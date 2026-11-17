import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { BUSINESS_RULES, formatMegabytes } from '../../../config/business-rules';
import { PaymentStatus } from '../../../generated/prisma/client';

const R = BUSINESS_RULES;

/** Qué se paga: una oferta (precio completo, HU-22) o el saldo de una postulación (HU-23). */
export class PaymentTargetQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'HU-22/24: oferta a pagar (precio completo). Envía `offerId` O `applicationId`.',
  })
  @IsOptional()
  @IsUUID('all')
  offerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'HU-23/24: postulación "Aprobada – pendiente de pago" (saldo tras beca).',
  })
  @IsOptional()
  @IsUUID('all')
  applicationId?: string;
}

export class StartCheckoutRequestDto extends PaymentTargetQueryDto {
  @ApiPropertyOptional({
    example: 3,
    minimum: R.INSTALLMENTS_MIN,
    maximum: R.INSTALLMENTS_MAX,
    description:
      'HU-24: número de cuotas (2–4, según `quote.installments.options[].available`). Omitir = pago ' +
      'único. La 1.ª cuota se cobra en Stripe Checkout y guarda la tarjeta para las siguientes.',
  })
  @IsOptional()
  @IsInt()
  @Min(R.INSTALLMENTS_MIN)
  @Max(R.INSTALLMENTS_MAX)
  installmentCount?: number;

  @ApiProperty({
    example: true,
    description:
      'HU-22: "Acepto los términos de inscripción y la política de cancelación y reembolso". Debe ser true.',
  })
  @Equals(true, { message: 'Debes aceptar los términos para pagar.' })
  termsAccepted!: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'HU-24: "Autorizo a la Escuela a cobrar automáticamente en mi tarjeta las cuotas". Obligatorio ' +
      '(true) cuando hay `installmentCount`.',
  })
  @IsOptional()
  @IsBoolean()
  autoDebitAuthorized?: boolean;
}

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus, description: 'Filtrar por estado.' })
  @IsOptional()
  @IsIn(Object.values(PaymentStatus))
  status?: PaymentStatus;
}

export class TransferUploadUrlRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Postulación "Aprobada – pendiente de pago".' })
  @IsUUID('all')
  applicationId!: string;

  @ApiProperty({ example: 'comprobante-spei.pdf', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    example: 'application/pdf',
    enum: R.FILE_LIMITS.TRANSFER_RECEIPT.mimeTypes,
    description: 'Content-Type exacto que enviarás en el PUT.',
  })
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'Tipo de archivo no válido.' })
  contentType!: string;

  @ApiProperty({
    example: 350_000,
    description: `Tamaño en bytes (≤ ${formatMegabytes(R.FILE_LIMITS.TRANSFER_RECEIPT.maxBytes)}).`,
  })
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class SubmitTransferRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  applicationId!: string;

  @ApiProperty({
    example: 'payments/transfers/3a1f…/2f0e…-comprobante-spei.pdf',
    description: '`key` devuelta por `…/transfers/upload-url`, tras hacer el PUT.',
  })
  @IsString()
  @MaxLength(500)
  key!: string;

  @ApiPropertyOptional({ example: 'comprobante-spei.pdf', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiProperty({
    example: 510_000,
    description:
      'Monto que la persona declara haber transferido (centavos MXN). Solo informativo: el saldo ' +
      'esperado lo calcula el servidor y el equipo captura el monto recibido al validar.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declaredAmountCents!: number;

  @ApiProperty({
    example: '2026-11-03',
    description: 'Fecha de la transferencia (YYYY-MM-DD, ≤ hoy).',
  })
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Usa el formato YYYY-MM-DD.' })
  paidOn!: string;

  @ApiProperty({
    example: 'MBAN01002611030012345678',
    maxLength: R.TRANSFER_TRACKING_KEY_MAX_LENGTH,
    description: 'Clave de rastreo SPEI (letras y números).',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,30}$/, { message: 'La clave de rastreo solo admite letras y números.' })
  trackingKey!: string;
}
