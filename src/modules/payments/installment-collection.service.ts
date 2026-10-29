import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { demoStripeBlocked, isDemoStripeId } from '../../common/utils/demo';
import { addDaysInZone, addMinutes, nowUtc } from '../../common/utils/time';
import { BUSINESS_RULES } from '../../config/business-rules';
import type { InstallmentStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  type GatewayCheckoutSession,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../../infra/stripe/payment-gateway';
import { NotificationsService } from '../notifications/notifications.service';
import type { PaymentPlanDto } from './dto/payments.response.dto';
import { PaymentLedgerService } from './payment-ledger.service';
import { PLAN_INCLUDE, toPlanDto } from './payment-view';
import { paymentConceptLabel } from './policies/payment-amounts.policy';
import { installmentUpcomingMessage } from './policies/payment-messages.policy';
import { ACTIVE_PLAN_STATUSES, isActivePlan } from './policies/payment-status.policy';

export type ChargeOutcome = 'PAID' | 'FAILED' | 'PROCESSING' | 'SKIPPED';

/** Plan de los datos demo: cliente o tarjeta de Stripe ficticios (`cus_demo_…` / `pm_demo_…`). */
function isDemoPlan(plan: {
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
}): boolean {
  return isDemoStripeId(plan.stripeCustomerId) || isDemoStripeId(plan.stripePaymentMethodId);
}

/**
 * Cobro automático de cuotas (HU-24). DECISIÓN (docs/ARCHITECTURE.md → "Pagos"): plan PROPIO en
 * lugar de Stripe Subscriptions/Subscription Schedules, porque los montos no salen de un Price fijo
 * (saldo tras beca, centavos de ajuste en la última cuota), las fechas dependen del fin de la oferta y
 * el plan debe reflejar estados de negocio (Al día / Cobro fallido / En mora / suspensión). La 1.ª
 * cuota se cobra en Checkout guardando la tarjeta (`setup_future_usage=off_session`); las siguientes
 * se cobran aquí con PaymentIntents off-session (`chargeOffSession`, clave idempotente por intento).
 *
 * Todas las operaciones son idempotentes: claim atómico de la cuota (`status` + `processingSince`) y
 * transiciones condicionadas en `PaymentLedgerService`.
 */
@Injectable()
export class InstallmentCollectionService {
  private readonly logger = new Logger(InstallmentCollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PaymentLedgerService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Cobra una cuota con la tarjeta guardada. `allowFrom`: estados desde los que se reclama (el job:
   * SCHEDULED vencidas y FAILED con reintento; [Pagar ahora]: FAILED; reproceso: PROCESSING viejas).
   */
  async chargeInstallment(
    installmentId: string,
    allowFrom: InstallmentStatus[],
    options: { staleBefore?: Date } = {},
  ): Promise<{ outcome: ChargeOutcome; failureMessage: string | null }> {
    if (!this.gateway.configured) return { outcome: 'SKIPPED', failureMessage: null };
    const now = nowUtc();
    const current = await this.prisma.installment.findUnique({
      where: { id: installmentId },
      include: { plan: { include: { offer: { select: { name: true } } } } },
    });
    if (!current || !allowFrom.includes(current.status) || !isActivePlan(current.plan.status)) {
      return { outcome: 'SKIPPED', failureMessage: null };
    }
    // Datos demo (prisma/demo-data.ts): tarjeta ficticia, nunca se cobra en Stripe.
    if (isDemoPlan(current.plan)) {
      this.logger.debug({ installmentId }, 'Cuota demo: se omite el cobro');
      return { outcome: 'SKIPPED', failureMessage: null };
    }
    const reprocess = current.status === 'PROCESSING';
    const claimed = await this.prisma.installment.updateMany({
      where: {
        id: installmentId,
        status: current.status,
        ...(reprocess
          ? { processingSince: { lt: options.staleBefore ?? now } }
          : { processingSince: null }),
      },
      data: {
        status: 'PROCESSING',
        processingSince: now,
        lastAttemptAt: now,
        // Reprocesar una cuota "en cobro" reutiliza el intento (misma clave idempotente).
        ...(reprocess ? {} : { attempts: { increment: 1 } }),
      },
    });
    if (claimed.count === 0) return { outcome: 'SKIPPED', failureMessage: null };
    const attempt = reprocess ? current.attempts : current.attempts + 1;
    const plan = current.plan;

    const payment = await this.prisma.payment.upsert({
      where: { installmentId },
      create: {
        userId: plan.userId,
        offerId: plan.offerId,
        enrollmentId: plan.enrollmentId,
        applicationId: plan.applicationId,
        planId: plan.id,
        installmentId,
        concept: 'INSTALLMENT',
        method: 'CARD',
        status: 'PENDING',
        amountCents: current.amountCents,
        currency: plan.currency,
      },
      update: {},
    });

    if (!plan.stripeCustomerId || !plan.stripePaymentMethodId) {
      await this.ledger.markInstallmentFailed(payment.id, {
        failureMessage: 'No hay una tarjeta registrada para el cobro automático.',
      });
      return { outcome: 'FAILED', failureMessage: 'Sin tarjeta registrada.' };
    }

    let result;
    try {
      result = await this.gateway.chargeOffSession({
        customerId: plan.stripeCustomerId,
        paymentMethodId: plan.stripePaymentMethodId,
        amountCents: current.amountCents,
        currency: plan.currency,
        description: `${plan.offer.name} — ${paymentConceptLabel({
          concept: 'INSTALLMENT',
          installment: { sequence: current.sequence, count: plan.installmentCount },
        })}`,
        metadata: {
          kind: 'installment',
          paymentId: payment.id,
          planId: plan.id,
          installmentId,
          userId: plan.userId,
          offerId: plan.offerId,
        },
        idempotencyKey: `installment:${installmentId}:attempt:${attempt}`,
      });
    } catch (error) {
      // Stripe no respondió: se libera el claim para reintentar en la siguiente corrida.
      await this.prisma.installment.update({
        where: { id: installmentId },
        data: {
          status: current.status === 'PROCESSING' ? 'PROCESSING' : current.status,
          processingSince: current.status === 'PROCESSING' ? now : null,
          ...(reprocess ? {} : { attempts: { decrement: 1 } }),
        },
      });
      throw error;
    }

    if (result.paymentIntentId) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { stripePaymentIntentId: result.paymentIntentId },
      });
    }
    if (result.status === 'succeeded') {
      await this.ledger.markPaid(payment.id, {
        paymentIntentId: result.paymentIntentId,
        chargeId: result.chargeId,
        receiptUrl: result.receiptUrl,
        card: result.card,
      });
      return { outcome: 'PAID', failureMessage: null };
    }
    if (result.status === 'processing') return { outcome: 'PROCESSING', failureMessage: null };
    await this.ledger.markInstallmentFailed(payment.id, {
      paymentIntentId: result.paymentIntentId,
      failureCode: result.failureCode,
      failureMessage: result.failureMessage,
    });
    return { outcome: 'FAILED', failureMessage: result.failureMessage };
  }

  /** [Pagar ahora] (HU-24/26): cobra de inmediato las cuotas fallidas con la tarjeta registrada. */
  async payNow(userId: string, planId: string): Promise<PaymentPlanDto> {
    if (!this.gateway.configured) throw new AppException('PAYMENTS_NOT_CONFIGURED');
    const plan = await this.prisma.installmentPlan.findFirst({
      where: { id: planId, userId },
      include: { installments: { where: { status: 'FAILED' }, orderBy: { sequence: 'asc' } } },
    });
    if (!plan) throw AppException.notFound('El plan no existe.');
    if (!isActivePlan(plan.status) || plan.installments.length === 0) {
      throw new AppException('PAYMENT_INVALID_STATE', { meta: { status: plan.status } });
    }
    if (isDemoPlan(plan)) throw demoStripeBlocked();
    for (const installment of plan.installments) {
      const { outcome, failureMessage } = await this.chargeInstallment(installment.id, ['FAILED']);
      if (outcome === 'FAILED') {
        throw new AppException('PAYMENT_CHARGE_FAILED', { meta: { failureMessage } });
      }
    }
    return this.planDto(planId);
  }

  /**
   * [Actualizar tarjeta] completado (Checkout `setup`): guarda la tarjeta nueva en el plan y, si
   * había cuotas fallidas, las cobra de inmediato (regulariza).
   */
  async applyCardUpdate(session: GatewayCheckoutSession): Promise<void> {
    const planId = session.metadata.planId;
    if (!planId || session.status !== 'complete' || !session.setupIntentId) return;
    const setup = await this.gateway.retrieveSetupIntent(session.setupIntentId);
    if (!setup.paymentMethodId) return;
    const plan = await this.prisma.installmentPlan.findUnique({ where: { id: planId } });
    if (!plan || !isActivePlan(plan.status)) return;
    await this.prisma.installmentPlan.update({
      where: { id: planId },
      data: {
        stripePaymentMethodId: setup.paymentMethodId,
        stripeCustomerId: session.customerId ?? plan.stripeCustomerId,
        ...(setup.card
          ? {
              cardBrand: setup.card.brand,
              cardLast4: setup.card.last4,
              cardExpMonth: setup.card.expMonth,
              cardExpYear: setup.card.expYear,
            }
          : {}),
      },
    });
    const failed = await this.prisma.installment.findMany({
      where: { planId, status: 'FAILED' },
      orderBy: { sequence: 'asc' },
    });
    for (const installment of failed) {
      try {
        await this.chargeInstallment(installment.id, ['FAILED']);
      } catch (error) {
        this.logger.error(
          { err: error, installmentId: installment.id },
          'Reintento tras tarjeta nueva',
        );
      }
    }
  }

  // --- Jobs ----------------------------------------------------------------------------------------

  /** Cuotas vencidas, reintentos programados y cobros "en curso" abandonados. */
  async chargeDue(now: Date): Promise<number> {
    const staleBefore = addMinutes(now, -BUSINESS_RULES.INSTALLMENT_PROCESSING_STALE_MINUTES);
    const due = await this.prisma.installment.findMany({
      where: {
        plan: { status: { in: [...ACTIVE_PLAN_STATUSES] } },
        OR: [
          { status: 'SCHEDULED', dueAt: { lte: now } },
          { status: 'FAILED', nextRetryAt: { lte: now } },
          { status: 'PROCESSING', processingSince: { lt: staleBefore } },
        ],
      },
      orderBy: { dueAt: 'asc' },
      select: { id: true, status: true },
      take: 100,
    });
    let charged = 0;
    for (const installment of due) {
      try {
        const { outcome } = await this.chargeInstallment(installment.id, [installment.status], {
          staleBefore,
        });
        if (outcome !== 'SKIPPED') charged++;
      } catch (error) {
        this.logger.error({ err: error, installmentId: installment.id }, 'Cobro de cuota falló');
      }
    }
    return charged;
  }

  /** "En mora" a los DELINQUENCY_AFTER_DAYS del primer cobro fallido sin regularizar. */
  async markDelinquent(now: Date): Promise<number> {
    const threshold = addDaysInZone(now, -BUSINESS_RULES.DELINQUENCY_AFTER_DAYS);
    const plans = await this.prisma.installmentPlan.findMany({
      where: { status: 'PAST_DUE', failedSince: { lte: threshold } },
      select: { id: true },
    });
    let count = 0;
    for (const plan of plans) {
      try {
        if (await this.ledger.markDelinquent(plan.id, threshold)) count++;
      } catch (error) {
        this.logger.error({ err: error, planId: plan.id }, 'No se pudo marcar el plan en mora');
      }
    }
    return count;
  }

  /** HU-06/13: aviso "cuota próxima" N días antes (claim `upcomingNotifiedAt`). */
  async notifyUpcoming(now: Date): Promise<number> {
    const horizon = addDaysInZone(now, BUSINESS_RULES.INSTALLMENT_UPCOMING_NOTICE_DAYS);
    const upcoming = await this.prisma.installment.findMany({
      where: {
        status: 'SCHEDULED',
        upcomingNotifiedAt: null,
        sequence: { gt: 1 },
        dueAt: { gt: now, lte: horizon },
        plan: { status: { in: [...ACTIVE_PLAN_STATUSES] } },
      },
      include: {
        plan: {
          include: {
            offer: { select: { name: true } },
            user: { select: { timezone: true } },
          },
        },
      },
    });
    let sent = 0;
    for (const installment of upcoming) {
      const claimed = await this.prisma.installment.updateMany({
        where: { id: installment.id, upcomingNotifiedAt: null },
        data: { upcomingNotifiedAt: now },
      });
      if (claimed.count === 0) continue;
      const { plan } = installment;
      try {
        await this.notifications.notify({
          userIds: [plan.userId],
          ...installmentUpcomingMessage({
            offerName: plan.offer.name,
            sequence: installment.sequence,
            count: plan.installmentCount,
            amount: { amountCents: installment.amountCents, currency: plan.currency },
            dueAt: installment.dueAt,
            cardBrand: plan.cardBrand,
            cardLast4: plan.cardLast4,
            timezone: plan.user.timezone,
          }),
          data: { planId: plan.id, installmentId: installment.id },
          dedupeKey: `installment-upcoming:${installment.id}`,
        });
        sent++;
      } catch (error) {
        this.logger.error({ err: error, installmentId: installment.id }, 'Aviso de cuota falló');
      }
    }
    return sent;
  }

  private async planDto(planId: string): Promise<PaymentPlanDto> {
    const plan = await this.prisma.installmentPlan.findUniqueOrThrow({
      where: { id: planId },
      include: PLAN_INCLUDE,
    });
    return toPlanDto(plan, nowUtc());
  }
}
