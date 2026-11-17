import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDaysInZone, addHours } from '../src/common/utils/time';
import type { Prisma } from '../src/generated/prisma/client';
import { MAIL_DRIVER } from '../src/infra/mail/mail.types';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { StorageService } from '../src/infra/storage/storage.service';
import { ApplicationJobsService } from '../src/modules/applications/application-jobs.service';
import { ApplicationWorkflowService } from '../src/modules/applications/application-workflow.service';
import { createTestApp } from './utils/create-test-app';
import { FakeStorage } from './utils/fake-storage';
import { createVerifiedUser, login } from './utils/identity';
import { MailCapture } from './utils/mail-capture';
import { scholarshipTypeIds, withScholarshipTypes } from './utils/scholarship-types';

/**
 * Postulaciones (Fase 04): HU-19 (beca), HU-20 (convocatoria), HU-21 (seguimiento) + transiciones de
 * revisión que reutilizará la Fase 06 (vía ApplicationWorkflowService) y jobs de vencimiento.
 * Ofertas propias con fechas RELATIVAS a ahora (prefijo único) y usuarios nuevos por ejecución.
 */
describe('Postulaciones (e2e) — Fase 04', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let workflow: ApplicationWorkflowService;
  let jobs: ApplicationJobsService;
  const mail = new MailCapture();
  const storage = new FakeStorage();

  const token = `ap${randomUUID().slice(0, 6)}`;
  const slug = (s: string) => `e2e-${token}-${s}`;
  const now = new Date();
  const days = (n: number) => addDaysInZone(now, n);
  const ids: Record<string, string> = {};
  const MB = 1024 * 1024;
  const LETTER = 'Quiero replicar lo aprendido en mi comunidad. '.repeat(20); // ~920
  const ANSWER = 'Trabajo con el comité de agua de mi territorio. '.repeat(8); // ~390

  type User = { token: string; id: string; email: string };
  let ana: User; // beca
  let beto: User; // convocatoria
  let carla: User; // ajena / otros casos
  let staff: User;
  /** key → id de los tipos de beca. */
  let T: Record<string, string>;

  const api = () => request(app.getHttpServer());
  const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });
  const get = (path: string, user: User) => api().get(`/api/v1${path}`).set(auth(user));
  const post = (path: string, user: User, body: object = {}) =>
    api().post(`/api/v1${path}`).set(auth(user)).send(body);
  const patch = (path: string, user: User, body: object = {}) =>
    api().patch(`/api/v1${path}`).set(auth(user)).send(body);
  const del = (path: string, user: User) => api().delete(`/api/v1${path}`).set(auth(user));

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
    endsAt: days(90),
    priceMxnCents: 1_020_000,
    priceUsdCents: 58_500,
    scholarshipEnabled: true,
    scholarshipTypes: withScholarshipTypes(['AGUA_VIVA', 'AGUAS_LIBRES', 'SPECIAL']),
    scholarshipOpensAt: days(-5),
    scholarshipClosesAt: days(10),
    ...overrides,
  });

  const newUser = async (): Promise<User> => {
    const { email, password } = await createVerifiedUser(app, mail);
    const body = await login(app, email, password);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    return { token: body.accessToken, id: user.id, email };
  };

  const notificationsOf = (userId: string, type: string) =>
    prisma.notification.findMany({ where: { userId, type: type as never } });

  beforeAll(async () => {
    app = await createTestApp({
      customize: (b) =>
        b
          .overrideProvider(MAIL_DRIVER)
          .useValue(mail)
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    prisma = app.get(PrismaService);
    workflow = app.get(ApplicationWorkflowService);
    jobs = app.get(ApplicationJobsService);
    T = await scholarshipTypeIds(prisma);
    scholarshipBody.requestedScholarshipTypeId = T.AGUAS_LIBRES;
    [ana, beto, carla, staff] = [
      await newUser(),
      await newUser(),
      await newUser(),
      await newUser(),
    ];

    const create = async (key: string, overrides: Partial<Prisma.OfferUncheckedCreateInput>) => {
      ids[key] = (await prisma.offer.create({ data: offerData(key, overrides) })).id;
    };
    await create('diploma', {});
    await create('diploma2', {});
    await create('diploma-closed', {
      scholarshipOpensAt: days(-20),
      scholarshipClosesAt: days(-1),
    });
    await create('diploma-soon', { scholarshipOpensAt: days(3), scholarshipClosesAt: days(12) });
    await create('course', { type: 'COURSE', scholarshipEnabled: false, scholarshipTypes: {} });
    await create('draft', { publicationStatus: 'DRAFT' });
    const call = {
      type: 'OPEN_CALL' as const,
      modality: 'IN_PERSON' as const,
      isFree: true,
      priceMxnCents: null,
      priceUsdCents: null,
      scholarshipEnabled: false,
      scholarshipTypes: {},
      scholarshipOpensAt: null,
      scholarshipClosesAt: null,
      venueName: 'Sede E2E',
      venueCity: 'Oaxaca',
      eligibilityText: 'Dirigida a mujeres lideresas de Centroamérica y México.',
      eligibleCountryCodes: ['MX', 'GT'],
      requiresTravel: true,
    };
    await create('call', call);
    await create('call2', call);
    await create('call-paid', {
      ...call,
      isFree: false,
      priceMxnCents: 200_000,
      priceUsdCents: 12_000,
    });
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  const scholarshipBody: Record<string, unknown> = {
    age: 34,
    intentLetter: LETTER,
    evidenceLinks: ['https://www.youtube.com/watch?v=abc123'],
    termsAccepted: true,
  };
  const openCallBody = {
    eligibilityConfirmed: true,
    organization: 'Colectivo Agua Viva',
    organizationRole: 'Coordinadora',
    experience: ANSWER,
    motivation: ANSWER,
    canTravel: true,
    termsAccepted: true,
  };

  /** Sube y confirma una evidencia (flujo URL firmada → PUT → confirmación). */
  const addEvidence = async (user: User, applicationId: string, name = 'foto.jpg') => {
    const url = await post(`/me/applications/${applicationId}/documents/upload-url`, user, {
      fileName: name,
      contentType: 'image/jpeg',
      sizeBytes: 2 * MB,
    }).expect(200);
    storage.put(url.body.key, 'image/jpeg', 2 * MB);
    return post(`/me/applications/${applicationId}/documents`, user, {
      key: url.body.key,
      fileName: name,
    }).expect(201);
  };

  it('todas las rutas exigen sesión (401)', async () => {
    for (const path of ['/me/applications', '/me/applications/opportunities?kind=SCHOLARSHIP']) {
      const res = await api().get(`/api/v1${path}`).expect(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }
  });

  // -----------------------------------------------------------------------------------------------
  describe('Becas disponibles / Convocatorias abiertas', () => {
    it('lista becas abiertas y próximas (no cerradas) con niveles en mi moneda', async () => {
      const res = await get('/me/applications/opportunities?kind=SCHOLARSHIP', carla).expect(200);
      const mine = res.body.data.filter((o: { offer: { slug: string } }) =>
        o.offer.slug.startsWith(`e2e-${token}`),
      );
      const bySlug = Object.fromEntries(
        mine.map((o: { offer: { slug: string } }) => [o.offer.slug, o]),
      );
      expect(Object.keys(bySlug).sort()).toEqual(
        [slug('diploma'), slug('diploma-soon'), slug('diploma2')].sort(),
      );
      expect(bySlug[slug('diploma')]).toMatchObject({
        kind: 'SCHOLARSHIP',
        window: { state: 'OPEN', reason: null },
        price: { amountCents: 1_020_000, currency: 'MXN' },
        myApplication: null,
        canApply: true,
        enrolled: false,
      });
      expect(
        bySlug[slug('diploma')].scholarshipTypes.map(
          (t: { scholarshipType: { key: string } }) => t.scholarshipType.key,
        ),
      ).toEqual(['AGUA_VIVA', 'AGUAS_LIBRES', 'SPECIAL']);
      expect(bySlug[slug('diploma-soon')]).toMatchObject({
        window: { state: 'UPCOMING', reason: 'SCHOLARSHIP_NOT_OPEN_YET' },
        canApply: false,
      });
      // Abiertas antes que próximas.
      const order = mine.map((o: { offer: { slug: string } }) => o.offer.slug);
      expect(order.indexOf(slug('diploma-soon'))).toBe(order.length - 1);
    });

    it('convocatorias: elegibilidad y marca de "vistas" (widget nuevas)', async () => {
      const before = await get('/me/dashboard', carla).expect(200);
      expect(before.body.openCalls.newCount).toBeGreaterThanOrEqual(3);

      const res = await get('/me/applications/opportunities?kind=OPEN_CALL', carla).expect(200);
      const call = res.body.data.find(
        (o: { offer: { slug: string } }) => o.offer.slug === slug('call'),
      );
      expect(call).toMatchObject({
        kind: 'OPEN_CALL',
        price: null,
        scholarshipTypes: [],
        offer: { venue: { name: 'Sede E2E', city: 'Oaxaca' } },
        eligibility: {
          text: 'Dirigida a mujeres lideresas de Centroamérica y México.',
          requiresTravel: true,
          eligible: true,
          reasons: [],
        },
      });
      expect(call.eligibility.countries).toEqual([
        { code: 'MX', name: 'México' },
        { code: 'GT', name: 'Guatemala' },
      ]);
      const after = await get('/me/dashboard', carla).expect(200);
      expect(after.body.openCalls.newCount).toBe(0);
    });

    it('kind obligatorio y válido', async () => {
      const res = await get('/me/applications/opportunities', carla).expect(400);
      expect(res.body.details[0].field).toBe('kind');
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('HU-19 Postulación a beca', () => {
    let appId: string;

    it('reglas para iniciar: no aplica, ventana cerrada, borrador, oferta inexistente', async () => {
      const course = await post('/me/applications', ana, { offerId: ids.course }).expect(422);
      expect(course.body.code).toBe('APPLICATION_NOT_ALLOWED');

      const closed = await post('/me/applications', ana, { offerId: ids['diploma-closed'] }).expect(
        422,
      );
      expect(closed.body).toMatchObject({
        code: 'APPLICATION_WINDOW_CLOSED',
        meta: { reason: 'SCHOLARSHIP_CLOSED', availableFrom: null },
      });
      const soon = await post('/me/applications', ana, { offerId: ids['diploma-soon'] }).expect(
        422,
      );
      expect(soon.body.meta).toMatchObject({
        reason: 'SCHOLARSHIP_NOT_OPEN_YET',
        availableFrom: days(3).toISOString(),
      });

      for (const offerId of [ids.draft, randomUUID()]) {
        const res = await post('/me/applications', ana, { offerId }).expect(404);
        expect(res.body.code).toBe('OFFER_NOT_AVAILABLE');
      }
      const invalid = await post('/me/applications', ana, { offerId: 'nope' }).expect(400);
      expect(invalid.body.code).toBe('VALIDATION_ERROR');
    });

    it('crea el borrador con datos del perfil y pendientes para enviar', async () => {
      const res = await post('/me/applications', ana, {
        offerId: ids.diploma,
        requestedScholarshipTypeId: T.AGUAS_LIBRES,
      }).expect(201);
      appId = res.body.id;
      expect(res.body).toMatchObject({
        kind: 'SCHOLARSHIP',
        status: 'DRAFT',
        editable: true,
        submittedAt: null,
        requiresAction: false,
        action: { type: 'CONTINUE_DRAFT', enabled: true },
        applicant: { email: ana.email, countryCode: 'MX', currency: 'MXN' },
        answers: {
          requestedScholarshipTypeId: T.AGUAS_LIBRES,
          requestedScholarshipType: { key: 'AGUAS_LIBRES', name: 'Aguas Libres', minPercent: 50 },
          termsAccepted: false,
          evidenceLinks: [],
        },
        form: {
          window: { state: 'OPEN' },
          price: { amountCents: 1_020_000, currency: 'MXN' },
          interviewNotice: false,
          eligibility: null,
          limits: { letterMinLength: 800, letterMaxLength: 4000, minFiles: 1, maxFiles: 10 },
        },
      });
      expect(res.body.folio).toMatch(/^BEC-\d{6}$/);
      expect(res.body.history).toEqual([{ status: 'DRAFT', at: expect.any(String) }]);
      expect(res.body.form.scholarshipTypes[1]).toMatchObject({
        scholarshipTypeId: T.AGUAS_LIBRES,
        estimatedBalance: { minAmountCents: 510_000, currency: 'MXN' },
      });
      expect(res.body.missingRequirements.map((i: { field: string }) => i.field)).toEqual([
        'age',
        'intentLetter',
        'documents',
        'termsAccepted',
      ]);
    });

    it('una postulación por cohorte → 409 con la existente', async () => {
      const res = await post('/me/applications', ana, { offerId: ids.diploma }).expect(409);
      expect(res.body).toMatchObject({
        code: 'APPLICATION_ALREADY_EXISTS',
        meta: { applicationId: appId, status: 'DRAFT' },
      });
    });

    it('autoguardado: valida formato, tipo de beca habilitado y campos del otro tipo', async () => {
      const notApplicable = await patch(`/me/applications/${appId}`, ana, {
        experience: 'algo',
      }).expect(400);
      expect(notApplicable.body.details).toEqual([
        { field: 'experience', code: 'NOT_APPLICABLE', message: expect.any(String) },
      ]);
      const level = await patch(`/me/applications/${appId}`, ana, {
        requestedScholarshipTypeId: T.CENOTES_VIVOS,
      }).expect(400);
      expect(level.body.details[0]).toMatchObject({
        field: 'requestedScholarshipTypeId',
        code: 'SCHOLARSHIP_TYPE_NOT_ENABLED',
      });
      const links = await patch(`/me/applications/${appId}`, ana, {
        evidenceLinks: ['notaurl'],
      }).expect(400);
      expect(links.body.details[0].field).toMatch(/^evidenceLinks/);
      const long = await patch(`/me/applications/${appId}`, ana, {
        intentLetter: 'x'.repeat(4001),
      }).expect(400);
      expect(long.body.details[0].code).toBe('MAX_LENGTH');
      const phone = await patch(`/me/applications/${appId}`, ana, {
        phone: { countryCode: '+52', number: '12345' },
      }).expect(400);
      expect(phone.body.details[0].code).toBe('INVALID_PHONE');

      const saved = await patch(`/me/applications/${appId}`, ana, {
        age: 34,
        requestedScholarshipTypeId: T.SPECIAL,
        intentLetter: 'Carta corta',
        phone: { countryCode: '+52', number: '5598765432' },
      }).expect(200);
      expect(saved.body).toMatchObject({
        answers: { age: 34, requestedScholarshipTypeId: T.SPECIAL, intentLetter: 'Carta corta' },
        applicant: { phone: { countryCode: '+52', number: '5598765432' } },
        form: { interviewNotice: true },
      });
      expect(saved.body.missingRequirements[0]).toMatchObject({
        field: 'intentLetter',
        code: 'MIN_LENGTH',
      });
    });

    it('enviar incompleto → 422 APPLICATION_INCOMPLETE con detalles', async () => {
      const res = await post(`/me/applications/${appId}/submit`, ana).expect(422);
      expect(res.body.code).toBe('APPLICATION_INCOMPLETE');
      expect(
        res.body.details.map((d: { field: string; code: string }) => `${d.field}:${d.code}`),
      ).toEqual(['intentLetter:MIN_LENGTH', 'documents:MIN_FILES', 'termsAccepted:MUST_ACCEPT']);
    });

    it('evidencias: tipo/tamaño declarado y real, PUT pendiente, descarga y borrado', async () => {
      const base = `/me/applications/${appId}/documents`;
      const pdf = await post(`${base}/upload-url`, ana, {
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1000,
      }).expect(422);
      expect(pdf.body.code).toBe('APPLICATION_INVALID_FILE');
      const heavy = await post(`${base}/upload-url`, ana, {
        fileName: 'a.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 15 * MB + 1,
      }).expect(422);
      expect(heavy.body.code).toBe('APPLICATION_INVALID_FILE');
      // Límite de imágenes: 15 MB (antes 10 MB).
      await post(`${base}/upload-url`, ana, {
        fileName: 'foto.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 15 * MB,
      }).expect(200);

      const url = await post(`${base}/upload-url`, ana, {
        fileName: 'Video Territorio.MP4',
        contentType: 'video/mp4',
        sizeBytes: 50 * MB,
      }).expect(200);
      expect(url.body).toMatchObject({
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
      });
      expect(url.body.key).toMatch(
        new RegExp(`^applications/${appId}/evidence/.+-video-territorio\\.mp4$`),
      );

      // Sin PUT → no existe.
      const missing = await post(base, ana, { key: url.body.key }).expect(422);
      expect(missing.body.code).toBe('APPLICATION_UPLOAD_NOT_FOUND');
      // Key ajena (otro prefijo) → no encontrado.
      const foreign = await post(base, ana, { key: `applications/${randomUUID()}/evidence/x.jpg` });
      expect(foreign.status).toBe(422);
      // El archivo real no cumple (tipo real distinto) → se borra.
      storage.put(url.body.key, 'application/pdf', 1000);
      const wrong = await post(base, ana, { key: url.body.key }).expect(422);
      expect(wrong.body.code).toBe('APPLICATION_INVALID_FILE');
      expect(storage.deleted).toContain(url.body.key);

      const doc = await addEvidence(ana, appId, 'huerto.jpg');
      expect(doc.body).toMatchObject({
        fileName: 'huerto.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2 * MB,
        mediaType: 'IMAGE',
      });
      const download = await get(`${base}/${doc.body.id}/download`, ana).expect(200);
      expect(download.body).toMatchObject({ kind: 'FILE', fileName: 'huerto.jpg' });

      const extra = await addEvidence(ana, appId, 'extra.jpg');
      await del(`${base}/${extra.body.id}`, ana).expect(204);
      await del(`${base}/${extra.body.id}`, ana).expect(404);
      const detail = await get(`/me/applications/${appId}`, ana).expect(200);
      expect(detail.body.documents).toHaveLength(1);
    });

    it('máximo 10 archivos', async () => {
      const draft = await post('/me/applications', ana, { offerId: ids.diploma2 }).expect(201);
      const rows = Array.from({ length: 10 }, (_, i) => ({
        applicationId: draft.body.id,
        userId: ana.id,
        fileKey: `applications/${draft.body.id}/evidence/${i}.jpg`,
        fileName: `${i}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
      }));
      await prisma.applicationDocument.createMany({ data: rows });
      const res = await post(`/me/applications/${draft.body.id}/documents/upload-url`, ana, {
        fileName: 'once.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 100,
      }).expect(422);
      expect(res.body).toMatchObject({ code: 'APPLICATION_TOO_MANY_FILES', meta: { max: 10 } });
      // Descartar el borrador borra sus archivos y permite volver a postular.
      await del(`/me/applications/${draft.body.id}`, ana).expect(204);
      expect(storage.deleted).toContain(rows[0].fileKey);
      await get(`/me/applications/${draft.body.id}`, ana).expect(404);
    });

    it('envía: folio, Enviada, correo y notificación; queda en solo lectura', async () => {
      await patch(`/me/applications/${appId}`, ana, {
        ...scholarshipBody,
        requestedScholarshipTypeId: T.AGUAS_LIBRES,
      }).expect(200);
      const res = await post(`/me/applications/${appId}/submit`, ana).expect(200);
      expect(res.body).toMatchObject({
        status: 'SUBMITTED',
        editable: false,
        missingRequirements: [],
        action: { type: 'VIEW' },
      });
      expect(res.body.submittedAt).not.toBeNull();
      expect(res.body.timeline.slice(0, 2)).toEqual([
        { key: 'SUBMITTED', state: 'DONE', at: res.body.submittedAt },
        { key: 'IN_REVIEW', state: 'CURRENT', at: null },
      ]);
      const [notice] = await notificationsOf(ana.id, 'APPLICATION_SUBMITTED');
      expect(notice).toMatchObject({
        category: 'APPLICATIONS',
        actionPath: `/postulaciones/${appId}`,
        emailStatus: 'SENT',
      });
      expect(notice.body).toContain(res.body.folio);
      expect(mail.last(ana.email)?.subject).toContain('Postulación enviada');
      const stored = await prisma.application.findUniqueOrThrow({ where: { id: appId } });
      expect(stored).toMatchObject({ currency: 'MXN', originalAmountCents: 1_020_000 });

      const edit = await patch(`/me/applications/${appId}`, ana, { age: 40 }).expect(409);
      expect(edit.body).toMatchObject({
        code: 'APPLICATION_NOT_EDITABLE',
        meta: { status: 'SUBMITTED' },
      });
      await post(`/me/applications/${appId}/submit`, ana).expect(409);
      await post(`/me/applications/${appId}/documents/upload-url`, ana, {
        fileName: 'a.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 10,
      }).expect(409);
      await del(`/me/applications/${appId}`, ana).expect(409);
    });

    it('HU-21: postulación ajena o id inválido → 404', async () => {
      const foreign = await get(`/me/applications/${appId}`, carla).expect(404);
      expect(foreign.body.code).toBe('NOT_FOUND');
      await get('/me/applications/no-es-uuid', carla).expect(404);
      await patch(`/me/applications/${appId}`, carla, { age: 20 }).expect(404);
    });

    it('la ficha muestra [Ver mi postulación] en lugar de [Postular a beca]', async () => {
      const res = await api()
        .get(`/api/v1/offers/${slug('diploma')}`)
        .set(auth(ana))
        .expect(200);
      expect(res.body.viewer.application).toMatchObject({ id: appId, status: 'SUBMITTED' });
      expect(res.body.actions.map((a: { type: string }) => a.type)).toEqual([
        'ENROLL_AND_PAY',
        'VIEW_APPLICATION',
      ]);
      expect(res.body.actions[1]).toMatchObject({
        applicationId: appId,
        applicationStatus: 'SUBMITTED',
      });
    });

    it('revisión (Fase 06): En revisión solo portal; especial exige entrevista; aprobada con saldo', async () => {
      await workflow.startReview(appId, staff.id);
      await workflow.startReview(appId, staff.id); // idempotente
      const reviewNotices = await notificationsOf(ana.id, 'APPLICATION_STATUS_CHANGED');
      expect(reviewNotices).toHaveLength(1);
      expect(reviewNotices[0]).toMatchObject({ emailStatus: 'NOT_REQUESTED' });
      expect(reviewNotices[0].title).toContain('En revisión');

      await expect(
        workflow.approve(
          appId,
          { assignedScholarshipTypeId: T.SPECIAL, assignedPercent: 75 },
          staff.id,
        ),
      ).rejects.toMatchObject({ code: 'APPLICATION_INTERVIEW_REQUIRED' });
      await expect(
        workflow.approve(
          appId,
          { assignedScholarshipTypeId: T.SPECIAL, assignedPercent: 90 },
          staff.id,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      await workflow.approve(appId, { assignedScholarshipTypeId: T.AGUAS_LIBRES }, staff.id);
      const res = await get(`/me/applications/${appId}`, ana).expect(200);
      expect(res.body).toMatchObject({
        status: 'APPROVED_PENDING_PAYMENT',
        requiresAction: true,
        action: { type: 'PAY_BALANCE', enabled: true },
        scholarshipResult: {
          requestedScholarshipTypeId: T.AGUAS_LIBRES,
          assignedScholarshipTypeId: T.AGUAS_LIBRES,
          assignedScholarshipType: { key: 'AGUAS_LIBRES', name: 'Aguas Libres' },
          assignedPercent: 50,
          originalAmount: { amountCents: 1_020_000, currency: 'MXN' },
          balance: { amountCents: 510_000, currency: 'MXN' },
        },
        response: {
          kind: 'PAYMENT',
          amount: { amountCents: 510_000 },
          transferPendingValidation: false,
        },
      });
      // 7 días naturales desde la aprobación (el inicio está a 30 días).
      const due = new Date(res.body.response.dueAt).getTime();
      expect(Math.abs(due - addDaysInZone(new Date(), 7).getTime())).toBeLessThan(60_000);
      expect(res.body.history.map((h: { status: string }) => h.status)).toEqual([
        'DRAFT',
        'SUBMITTED',
        'IN_REVIEW',
        'APPROVED_PENDING_PAYMENT',
      ]);

      const [approved] = await notificationsOf(ana.id, 'SCHOLARSHIP_APPROVED');
      expect(approved.body).toContain('Aguas Libres (50%)');
      expect(approved.body).toContain('$5,100.00 MXN');
      expect(approved.actionPath).toBe(`/postulaciones/${appId}/pago`);
      expect(approved.dedupeKey).toMatch(
        new RegExp(`^app-status:${appId}:APPROVED_PENDING_PAYMENT:`),
      );

      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_offerId: { userId: ana.id, offerId: ids.diploma } },
      });
      expect(enrollment).toMatchObject({
        status: 'PENDING_PAYMENT',
        source: 'SCHOLARSHIP',
        applicationId: appId,
      });
      // Pendiente de pago: no aparece en Mi formación ni da acceso al Aula.
      await get(`/me/classrooms/${ids.diploma}`, ana).expect(403);

      const offer = await api()
        .get(`/api/v1/offers/${slug('diploma')}`)
        .set(auth(ana))
        .expect(200);
      expect(
        offer.body.actions.map((a: { type: string; primary: boolean }) => [a.type, a.primary]),
      ).toEqual([
        ['PAY_BALANCE', true],
        ['VIEW_APPLICATION', false],
      ]);
    });

    it('Fase 05: pago confirmado → Inscrita y acceso al Aula', async () => {
      await workflow.markEnrolled(appId);
      const res = await get(`/me/applications/${appId}`, ana).expect(200);
      expect(res.body).toMatchObject({
        status: 'ENROLLED',
        action: { type: 'GO_TO_CLASSROOM' },
        requiresAction: false,
      });
      expect(res.body.timeline.every((s: { state: string }) => s.state === 'DONE')).toBe(true);
      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_offerId: { userId: ana.id, offerId: ids.diploma } },
      });
      expect(enrollment.status).toBe('ACTIVE');
      expect(enrollment.activatedAt).not.toBeNull();
      await get(`/me/classrooms/${ids.diploma}`, ana).expect(200);
      await expect(workflow.markEnrolled(appId)).rejects.toMatchObject({
        code: 'APPLICATION_INVALID_TRANSITION',
      });
    });

    it('ya inscrito en la oferta → no puede postular', async () => {
      await prisma.enrollment.create({
        data: { userId: carla.id, offerId: ids.diploma2, status: 'ACTIVE', source: 'MANUAL' },
      });
      const res = await post('/me/applications', carla, { offerId: ids.diploma2 }).expect(409);
      expect(res.body.code).toBe('ENROLLMENT_ALREADY_EXISTS');
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('HU-20 Postulación a convocatoria + HU-21 entrevista y confirmación', () => {
    let appId: string;

    it('elegibilidad: país fuera de la lista y "No" a viajar bloquean el envío', async () => {
      const res = await post('/me/applications', beto, {
        offerId: ids.call,
        ...openCallBody,
        canTravel: false,
      }).expect(201);
      appId = res.body.id;
      expect(res.body).toMatchObject({
        kind: 'OPEN_CALL',
        folio: expect.stringMatching(/^CONV-\d{6}$/),
        form: {
          interviewNotice: true,
          price: null,
          scholarshipTypes: [],
          limits: { answerMinLength: 300, answerMaxLength: 2000, minFiles: 0 },
          eligibility: { eligible: false, reasons: ['TRAVEL_REQUIRED'] },
        },
        missingRequirements: [],
      });
      const travel = await post(`/me/applications/${appId}/submit`, beto).expect(422);
      expect(travel.body).toMatchObject({
        code: 'APPLICATION_NOT_ELIGIBLE',
        meta: { reasons: ['TRAVEL_REQUIRED'] },
      });

      await prisma.user.update({ where: { id: beto.id }, data: { countryCode: 'AR' } });
      await patch(`/me/applications/${appId}`, beto, { canTravel: true }).expect(200);
      const country = await post(`/me/applications/${appId}/submit`, beto).expect(422);
      expect(country.body.meta).toEqual({
        reasons: ['COUNTRY_NOT_ELIGIBLE'],
        eligibilityText: 'Dirigida a mujeres lideresas de Centroamérica y México.',
      });
      await prisma.user.update({ where: { id: beto.id }, data: { countryCode: 'MX' } });
    });

    it('campos de beca no aplican; respuestas cortas → incompleta', async () => {
      const notApplicable = await patch(`/me/applications/${appId}`, beto, {
        requestedScholarshipTypeId: T.AGUA_VIVA,
      }).expect(400);
      expect(notApplicable.body.details[0]).toMatchObject({
        field: 'requestedScholarshipTypeId',
        code: 'NOT_APPLICABLE',
      });
      await patch(`/me/applications/${appId}`, beto, { motivation: 'corta' }).expect(200);
      const res = await post(`/me/applications/${appId}/submit`, beto).expect(422);
      expect(res.body.details).toEqual([
        { field: 'motivation', code: 'MIN_LENGTH', message: expect.stringContaining('300') },
      ]);
    });

    it('envía (sin evidencia) con aviso de entrevista por Zoom', async () => {
      await patch(`/me/applications/${appId}`, beto, { motivation: ANSWER }).expect(200);
      const res = await post(`/me/applications/${appId}/submit`, beto).expect(200);
      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.timeline.map((s: { key: string }) => s.key)).toEqual([
        'SUBMITTED',
        'IN_REVIEW',
        'INTERVIEW',
        'RESULT',
        'CONFIRMATION',
        'ENROLLED',
      ]);
      const [notice] = await notificationsOf(beto.id, 'APPLICATION_SUBMITTED');
      expect(notice.body).toContain('entrevista por Zoom');
      const offer = await api()
        .get(`/api/v1/offers/${slug('call')}`)
        .set(auth(beto))
        .expect(200);
      expect(offer.body.actions).toEqual([
        expect.objectContaining({ type: 'VIEW_APPLICATION', primary: true, applicationId: appId }),
      ]);
    });

    it('entrevista agendada: hora local + CDMX, enlace 10 min antes, calendario y recordatorio', async () => {
      const startsAt = addHours(new Date(), 20);
      await workflow.scheduleInterview(
        appId,
        { startsAt, endsAt: addHours(startsAt, 0.5), joinUrl: 'https://zoom.us/j/123?pwd=x' },
        staff.id,
      );
      const res = await get(`/me/applications/${appId}`, beto).expect(200);
      expect(res.body).toMatchObject({
        status: 'INTERVIEW_SCHEDULED',
        requiresAction: true,
        action: { type: 'JOIN_INTERVIEW', enabled: false, reason: 'INTERVIEW_NOT_OPEN_YET' },
        interview: {
          startsAt: startsAt.toISOString(),
          timezone: 'America/Mexico_City',
          status: 'SCHEDULED',
          join: { state: 'NOT_YET', url: null },
        },
      });
      const [scheduled] = await notificationsOf(beto.id, 'INTERVIEW_SCHEDULED');
      expect(scheduled.body).toContain('(tu hora)');
      expect(scheduled.body).toContain('hora CDMX');

      const calendar = await get(
        `/me/calendar?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(addDaysInZone(new Date(), 2).toISOString())}`,
        beto,
      ).expect(200);
      const interviewItem = calendar.body.data.find(
        (i: { source: string }) => i.source === 'APPLICATION',
      );
      expect(interviewItem).toMatchObject({
        kind: 'INTERVIEW',
        category: 'IMPORTANT_DATES',
        link: { kind: 'APPLICATION', applicationId: appId, slug: slug('call') },
        join: { state: 'NOT_YET', url: null },
      });

      // Recordatorio 24 h antes (idempotente).
      expect(await jobs.remindInterviews(new Date())).toBeGreaterThanOrEqual(1);
      expect(await jobs.remindInterviews(new Date())).toBe(0);
      expect(await notificationsOf(beto.id, 'INTERVIEW_REMINDER')).toHaveLength(1);

      // Ya dentro de los 10 minutos previos → enlace disponible.
      await prisma.applicationInterview.updateMany({
        where: { applicationId: appId, status: 'SCHEDULED' },
        data: { startsAt: addHours(new Date(), 0.1), endsAt: addHours(new Date(), 0.6) },
      });
      const open = await get(`/me/applications/${appId}`, beto).expect(200);
      expect(open.body.interview.join).toMatchObject({
        state: 'OPEN',
        url: 'https://zoom.us/j/123?pwd=x',
      });
      expect(open.body.action).toMatchObject({ type: 'JOIN_INTERVIEW', enabled: true });
    });

    it('aprobar exige entrevista Realizada; gratuita → confirma participación → Inscrita', async () => {
      await expect(workflow.approve(appId, {}, staff.id)).rejects.toMatchObject({
        code: 'APPLICATION_INTERVIEW_REQUIRED',
      });
      await workflow.completeInterview(appId, staff.id);
      await workflow.approve(appId, {}, staff.id);
      const res = await get(`/me/applications/${appId}`, beto).expect(200);
      expect(res.body).toMatchObject({
        status: 'APPROVED_PENDING_CONFIRMATION',
        action: { type: 'CONFIRM_PARTICIPATION', enabled: true },
        response: { kind: 'CONFIRMATION', amount: null },
        scholarshipResult: null,
        interview: null,
      });
      // Sin costo no hay reserva de inscripción hasta confirmar.
      expect(
        await prisma.enrollment.findUnique({
          where: { userId_offerId: { userId: beto.id, offerId: ids.call } },
        }),
      ).toBeNull();

      const confirmed = await post(`/me/applications/${appId}/confirm`, beto).expect(200);
      expect(confirmed.body).toMatchObject({
        status: 'ENROLLED',
        action: { type: 'GO_TO_CLASSROOM' },
      });
      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_offerId: { userId: beto.id, offerId: ids.call } },
      });
      expect(enrollment).toMatchObject({
        status: 'ACTIVE',
        source: 'OPEN_CALL',
        applicationId: appId,
      });
      const again = await post(`/me/applications/${appId}/confirm`, beto).expect(409);
      expect(again.body).toMatchObject({
        code: 'APPLICATION_INVALID_TRANSITION',
        meta: { status: 'ENROLLED' },
      });
      const [enrolled] = (await notificationsOf(beto.id, 'APPLICATION_STATUS_CHANGED')).filter(
        (n) => n.title.startsWith('Inscrita'),
      );
      expect(enrolled.actionPath).toBe(`/aula/${ids.call}`);
    });

    it('confirmar fuera de plazo → 422 APPLICATION_DEADLINE_PASSED', async () => {
      const draft = await post('/me/applications', carla, {
        offerId: ids.call,
        ...openCallBody,
      }).expect(201);
      await post(`/me/applications/${draft.body.id}/submit`, carla).expect(200);
      await workflow.scheduleInterview(
        draft.body.id,
        {
          startsAt: addHours(new Date(), -2),
          endsAt: addHours(new Date(), -1.5),
          joinUrl: 'https://zoom.us/j/9',
        },
        staff.id,
      );
      await workflow.completeInterview(draft.body.id, staff.id);
      await workflow.approve(draft.body.id, {}, staff.id);
      await prisma.application.update({
        where: { id: draft.body.id },
        data: { responseDueAt: addHours(new Date(), -1) },
      });
      const res = await post(`/me/applications/${draft.body.id}/confirm`, carla).expect(422);
      expect(res.body.code).toBe('APPLICATION_DEADLINE_PASSED');
      // Confirmar una que no espera confirmación.
      const other = await post('/me/applications', carla, { offerId: ids.call2 }).expect(201);
      await post(`/me/applications/${other.body.id}/confirm`, carla).expect(409);
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('HU-21 vencimientos y recordatorios (jobs)', () => {
    let user: User;
    let appId: string;

    beforeAll(async () => {
      user = await newUser();
      const created = await post('/me/applications', user, {
        offerId: ids['call-paid'],
        ...openCallBody,
      }).expect(201);
      appId = created.body.id;
      await post(`/me/applications/${appId}/submit`, user).expect(200);
      await workflow.scheduleInterview(
        appId,
        {
          startsAt: addHours(new Date(), -3),
          endsAt: addHours(new Date(), -2.5),
          joinUrl: 'https://zoom.us/j/7',
        },
        staff.id,
      );
      // Reprogramación: misma etapa, nueva entrevista y aviso.
      await workflow.scheduleInterview(
        appId,
        {
          startsAt: addHours(new Date(), -2),
          endsAt: addHours(new Date(), -1.5),
          joinUrl: 'https://zoom.us/j/8',
        },
        staff.id,
      );
      expect(await notificationsOf(user.id, 'INTERVIEW_SCHEDULED')).toHaveLength(2);
      await workflow.completeInterview(appId, staff.id);
      await workflow.approve(appId, {}, staff.id);
    });

    it('convocatoria con costo → Aprobada – pendiente de pago con reserva de inscripción', async () => {
      const res = await get(`/me/applications/${appId}`, user).expect(200);
      expect(res.body).toMatchObject({
        status: 'APPROVED_PENDING_PAYMENT',
        response: { kind: 'PAYMENT', amount: { amountCents: 200_000, currency: 'MXN' } },
        scholarshipResult: null,
      });
    });

    it('recordatorio de saldo 48 h antes (una vez por plazo)', async () => {
      await prisma.application.update({
        where: { id: appId },
        data: { responseDueAt: addHours(new Date(), 24) },
      });
      expect(await jobs.remindBalanceDue(new Date())).toBeGreaterThanOrEqual(1);
      expect(await jobs.remindBalanceDue(new Date())).toBe(0);
      const [reminder] = await notificationsOf(user.id, 'BALANCE_DUE_REMINDER');
      expect(reminder.body).toContain('$2,000.00 MXN');
    });

    it('con comprobante pendiente no vence; sin él → Vencida y se libera la reserva', async () => {
      await prisma.application.update({
        where: { id: appId },
        data: { responseDueAt: addHours(new Date(), -1) },
      });
      await workflow.setPendingTransfer(appId, true);
      await jobs.expireOverdue(new Date());
      expect((await prisma.application.findUniqueOrThrow({ where: { id: appId } })).status).toBe(
        'APPROVED_PENDING_PAYMENT',
      );

      await workflow.setPendingTransfer(appId, false);
      expect(await jobs.expireOverdue(new Date())).toBeGreaterThanOrEqual(1);
      expect(await workflow.expireIfDue(appId)).toBe(false); // idempotente
      const res = await get(`/me/applications/${appId}`, user).expect(200);
      expect(res.body).toMatchObject({
        status: 'EXPIRED',
        requiresAction: false,
        action: { type: 'VIEW' },
        response: null,
      });
      expect(
        res.body.timeline
          .map((s: { key: string; state: string }) => `${s.key}:${s.state}`)
          .slice(-2),
      ).toEqual(['PAYMENT:FAILED', 'ENROLLED:SKIPPED']);
      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_offerId: { userId: user.id, offerId: ids['call-paid'] } },
      });
      expect(enrollment.status).toBe('CANCELLED');
      const expired = await notificationsOf(user.id, 'APPLICATION_EXPIRED');
      expect(expired).toHaveLength(1);
      expect(expired[0].body).toContain('Vencida');
    });

    it('HU-32 extender plazo reactiva la Vencida', async () => {
      await workflow.extendDeadline(appId, days(5), staff.id, 'Solicitó una semana más');
      const res = await get(`/me/applications/${appId}`, user).expect(200);
      expect(res.body.status).toBe('APPROVED_PENDING_PAYMENT');
      const enrollment = await prisma.enrollment.findUniqueOrThrow({
        where: { userId_offerId: { userId: user.id, offerId: ids['call-paid'] } },
      });
      expect(enrollment.status).toBe('PENDING_PAYMENT');
      await expect(
        workflow.extendDeadline(appId, days(60), staff.id, 'Después del inicio'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('no seleccionada', async () => {
      const other = await newUser();
      const created = await post('/me/applications', other, {
        offerId: ids.call2,
        ...openCallBody,
      }).expect(201);
      await post(`/me/applications/${created.body.id}/submit`, other).expect(200);
      await workflow.reject(created.body.id, staff.id, 'Cupo completo');
      const res = await get(`/me/applications/${created.body.id}`, other).expect(200);
      expect(res.body.status).toBe('NOT_SELECTED');
      expect(res.body.timeline.find((s: { key: string }) => s.key === 'RESULT').state).toBe(
        'FAILED',
      );
      await expect(workflow.approve(created.body.id, {}, staff.id)).rejects.toMatchObject({
        code: 'APPLICATION_INTERVIEW_REQUIRED',
      });
    });
  });

  // -----------------------------------------------------------------------------------------------
  describe('HU-21 Mis postulaciones y Dashboard (HU-06)', () => {
    it('solo las mías, filtradas por tipo; las que requieren acción primero', async () => {
      const scholarships = await get('/me/applications?kind=SCHOLARSHIP', ana).expect(200);
      expect(scholarships.body.meta.total).toBe(1);
      expect(scholarships.body.data[0].status).toBe('ENROLLED');

      const calls = await get('/me/applications?kind=OPEN_CALL', carla).expect(200);
      // La aprobada fuera de plazo la venció el job (expireOverdue) del bloque anterior.
      expect(calls.body.data.map((a: { status: string }) => a.status)).toEqual([
        'EXPIRED',
        'DRAFT',
      ]);
      expect(calls.body.data[0].requiresAction).toBe(false);
      const withAction = await get('/me/applications?kind=SCHOLARSHIP', carla).expect(200);
      expect(withAction.body.data).toEqual([]);
      const filtered = await get('/me/applications?status=DRAFT', carla).expect(200);
      expect(filtered.body.data).toHaveLength(1);
      await get('/me/applications?status=NOPE', carla).expect(400);
    });

    it('widgets Becas / Convocatorias con el estado de mi postulación', async () => {
      const res = await get('/me/dashboard', carla).expect(200);
      expect(res.body.failedBlocks).toEqual([]);
      expect(res.body.scholarships).toMatchObject({ latest: null, actionRequired: 0, newCount: 0 });
      expect(res.body.scholarships.openCount).toBeGreaterThanOrEqual(2);
      expect(res.body.openCalls).toMatchObject({
        latest: { status: 'EXPIRED', kind: 'OPEN_CALL' },
        actionRequired: 0,
      });
    });
  });
});
