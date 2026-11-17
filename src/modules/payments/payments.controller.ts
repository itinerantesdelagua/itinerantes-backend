import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import type { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { uuidOr404 } from '../../common/pipes/uuid-or-404.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../common/swagger/api-paginated-response.decorator';
import { BUSINESS_RULES, formatMegabytes } from '../../config/business-rules';
import { BEARER_AUTH_NAME } from '../../config/openapi';
import { AccessUrlDto } from '../enrollments/dto/portal-shared.dto';
import { CheckoutService } from './checkout.service';
import {
  ListPaymentsQueryDto,
  PaymentTargetQueryDto,
  StartCheckoutRequestDto,
  SubmitTransferRequestDto,
  TransferUploadUrlRequestDto,
} from './dto/payments.request.dto';
import {
  CardUpdateSessionDto,
  CheckoutSessionDto,
  PaymentDto,
  PaymentPlanDto,
  PaymentPlansDto,
  PaymentQuoteDto,
  PaymentsSummaryDto,
  TransferUploadUrlDto,
} from './dto/payments.response.dto';
import { InstallmentCollectionService } from './installment-collection.service';
import { PaymentsQueryService } from './payments-query.service';
import { TransfersService } from './transfers.service';

const PAYMENT_ID = uuidOr404('El pago no existe.');
const PLAN_ID = uuidOr404('El plan no existe.');
/** Tamaño máximo del comprobante, para la documentación ("15 MB"). */
const PROOF_MAX = formatMegabytes(BUSINESS_RULES.FILE_LIMITS.TRANSFER_RECEIPT.maxBytes);
const OWN = ' Pago/plan ajeno, inexistente o id mal formado → 404 `NOT_FOUND` (HU-26).';

@ApiTags('Pagos')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('me/payments')
export class PaymentsController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly query: PaymentsQueryService,
    private readonly transfers: TransfersService,
    private readonly collection: InstallmentCollectionService,
  ) {}

  // --- Pantalla de pago y Stripe Checkout ---------------------------------------------------------

  @Get('quote')
  @ApiOperation({
    summary: 'Resumen de pago (precio, cuotas, métodos, transferencia)',
    description:
      'HU-22 paso "Resumen" ([Inscribirme y pagar] / [Pagar en cuotas], `offerId`) y HU-23 "Pagar ' +
      'saldo" (`applicationId`). Monto en la moneda de cobro (país del perfil: MX → MXN; resto → ' +
      'USD; el saldo usa la moneda de la postulación), calculado por el servidor. Incluye: opciones ' +
      'de cuotas con calendario (HU-24: 2–4, la última antes del fin de la oferta), métodos ' +
      '(`BANK_TRANSFER` solo México y solo saldo), datos bancarios con referencia única, `blocker` ' +
      '(ya inscrito, cupo agotado, cerradas, Moodle, vencida…: botón deshabilitado con el motivo), ' +
      '`openCheckout` ([Continuar pago]) y `latestTransfer` (pendiente o rechazada con motivo). ' +
      'Envía `offerId` O `applicationId`.',
  })
  @ApiOkResponse({ type: PaymentQuoteDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'NOT_FOUND',
    'OFFER_NOT_AVAILABLE',
    'RATE_LIMITED',
  )
  quote(
    @CurrentUser() user: AuthUser,
    @Query() q: PaymentTargetQueryDto,
  ): Promise<PaymentQuoteDto> {
    return this.checkout.quote(user.id, q);
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Iniciar pago con tarjeta (Stripe Checkout)',
    description:
      'HU-22 (pago completo), HU-23 (saldo tras beca) y HU-24 (`installmentCount` 2–4 + ' +
      '`autoDebitAuthorized`: se cobra la 1.ª cuota y se guarda la tarjeta). Requiere ' +
      '`termsAccepted: true`. Devuelve `checkoutUrl`: redirige el navegador ahí (`window.location`). ' +
      'Stripe regresa a `/pagos/resultado?paymentId=…&result=success|cancel`; consulta ' +
      '`GET /me/payments/{paymentId}` hasta que deje de estar PENDING. Si ya hay un checkout abierto ' +
      'con los mismos datos se reutiliza (`reused: true`, [Continuar pago]). Con cupo limitado, la ' +
      'reserva retiene el lugar mientras la sesión está abierta (30 min). Nada se cobra hasta que ' +
      'Stripe confirma. Sin llaves de Stripe → 503 `PAYMENTS_NOT_CONFIGURED`.',
  })
  @ApiCreatedResponse({ type: CheckoutSessionDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'NOT_FOUND',
    'OFFER_NOT_AVAILABLE',
    'ENROLLMENT_ALREADY_EXISTS',
    'OFFER_SOLD_OUT',
    'PAYMENT_TRANSFER_PENDING',
    'PAYMENT_BALANCE_NOT_DUE',
    'ENROLLMENT_CLOSED',
    'PAYMENT_NOT_ALLOWED',
    'PAYMENT_INSTALLMENTS_NOT_AVAILABLE',
    'APPLICATION_DEADLINE_PASSED',
    'RATE_LIMITED',
    'PAYMENT_PROVIDER_ERROR',
    'PAYMENTS_NOT_CONFIGURED',
  )
  start(
    @CurrentUser() user: AuthUser,
    @Body() dto: StartCheckoutRequestDto,
  ): Promise<CheckoutSessionDto> {
    return this.checkout.start(user.id, dto);
  }

  // --- Mis pagos (HU-26) ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Mis pagos: historial',
    description:
      'HU-26 / HU-14 "Mis pagos": solo pagos propios, del más reciente al más antiguo (fecha, ' +
      'concepto, monto, moneda, método y estado). No incluye checkouts cancelados. Vacío → "Aún no ' +
      'tienes pagos" (ver `summary.moodleOnly`).',
  })
  @ApiPaginatedResponse(PaymentDto, 'Pagos paginados.')
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'RATE_LIMITED')
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: ListPaymentsQueryDto,
  ): Promise<PaginatedResponseDto<PaymentDto>> {
    return this.query.list(user.id, q);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Mis pagos: plan vigente y avisos',
    description:
      'HU-26: arriba de "Mis pagos" — planes de cuotas vigentes (cuotas pagadas/total, próximo ' +
      'cobro, tarjeta) y avisos destacados (cobro fallido, en mora, transferencia pendiente o ' +
      'rechazada). `moodleOnly`: sin pagos pero con formaciones Moodle ("se pagaron fuera", HU-25).',
  })
  @ApiOkResponse({ type: PaymentsSummaryDto })
  @ApiErrorResponses('UNAUTHORIZED', 'RATE_LIMITED')
  summary(@CurrentUser() user: AuthUser): Promise<PaymentsSummaryDto> {
    return this.query.summary(user.id);
  }

  @Get('plans')
  @ApiOperation({
    summary: 'Mis planes de cuotas',
    description: 'HU-24 / HU-26: todos mis planes (vigentes primero) con su calendario de cuotas.',
  })
  @ApiOkResponse({ type: PaymentPlansDto })
  @ApiErrorResponses('UNAUTHORIZED', 'RATE_LIMITED')
  async plans(@CurrentUser() user: AuthUser): Promise<PaymentPlansDto> {
    return { data: await this.query.plans(user.id) };
  }

  @Get('plans/:planId')
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiOperation({ summary: 'Detalle de un plan de cuotas', description: 'HU-24 / HU-26.' + OWN })
  @ApiOkResponse({ type: PaymentPlanDto })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED')
  plan(
    @CurrentUser() user: AuthUser,
    @Param('planId', PLAN_ID) planId: string,
  ): Promise<PaymentPlanDto> {
    return this.query.plan(user.id, planId);
  }

  @Post('plans/:planId/card-update')
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiOperation({
    summary: '[Actualizar tarjeta]',
    description:
      'HU-24 / HU-26: crea una sesión de Stripe Checkout en modo `setup` (Stripe pide la tarjeta ' +
      'nueva, con 3-D Secure; el portal no ve datos de tarjeta). Redirige a `checkoutUrl`; al volver ' +
      '(`/perfil/pagos?planId=…&cardUpdate=success|cancel`) recarga el plan: el webhook guarda ' +
      'la tarjeta y cobra de inmediato las cuotas fallidas.' +
      OWN,
  })
  @ApiCreatedResponse({ type: CardUpdateSessionDto })
  @ApiErrorResponses(
    'UNAUTHORIZED',
    'NOT_FOUND',
    'PAYMENT_INVALID_STATE',
    'RATE_LIMITED',
    'PAYMENT_PROVIDER_ERROR',
    'PAYMENTS_NOT_CONFIGURED',
  )
  cardUpdate(
    @CurrentUser() user: AuthUser,
    @Param('planId', PLAN_ID) planId: string,
  ): Promise<CardUpdateSessionDto> {
    return this.checkout.cardUpdateSession(user.id, planId);
  }

  @Post('plans/:planId/pay-now')
  @HttpCode(200)
  @ApiParam({ name: 'planId', format: 'uuid' })
  @ApiOperation({
    summary: '[Pagar ahora] cuotas fallidas',
    description:
      'HU-24 / HU-26: cobra de inmediato las cuotas fallidas con la tarjeta registrada. Éxito → plan ' +
      '"Al día" (avisos desfijados; acceso restablecido si estaba suspendido por mora). Rechazo → 422 ' +
      '`PAYMENT_CHARGE_FAILED` (`meta.failureMessage`): ofrece [Actualizar tarjeta].' +
      OWN,
  })
  @ApiOkResponse({ type: PaymentPlanDto })
  @ApiErrorResponses(
    'UNAUTHORIZED',
    'NOT_FOUND',
    'PAYMENT_INVALID_STATE',
    'PAYMENT_CHARGE_FAILED',
    'RATE_LIMITED',
    'PAYMENT_PROVIDER_ERROR',
    'PAYMENTS_NOT_CONFIGURED',
  )
  payNow(
    @CurrentUser() user: AuthUser,
    @Param('planId', PLAN_ID) planId: string,
  ): Promise<PaymentPlanDto> {
    return this.collection.payNow(user.id, planId);
  }

  // --- Transferencia (HU-23) -----------------------------------------------------------------------

  @Post('transfers/upload-url')
  @ApiOperation({
    summary: 'Comprobante de transferencia, paso 1: URL de carga',
    description:
      'HU-23 (solo México, saldo en MXN, antes de la fecha límite): valida tipo y tamaño declarados ' +
      `(PDF/JPG/PNG ≤ ${PROOF_MAX}) y devuelve` +
      ' una URL firmada para `PUT` directo a storage con el ' +
      '`Content-Type` indicado.',
  })
  @ApiCreatedResponse({ type: TransferUploadUrlDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'NOT_FOUND',
    'PAYMENT_BALANCE_NOT_DUE',
    'PAYMENT_TRANSFER_NOT_AVAILABLE',
    'PAYMENT_TRANSFER_INVALID_FILE',
    'APPLICATION_DEADLINE_PASSED',
    'RATE_LIMITED',
  )
  transferUploadUrl(
    @CurrentUser() user: AuthUser,
    @Body() dto: TransferUploadUrlRequestDto,
  ): Promise<TransferUploadUrlDto> {
    return this.transfers.uploadUrl(user.id, dto);
  }

  @Post('transfers')
  @ApiOperation({
    summary: 'Comprobante de transferencia, paso 3: enviar',
    description:
      'HU-23: tras el `PUT`, confirma el comprobante con monto, fecha y clave de rastreo. El backend ' +
      'verifica tipo y tamaño REALES. Queda "Pendiente de validación" (la postulación no vence; ' +
      'acción "Pago en validación"). Mientras siga pendiente, enviar otro lo REEMPLAZA. Si fue ' +
      '"Rechazada", se crea uno nuevo. El equipo valida en 1–2 días hábiles (HU-33).',
  })
  @ApiCreatedResponse({ type: PaymentDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'NOT_FOUND',
    'PAYMENT_BALANCE_NOT_DUE',
    'PAYMENT_TRANSFER_NOT_AVAILABLE',
    'PAYMENT_TRANSFER_INVALID_FILE',
    'PAYMENT_TRANSFER_UPLOAD_NOT_FOUND',
    'APPLICATION_DEADLINE_PASSED',
    'RATE_LIMITED',
  )
  submitTransfer(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubmitTransferRequestDto,
  ): Promise<PaymentDto> {
    return this.transfers.submit(user.id, dto);
  }

  // --- Un pago -------------------------------------------------------------------------------------

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Detalle / estado de un pago',
    description:
      'HU-22 al volver de Stripe ("Procesando pago…"): si sigue PENDING y el webhook no ha llegado, ' +
      'el backend concilia con Stripe. Haz polling cada 2–3 s (máx. ~1 min) hasta `PAID` ' +
      '("Pago confirmado" + [Ir a mi aula]) o `CANCELLED`/`FAILED`. HU-26: detalle con comprobante, ' +
      'motivo de rechazo de transferencia, etc.' +
      OWN,
  })
  @ApiOkResponse({ type: PaymentDto })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED')
  get(@CurrentUser() user: AuthUser, @Param('id', PAYMENT_ID) id: string): Promise<PaymentDto> {
    return this.query.get(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Cancelar un checkout abierto',
    description:
      'HU-22 "Pago cancelado: no se realizó ningún cargo": cierra la sesión de Stripe y libera el ' +
      'cupo retenido (si Stripe ya había cobrado, el pago queda PAID). Úsalo al volver con ' +
      '`result=cancel` o si la persona cambia de opción.' +
      OWN,
  })
  @ApiNoContentResponse({ description: 'Cancelado.' })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'PAYMENT_INVALID_STATE', 'RATE_LIMITED')
  async cancel(@CurrentUser() user: AuthUser, @Param('id', PAYMENT_ID) id: string): Promise<void> {
    await this.checkout.cancel(user.id, id);
  }

  @Get(':id/receipt')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Descargar comprobante (PDF)',
    description:
      'HU-26: recibo PDF generado por el backend con folio, fecha, concepto, monto, moneda y método ' +
      '(no es factura fiscal). Solo pagos "Pagado" o transferencias "Validada". Descárgalo con ' +
      '`fetch` (Bearer) → `blob` → enlace de descarga.' +
      OWN,
  })
  @ApiOkResponse({
    description: 'PDF',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'PAYMENT_RECEIPT_NOT_AVAILABLE', 'RATE_LIMITED')
  async receipt(
    @CurrentUser() user: AuthUser,
    @Param('id', PAYMENT_ID) id: string,
  ): Promise<StreamableFile> {
    const { fileName, pdf } = await this.query.receipt(user.id, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
      length: pdf.length,
    });
  }

  @Get(':id/transfer-proof')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ver mi comprobante de transferencia',
    description: 'HU-26: URL firmada (~10 min) del comprobante enviado.' + OWN,
  })
  @ApiOkResponse({ type: AccessUrlDto })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED')
  transferProof(
    @CurrentUser() user: AuthUser,
    @Param('id', PAYMENT_ID) id: string,
  ): Promise<AccessUrlDto> {
    return this.transfers.proofDownload(user.id, id);
  }
}
