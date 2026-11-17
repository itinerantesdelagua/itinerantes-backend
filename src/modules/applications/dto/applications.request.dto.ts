import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { BUSINESS_RULES, formatMegabytes } from '../../../config/business-rules';
import { ApplicationKind, ApplicationStatus } from '../../../generated/prisma/client';
import { PhoneDto } from '../../users/dto/user-fields';

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const csvArray = Transform(({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') return undefined;
  const items = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v).split(','));
  const clean = items.map((v) => v.trim()).filter(Boolean);
  return clean.length ? clean : undefined;
});

const R = BUSINESS_RULES;
const EVIDENCE_MIME_TYPES = [
  ...R.FILE_LIMITS.EVIDENCE_IMAGE.mimeTypes,
  ...R.FILE_LIMITS.EVIDENCE_VIDEO.mimeTypes,
];

/**
 * Campos del formulario (HU-19 beca / HU-20 convocatoria). Todos opcionales: el borrador se guarda
 * parcialmente (autoguardado) y los obligatorios se exigen al ENVIAR (`POST …/submit`). `null` borra
 * el valor. Enviar un campo del otro tipo de postulación → 400 (`details[].code = NOT_APPLICABLE`).
 */
export class ApplicationFormFieldsDto {
  @ApiPropertyOptional({
    type: PhoneDto,
    description: 'WhatsApp con indicativo. Se precarga del perfil (HU-14); editable.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PhoneDto)
  phone?: PhoneDto;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 29,
    minimum: R.APPLICANT_MIN_AGE,
    maximum: R.APPLICANT_MAX_AGE,
    description: 'Edad (entero). Obligatoria en becas.',
  })
  @IsOptional()
  @IsInt({ message: 'La edad debe ser un número entero.' })
  @Min(R.APPLICANT_MIN_AGE, { message: `La edad mínima es ${R.APPLICANT_MIN_AGE}.` })
  @Max(R.APPLICANT_MAX_AGE, { message: `La edad máxima es ${R.APPLICANT_MAX_AGE}.` })
  age?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'RED-AGUA-OAX',
    maxLength: R.PARTNER_CODE_MAX_LENGTH,
    description: 'Código de iniciativa aliada (opcional; no aplica descuento).',
  })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(R.PARTNER_CODE_MAX_LENGTH)
  partnerCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Colectivo Agua Viva de la Sierra',
    maxLength: R.ORGANIZATION_MAX_LENGTH,
    description: 'Organización (obligatoria en convocatorias).',
  })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(R.ORGANIZATION_MAX_LENGTH)
  organization?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Coordinadora de proyectos',
    maxLength: R.ORGANIZATION_ROLE_MAX_LENGTH,
    description: 'Rol en la organización (obligatorio en convocatorias).',
  })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(R.ORGANIZATION_ROLE_MAX_LENGTH)
  organizationRole?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    example: '0b9a3c52-5f3e-4c1b-9d8e-1c2f3a4b5c6d',
    description:
      'Beca: tipo de beca solicitado (antes `requestedLevel`). Solo los tipos activos del ' +
      'diplomado (`form.scholarshipTypes[].scholarshipTypeId`); otro → 400 ' +
      '`SCHOLARSHIP_TYPE_NOT_ENABLED`. Si el tipo tiene `requiresInterview`, habrá entrevista por Zoom.',
  })
  @IsOptional()
  @IsUUID()
  requestedScholarshipTypeId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: R.SCHOLARSHIP_LETTER_MAX_LENGTH,
    example: 'Necesito la beca porque…',
    description: `Beca: carta de intención (${R.SCHOLARSHIP_LETTER_MIN_LENGTH}–${R.SCHOLARSHIP_LETTER_MAX_LENGTH} caracteres al enviar).`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(R.SCHOLARSHIP_LETTER_MAX_LENGTH, {
    message: `La carta debe tener como máximo ${R.SCHOLARSHIP_LETTER_MAX_LENGTH} caracteres.`,
  })
  intentLetter?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Convocatoria: "Confirmo que cumplo con la elegibilidad" (obligatoria).',
  })
  @IsOptional()
  @IsBoolean()
  eligibilityConfirmed?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: R.OPEN_CALL_ANSWER_MAX_LENGTH,
    example: 'Desde 2021 coordino la captación de lluvia en mi comunidad…',
    description: `Convocatoria: experiencia en cuidado del agua (${R.OPEN_CALL_ANSWER_MIN_LENGTH}–${R.OPEN_CALL_ANSWER_MAX_LENGTH} al enviar).`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(R.OPEN_CALL_ANSWER_MAX_LENGTH)
  experience?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: R.OPEN_CALL_ANSWER_MAX_LENGTH,
    example: 'Replicaré lo aprendido con las mujeres de mi cooperativa…',
    description: `Convocatoria: motivación y cómo replicará lo aprendido (${R.OPEN_CALL_ANSWER_MIN_LENGTH}–${R.OPEN_CALL_ANSWER_MAX_LENGTH} al enviar).`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(R.OPEN_CALL_ANSWER_MAX_LENGTH)
  motivation?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    example: true,
    description:
      'Convocatoria: disponibilidad para viajar (asistencia presencial completa). Debe ser `true` ' +
      'para enviar si la convocatoria lo exige (`false` → `APPLICATION_NOT_ELIGIBLE`).',
  })
  @IsOptional()
  @IsBoolean()
  canTravel?: boolean | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://www.youtube.com/watch?v=abc123'],
    maxItems: R.EVIDENCE_MAX_LINKS,
    description: `Enlaces de evidencia (YouTube, Drive, redes), máximo ${R.EVIDENCE_MAX_LINKS}. Reemplaza la lista completa.`,
  })
  @IsOptional()
  @ArrayMaxSize(R.EVIDENCE_MAX_LINKS, {
    message: `Puedes agregar como máximo ${R.EVIDENCE_MAX_LINKS} enlaces.`,
  })
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { each: true, message: 'Cada enlace debe ser una URL válida (https://…).' },
  )
  @MaxLength(500, { each: true })
  evidenceLinks?: string[];

  @ApiPropertyOptional({
    example: true,
    description:
      'Términos (veracidad, asistencia, proyecto final, datos y pago del saldo / entrevista por ' +
      'Zoom en convocatorias; una postulación por cohorte). Obligatorio para enviar.',
  })
  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}

export class CreateApplicationRequestDto extends ApplicationFormFieldsDto {
  @ApiProperty({
    format: 'uuid',
    example: '9d3c6a1e-2b4f-4c8d-9e0a-1b2c3d4e5f60',
    description:
      '`id` de la oferta (ficha HU-16 o "Becas disponibles" / "Convocatorias abiertas"): diplomado ' +
      'con beca → postulación a beca; convocatoria → postulación a convocatoria.',
  })
  @IsUUID('4', { message: 'offerId debe ser un UUID.' })
  offerId!: string;
}

export class UpdateApplicationRequestDto extends ApplicationFormFieldsDto {}

export class ListApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ApplicationKind,
    example: 'SCHOLARSHIP',
    description:
      'Pestaña "Mis postulaciones" de Becas (`SCHOLARSHIP`) o de Convocatorias (`OPEN_CALL`).',
  })
  @IsOptional()
  @IsEnum(ApplicationKind)
  kind?: ApplicationKind;

  @ApiPropertyOptional({
    enum: ApplicationStatus,
    isArray: true,
    example: ['SUBMITTED', 'IN_REVIEW'],
    description: 'Filtro por estado (varios con coma).',
  })
  @IsOptional()
  @csvArray
  @IsEnum(ApplicationStatus, { each: true })
  status?: ApplicationStatus[];
}

export class OpportunitiesQueryDto {
  @ApiProperty({
    enum: ApplicationKind,
    example: 'OPEN_CALL',
    description: '"Becas disponibles" (`SCHOLARSHIP`) o "Convocatorias abiertas" (`OPEN_CALL`).',
  })
  @IsEnum(ApplicationKind)
  kind!: ApplicationKind;
}

export class EvidenceUploadRequestDto {
  @ApiProperty({ example: 'huerto-comunitario.jpg', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    example: 'image/jpeg',
    enum: EVIDENCE_MIME_TYPES,
    description: 'Content-Type exacto que enviarás en el PUT.',
  })
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'Tipo de archivo no válido.' })
  contentType!: string;

  @ApiProperty({
    example: 2_400_000,
    description: `Tamaño en bytes (imágenes ≤ ${formatMegabytes(R.FILE_LIMITS.EVIDENCE_IMAGE.maxBytes)}; videos ≤ ${formatMegabytes(R.FILE_LIMITS.EVIDENCE_VIDEO.maxBytes)}).`,
  })
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class ConfirmDocumentRequestDto {
  @ApiProperty({
    example: 'applications/3a1f…/evidence/2f0e…-huerto-comunitario.jpg',
    description: '`key` devuelta por `…/documents/upload-url`, tras hacer el PUT.',
  })
  @IsString()
  @MaxLength(500)
  key!: string;

  @ApiPropertyOptional({ example: 'huerto-comunitario.jpg', description: 'Nombre a mostrar.' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
