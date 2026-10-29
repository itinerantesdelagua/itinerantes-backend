import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception';
import { type Currency, currencyForCountry, isCurrency } from '../../common/utils/money';
import { demoStripeBlocked, isDemoEmail, isDemoStripeId } from '../../common/utils/demo';
import { addMinutes, nowUtc } from '../../common/utils/time';
import { BUSINESS_RULES } from '../../config/business-rules';
import { type Env, portalBaseUrl } from '../../config/env.schema';
import type { PaymentConcept, Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../../infra/stripe/payment-gateway';
import { ApplicationWorkflowService } from '../applications/application-workflow.service';
import { formatFolio } from '../applications/policies/application-rules.policy';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { seatHoldingWhere } from '../enrollments/policies/enrollment.policy';
import { frontendLink } from '../notifications/notifications.policy';
import { PORTAL_LINKS } from '../notifications/portal-links';
import { deriveOfferAvailability } from '../offers/policies/offer-status.policy';
import type { StartCheckoutRequestDto } from './dto/payments.request.dto';
import type {
  BankTransferDetailsDto,
  CardUpdateSessionDto,
  CheckoutSessionDto,
  PaymentQuoteDto,
  QuoteBlockerDto,
} from './dto/payments.response.dto';
import { PaymentLedgerService } from './payment-ledger.service';
import { OFFER_REF_SELECT, PAYMENT_INCLUDE, toOfferRef, toPaymentDto } from './payment-view';
import {
  type BalanceDecision,
  type CheckoutDecision,
  decideBalancePayment,
  decideEnrollmentCheckout,
} from './policies/checkout.policy';
import {
  installmentOptions,
  offerPriceFor,
  paymentConceptLabel,
} from './policies/payment-amounts.policy';
import { isActivePlan } from './policies/payment-status.policy';
import { transferAvailability, transferReference } from './policies/transfer.policy';
import {
  OFFER_SCHOLARSHIP_TYPES_RELATION,
  SCHOLARSHIP_TYPE_SELECT,
} from '../scholarship-types/scholarship-type.select';
import { assignedSummary } from '../scholarship-types/policies/scholarship-type.policy';

const OFFER_SELECT = {
  ...OFFER_REF_SELECT,
  origin: true,
  isFree: true,
  publicationStatus: true,
  enrollmentOpensAt: true,
  enrollmentClosesAt: true,
  priceMxnCents: true,
  priceUsdCents: true,
  installmentsEnabled: true,
  installmentsMax: true,
  capacity: true,
} as const satisfies Prisma.OfferSelect;

type OfferRow = Prisma.OfferGetPayload<{ select: typeof OFFER_SELECT }>;

const APPLICATION_SELECT = {
  id: true,
  userId: true,
  offerId: true,
  kind: true,
  number: true,
  status: true,
  currency: true,
  originalAmountCents: true,
  balanceCents: true,
  assignedScholarshipTypeId: true,
  assignedScholarshipTypeName: true,
  assignedScholarshipType: { select: SCHOLARSHIP_TYPE_SELECT },
  assignedPercent: true,
  offer: { select: { scholarshipTypes: OFFER_SCHOLARSHIP_TYPES_RELATION } },
  responseDueAt: true,
  pendingTransferSince: true,
} as const satisfies Prisma.ApplicationSelect;

type ApplicationRow = Prisma.ApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

interface Target {
  concept: 'FULL_PRICE' | 'BALANCE';
  user: User;
  offer: OfferRow;
  application: ApplicationRow | null;
  currency: Currency;
  /** Total a pagar (null si la oferta no tiene precio en la moneda). */
  totalCents: number | null;
}

/**
 * Pantalla de pago y Stripe Checkout (HU-22 pago completo, HU-23 saldo tras beca, HU-24 cuotas).
 * El servidor calcula SIEMPRE el monto (precio fijo por moneda del perfil o saldo de la postulación).
 *
 * Flujo de `start`: valida (con la oferta bloqueada para el cupo) → crea el pago PENDING (+ plan
 * PENDING_ACTIVATION y su calendario) y la reserva de cupo → crea la sesión de Checkout → la persona
 * paga en Stripe → el webhook (o la conciliación al volver) confirma con `PaymentLedgerService`.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);
  /** Raíz del portal (PORTAL_URL o FRONTEND_URL). */
  private readonly frontendUrl: string;
  private readonly bank: { holder?: string; bank?: string; clabe?: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService,
    private readonly workflow: ApplicationWorkflowService,
    private readonly ledger: PaymentLedgerService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    config: ConfigService<Env, true>,
  ) {
    this.frontendUrl = portalBaseUrl(config);
    this.bank = {
      holder: config.get('BANK_TRANSFER_ACCOUNT_HOLDER', { infer: true }),
      bank: config.get('BANK_TRANSFER_BANK_NAME', { infer: true }),
      clabe: config.get('BANK_TRANSFER_CLABE', { infer: true }),
    };
  }

  get bankConfigured(): boolean {
    return !!(this.bank.holder && this.bank.bank && this.bank.clabe);
  }

  bankDetails(): { holder: string; bank: string; clabe: string } | null {
    return this.bankConfigured
      ? { holder: this.bank.holder!, bank: this.bank.bank!, clabe: this.bank.clabe! }
      : null;
  }

  // --- Pantalla de pago ---------------------------------------------------------------------------

  async quote(
    userId: string,
    input: { offerId?: string; applicationId?: string },
  ): Promise<PaymentQuoteDto> {
    const now = nowUtc();
    const target = await this.resolveTarget(userId, input);
    const { offer, application, currency, totalCents } = target;

    let blocker: QuoteBlockerDto | null = null;
    if (target.concept === 'BALANCE') {
      const decision = this.balanceDecision(application!, now);
      if (!decision.ok) blocker = { code: decision.code, meta: serializeMeta(decision.meta) };
    } else {
      const decision = await this.enrollmentDecision(this.prisma, target, now);
      if (!decision.ok) blocker = { code: decision.code, meta: serializeMeta(decision.meta) };
    }

    const transfer = transferAvailability({
      isBalance: target.concept === 'BALANCE',
      profileCountryCode: target.user.countryCode,
      currency: application?.currency ?? null,
      bankConfigured: this.bankConfigured,
    });
    const options = totalCents !== null ? installmentOptions(totalCents, offer, now) : [];

    const [openCheckout, latestTransfer] = await Promise.all([
      this.prisma.payment.findFirst({
        where: {
          userId,
          offerId: offer.id,
          applicationId: application?.id ?? null,
          status: 'PENDING',
          checkoutExpiresAt: { gt: now },
          stripeCheckoutSessionId: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        include: PAYMENT_INCLUDE,
      }),
      application
        ? this.prisma.payment.findFirst({
            where: { applicationId: application.id, method: 'BANK_TRANSFER' },
            orderBy: { createdAt: 'desc' },
            include: PAYMENT_INCLUDE,
          })
        : Promise.resolve(null),
    ]);

    const bank = this.bankDetails();
    const bankTransfer: BankTransferDetailsDto | null =
      transfer.available && bank && application && totalCents !== null
        ? {
            accountHolder: bank.holder,
            bankName: bank.bank,
            clabe: bank.clabe,
            reference: transferReference(formatFolio(application.kind, application.number)),
            amount: { amountCents: totalCents, currency: 'MXN' },
          }
        : null;

    return {
      concept: target.concept,
      offer: toOfferRef(offer),
      application: application
        ? {
            id: application.id,
            folio: formatFolio(application.kind, application.number),
            kind: application.kind,
            status: application.status,
            assignedScholarshipTypeId: application.assignedScholarshipTypeId,
            assignedScholarshipType: assignedSummary(
              application.assignedScholarshipType,
              application.offer.scholarshipTypes,
              application.assignedScholarshipTypeName,
            ),
            assignedPercent: application.assignedPercent,
            originalAmount:
              application.originalAmountCents !== null
                ? { amountCents: application.originalAmountCents, currency }
                : null,
            dueAt: application.responseDueAt?.toISOString() ?? null,
          }
        : null,
      amount: totalCents !== null ? { amountCents: totalCents, currency } : null,
      methods: [
        {
          method: 'CARD',
          available: this.gateway.configured,
          reason: this.gateway.configured ? null : 'PAYMENTS_NOT_CONFIGURED',
        },
        { method: 'BANK_TRANSFER', available: transfer.available, reason: transfer.reason },
      ],
      installments:
        options.length > 0
          ? {
              max: options[options.length - 1].count,
              options: options.map((o) => ({
                count: o.count,
                available: o.available,
                reason: o.reason,
                perInstallment: { amountCents: o.schedule[0].amountCents, currency },
                schedule: o.schedule.map((s) => ({
                  sequence: s.sequence,
                  amount: { amountCents: s.amountCents, currency },
                  dueAt: s.dueAt.toISOString(),
                })),
              })),
            }
          : null,
      bankTransfer,
      blocker,
      openCheckout: openCheckout ? toPaymentDto(openCheckout, now) : null,
      latestTransfer: latestTransfer ? toPaymentDto(latestTransfer, now) : null,
    };
  }

  // --- Stripe Checkout ----------------------------------------------------------------------------

  async start(userId: string, dto: StartCheckoutRequestDto): Promise<CheckoutSessionDto> {
    if (!this.gateway.configured) throw new AppException('PAYMENTS_NOT_CONFIGURED');
    const now = nowUtc();
    const target = await this.resolveTarget(userId, dto);
    const { offer, application, currency } = target;

    // Cuotas (HU-24): número disponible para la oferta y autorización de débito automático.
    const count = dto.installmentCount ?? null;
    let schedule: Array<{ sequence: number; amountCents: number; dueAt: Date }> | null = null;
    if (count !== null) {
      const options =
        target.totalCents !== null ? installmentOptions(target.totalCents, offer, now) : [];
      const option = options.find((o) => o.count === count && o.available);
      if (!option) {
        throw new AppException('PAYMENT_INSTALLMENTS_NOT_AVAILABLE', {
          meta: { allowed: options.filter((o) => o.available).map((o) => o.count) },
        });
      }
      if (dto.autoDebitAuthorized !== true) {
        throw AppException.validation([
          {
            field: 'autoDebitAuthorized',
            code: 'MUST_ACCEPT',
            message: 'Autoriza el cobro automático de las cuotas para continuar.',
          },
        ]);
      }
      schedule = option.schedule;
    }

    // Checkout abierto con los mismos datos → [Continuar pago] (no se crea otra sesión).
    const open = await this.prisma.payment.findFirst({
      where: {
        userId,
        offerId: offer.id,
        applicationId: application?.id ?? null,
        status: 'PENDING',
        method: 'CARD',
        stripeCheckoutSessionId: { not: null },
      },
      include: { plan: { select: { installmentCount: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      const sameShape = (open.plan?.installmentCount ?? null) === count;
      const stillOpen =
        open.checkoutExpiresAt && addMinutes(now, 1).getTime() < open.checkoutExpiresAt.getTime();
      if (sameShape && stillOpen && open.checkoutUrl) {
        return {
          paymentId: open.id,
          checkoutUrl: open.checkoutUrl,
          expiresAt: open.checkoutExpiresAt!.toISOString(),
          reused: true,
        };
      }
      await this.closeCheckout(open.id, open.stripeCheckoutSessionId!);
    }

    const customerId = await this.ensureCustomer(target.user);
    // Stripe exige ≥ 30 min de vigencia: margen de 2 min para el reloj.
    const expiresAt = addMinutes(now, BUSINESS_RULES.CHECKOUT_SESSION_TTL_MINUTES + 2);
    const concept: PaymentConcept = schedule ? 'INSTALLMENT' : target.concept;

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offer.id}::uuid FOR UPDATE`;
      if (target.concept === 'BALANCE') {
        const fresh = await tx.application.findUniqueOrThrow({
          where: { id: application!.id },
          select: APPLICATION_SELECT,
        });
        const decision = this.balanceDecision(fresh, now);
        if (!decision.ok)
          throw new AppException(decision.code, { meta: serializeMeta(decision.meta) });
      } else {
        const decision = await this.enrollmentDecision(tx, target, now);
        if (!decision.ok)
          throw new AppException(decision.code, { meta: serializeMeta(decision.meta) });
      }
      const totalCents = target.totalCents!;

      let planId: string | null = null;
      let installmentId: string | null = null;
      if (schedule) {
        const plan = await tx.installmentPlan.create({
          data: {
            userId,
            offerId: offer.id,
            applicationId: application?.id ?? null,
            concept: target.concept,
            currency,
            totalCents,
            installmentCount: schedule.length,
            stripeCustomerId: customerId,
            autoDebitAuthorizedAt: now,
            installments: { create: schedule.map((s) => ({ ...s })) },
          },
          include: { installments: { where: { sequence: 1 }, select: { id: true } } },
        });
        planId = plan.id;
        installmentId = plan.installments[0].id;
      }

      let enrollmentId: string | null;
      if (target.concept === 'FULL_PRICE') {
        const hold = await this.enrollments.holdForCheckout(tx, {
          userId,
          offerId: offer.id,
          source: schedule ? 'INSTALLMENTS' : 'PAYMENT',
          expiresAt,
        });
        enrollmentId = hold.id;
      } else {
        await this.workflow.markPaymentStarted(application!.id, tx);
        const reservation = await tx.enrollment.findUnique({
          where: { applicationId: application!.id },
          select: { id: true },
        });
        enrollmentId = reservation?.id ?? null;
      }
      if (planId && enrollmentId) {
        await tx.installmentPlan.update({ where: { id: planId }, data: { enrollmentId } });
      }

      return tx.payment.create({
        data: {
          userId,
          offerId: offer.id,
          enrollmentId,
          applicationId: application?.id ?? null,
          planId,
          installmentId,
          concept,
          method: 'CARD',
          status: 'PENDING',
          amountCents: schedule ? schedule[0].amountCents : totalCents,
          currency,
          checkoutExpiresAt: expiresAt,
        },
      });
    });

    const resultUrl = (result: 'success' | 'cancel') =>
      `${frontendLink(this.frontendUrl, PORTAL_LINKS.checkoutResult())}?paymentId=${created.id}` +
      `&result=${result}${result === 'success' ? '&session_id={CHECKOUT_SESSION_ID}' : ''}`;
    try {
      const session = await this.gateway.createCheckoutSession({
        mode: 'payment',
        customerId,
        currency,
        amountCents: created.amountCents,
        productName: offer.name,
        description: paymentConceptLabel({
          concept,
          applicationKind: application?.kind ?? null,
          installment: schedule ? { sequence: 1, count: schedule.length } : null,
        }),
        successUrl: resultUrl('success'),
        cancelUrl: resultUrl('cancel'),
        expiresAt,
        saveCardForFutureUsage: schedule !== null,
        metadata: {
          kind: 'checkout',
          paymentId: created.id,
          userId,
          offerId: offer.id,
          ...(application ? { applicationId: application.id } : {}),
          ...(created.planId ? { planId: created.planId } : {}),
        },
        clientReferenceId: created.id,
        idempotencyKey: `checkout:${created.id}`,
      });
      await this.prisma.payment.update({
        where: { id: created.id },
        data: {
          stripeCheckoutSessionId: session.id,
          checkoutUrl: session.url,
          checkoutExpiresAt: session.expiresAt,
        },
      });
      return {
        paymentId: created.id,
        checkoutUrl: session.url,
        expiresAt: session.expiresAt.toISOString(),
        reused: false,
      };
    } catch (error) {
      await this.ledger.cancelCheckoutPayment(created.id, 'No se pudo crear la sesión de pago.');
      throw error;
    }
  }

  /** "Pago cancelado" / volver atrás: cierra la sesión en Stripe y libera la reserva. */
  async cancel(userId: string, paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, userId } });
    if (!payment) throw AppException.notFound('El pago no existe.');
    // Solo checkouts abiertos (las cuotas automáticas no se "cancelan" desde aquí).
    if (payment.status !== 'PENDING' || payment.method !== 'CARD' || !payment.checkoutExpiresAt) {
      throw new AppException('PAYMENT_INVALID_STATE', { meta: { status: payment.status } });
    }
    if (!payment.stripeCheckoutSessionId || isDemoStripeId(payment.stripeCheckoutSessionId)) {
      await this.ledger.cancelCheckoutPayment(payment.id, 'Pago cancelado por la persona.');
      return;
    }
    await this.closeCheckout(payment.id, payment.stripeCheckoutSessionId);
  }

  /**
   * Conciliación: consulta la sesión en Stripe y aplica su estado (lo usa la consulta del pago al
   * volver de Checkout si el webhook aún no llega, y el job para sesiones vencidas).
   */
  async reconcile(paymentId: string): Promise<void> {
    if (!this.gateway.configured) return;
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.stripeCheckoutSessionId || payment.status !== 'PENDING') return;
    if (isDemoStripeId(payment.stripeCheckoutSessionId)) return; // datos demo: nunca a Stripe
    const session = await this.gateway.retrieveCheckoutSession(payment.stripeCheckoutSessionId);
    await this.ledger.applyCheckoutSession(session);
  }

  /** Job: checkouts vencidos sin confirmación → concilia (paga o cancela y libera el cupo). */
  async reconcileExpired(now: Date): Promise<number> {
    const stale = await this.prisma.payment.findMany({
      where: { status: 'PENDING', method: 'CARD', checkoutExpiresAt: { lt: addMinutes(now, -5) } },
      select: { id: true, stripeCheckoutSessionId: true },
      take: 100,
    });
    let done = 0;
    for (const payment of stale) {
      // Datos demo (prisma/demo-data.ts): checkout ficticio, no se concilia con Stripe.
      if (isDemoStripeId(payment.stripeCheckoutSessionId)) continue;
      try {
        if (payment.stripeCheckoutSessionId && this.gateway.configured) {
          const session = await this.gateway.retrieveCheckoutSession(
            payment.stripeCheckoutSessionId,
          );
          if (session.status === 'open') await this.gateway.expireCheckoutSession(session.id);
          await this.ledger.applyCheckoutSession(
            session.status === 'open' ? { ...session, status: 'expired' } : session,
          );
        } else {
          await this.ledger.cancelCheckoutPayment(payment.id, 'La sesión de pago venció.');
        }
        done++;
      } catch (error) {
        this.logger.error(
          { err: error, paymentId: payment.id },
          'No se pudo conciliar el checkout',
        );
      }
    }
    return done;
  }

  /** HU-24/26 [Actualizar tarjeta]: Checkout en modo `setup` (Stripe guarda la tarjeta nueva). */
  async cardUpdateSession(userId: string, planId: string): Promise<CardUpdateSessionDto> {
    if (!this.gateway.configured) throw new AppException('PAYMENTS_NOT_CONFIGURED');
    const plan = await this.prisma.installmentPlan.findFirst({ where: { id: planId, userId } });
    if (!plan) throw AppException.notFound('El plan no existe.');
    if (!isActivePlan(plan.status)) {
      throw new AppException('PAYMENT_INVALID_STATE', { meta: { status: plan.status } });
    }
    if (isDemoStripeId(plan.stripeCustomerId)) throw demoStripeBlocked();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const customerId = plan.stripeCustomerId ?? (await this.ensureCustomer(user));
    const now = nowUtc();
    const back = (result: string) =>
      `${frontendLink(this.frontendUrl, PORTAL_LINKS.myPayments())}?planId=${plan.id}&cardUpdate=${result}`;
    const session = await this.gateway.createCheckoutSession({
      mode: 'setup',
      customerId,
      currency: plan.currency,
      successUrl: back('success'),
      cancelUrl: back('cancel'),
      expiresAt: addMinutes(now, BUSINESS_RULES.CHECKOUT_SESSION_TTL_MINUTES + 2),
      metadata: { kind: 'card_update', planId: plan.id, userId },
      idempotencyKey: `card-update:${plan.id}:${now.getTime()}`,
    });
    return { checkoutUrl: session.url, expiresAt: session.expiresAt.toISOString() };
  }

  // ------------------------------------------------------------------------------------------------

  private async closeCheckout(paymentId: string, sessionId: string): Promise<void> {
    await this.gateway.expireCheckoutSession(sessionId);
    const session = await this.gateway.retrieveCheckoutSession(sessionId);
    if (session.status === 'complete') {
      await this.ledger.applyCheckoutSession(session); // se pagó justo antes de cerrar
      if (session.paymentStatus === 'paid') return;
    }
    await this.ledger.cancelCheckoutPayment(
      paymentId,
      'Pago cancelado: no se realizó ningún cargo.',
    );
  }

  private async ensureCustomer(user: User): Promise<string> {
    // Personas demo (prisma/demo-data.ts): nunca crean clientes ni sesiones reales en Stripe.
    if (isDemoEmail(user.email) || isDemoStripeId(user.stripeCustomerId)) {
      throw demoStripeBlocked();
    }
    const id = await this.gateway.ensureCustomer({
      existingId: user.stripeCustomerId,
      userId: user.id,
      email: user.email,
      name: user.fullName,
    });
    if (id !== user.stripeCustomerId) {
      await this.prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: id } });
    }
    return id;
  }

  private async resolveTarget(
    userId: string,
    input: { offerId?: string; applicationId?: string },
  ): Promise<Target> {
    if (!!input.offerId === !!input.applicationId) {
      throw AppException.validation([
        {
          field: input.offerId ? 'applicationId' : 'offerId',
          code: 'INVALID',
          message: 'Envía `offerId` (pago de la oferta) o `applicationId` (saldo), no ambos.',
        },
      ]);
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (input.applicationId) {
      const application = await this.prisma.application.findFirst({
        where: { id: input.applicationId, userId },
        select: APPLICATION_SELECT,
      });
      if (!application) throw AppException.notFound('La postulación no existe.');
      const offer = await this.prisma.offer.findUniqueOrThrow({
        where: { id: application.offerId },
        select: OFFER_SELECT,
      });
      const currency =
        application.currency && isCurrency(application.currency)
          ? application.currency
          : currencyForCountry(user.countryCode);
      return {
        concept: 'BALANCE',
        user,
        offer,
        application,
        currency,
        totalCents: (application.balanceCents ?? 0) > 0 ? application.balanceCents : null,
      };
    }
    const offer = await this.prisma.offer.findUnique({
      where: { id: input.offerId },
      select: OFFER_SELECT,
    });
    if (!offer || offer.publicationStatus !== 'PUBLISHED') {
      throw new AppException('OFFER_NOT_AVAILABLE');
    }
    const currency = currencyForCountry(user.countryCode);
    return {
      concept: 'FULL_PRICE',
      user,
      offer,
      application: null,
      currency,
      totalCents: offerPriceFor(offer, currency),
    };
  }

  private balanceDecision(application: ApplicationRow, now: Date): BalanceDecision {
    return decideBalancePayment({
      status: application.status,
      balanceCents: application.balanceCents,
      hasCurrency: !!application.currency,
      responseDueAt: application.responseDueAt,
      pendingTransfer: application.pendingTransferSince !== null,
      now,
    });
  }

  private async enrollmentDecision(
    db: Prisma.TransactionClient,
    target: Target,
    now: Date,
  ): Promise<CheckoutDecision> {
    const { offer, user } = target;
    const [existing, seatsTaken, application] = await Promise.all([
      db.enrollment.findUnique({
        where: { userId_offerId: { userId: user.id, offerId: offer.id } },
        select: { status: true },
      }),
      offer.capacity !== null
        ? db.enrollment.count({
            where: { offerId: offer.id, userId: { not: user.id }, ...seatHoldingWhere(now) },
          })
        : Promise.resolve(0),
      db.application.findUnique({
        where: { userId_offerId: { userId: user.id, offerId: offer.id } },
        select: { status: true },
      }),
    ]);
    return decideEnrollmentCheckout({
      type: offer.type,
      origin: offer.origin,
      isFree: offer.isFree,
      availability: deriveOfferAvailability(offer, now),
      enrollmentOpensAt: offer.enrollmentOpensAt,
      hasPrice: target.totalCents !== null,
      soldOut: offer.capacity !== null && seatsTaken >= offer.capacity,
      existingEnrollmentStatus: existing?.status ?? null,
      applicationStatus: application?.status ?? null,
    });
  }
}

/** Fechas a ISO para `meta` del error / del bloqueo. */
function serializeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]),
  );
}
