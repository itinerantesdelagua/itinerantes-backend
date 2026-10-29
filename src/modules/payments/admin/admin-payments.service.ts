import { Inject, Injectable } from '@nestjs/common';
import type { AdminUser } from '../../../common/guards/permissions.guard';
import { AppException } from '../../../common/errors/app.exception';
import { paginate, type PaginatedResponseDto } from '../../../common/dto/pagination.dto';
import { assertNotDemoStripe } from '../../../common/utils/demo';
import { nowUtc } from '../../../common/utils/time';
import { BUSINESS_RULES } from '../../../config/business-rules';
import { Permission } from '../../../config/permissions';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../../../infra/stripe/payment-gateway';
import { AuditService } from '../../audit/audit.service';
import type { AccessUrlDto } from '../../enrollments/dto/portal-shared.dto';
import { formatPaymentFolio } from '../policies/payment-amounts.policy';
import { TransfersService } from '../transfers.service';
import {
  ADMIN_PAYMENT_INCLUDE,
  ADMIN_REFUND_INCLUDE,
  type AdminPaymentRow,
  PAYER_SELECT,
  toAdminPaymentDto,
  toAdminRefundDto,
} from './admin-payment-view';
import type {
  AdminPaymentsSummaryQueryDto,
  ListAdminPaymentsQueryDto,
  ListAdminRefundsQueryDto,
  ListAdminTransfersQueryDto,
  RefundRequestDto,
  RejectTransferRequestDto,
  ValidateTransferRequestDto,
} from './dto/admin-payments.request.dto';
import type {
  AdminPaymentDetailDto,
  AdminPaymentDto,
  AdminPaymentsSummaryDto,
  AdminRefundDto,
} from './dto/admin-payments.response.dto';
import {
  decideRefund,
  paymentRefundTotals,
  refundStatusFromGateway,
  totalsByCurrency,
} from './policies/admin-payments.policy';
import { OFFER_REF_SELECT } from '../payment-view';

/** Estados que cuentan como cobrados en el resumen (incluye los luego reembolsados). */
const COLLECTED_STATUSES = ['PAID', 'VALIDATED', 'REFUNDED'] as const;

/**
 * Panel de pagos (HU-33): listado y detalle de pagos, transferencias por conciliar (validar /
 * rechazar con `TransfersService`), reembolsos (tarjeta vía `PaymentGateway`; transferencia =
 * registro del reembolso hecho fuera) y resumen por moneda. Toda acción queda en la auditoría.
 */
@Injectable()
export class AdminPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly transfers: TransfersService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // --- Lectura -------------------------------------------------------------------------------------

  async list(query: ListAdminPaymentsQueryDto): Promise<PaginatedResponseDto<AdminPaymentDto>> {
    const where: Prisma.PaymentWhereInput = {
      status: query.status?.length ? { in: query.status } : { not: 'CANCELLED' },
      ...(query.method ? { method: query.method } : {}),
      ...(query.concept ? { concept: query.concept } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...searchWhere(query.q),
    };
    const orderBy: Prisma.PaymentOrderByWithRelationInput[] =
      query.sort === 'CREATED_ASC'
        ? [{ createdAt: 'asc' }]
        : query.sort === 'PAID_DESC'
          ? [{ paidAt: { sort: 'desc', nulls: 'last' } }]
          : query.sort === 'AMOUNT_DESC'
            ? [{ amountCents: 'desc' }]
            : [{ createdAt: 'desc' }];
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: ADMIN_PAYMENT_INCLUDE,
        orderBy: [...orderBy, { id: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(rows.map(toAdminPaymentDto), total, query);
  }

  async listTransfers(
    query: ListAdminTransfersQueryDto,
  ): Promise<PaginatedResponseDto<AdminPaymentDto>> {
    const status = query.status ?? 'PENDING_VALIDATION';
    const where: Prisma.PaymentWhereInput = {
      method: 'BANK_TRANSFER',
      status,
      ...(query.offerId ? { offerId: query.offerId } : {}),
      ...searchWhere(query.q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: ADMIN_PAYMENT_INCLUDE,
        // Por conciliar: la más antigua primero; resueltas: la revisión más reciente primero.
        orderBy:
          status === 'PENDING_VALIDATION'
            ? [{ submittedAt: 'asc' }, { id: 'asc' }]
            : [{ reviewedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(rows.map(toAdminPaymentDto), total, query);
  }

  async detail(paymentId: string, user: AdminUser): Promise<AdminPaymentDetailDto> {
    const row = await this.require(paymentId);
    const dto = toAdminPaymentDto(row);
    const manage = user.permissions.includes(Permission.PAYMENTS_MANAGE);
    return {
      ...dto,
      refunds: row.refunds.map((r) => toAdminRefundDto(r, row)),
      actions: {
        canRefund: manage && dto.refundable.amountCents > 0,
        canReview: manage && row.method === 'BANK_TRANSFER' && row.status === 'PENDING_VALIDATION',
      },
    };
  }

  async proof(paymentId: string): Promise<AccessUrlDto> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.proofFileKey) throw AppException.notFound('El comprobante no existe.');
    const signed = await this.storage.getDownloadUrl(payment.proofFileKey, {
      expiresInSeconds: BUSINESS_RULES.PRIVATE_FILE_URL_TTL_SECONDS,
      downloadFileName: payment.proofFileName ?? undefined,
    });
    return {
      kind: 'FILE',
      url: signed.url,
      expiresAt: signed.expiresAt,
      fileName: payment.proofFileName,
    };
  }

  async summary(query: AdminPaymentsSummaryQueryDto): Promise<AdminPaymentsSummaryDto> {
    const offer = query.offerId ? { offerId: query.offerId } : {};
    const [collected, pendingTransfers, pastDue, delinquent, suspended, pendingRefunds] =
      await Promise.all([
        this.prisma.payment.findMany({
          where: {
            ...offer,
            status: { in: [...COLLECTED_STATUSES] },
            ...(query.from || query.to
              ? {
                  paidAt: {
                    ...(query.from ? { gte: new Date(query.from) } : {}),
                    ...(query.to ? { lte: new Date(query.to) } : {}),
                  },
                }
              : {}),
          },
          select: { currency: true, amountCents: true, refundedCents: true },
        }),
        this.prisma.payment.aggregate({
          where: { ...offer, method: 'BANK_TRANSFER', status: 'PENDING_VALIDATION' },
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
        this.prisma.installmentPlan.count({ where: { ...offer, status: 'PAST_DUE' } }),
        this.prisma.installmentPlan.count({ where: { ...offer, status: 'DELINQUENT' } }),
        this.prisma.installmentPlan.count({
          where: { ...offer, enrollment: { status: 'SUSPENDED' } },
        }),
        this.prisma.paymentRefund.count({
          where: { status: 'PENDING', ...(query.offerId ? { payment: offer } : {}) },
        }),
      ]);
    return {
      currencies: totalsByCurrency(collected),
      pendingTransfers: {
        count: pendingTransfers._count._all,
        // La transferencia solo existe en MXN (HU-23).
        amount: { amountCents: pendingTransfers._sum.amountCents ?? 0, currency: 'MXN' },
      },
      plans: { pastDue, delinquent, accessSuspended: suspended },
      pendingRefunds,
    };
  }

  async listRefunds(
    query: ListAdminRefundsQueryDto,
  ): Promise<PaginatedResponseDto<AdminRefundDto>> {
    const where: Prisma.PaymentRefundWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.offerId ? { payment: { offerId: query.offerId } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.paymentRefund.findMany({
        where,
        include: {
          ...ADMIN_REFUND_INCLUDE,
          payment: {
            select: {
              id: true,
              number: true,
              user: { select: PAYER_SELECT },
              offer: { select: OFFER_REF_SELECT },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.paymentRefund.count({ where }),
    ]);
    return paginate(
      rows.map((r) => toAdminRefundDto(r, r.payment)),
      total,
      query,
    );
  }

  // --- Transferencias ------------------------------------------------------------------------------

  /** "Validar y activar inscripción" (reutiliza `TransfersService.approveTransfer`). */
  async validateTransfer(
    paymentId: string,
    user: AdminUser,
    dto: ValidateTransferRequestDto,
  ): Promise<AdminPaymentDetailDto> {
    const receivedOn = new Date(`${dto.receivedOn}T00:00:00.000Z`);
    if (Number.isNaN(receivedOn.getTime())) {
      throw AppException.validation([
        { field: 'receivedOn', code: 'INVALID', message: 'Fecha inválida.' },
      ]);
    }
    const before = await this.require(paymentId);
    await this.transfers.approveTransfer(paymentId, user.id, {
      receivedAmountCents: dto.receivedAmountCents,
      receivedOn,
    });
    await this.audit.record({
      actor: user,
      action: 'transfer.validate',
      entityType: 'Payment',
      entityId: paymentId,
      summary: `Validó la transferencia ${formatPaymentFolio(before.number)} de ${before.user.fullName} (inscripción activada).`,
      before: { status: before.status },
      after: {
        status: 'VALIDATED',
        receivedAmountCents: dto.receivedAmountCents,
        receivedOn: dto.receivedOn,
      },
    });
    return this.detail(paymentId, user);
  }

  async rejectTransfer(
    paymentId: string,
    user: AdminUser,
    dto: RejectTransferRequestDto,
  ): Promise<AdminPaymentDetailDto> {
    const note = dto.note?.trim() || null;
    if (dto.reason === 'OTHER' && !note) {
      throw AppException.validation([
        { field: 'note', code: 'REQUIRED', message: 'Describe el motivo del rechazo.' },
      ]);
    }
    const before = await this.require(paymentId);
    await this.transfers.rejectTransfer(paymentId, user.id, { reason: dto.reason, note });
    await this.audit.record({
      actor: user,
      action: 'transfer.reject',
      entityType: 'Payment',
      entityId: paymentId,
      summary: `Rechazó la transferencia ${formatPaymentFolio(before.number)} de ${before.user.fullName}.`,
      before: { status: before.status },
      after: { status: 'REJECTED', rejectionReason: dto.reason, rejectionNote: note },
    });
    return this.detail(paymentId, user);
  }

  // --- Reembolsos ----------------------------------------------------------------------------------

  /**
   * Reembolso total o parcial (HU-33). Tarjeta → Stripe (`refundPayment`, clave idempotente por
   * registro); transferencia → se registra el reembolso hecho fuera (confirmado al instante). La
   * inscripción NO cambia (la baja es una decisión aparte del equipo).
   */
  async refund(
    paymentId: string,
    user: AdminUser,
    dto: RefundRequestDto,
  ): Promise<AdminPaymentDetailDto> {
    const payment = await this.require(paymentId);
    const decision = decideRefund({
      status: payment.status,
      method: payment.method,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      amountCents: payment.amountCents,
      refundedCents: payment.refundedCents,
      refunds: payment.refunds,
      requestedCents: dto.amountCents,
    });
    if (!decision.ok) {
      throw new AppException(decision.code, {
        meta: { status: payment.status, refundableCents: decision.refundableCents },
      });
    }
    // Datos demo (prisma/demo-data.ts): el cobro es ficticio, no se reembolsa en Stripe.
    if (decision.via === 'GATEWAY') assertNotDemoStripe(payment.stripePaymentIntentId);
    if (decision.via === 'GATEWAY' && !this.gateway.configured) {
      throw new AppException('PAYMENTS_NOT_CONFIGURED');
    }
    const reason = dto.reason.trim();
    const refund = await this.prisma.paymentRefund.create({
      data: {
        paymentId,
        amountCents: dto.amountCents,
        currency: payment.currency,
        method: payment.method,
        status: decision.via === 'MANUAL_RECORD' ? 'SUCCEEDED' : 'PENDING',
        reason,
        createdById: user.id,
      },
    });

    if (decision.via === 'GATEWAY') {
      try {
        const result = await this.gateway.refundPayment({
          paymentIntentId: payment.stripePaymentIntentId!,
          amountCents: dto.amountCents,
          metadata: {
            kind: 'admin_refund',
            paymentId,
            refundId: refund.id,
            reason: reason.slice(0, 450),
          },
          idempotencyKey: `refund:${refund.id}`,
        });
        await this.prisma.paymentRefund.update({
          where: { id: refund.id },
          data: {
            status: refundStatusFromGateway(result.status),
            stripeRefundId: result.id,
            failureMessage: result.failureMessage?.slice(0, 500) ?? null,
          },
        });
      } catch (error) {
        await this.prisma.paymentRefund.update({
          where: { id: refund.id },
          data: { status: 'FAILED', failureMessage: 'Stripe no respondió. Intenta de nuevo.' },
        });
        await this.audit.record({
          actor: user,
          action: 'payment.refund',
          entityType: 'Payment',
          entityId: paymentId,
          summary: `Intentó reembolsar ${formatPaymentFolio(payment.number)}: Stripe no respondió.`,
          after: { refundId: refund.id, amountCents: dto.amountCents, status: 'FAILED', reason },
        });
        throw error;
      }
    }

    const refunds = await this.prisma.paymentRefund.findMany({ where: { paymentId } });
    const totals = paymentRefundTotals({ amountCents: payment.amountCents, refunds });
    const refundedCents = Math.max(payment.refundedCents, totals.refundedCents);
    const now = nowUtc();
    await this.prisma.payment.update({ where: { id: paymentId }, data: { refundedCents } });
    if (refundedCents >= payment.amountCents) {
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: { in: ['PAID', 'VALIDATED'] } },
        data: { status: 'REFUNDED', refundedAt: now },
      });
    }
    const saved = refunds.find((r) => r.id === refund.id)!;
    await this.audit.record({
      actor: user,
      action: 'payment.refund',
      entityType: 'Payment',
      entityId: paymentId,
      summary:
        `Reembolsó ${(dto.amountCents / 100).toFixed(2)} ${payment.currency} de ` +
        `${formatPaymentFolio(payment.number)} (${saved.status === 'SUCCEEDED' ? 'confirmado' : saved.status === 'PENDING' ? 'en proceso en Stripe' : 'fallido'}).`,
      before: { status: payment.status, refundedCents: payment.refundedCents },
      after: {
        status: refundedCents >= payment.amountCents ? 'REFUNDED' : payment.status,
        refundedCents,
        refundId: refund.id,
        refundStatus: saved.status,
        reason,
      },
    });
    return this.detail(paymentId, user);
  }

  // ------------------------------------------------------------------------------------------------

  private async require(paymentId: string): Promise<AdminPaymentRow> {
    const row = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: ADMIN_PAYMENT_INCLUDE,
    });
    if (!row) throw AppException.notFound('El pago no existe.');
    return row;
  }
}

/** `q`: folio PAG-000123 (o el número), nombre/correo de quien paga o nombre de la oferta. */
function searchWhere(q: string | undefined): Prisma.PaymentWhereInput {
  const text = q?.trim();
  if (!text) return {};
  const folio = /^(?:PAG-?)?0*(\d{1,9})$/i.exec(text);
  const contains = { contains: text, mode: 'insensitive' as const };
  return {
    OR: [
      ...(folio ? [{ number: Number(folio[1]) }] : []),
      { user: { fullName: contains } },
      { user: { email: contains } },
      { offer: { name: contains } },
    ],
  };
}
