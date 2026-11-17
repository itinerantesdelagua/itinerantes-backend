import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDaysInZone } from '../src/common/utils/time';
import type { Prisma } from '../src/generated/prisma/client';
import { MAIL_DRIVER } from '../src/infra/mail/mail.types';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { StorageService } from '../src/infra/storage/storage.service';
import { PAYMENT_GATEWAY } from '../src/infra/stripe/payment-gateway';
import { MoodleAccessService } from '../src/modules/moodle/moodle-access.service';
import { PaymentJobsService } from '../src/modules/payments/payment-jobs.service';
import { TransfersService } from '../src/modules/payments/transfers.service';
import { createTestApp } from './utils/create-test-app';
import { FakePaymentGateway } from './utils/fake-payment-gateway';
import { FakeStorage } from './utils/fake-storage';
import { createVerifiedUser, login } from './utils/identity';
import { MailCapture } from './utils/mail-capture';
import { scholarshipTypeIds, withScholarshipTypes } from './utils/scholarship-types';

/**
 * Pagos (Fase 05): HU-22 (Stripe Checkout), HU-23 (saldo tras beca: tarjeta y transferencia),
 * HU-24 (cuotas, cobro fallido, mora, regularización), HU-25 (Moodle), HU-26 (Mis pagos) y el
 * webhook firmado (idempotente, fuera de orden). Stripe se sustituye por `FakePaymentGateway`
 * (firma real del SDK); storage por `FakeStorage`. Ofertas propias con prefijo único.
 */
describe('Pagos (e2e) — Fase 05', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  /** key → id de los tipos de beca. */
  let T: Record<string, string>;
  let jobs: PaymentJobsService;
  let transfers: TransfersService;
  let moodle: MoodleAccessService;
  const mail = new MailCapture();
  const storage = new FakeStorage();
  const gateway = new FakePaymentGateway();

  const token = `py${randomUUID().slice(0, 6)}`;
  const slug = (s: string) => `e2e-${token}-${s}`;
  const now = new Date();
  const days = (n: number) => addDaysInZone(now, n);
  const ids: Record<string, string> = {};

  type User = { token: string; id: string; email: string };
  let ana: User; // MX: pago completo
  let beto: User; // MX: cupo, cancelación, saldo con transferencia
  let carla: User; // GT (USD): cuotas
  let dani: User; // MX: saldo con tarjeta
  let staff: User;

  const api = () => request(app.getHttpServer());
  const auth = (u: User) => ({ Authorization: `Bearer ${u.token}` });
  const get = (path: string, u: User) => api().get(`/api/v1${path}`).set(auth(u));
  const post = (path: string, u: User, body: object = {}) =>
    api().post(`/api/v1${path}`).set(auth(u)).send(body);
  const webhook = (event: Record<string, unknown>, secret?: string) => {
    const { body, signature } = gateway.sign(event, secret);
    return api()
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(body);
  };

  const offerData = (
    key: string,
    overrides: Partial<Prisma.OfferUncheckedCreateInput> = {},
  ): Prisma.OfferUncheckedCreateInput => ({
    slug: slug(key),
    name: `${token} ${key}`,
    type: 'DIPLOMA',
    modality: 'ONLINE_LIVE',
    origin: 'NAS',
    publicationStatus: 'PUBLISHED',
    publishedAt: days(-1),
    summary: `Resumen ${key}`,
    description: `Descripción ${key}`,
    learningOutcomes: [],
    enrollmentOpensAt: days(-10),
    enrollmentClosesAt: days(20),
    startsAt: days(30),
    endsAt: days(200),
    priceMxnCents: 1_020_000,
    priceUsdCents: 58_500,
    installmentsEnabled: true,
    installmentsMax: 3,
    ...overrides,
  });

  const newUser = async (overrides: Record<string, unknown> = {}): Promise<User> => {
    const { email, password } = await createVerifiedUser(app, mail, overrides);
    const body = await login(app, email, password);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { token: body.accessToken, id: user.id, email };
  };

  /** Postulación aprobada con saldo (como la deja `ApplicationWorkflowService.approve`). */
  const approvedApplication = async (user: User, offerId: string, currency: 'MXN' | 'USD') => {
    const profile = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const application = await prisma.application.create({
      data: {
        userId: user.id,
        offerId,
        kind: 'SCHOLARSHIP',
        status: 'APPROVED_PENDING_PAYMENT',
        applicantName: profile.fullName,
        applicantEmail: profile.email,
        phoneCountryCode: profile.phoneCountryCode,
        phoneNumber: profile.phoneNumber,
        countryCode: profile.countryCode,
        divisionName: profile.divisionName,
        municipalityName: profile.municipalityName,
        requestedScholarshipTypeId: T.AGUAS_LIBRES,
        assignedScholarshipTypeId: T.AGUAS_LIBRES,
        assignedScholarshipTypeName: 'Aguas Libres',
        assignedPercent: 50,
        currency,
        originalAmountCents: currency === 'MXN' ? 1_020_000 : 58_500,
        balanceCents: currency === 'MXN' ? 510_000 : 29_250,
        responseDueAt: days(5),
        submittedAt: days(-10),
        decidedAt: days(-1),
      },
    });
    await prisma.enrollment.create({
      data: {
        userId: user.id,
        offerId,
        applicationId: application.id,
        status: 'PENDING_PAYMENT',
        source: 'SCHOLARSHIP',
      },
    });
    return application.id;
  };

  const enrollmentOf = (userId: string, offerId: string) =>
    prisma.enrollment.findUniqueOrThrow({ where: { userId_offerId: { userId, offerId } } });
  const notifications = (userId: string, type: string) =>
    prisma.notification.findMany({ where: { userId, type: type as never } });

  beforeAll(async () => {
    app = await createTestApp({
      customize: (b) =>
        b
          .overrideProvider(MAIL_DRIVER)
          .useValue(mail)
          .overrideProvider(StorageService)
          .useValue(storage)
          .overrideProvider(PAYMENT_GATEWAY)
          .useValue(gateway),
    });
    prisma = app.get(PrismaService);
    T = await scholarshipTypeIds(prisma);
    jobs = app.get(PaymentJobsService);
    transfers = app.get(TransfersService);
    moodle = app.get(MoodleAccessService);
    ana = await newUser();
    beto = await newUser();
    dani = await newUser();
    staff = await newUser();
    const gt = await prisma.country.findUnique({ where: { code: 'GT' } });
    carla = await newUser({
      location: { countryCode: 'GT', divisionName: 'Guatemala', municipalityName: 'Mixco' },
      phone: { countryCode: gt?.phoneCode ?? '+502', number: '55123456' },
    });

    const create = async (key: string, o: Partial<Prisma.OfferUncheckedCreateInput> = {}) => {
      ids[key] = (await prisma.offer.create({ data: offerData(key, o) })).id;
    };
    await create('seat', { capacity: 1, installmentsEnabled: false, installmentsMax: null });
    await create('plan');
    await create('cancel');
    await create('balance', {
      scholarshipEnabled: true,
      scholarshipTypes: withScholarshipTypes(['AGUAS_LIBRES']),
    });
    await create('balance-card', {
      scholarshipEnabled: true,
      scholarshipTypes: withScholarshipTypes(['AGUAS_LIBRES']),
    });
    await create('free', { isFree: true, priceMxnCents: null, priceUsdCents: null });
    await create('moodle', {
      origin: 'MOODLE',
      type: 'COURSE',
      priceMxnCents: null,
      priceUsdCents: null,
      installmentsEnabled: false,
      installmentsMax: null,
    });
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  // --- HU-22 -------------------------------------------------------------------------------------

  describe('HU-22: pago completo con Stripe Checkout', () => {
    let paymentId: string;
    let sessionId: string;

    it('quote: precio en la moneda del perfil (MX → MXN, GT → USD) y métodos', async () => {
      const mx = await get(`/me/payments/quote?offerId=${ids.seat}`, ana).expect(200);
      expect(mx.body).toMatchObject({
        concept: 'FULL_PRICE',
        amount: { amountCents: 1_020_000, currency: 'MXN' },
        blocker: null,
        installments: null,
        bankTransfer: null,
      });
      expect(mx.body.methods).toEqual([
        { method: 'CARD', available: true, reason: null },
        { method: 'BANK_TRANSFER', available: false, reason: 'NOT_A_BALANCE' },
      ]);
      const usd = await get(`/me/payments/quote?offerId=${ids.plan}`, carla).expect(200);
      expect(usd.body.amount).toEqual({ amountCents: 58_500, currency: 'USD' });
      expect(usd.body.installments.options.map((o: { count: number }) => o.count)).toEqual([2, 3]);
    });

    it('validaciones: términos obligatorios y offerId XOR applicationId', async () => {
      const r = await post('/me/payments/checkout', ana, { offerId: ids.seat }).expect(400);
      expect(r.body.details[0]).toMatchObject({ field: 'termsAccepted' });
      await post('/me/payments/checkout', ana, { termsAccepted: true }).expect(400);
      const free = await post('/me/payments/checkout', ana, {
        offerId: ids.free,
        termsAccepted: true,
      }).expect(422);
      expect(free.body).toMatchObject({
        code: 'PAYMENT_NOT_ALLOWED',
        meta: { reason: 'FREE', requiredAction: 'ENROLL_FREE' },
      });
      const md = await post('/me/payments/checkout', ana, {
        offerId: ids.moodle,
        termsAccepted: true,
      }).expect(422);
      expect(md.body.meta.reason).toBe('MOODLE');
    });

    it('crea el checkout, retiene el cupo y reutiliza la sesión abierta', async () => {
      const r = await post('/me/payments/checkout', ana, {
        offerId: ids.seat,
        termsAccepted: true,
        amountCents: 1, // el cliente nunca decide el monto → campo rechazado
      }).expect(400);
      expect(r.body.details[0]).toMatchObject({ field: 'amountCents', code: 'UNKNOWN_FIELD' });

      const res = await post('/me/payments/checkout', ana, {
        offerId: ids.seat,
        termsAccepted: true,
      }).expect(201);
      expect(res.body).toMatchObject({ reused: false });
      expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
      paymentId = res.body.paymentId;
      sessionId = gateway.sessionForPayment(paymentId).id;
      expect(gateway.sessions.get(sessionId)!.amountCents).toBe(1_020_000);

      const hold = await enrollmentOf(ana.id, ids.seat);
      expect(hold).toMatchObject({ status: 'PENDING_PAYMENT', source: 'PAYMENT' });
      expect(hold.seatHoldExpiresAt!.getTime()).toBeGreaterThan(Date.now());

      const again = await post('/me/payments/checkout', ana, {
        offerId: ids.seat,
        termsAccepted: true,
      }).expect(201);
      expect(again.body).toMatchObject({ paymentId, reused: true });

      // Cupo 1 retenido por el checkout de Ana.
      const quote = await get(`/me/payments/quote?offerId=${ids.seat}`, beto).expect(200);
      expect(quote.body.blocker).toMatchObject({ code: 'OFFER_SOLD_OUT' });
      await post('/me/payments/checkout', beto, { offerId: ids.seat, termsAccepted: true }).expect(
        409,
      );
      const ficha = await api()
        .get(`/api/v1/offers/${slug('seat')}`)
        .set(auth(ana))
        .expect(200);
      expect(ficha.body.actions.map((a: { type: string }) => a.type)).toEqual(['CONTINUE_PAYMENT']);
    });

    it('"Procesando pago…": PENDING hasta que Stripe confirma', async () => {
      const r = await get(`/me/payments/${paymentId}`, ana).expect(200);
      expect(r.body).toMatchObject({ status: 'PENDING', folio: expect.stringMatching(/^PAG-/) });
      expect(r.body.checkout.url).toContain(sessionId);
    });

    it('webhook firmado: firma inválida → 400; confirmación → inscripción ACTIVE + aviso', async () => {
      gateway.completeSession(sessionId);
      const event = gateway.checkoutEvent('checkout.session.completed', sessionId);
      const bad = await webhook(event, 'whsec_otro_secreto').expect(400);
      expect(bad.body.code).toBe('PAYMENT_WEBHOOK_SIGNATURE_INVALID');
      await api()
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event))
        .expect(400);

      const ok = await webhook(event).expect(200);
      expect(ok.body).toEqual({ received: true, duplicate: false, ignored: false });
      const payment = await get(`/me/payments/${paymentId}`, ana).expect(200);
      expect(payment.body).toMatchObject({
        status: 'PAID',
        method: 'CARD',
        card: { brand: 'visa', last4: '4242' },
        receiptAvailable: true,
        checkout: null,
      });
      const enrollment = await enrollmentOf(ana.id, ids.seat);
      expect(enrollment).toMatchObject({
        status: 'ACTIVE',
        source: 'PAYMENT',
        seatHoldExpiresAt: null,
      });
      expect(await notifications(ana.id, 'PAYMENT_CONFIRMED')).toHaveLength(1);

      // Idempotencia: mismo evento → duplicate; evento "expired" fuera de orden → sigue PAID.
      const dup = await webhook(event).expect(200);
      expect(dup.body.duplicate).toBe(true);
      await webhook(gateway.checkoutEvent('checkout.session.expired', sessionId)).expect(200);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
        'PAID',
      );
      expect(await notifications(ana.id, 'PAYMENT_CONFIRMED')).toHaveLength(1);
      await webhook({ ...gateway.checkoutEvent('customer.created', sessionId) })
        .expect(200)
        .expect((r) => expect(r.body.ignored).toBe(true));
    });

    it('ya inscrito → no se cobra de nuevo; ficha con [Ir a mi aula]', async () => {
      const r = await post('/me/payments/checkout', ana, {
        offerId: ids.seat,
        termsAccepted: true,
      }).expect(409);
      expect(r.body.code).toBe('ENROLLMENT_ALREADY_EXISTS');
      const ficha = await api()
        .get(`/api/v1/offers/${slug('seat')}`)
        .set(auth(ana))
        .expect(200);
      expect(ficha.body.actions.map((a: { type: string }) => a.type)).toEqual(['GO_TO_CLASSROOM']);
    });

    it('recibo PDF propio; pago ajeno → 404', async () => {
      const pdf = await get(`/me/payments/${paymentId}/receipt`, ana)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).toString('latin1', 0, 8)).toBe('%PDF-1.4');
      await get(`/me/payments/${paymentId}`, beto).expect(404);
      await get(`/me/payments/${paymentId}/receipt`, beto).expect(404);
      await get('/me/payments/no-es-uuid', beto).expect(404);
    });

    it('cancelar: libera el cupo y la ficha vuelve a [Inscribirme y pagar]', async () => {
      const res = await post('/me/payments/checkout', beto, {
        offerId: ids.cancel,
        termsAccepted: true,
      }).expect(201);
      await post(`/me/payments/${res.body.paymentId}/cancel`, beto).expect(204);
      const p = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.paymentId } });
      expect(p.status).toBe('CANCELLED');
      expect((await enrollmentOf(beto.id, ids.cancel)).status).toBe('CANCELLED');
      await post(`/me/payments/${res.body.paymentId}/cancel`, beto).expect(409);
      const list = await get('/me/payments', beto).expect(200);
      expect(list.body.data).toHaveLength(0); // los cancelados no son pagos
    });
  });

  // --- HU-24 -------------------------------------------------------------------------------------

  describe('HU-24: cuotas con cobro automático', () => {
    let planId: string;

    it('exige autorización de débito y un número de cuotas disponible', async () => {
      await post('/me/payments/checkout', carla, {
        offerId: ids.plan,
        termsAccepted: true,
        installmentCount: 3,
      }).expect(400);
      const r = await post('/me/payments/checkout', carla, {
        offerId: ids.plan,
        termsAccepted: true,
        installmentCount: 4,
        autoDebitAuthorized: true,
      }).expect(422);
      expect(r.body).toMatchObject({
        code: 'PAYMENT_INSTALLMENTS_NOT_AVAILABLE',
        meta: { allowed: [2, 3] },
      });
    });

    it('1.ª cuota en Checkout (USD) → plan "Al día", inscripción INSTALLMENTS, tarjeta guardada', async () => {
      const res = await post('/me/payments/checkout', carla, {
        offerId: ids.plan,
        termsAccepted: true,
        installmentCount: 3,
        autoDebitAuthorized: true,
      }).expect(201);
      const session = gateway.sessionForPayment(res.body.paymentId);
      expect(session.amountCents).toBe(19_500); // 58,500 / 3
      gateway.completeSession(session.id);
      // Fuera de orden: llega primero payment_intent.succeeded y luego checkout.session.completed.
      await webhook(
        gateway.intentEvent('payment_intent.succeeded', session.paymentIntentId!),
      ).expect(200);
      await webhook(gateway.checkoutEvent('checkout.session.completed', session.id)).expect(200);

      const plans = await get('/me/payments/plans', carla).expect(200);
      expect(plans.body.data).toHaveLength(1);
      const plan = plans.body.data[0];
      planId = plan.id;
      expect(plan).toMatchObject({
        status: 'CURRENT',
        installmentCount: 3,
        paidCount: 1,
        total: { amountCents: 58_500, currency: 'USD' },
        card: { last4: '4242' },
        nextCharge: { sequence: 2, amount: { amountCents: 19_500, currency: 'USD' } },
      });
      expect(await enrollmentOf(carla.id, ids.plan)).toMatchObject({
        status: 'ACTIVE',
        source: 'INSTALLMENTS',
      });
      const dbPlan = await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } });
      expect(dbPlan.stripePaymentMethodId).toMatch(/^pm_/);
      expect(await notifications(carla.id, 'PAYMENT_CONFIRMED')).toHaveLength(1);
    });

    it('aviso de cuota próxima (Dashboard + notificación, una sola vez)', async () => {
      await prisma.installment.updateMany({
        where: { planId, sequence: 2 },
        data: { dueAt: days(3) },
      });
      const dash = await get('/me/dashboard', carla).expect(200);
      expect(dash.body.payments.upcomingInstallments).toHaveLength(1);
      expect(dash.body.payments.upcomingInstallments[0]).toMatchObject({
        type: 'INSTALLMENT_UPCOMING',
        card: { last4: '4242' },
      });
      await jobs.runOnce(new Date());
      await jobs.runOnce(new Date());
      expect(await notifications(carla.id, 'INSTALLMENT_UPCOMING')).toHaveLength(1);
    });

    it('cobro fallido → "Cobro fallido" + aviso fijado con reintento programado', async () => {
      await prisma.installment.updateMany({
        where: { planId, sequence: 2 },
        data: { dueAt: days(-1) },
      });
      gateway.nextCharges.push('failed');
      const result = await jobs.runOnce(new Date());
      expect(result.charged).toBeGreaterThanOrEqual(1);
      const plan = await get(`/me/payments/plans/${planId}`, carla).expect(200);
      expect(plan.body).toMatchObject({ status: 'PAST_DUE', canPayNow: true });
      expect(plan.body.installments[1]).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(plan.body.installments[1].nextRetryAt).not.toBeNull();
      const [failed] = await notifications(carla.id, 'INSTALLMENT_FAILED');
      expect(failed).toMatchObject({ priority: 'HIGH', pinned: true });
      const summary = await get('/me/payments/summary', carla).expect(200);
      expect(summary.body.alerts.map((a: { type: string }) => a.type)).toContain(
        'INSTALLMENT_FAILED',
      );
      // Correr el job otra vez no vuelve a cobrar antes del reintento.
      const calls = gateway.offSessionCalls.length;
      await jobs.runOnce(new Date());
      expect(gateway.offSessionCalls.length).toBe(calls);
    });

    it('mora a los 15 días → "En mora", acceso suspendido y aviso', async () => {
      await prisma.installmentPlan.update({
        where: { id: planId },
        data: { failedSince: days(-16) },
      });
      await prisma.installment.updateMany({
        where: { planId, sequence: 2 },
        data: { nextRetryAt: days(2) },
      });
      await jobs.runOnce(new Date());
      const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } });
      expect(plan.status).toBe('DELINQUENT');
      expect((await enrollmentOf(carla.id, ids.plan)).status).toBe('SUSPENDED');
      expect(await notifications(carla.id, 'PLAN_DELINQUENT')).toHaveLength(1);
      const aula = await get(`/me/classrooms/${ids.plan}`, carla).expect(403);
      expect(aula.body.code).toBe('ENROLLMENT_SUSPENDED');
      const ficha = await api()
        .get(`/api/v1/offers/${slug('plan')}`)
        .set(auth(carla))
        .expect(200);
      expect(ficha.body.actions[0].type).toBe('REGULARIZE_PAYMENT');
    });

    it('[Pagar ahora] rechazado → 422; aprobado → regulariza, desfija avisos y reactiva acceso', async () => {
      gateway.nextCharges.push('failed');
      const bad = await post(`/me/payments/plans/${planId}/pay-now`, carla).expect(422);
      expect(bad.body.code).toBe('PAYMENT_CHARGE_FAILED');

      const ok = await post(`/me/payments/plans/${planId}/pay-now`, carla).expect(200);
      expect(ok.body).toMatchObject({ status: 'CURRENT', paidCount: 2, failedSince: null });
      expect((await enrollmentOf(carla.id, ids.plan)).status).toBe('ACTIVE');
      const pinned = await prisma.notification.count({ where: { userId: carla.id, pinned: true } });
      expect(pinned).toBe(0);
      expect(await notifications(carla.id, 'INSTALLMENT_PAID')).toHaveLength(1);
      await post(`/me/payments/plans/${planId}/pay-now`, carla).expect(409);
    });

    it('[Actualizar tarjeta]: Checkout en modo setup guarda la tarjeta nueva', async () => {
      const r = await post(`/me/payments/plans/${planId}/card-update`, carla).expect(201);
      expect(r.body.checkoutUrl).toMatch(/checkout\.stripe\.test/);
      const setup = gateway.lastSetupSession(planId);
      gateway.completeSession(setup.id);
      await webhook(gateway.checkoutEvent('checkout.session.completed', setup.id)).expect(200);
      const plan = await get(`/me/payments/plans/${planId}`, carla).expect(200);
      expect(plan.body.card).toEqual({ brand: 'mastercard', last4: '4444' });
      await post(`/me/payments/plans/${planId}/card-update`, beto).expect(404);
    });

    it('última cuota → plan Completado; historial con las 3 cuotas', async () => {
      await prisma.installment.updateMany({
        where: { planId, sequence: 3 },
        data: { dueAt: days(-1) },
      });
      await jobs.runOnce(new Date());
      const plan = await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } });
      expect(plan.status).toBe('COMPLETED');
      const list = await get('/me/payments', carla).expect(200);
      expect(list.body.data.map((p: { conceptLabel: string }) => p.conceptLabel)).toEqual([
        'Cuota 3 de 3',
        'Cuota 2 de 3',
        'Cuota 1 de 3',
      ]);
      expect(list.body.data.every((p: { status: string }) => p.status === 'PAID')).toBe(true);
    });
  });

  // --- HU-23 -------------------------------------------------------------------------------------

  describe('HU-23: saldo tras beca', () => {
    let applicationId: string;
    let transferId: string;

    beforeAll(async () => {
      applicationId = await approvedApplication(beto, ids.balance, 'MXN');
    });

    it('quote: saldo, fecha límite, transferencia con datos bancarios y referencia', async () => {
      const r = await get(`/me/payments/quote?applicationId=${applicationId}`, beto).expect(200);
      expect(r.body).toMatchObject({
        concept: 'BALANCE',
        amount: { amountCents: 510_000, currency: 'MXN' },
        application: {
          assignedScholarshipTypeId: T.AGUAS_LIBRES,
          assignedScholarshipType: { key: 'AGUAS_LIBRES', name: 'Aguas Libres', minPercent: 50 },
          assignedPercent: 50,
          originalAmount: { amountCents: 1_020_000 },
        },
        bankTransfer: {
          clabe: '000000000000000000',
          reference: expect.stringMatching(/^EIA BEC-\d{6}$/),
          amount: { amountCents: 510_000, currency: 'MXN' },
        },
        blocker: null,
      });
      await get(`/me/payments/quote?applicationId=${applicationId}`, ana).expect(404);
    });

    it('comprobante: tipo inválido → 422; subida → "Pendiente de validación"; reemplazo', async () => {
      const invalid = await post('/me/payments/transfers/upload-url', beto, {
        applicationId,
        fileName: 'x.heic',
        contentType: 'image/heic',
        sizeBytes: 1000,
      }).expect(422);
      expect(invalid.body.code).toBe('PAYMENT_TRANSFER_INVALID_FILE');
      // Límite del comprobante: 15 MB (antes 5 MB).
      const heavy = await post('/me/payments/transfers/upload-url', beto, {
        applicationId,
        fileName: 'comprobante.pdf',
        contentType: 'application/pdf',
        sizeBytes: 15 * 1024 * 1024 + 1,
      }).expect(422);
      expect(heavy.body.code).toBe('PAYMENT_TRANSFER_INVALID_FILE');
      await post('/me/payments/transfers/upload-url', beto, {
        applicationId,
        fileName: 'comprobante.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12 * 1024 * 1024,
      }).expect(201);

      const upload = async (name: string) => {
        const u = await post('/me/payments/transfers/upload-url', beto, {
          applicationId,
          fileName: name,
          contentType: 'application/pdf',
          sizeBytes: 200_000,
        }).expect(201);
        storage.put(u.body.key, 'application/pdf', 200_000);
        return u.body.key as string;
      };
      const key1 = await upload('comprobante.pdf');
      const body = {
        applicationId,
        key: key1,
        fileName: 'comprobante.pdf',
        declaredAmountCents: 510_000,
        paidOn: new Date().toISOString().slice(0, 10),
        trackingKey: 'MBAN0100261103',
      };
      await post('/me/payments/transfers', beto, {
        ...body,
        key: 'payments/transfers/otro/x.pdf',
      }).expect(422);
      const r = await post('/me/payments/transfers', beto, body).expect(201);
      transferId = r.body.id;
      expect(r.body).toMatchObject({
        status: 'PENDING_VALIDATION',
        method: 'BANK_TRANSFER',
        amount: { amountCents: 510_000, currency: 'MXN' },
        transfer: { trackingKey: 'MBAN0100261103', proofFileName: 'comprobante.pdf' },
        receiptAvailable: false,
      });
      const app1 = await get(`/me/applications/${applicationId}`, beto).expect(200);
      expect(app1.body.action).toMatchObject({
        type: 'PAYMENT_IN_VALIDATION',
        enabled: false,
        reason: 'TRANSFER_PENDING_VALIDATION',
      });
      expect(app1.body.response.transferPendingValidation).toBe(true);

      // Con comprobante pendiente no se puede pagar con tarjeta.
      const card = await post('/me/payments/checkout', beto, {
        applicationId,
        termsAccepted: true,
      }).expect(409);
      expect(card.body.code).toBe('PAYMENT_TRANSFER_PENDING');

      const key2 = await upload('comprobante-2.pdf');
      const replaced = await post('/me/payments/transfers', beto, { ...body, key: key2 }).expect(
        201,
      );
      expect(replaced.body.id).toBe(transferId);
      expect(storage.deleted).toContain(key1);
      const proof = await get(`/me/payments/${transferId}/transfer-proof`, beto).expect(200);
      expect(proof.body.url).toContain(key2);
    });

    it('Fase 06 (servicio): rechazo con motivo → [Subir comprobante]; validación → Inscrita', async () => {
      await transfers.rejectTransfer(transferId, staff.id, {
        reason: 'ILLEGIBLE',
        note: 'No se lee la clave',
      });
      const app1 = await get(`/me/applications/${applicationId}`, beto).expect(200);
      expect(app1.body.action.type).toBe('UPLOAD_TRANSFER_PROOF');
      expect(await notifications(beto.id, 'TRANSFER_REJECTED')).toHaveLength(1);
      const summary = await get('/me/payments/summary', beto).expect(200);
      expect(summary.body.alerts[0]).toMatchObject({
        type: 'TRANSFER_REJECTED',
        paymentId: transferId,
      });
      const rejected = await get(`/me/payments/${transferId}`, beto).expect(200);
      expect(rejected.body.transfer).toMatchObject({ rejectionReason: 'ILLEGIBLE' });

      const u = await post('/me/payments/transfers/upload-url', beto, {
        applicationId,
        fileName: 'nuevo.png',
        contentType: 'image/png',
        sizeBytes: 50_000,
      }).expect(201);
      storage.put(u.body.key, 'image/png', 50_000);
      const second = await post('/me/payments/transfers', beto, {
        applicationId,
        key: u.body.key,
        declaredAmountCents: 510_000,
        paidOn: new Date().toISOString().slice(0, 10),
        trackingKey: 'ABC123',
      }).expect(201);
      expect(second.body.id).not.toBe(transferId);

      await expect(
        transfers.approveTransfer(second.body.id, staff.id, {
          receivedAmountCents: 500_000,
          receivedOn: new Date(),
        }),
      ).rejects.toMatchObject({
        code: 'PAYMENT_TRANSFER_AMOUNT_MISMATCH',
        meta: { differenceCents: 10_000 },
      });
      await transfers.approveTransfer(second.body.id, staff.id, {
        receivedAmountCents: 510_000,
        receivedOn: new Date(),
      });
      const app2 = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
      expect(app2).toMatchObject({ status: 'ENROLLED', pendingTransferSince: null });
      expect((await enrollmentOf(beto.id, ids.balance)).status).toBe('ACTIVE');
      expect(await notifications(beto.id, 'TRANSFER_VALIDATED')).toHaveLength(1);
      const validated = await get(`/me/payments/${second.body.id}`, beto).expect(200);
      expect(validated.body).toMatchObject({ status: 'VALIDATED', receiptAvailable: true });
      await get(`/me/payments/${second.body.id}/receipt`, beto).expect(200);
    });

    it('fuera de México no hay transferencia', async () => {
      const usdApp = await approvedApplication(carla, ids['balance-card'], 'USD');
      const q = await get(`/me/payments/quote?applicationId=${usdApp}`, carla).expect(200);
      expect(q.body.methods[1]).toEqual({
        method: 'BANK_TRANSFER',
        available: false,
        reason: 'NOT_MEXICO',
      });
      expect(q.body.amount).toEqual({ amountCents: 29_250, currency: 'USD' });
      const r = await post('/me/payments/transfers/upload-url', carla, {
        applicationId: usdApp,
        fileName: 'c.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1000,
      }).expect(422);
      expect(r.body).toMatchObject({
        code: 'PAYMENT_TRANSFER_NOT_AVAILABLE',
        meta: { reason: 'NOT_MEXICO' },
      });
    });

    it('saldo con tarjeta → [Continuar pago] → Inscrita (markEnrolled) al confirmar', async () => {
      const appId = await approvedApplication(dani, ids['balance-card'], 'MXN');
      const full = await post('/me/payments/checkout', dani, {
        offerId: ids['balance-card'],
        termsAccepted: true,
      }).expect(422);
      expect(full.body.meta.reason).toBe('PAY_BALANCE');

      const res = await post('/me/payments/checkout', dani, {
        applicationId: appId,
        termsAccepted: true,
      }).expect(201);
      const session = gateway.sessionForPayment(res.body.paymentId);
      expect(session.amountCents).toBe(510_000);
      const card = await get(`/me/applications/${appId}`, dani).expect(200);
      expect(card.body.action.type).toBe('CONTINUE_PAYMENT');

      gateway.completeSession(session.id);
      // Sin webhook: al consultar el pago se concilia con Stripe (webhook tardío).
      await prisma.payment.update({
        where: { id: res.body.paymentId },
        data: { updatedAt: days(-1) },
      });
      const paid = await get(`/me/payments/${res.body.paymentId}`, dani).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', conceptLabel: 'Saldo tras beca' });
      const app = await prisma.application.findUniqueOrThrow({ where: { id: appId } });
      expect(app.status).toBe('ENROLLED');
      expect(app.paymentStartedAt).not.toBeNull();
      expect((await enrollmentOf(dani.id, ids['balance-card'])).status).toBe('ACTIVE');
      // El webhook que llega después no duplica nada.
      await webhook(gateway.checkoutEvent('checkout.session.completed', session.id)).expect(200);
      expect(await notifications(dani.id, 'PAYMENT_CONFIRMED')).toHaveLength(1);
    });
  });

  // --- HU-25 -------------------------------------------------------------------------------------

  describe('HU-25: acceso Moodle', () => {
    it('correo en la lista → se vincula al verificar el correo y notifica', async () => {
      const email = `moodle-${token}@example.com`;
      const result = await moodle.importRoster(
        ids.moodle,
        [email.toUpperCase(), ' x ', email],
        null,
      );
      expect(result).toMatchObject({ added: 1, invalid: ['x'] });
      const user = await newUser({ email });
      const enrollment = await enrollmentOf(user.id, ids.moodle);
      expect(enrollment).toMatchObject({
        status: 'ACTIVE',
        origin: 'MOODLE',
        source: 'MOODLE_LIST',
      });
      expect(await notifications(user.id, 'MOODLE_ENROLLMENT_LINKED')).toHaveLength(1);
      const again = await post('/me/moodle-access/link', user).expect(200);
      expect(again.body).toEqual({ found: true, linked: [] });
      const list = await get('/me/payments/summary', user).expect(200);
      expect(list.body).toMatchObject({ hasPayments: false, moodleOnly: true });
    });

    it('sin lista → found=false; código válido (un solo uso), usado, inválido y vencido', async () => {
      const r = await post('/me/moodle-access/link', ana).expect(200);
      expect(r.body).toEqual({ found: false, linked: [] });
      const aula = await get(`/me/classrooms/${ids.moodle}`, ana).expect(403);
      expect(aula.body.code).toBe('ENROLLMENT_REQUIRED');

      const [code, expired] = await moodle.generateCodes(ids.moodle, 2, null);
      const ok = await post('/me/moodle-access/redeem', ana, { code: code.toLowerCase() }).expect(
        200,
      );
      expect(ok.body.linked[0]).toMatchObject({ origin: 'MOODLE', offer: { id: ids.moodle } });
      expect((await enrollmentOf(ana.id, ids.moodle)).source).toBe('MOODLE_ACCESS_CODE');

      const used = await post('/me/moodle-access/redeem', dani, { code }).expect(409);
      expect(used.body.code).toBe('MOODLE_CODE_USED');
      const invalid = await post('/me/moodle-access/redeem', dani, { code: 'ZZZZ-ZZZZ' }).expect(
        422,
      );
      expect(invalid.body.code).toBe('MOODLE_CODE_INVALID');
      await prisma.moodleAccessCode.updateMany({
        where: { offerId: ids.moodle, usedAt: null },
        data: { expiresAt: days(-1) },
      });
      const exp = await post('/me/moodle-access/redeem', dani, { code: expired }).expect(422);
      expect(exp.body.code).toBe('MOODLE_CODE_EXPIRED');
    });
  });

  // --- Sin Stripe configurado ----------------------------------------------------------------------

  describe('sin llaves de Stripe', () => {
    afterEach(() => {
      gateway.configured = true;
      gateway.webhooksConfigured = true;
    });

    it('checkout → 503 PAYMENTS_NOT_CONFIGURED; webhook → 503; quote indica tarjeta no disponible', async () => {
      gateway.configured = false;
      gateway.webhooksConfigured = false;
      const r = await post('/me/payments/checkout', dani, {
        offerId: ids.cancel,
        termsAccepted: true,
      }).expect(503);
      expect(r.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
      const q = await get(`/me/payments/quote?offerId=${ids.cancel}`, dani).expect(200);
      expect(q.body.methods[0]).toEqual({
        method: 'CARD',
        available: false,
        reason: 'PAYMENTS_NOT_CONFIGURED',
      });
      await webhook(
        gateway.checkoutEvent('checkout.session.completed', [...gateway.sessions.keys()][0]),
      ).expect(503);
    });
  });
});

/** La app real (sin override) arranca sin llaves de Stripe y responde 503 en el checkout. */
describe('Pagos (e2e) — StripePaymentGateway sin llaves', () => {
  let app: NestExpressApplication;
  const mail = new MailCapture();

  beforeAll(async () => {
    app = await createTestApp({
      customize: (b) => b.overrideProvider(MAIL_DRIVER).useValue(mail),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /me/payments/checkout → 503 y el webhook → 503', async () => {
    const { email, password } = await createVerifiedUser(app, mail);
    const { accessToken } = await login(app, email, password);
    const r = await request(app.getHttpServer())
      .post('/api/v1/me/payments/checkout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ offerId: randomUUID(), termsAccepted: true })
      .expect(503);
    expect(r.body.code).toBe('PAYMENTS_NOT_CONFIGURED');
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=abc')
      .send('{}')
      .expect(503);
  });
});
