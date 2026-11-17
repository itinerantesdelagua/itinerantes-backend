import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';
import { BUSINESS_RULES, formatMegabytes } from '../../../../config/business-rules';
import {
  CalendarCategory,
  OfferModality,
  OfferOrigin,
  OfferPublicationStatus,
  OfferType,
  PublicTopic,
} from '../../../../generated/prisma/client';
import {
  OfferScholarshipQuotaDto,
  ScholarshipTypeSummaryDto,
} from '../../../scholarship-types/dto/scholarship-types.dto';
import {
  OFFER_AVAILABILITY_VALUES,
  type OfferAvailability,
} from '../../policies/offer-status.policy';
import { AdminOfferStatus, WizardIssueCode, WizardStepKey } from '../policies/offer-wizard.policy';

const R = BUSINESS_RULES;

/** El campo puede omitirse, pero si se envía no puede ser null (columna obligatoria). */
const Defined = () => ValidateIf((_o: unknown, v: unknown) => v !== undefined);
const HTTPS = { protocols: ['https'], require_protocol: true };

// =================================================================================================
// Consultas
// =================================================================================================

export const ADMIN_OFFER_SORTS = ['UPDATED_DESC', 'STARTS_AT_ASC', 'NAME_ASC'] as const;
export type AdminOfferSort = (typeof ADMIN_OFFER_SORTS)[number];

export class ListAdminOffersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'ecotecnologías', description: 'Busca en el nombre.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: OfferType, example: 'DIPLOMA' })
  @IsOptional()
  @IsEnum(OfferType)
  type?: OfferType;

  @ApiPropertyOptional({ enum: OfferModality, example: 'ONLINE_LIVE' })
  @IsOptional()
  @IsEnum(OfferModality)
  modality?: OfferModality;

  @ApiPropertyOptional({ enum: OfferOrigin, example: 'NAS' })
  @IsOptional()
  @IsEnum(OfferOrigin)
  origin?: OfferOrigin;

  @ApiPropertyOptional({
    enum: AdminOfferStatus,
    example: 'PUBLISHED',
    description:
      'Estado del listado (HU-27): DRAFT Borrador · PUBLISHED Publicado (abiertas y próximamente) · ' +
      'ENROLLMENT_CLOSED Inscripciones cerradas · FINISHED Finalizado · ARCHIVED Archivado.',
  })
  @IsOptional()
  @IsEnum(AdminOfferStatus)
  status?: AdminOfferStatus;

  @ApiPropertyOptional({ enum: ADMIN_OFFER_SORTS, default: 'UPDATED_DESC' })
  @IsOptional()
  @IsIn(ADMIN_OFFER_SORTS)
  sort: AdminOfferSort = 'UPDATED_DESC';
}

// =================================================================================================
// Escritura
// =================================================================================================

export class CreateOfferRequestDto {
  @ApiProperty({ enum: OfferType, example: 'DIPLOMA' })
  @IsEnum(OfferType)
  type!: OfferType;

  @ApiProperty({ enum: OfferModality, example: 'ONLINE_LIVE' })
  @IsEnum(OfferModality)
  modality!: OfferModality;

  @ApiProperty({
    example: 'Diplomado en Ecotecnologías del Agua 2027',
    minLength: 3,
    maxLength: 160,
  })
  @IsString()
  @Length(3, 160)
  name!: string;
}

/** Paso 1 — Datos e imágenes. */
export class UpdateGeneralStepDto {
  @ApiPropertyOptional({ example: 'Diplomado en Ecotecnologías del Agua', maxLength: 160 })
  @Defined()
  @IsString()
  @Length(3, 160)
  name?: string;

  @ApiPropertyOptional({
    enum: OfferType,
    description: 'No editable si ya hay inscritos o postulaciones (409 OFFER_HAS_ENROLLMENTS).',
  })
  @Defined()
  @IsEnum(OfferType)
  type?: OfferType;

  @ApiPropertyOptional({ enum: OfferModality, description: 'No editable con inscritos.' })
  @Defined()
  @IsEnum(OfferModality)
  modality?: OfferModality;

  @ApiPropertyOptional({ example: 'Generación 2027', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  cohortLabel?: string | null;

  @ApiPropertyOptional({
    example: 'Aprende a diseñar e implementar ecotecnologías.',
    maxLength: 300,
  })
  @Defined()
  @IsString()
  @MaxLength(R.OFFER_SUMMARY_MAX_LENGTH)
  summary?: string;

  @ApiPropertyOptional({
    example: 'public/offers/0f8b…/cover/2f1c…-portada.png',
    nullable: true,
    type: String,
    description:
      'Key devuelta por `POST /admin/uploads/images` (purpose OFFER_COVER) tras subir el archivo, o una URL https absoluta. Se verifica en storage.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  coverImageKey?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: [],
    description: 'Keys del carrusel (purpose OFFER_CAROUSEL), en orden.',
  })
  @Defined()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  carouselImageKeys?: string[];

  @ApiPropertyOptional({
    enum: PublicTopic,
    nullable: true,
    description: 'Temática pública de HU-34.',
  })
  @IsOptional()
  @IsEnum(PublicTopic)
  publicTopic?: PublicTopic | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    example: ['8c0e1f2a-0000-4000-8000-000000000001'],
    description: 'Docentes en el orden de la ficha (reemplaza la lista).',
  })
  @Defined()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  teacherIds?: string[];

  @ApiPropertyOptional({
    example: 'Rancho Las Cruces',
    nullable: true,
    type: String,
    description: 'Obligatorio si es presencial.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  venueName?: string | null;

  @ApiPropertyOptional({ example: 'Camino a Tepoztlán km 3', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  venueAddress?: string | null;

  @ApiPropertyOptional({ example: 'Tepoztlán, Morelos', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  venueCity?: string | null;

  @ApiPropertyOptional({ example: 'https://maps.app.goo.gl/abc', nullable: true, type: String })
  @IsOptional()
  @IsUrl(HTTPS)
  @MaxLength(500)
  venueMapsUrl?: string | null;

  @ApiPropertyOptional({
    example: 25,
    nullable: true,
    type: Number,
    description: 'Cupo (null = sin límite).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  capacity?: number | null;
}

/** Paso 2 — Contenido. */
export class UpdateContentStepDto {
  @ApiPropertyOptional({ example: 'El diplomado recorre…' })
  @Defined()
  @IsString()
  @MaxLength(20_000)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['Diseñar humedales construidos'],
    description: '"¿Qué aprenderás?"',
  })
  @Defined()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  learningOutcomes?: string[];

  @ApiPropertyOptional({ example: 'Conexión estable a internet.', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  requirements?: string | null;

  @ApiPropertyOptional({
    example: 'Jóvenes de 18 a 29 años…',
    nullable: true,
    type: String,
    description: 'Obligatorio en convocatorias.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  eligibilityText?: string | null;

  @ApiPropertyOptional({
    type: [String],
    example: ['MX', 'GT'],
    description: 'Países elegibles (ISO-2); vacío = todos.',
  })
  @Defined()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(60)
  @Matches(/^[A-Z]{2}$/, { each: true })
  eligibleCountryCodes?: string[];

  @ApiPropertyOptional({ example: false })
  @Defined()
  @IsBoolean()
  requiresTravel?: boolean;

  @ApiPropertyOptional({ example: '¡Bienvenida! Antes de empezar…', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  classroomWelcome?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Carga del proyecto final por archivo (solo diplomados).',
  })
  @Defined()
  @IsBoolean()
  finalProjectSubmissionEnabled?: boolean;

  @ApiPropertyOptional({
    example: 'Entrega un PDF de máximo 20 páginas…',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  finalProjectGuidelines?: string | null;
}

export class ScheduleSlotDto {
  @ApiProperty({
    example: 1,
    minimum: 1,
    maximum: 7,
    description: 'Día ISO: 1 = lunes … 7 = domingo.',
  })
  weekday!: number;

  @ApiProperty({ example: '10:00', description: 'Inicio en hora CDMX (HH:mm).' })
  startTime!: string;

  @ApiProperty({ example: '12:00', description: 'Fin en hora CDMX (HH:mm), posterior al inicio.' })
  endTime!: string;
}

/** Regla de horario guardada (normalizada: siempre trae `slots` y los campos clásicos derivados). */
export class ScheduleRuleDto {
  @ApiProperty({
    type: [Number],
    example: [1, 4],
    description: 'Días ISO con clase (1 = lunes … 7 = domingo), derivados de `slots`.',
  })
  weekdays!: number[];

  @ApiProperty({
    example: '10:00',
    description: 'Inicio (CDMX, HH:mm) del primer día de `slots`. Compatibilidad: usa `slots`.',
  })
  startTime!: string;

  @ApiProperty({
    example: '12:00',
    description: 'Fin (CDMX, HH:mm) del primer día de `slots`. Compatibilidad: usa `slots`.',
  })
  endTime!: string;

  @ApiProperty({
    type: [ScheduleSlotDto],
    description: 'Horario de cada día de clase, de lunes a domingo (puede variar por día).',
  })
  slots!: ScheduleSlotDto[];

  @ApiProperty({
    type: [String],
    example: ['2026-12-19'],
    description: 'Fechas CDMX omitidas (recesos).',
  })
  excludedDates!: string[];

  @ApiProperty({ example: true, description: 'Omite los festivos oficiales de México.' })
  excludeMexicanHolidays!: boolean;
}

/**
 * Regla de horario al guardarla. Dos formas: `slots` (horario por día, p. ej. lun 10–12 y jue
 * 16–18) o la clásica `weekdays` + `startTime` + `endTime` (mismo horario todos los días). Si
 * viene `slots`, manda y los campos clásicos se ignoran.
 */
export class ScheduleRuleInputDto {
  @ApiPropertyOptional({
    type: [ScheduleSlotDto],
    description: 'Horario por día de clase (sin días repetidos).',
  })
  slots?: ScheduleSlotDto[];

  @ApiPropertyOptional({
    type: [Number],
    example: [6, 7],
    description: 'Forma clásica: días ISO (1 = lunes … 7 = domingo) con el mismo horario.',
  })
  weekdays?: number[];

  @ApiPropertyOptional({ example: '10:00', description: 'Forma clásica: inicio en CDMX (HH:mm).' })
  startTime?: string;

  @ApiPropertyOptional({ example: '13:00', description: 'Forma clásica: fin en CDMX (HH:mm).' })
  endTime?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['2026-12-19'],
    description: 'Fechas CDMX omitidas (recesos).',
  })
  excludedDates?: string[];

  @ApiPropertyOptional({ example: true, description: 'Omite los festivos oficiales de México.' })
  excludeMexicanHolidays?: boolean;
}

/** Paso 3 — Horarios. */
export class UpdateScheduleStepDto {
  @ApiPropertyOptional({
    example: '2026-09-01T06:00:00.000Z',
    nullable: true,
    type: String,
    description: 'Apertura de inscripciones (convocatoria: de postulación).',
  })
  @IsOptional()
  @IsDateString()
  enrollmentOpensAt?: string | null;

  @ApiPropertyOptional({ example: '2026-11-01T05:59:59.000Z', nullable: true, type: String })
  @IsOptional()
  @IsDateString()
  enrollmentClosesAt?: string | null;

  @ApiPropertyOptional({ example: '2026-11-07T16:00:00.000Z', nullable: true, type: String })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({ example: '2027-01-31T19:00:00.000Z', nullable: true, type: String })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @ApiPropertyOptional({
    example: '2027-01-31T16:00:00.000Z',
    nullable: true,
    type: String,
    description: 'Obligatoria en diplomados.',
  })
  @IsOptional()
  @IsDateString()
  finalProjectDueAt?: string | null;

  @ApiPropertyOptional({
    example: 60,
    nullable: true,
    type: Number,
    description: 'Duración total en horas (curso ≤ 9 h; diplomado = 60 h).',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(1000)
  totalHours?: number | null;

  @ApiPropertyOptional({
    type: ScheduleRuleInputDto,
    nullable: true,
    description:
      'Regla de horario en hora CDMX (genera las sesiones, HU-29). Admite horario distinto por día ' +
      '(`slots`) o el mismo para todos (`weekdays` + `startTime` + `endTime`).',
  })
  @IsOptional()
  @IsObject()
  scheduleRule?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    enum: CalendarCategory,
    example: 'TRAINING',
    description: 'Color por defecto de las sesiones.',
  })
  @Defined()
  @IsEnum(CalendarCategory)
  calendarCategory?: CalendarCategory;
}

/** Paso 4 — Origen y precio. */
/** Tipo de beca habilitado en la oferta (paso 4), con rango propio opcional. */
export class OfferScholarshipTypeInputDto {
  @ApiProperty({ format: 'uuid', example: '0b9a3c52-5f3e-4c1b-9d8e-1c2f3a4b5c6d' })
  @IsUUID()
  scholarshipTypeId!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: null,
    minimum: R.SCHOLARSHIP_TYPE_PERCENT_FLOOR,
    maximum: R.SCHOLARSHIP_TYPE_PERCENT_CEILING,
    description: 'Sobrescribe el % mínimo del tipo SOLO en esta oferta (null = el del tipo).',
  })
  @IsOptional()
  @IsInt()
  @Min(R.SCHOLARSHIP_TYPE_PERCENT_FLOOR)
  @Max(R.SCHOLARSHIP_TYPE_PERCENT_CEILING)
  minPercent?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: null,
    minimum: R.SCHOLARSHIP_TYPE_PERCENT_FLOOR,
    maximum: R.SCHOLARSHIP_TYPE_PERCENT_CEILING,
    description: 'Sobrescribe el % máximo del tipo SOLO en esta oferta (null = el del tipo).',
  })
  @IsOptional()
  @IsInt()
  @Min(R.SCHOLARSHIP_TYPE_PERCENT_FLOOR)
  @Max(R.SCHOLARSHIP_TYPE_PERCENT_CEILING)
  maxPercent?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: null,
    description: 'Orden en esta oferta (null = el del tipo).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: null,
    minimum: 1,
    description:
      'Tope de becas de este tipo SOLO en esta oferta (además del cupo global del tipo). null = sin ' +
      'tope propio.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRecipients?: number | null;
}

export class UpdateOriginPricingStepDto {
  @ApiPropertyOptional({
    enum: OfferOrigin,
    description: 'MOODLE oculta precio, cuotas y beca (se limpian). No editable con inscritos.',
  })
  @Defined()
  @IsEnum(OfferOrigin)
  origin?: OfferOrigin;

  @ApiPropertyOptional({ example: false })
  @Defined()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({
    example: 1_020_000,
    nullable: true,
    type: Number,
    description: 'Centavos MXN (> 0 si es de pago).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceMxnCents?: number | null;

  @ApiPropertyOptional({
    example: 58_500,
    nullable: true,
    type: Number,
    description: 'Centavos USD (> 0 si es de pago).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  priceUsdCents?: number | null;

  @ApiPropertyOptional({ example: true })
  @Defined()
  @IsBoolean()
  installmentsEnabled?: boolean;

  @ApiPropertyOptional({
    example: 3,
    nullable: true,
    type: Number,
    minimum: R.INSTALLMENTS_MIN,
    maximum: R.INSTALLMENTS_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(R.INSTALLMENTS_MIN)
  @Max(R.INSTALLMENTS_MAX)
  installmentsMax?: number | null;

  @ApiPropertyOptional({
    example: 'https://moodle.example.org/course/view.php?id=12',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsUrl(HTTPS)
  @MaxLength(500)
  moodleCourseUrl?: string | null;

  @ApiPropertyOptional({ example: true, description: 'Solo diplomados NAS.' })
  @Defined()
  @IsBoolean()
  scholarshipEnabled?: boolean;

  @ApiPropertyOptional({
    type: () => [OfferScholarshipTypeInputDto],
    description:
      'Tipos de beca habilitados (REEMPLAZA la lista; antes `scholarshipLevels`). Ids de ' +
      '`GET /admin/scholarship-types`. Un tipo inexistente o desactivado → 422 ' +
      '`SCHOLARSHIP_TYPE_NOT_AVAILABLE` (los desactivados que la oferta ya tenía se pueden conservar). ' +
      '`minPercent`/`maxPercent` opcionales ajustan el rango SOLO en esta oferta (rango inválido → 422 ' +
      '`SCHOLARSHIP_TYPE_INVALID_RANGE`).',
  })
  @Defined()
  @IsArray()
  @ArrayMaxSize(R.SCHOLARSHIP_TYPES_PER_OFFER_MAX)
  @ValidateNested({ each: true })
  @Type(() => OfferScholarshipTypeInputDto)
  scholarshipTypes?: OfferScholarshipTypeInputDto[];

  @ApiPropertyOptional({
    example: '2026-09-01T06:00:00.000Z',
    nullable: true,
    type: String,
    description: 'Null = ventana de inscripción.',
  })
  @IsOptional()
  @IsDateString()
  scholarshipOpensAt?: string | null;

  @ApiPropertyOptional({ example: '2026-10-15T05:59:59.000Z', nullable: true, type: String })
  @IsOptional()
  @IsDateString()
  scholarshipClosesAt?: string | null;
}

/** Paso 6 — Asistencia. */
export class UpdateAttendanceStepDto {
  @ApiProperty({
    example: 24,
    minimum: R.ATTENDANCE_WINDOW_MIN_HOURS,
    maximum: R.ATTENDANCE_WINDOW_MAX_HOURS,
    description: 'Horas para registrar asistencia tras cada sesión (HU-30).',
  })
  @IsInt()
  @Min(R.ATTENDANCE_WINDOW_MIN_HOURS)
  @Max(R.ATTENDANCE_WINDOW_MAX_HOURS)
  attendanceWindowHours!: number;
}

/** Paso 7 — WhatsApp. */
export class UpdateWhatsappStepDto {
  @ApiPropertyOptional({
    example: 'https://chat.whatsapp.com/AbCdEf123',
    nullable: true,
    type: String,
    description: 'Solo visible para inscritos.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  whatsappGroupUrl?: string | null;

  @ApiPropertyOptional({
    example: '2026-11-01T16:00:00.000Z',
    nullable: true,
    type: String,
    description: 'Desde cuándo lo ven los inscritos (null = desde la inscripción).',
  })
  @IsOptional()
  @IsDateString()
  whatsappVisibleFrom?: string | null;
}

export class DuplicateOfferRequestDto {
  @ApiPropertyOptional({
    example: 'Diplomado en Ecotecnologías del Agua 2028',
    description: 'Por defecto "<nombre> (copia)".',
  })
  @IsOptional()
  @IsString()
  @Length(3, 160)
  name?: string;

  @ApiPropertyOptional({ example: 'Generación 2028', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  cohortLabel?: string | null;
}

export const IMAGE_PURPOSES = ['OFFER_COVER', 'OFFER_CAROUSEL', 'TEACHER_PHOTO'] as const;

export class ImageUploadUrlRequestDto {
  @ApiProperty({ enum: IMAGE_PURPOSES, example: 'OFFER_COVER' })
  @IsIn(IMAGE_PURPOSES)
  purpose!: (typeof IMAGE_PURPOSES)[number];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Obligatorio para OFFER_COVER / OFFER_CAROUSEL.',
  })
  @ValidateIf((o: ImageUploadUrlRequestDto) => o.purpose !== 'TEACHER_PHOTO')
  @IsUUID('all')
  offerId?: string;

  @ApiProperty({ example: 'portada-diplomado.png' })
  @IsString()
  @Length(1, 255)
  fileName!: string;

  @ApiProperty({ example: 'image/png', enum: R.FILE_LIMITS.OFFER_COVER.mimeTypes })
  @IsString()
  @MaxLength(120)
  contentType!: string;

  @ApiProperty({
    example: 345_678,
    description: `Bytes (máx. ${formatMegabytes(R.FILE_LIMITS.OFFER_COVER.maxBytes)}).`,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

// =================================================================================================
// Respuestas
// =================================================================================================

export class ImageUploadUrlDto {
  @ApiProperty({
    example: 'https://storage…/public/offers/…?X-Amz-Signature=…',
    description: 'Haz PUT del archivo aquí.',
  })
  uploadUrl!: string;

  @ApiProperty({ example: 'PUT' })
  method!: 'PUT';

  @ApiProperty({
    example: { 'Content-Type': 'image/png' },
    description: 'Headers obligatorios del PUT.',
  })
  headers!: Record<string, string>;

  @ApiProperty({
    example: 'public/offers/0f8b…/cover/2f1c…-portada.png',
    description: 'Guárdala en el paso correspondiente.',
  })
  key!: string;

  @ApiProperty({ example: '2026-11-07T16:15:00.000Z' })
  expiresAt!: string;
}

export class AdminImageDto {
  @ApiProperty({ example: 'public/offers/0f8b…/cover/2f1c…-portada.png' })
  key!: string;

  @ApiProperty({ example: 'https://cdn.example.org/public/offers/…/portada.png' })
  url!: string;
}

export class AdminOfferCountsDto {
  @ApiProperty({
    example: 18,
    description: 'Inscripciones que ocupan cupo (incluye reservas vigentes).',
  })
  enrollments!: number;

  @ApiProperty({ example: 40, description: 'Postulaciones enviadas (sin borradores).' })
  applications!: number;

  @ApiProperty({ example: 20, description: 'Sesiones no canceladas.' })
  sessions!: number;

  @ApiProperty({ example: 9 })
  modules!: number;
}

export class AdminOfferListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'diplomado-ecotecnologias-del-agua-2026' })
  slug!: string;

  @ApiProperty({ example: 'Diplomado en Ecotecnologías del Agua' })
  name!: string;

  @ApiProperty({ enum: OfferType })
  type!: OfferType;

  @ApiProperty({ enum: OfferModality })
  modality!: OfferModality;

  @ApiProperty({ enum: OfferOrigin })
  origin!: OfferOrigin;

  @ApiProperty({ enum: OfferPublicationStatus })
  publicationStatus!: OfferPublicationStatus;

  @ApiProperty({
    enum: AdminOfferStatus,
    description: 'Estado del listado (ver tabla de la guía).',
  })
  adminStatus!: AdminOfferStatus;

  @ApiProperty({
    enum: OFFER_AVAILABILITY_VALUES,
    description: 'Estado público derivado ("Próximamente" en el sitio).',
  })
  availability!: OfferAvailability;

  @ApiProperty({ example: 'Generación 2026–2027', nullable: true, type: String })
  cohortLabel!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-11-07T16:00:00.000Z' })
  startsAt!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2027-01-31T19:00:00.000Z' })
  endsAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  coverImageUrl!: string | null;

  @ApiProperty({ type: AdminOfferCountsDto })
  counts!: AdminOfferCountsDto;

  @ApiProperty({
    example: '/escuela/oferta/diplomado-ecotecnologias-del-agua-2026',
    description: 'Ruta de la ficha pública (Vista previa).',
  })
  publicPath!: string;

  @ApiProperty({ example: '2026-10-21T18:00:00.000Z' })
  updatedAt!: string;
}

export class WizardIssueDto {
  @ApiProperty({ example: 'totalHours' })
  field!: string;

  @ApiProperty({ enum: WizardIssueCode, example: 'DIPLOMA_HOURS_MISMATCH' })
  code!: WizardIssueCode;

  @ApiProperty({ example: 'Los diplomados deben sumar 60 horas.' })
  message!: string;
}

export class WizardStepDto {
  @ApiProperty({ example: 3, minimum: 1, maximum: 7 })
  step!: number;

  @ApiProperty({ enum: WizardStepKey, example: 'SCHEDULE' })
  key!: WizardStepKey;

  @ApiProperty({
    example: 'schedule',
    description: 'Segmento de `PATCH /admin/offers/{id}/steps/{slug}`.',
  })
  slug!: string;

  @ApiProperty({ example: 'Horarios' })
  label!: string;

  @ApiProperty({ example: true, description: 'Obligatorio para publicar.' })
  requiredToPublish!: boolean;

  @ApiProperty({ example: false, description: 'Sin problemas: se puede avanzar.' })
  complete!: boolean;

  @ApiProperty({ type: [WizardIssueDto] })
  issues!: WizardIssueDto[];
}

export class WizardStatusDto {
  @ApiProperty({ type: [WizardStepDto] })
  steps!: WizardStepDto[];

  @ApiProperty({ example: false, description: '"Publicar" habilitado.' })
  canPublish!: boolean;

  @ApiProperty({
    type: [WizardIssueDto],
    description: 'Problemas que impiden publicar (`field` = `<paso>.<campo>`).',
  })
  publishBlockers!: WizardIssueDto[];
}

export class AdminTeacherRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dra. Ana Torres' })
  fullName!: string;

  @ApiProperty({ nullable: true, type: String })
  photoUrl!: string | null;
}

export class AdminVenueDto {
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty({ nullable: true, type: String }) address!: string | null;
  @ApiProperty({ nullable: true, type: String }) city!: string | null;
  @ApiProperty({ nullable: true, type: String }) mapsUrl!: string | null;
}

export class AdminOfferGeneralDto {
  @ApiProperty({ nullable: true, type: String }) cohortLabel!: string | null;
  @ApiProperty({ example: 'Aprende a diseñar…' }) summary!: string;
  @ApiProperty({ type: AdminImageDto, nullable: true }) coverImage!: AdminImageDto | null;
  @ApiProperty({ type: [AdminImageDto] }) carouselImages!: AdminImageDto[];
  @ApiProperty({ enum: PublicTopic, nullable: true }) publicTopic!: PublicTopic | null;
  @ApiProperty({ type: [AdminTeacherRefDto] }) teachers!: AdminTeacherRefDto[];
  @ApiProperty({ type: AdminVenueDto }) venue!: AdminVenueDto;
  @ApiProperty({ nullable: true, type: Number, example: 25 }) capacity!: number | null;
}

export class AdminOfferContentDto {
  @ApiProperty() description!: string;
  @ApiProperty({ type: [String] }) learningOutcomes!: string[];
  @ApiProperty({ nullable: true, type: String }) requirements!: string | null;
  @ApiProperty({ nullable: true, type: String }) eligibilityText!: string | null;
  @ApiProperty({ type: [String], example: ['MX'] }) eligibleCountryCodes!: string[];
  @ApiProperty() requiresTravel!: boolean;
  @ApiProperty({ nullable: true, type: String }) classroomWelcome!: string | null;
  @ApiProperty() finalProjectSubmissionEnabled!: boolean;
  @ApiProperty({ nullable: true, type: String }) finalProjectGuidelines!: string | null;
}

export class AdminOfferScheduleDto {
  @ApiProperty({ nullable: true, type: String }) enrollmentOpensAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) enrollmentClosesAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) startsAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) endsAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) finalProjectDueAt!: string | null;
  @ApiProperty({ nullable: true, type: Number, example: 60 }) totalHours!: number | null;
  @ApiProperty({ type: ScheduleRuleDto, nullable: true }) scheduleRule!: ScheduleRuleDto | null;
  @ApiProperty({ enum: CalendarCategory }) calendarCategory!: CalendarCategory;
  @ApiProperty({ example: 'America/Mexico_City', description: 'Zona de las horas de la regla.' })
  timezone!: string;
}

export class AdminOfferScholarshipTypeDto {
  @ApiProperty({ format: 'uuid' }) scholarshipTypeId!: string;
  @ApiProperty({
    nullable: true,
    type: Number,
    example: null,
    description: 'Override de la oferta.',
  })
  minPercent!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    example: null,
    description: 'Override de la oferta.',
  })
  maxPercent!: number | null;
  @ApiProperty({ nullable: true, type: Number, example: null }) sortOrder!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    example: null,
    description: 'Tope propio de la oferta.',
  })
  maxRecipients!: number | null;
  @ApiProperty({ type: OfferScholarshipQuotaDto, description: 'Cupo global + de la oferta.' })
  quota!: OfferScholarshipQuotaDto;
  @ApiProperty({ example: true, description: 'false = tipo desactivado: no se ofrece.' })
  active!: boolean;
  @ApiProperty({
    type: ScholarshipTypeSummaryDto,
    description: 'Tipo con el rango EFECTIVO en esta oferta.',
  })
  scholarshipType!: ScholarshipTypeSummaryDto;
}

export class AdminOfferOriginPricingDto {
  @ApiProperty({ enum: OfferOrigin }) origin!: OfferOrigin;
  @ApiProperty() isFree!: boolean;
  @ApiProperty({ nullable: true, type: Number, example: 1_020_000 }) priceMxnCents!: number | null;
  @ApiProperty({ nullable: true, type: Number, example: 58_500 }) priceUsdCents!: number | null;
  @ApiProperty() installmentsEnabled!: boolean;
  @ApiProperty({ nullable: true, type: Number, example: 3 }) installmentsMax!: number | null;
  @ApiProperty({ nullable: true, type: String }) moodleCourseUrl!: string | null;
  @ApiProperty() scholarshipEnabled!: boolean;
  @ApiProperty({
    type: () => [AdminOfferScholarshipTypeDto],
    description: 'Tipos de beca habilitados (antes `scholarshipLevels`), incluye desactivados.',
  })
  scholarshipTypes!: AdminOfferScholarshipTypeDto[];
  @ApiProperty({ nullable: true, type: String }) scholarshipOpensAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) scholarshipClosesAt!: string | null;
}

export class AdminOfferResourcesSummaryDto {
  @ApiProperty({ example: 9 }) moduleCount!: number;
  @ApiProperty({ example: 7 }) publishedModuleCount!: number;
  @ApiProperty({ example: 24 }) resourceCount!: number;
}

export class AdminOfferAttendanceDto {
  @ApiProperty({ example: 24 }) attendanceWindowHours!: number;
}

export class AdminOfferWhatsappDto {
  @ApiProperty({ nullable: true, type: String }) whatsappGroupUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) whatsappVisibleFrom!: string | null;
}

export class SessionPreviewHintDto {
  @ApiProperty({
    example: true,
    description: 'Hay regla de horario y fechas: abrir la vista previa de sesiones (HU-29).',
  })
  available!: boolean;
}

export class AdminOfferDetailDto extends AdminOfferListItemDto {
  @ApiProperty({ nullable: true, type: String }) publishedAt!: string | null;

  @ApiProperty({
    example: true,
    description: 'Tiene inscritos o postulaciones: tipo, modalidad y origen quedan bloqueados.',
  })
  hasEnrollments!: boolean;

  @ApiProperty({ type: AdminOfferGeneralDto, description: 'Paso 1.' })
  general!: AdminOfferGeneralDto;
  @ApiProperty({ type: AdminOfferContentDto, description: 'Paso 2.' })
  content!: AdminOfferContentDto;
  @ApiProperty({ type: AdminOfferScheduleDto, description: 'Paso 3.' })
  schedule!: AdminOfferScheduleDto;
  @ApiProperty({ type: AdminOfferOriginPricingDto, description: 'Paso 4.' })
  originPricing!: AdminOfferOriginPricingDto;
  @ApiProperty({
    type: AdminOfferResourcesSummaryDto,
    description: 'Paso 5 (se gestiona en Contenido del aula).',
  })
  resources!: AdminOfferResourcesSummaryDto;
  @ApiProperty({ type: AdminOfferAttendanceDto, description: 'Paso 6.' })
  attendance!: AdminOfferAttendanceDto;
  @ApiProperty({ type: AdminOfferWhatsappDto, description: 'Paso 7.' })
  whatsapp!: AdminOfferWhatsappDto;

  @ApiProperty({ type: WizardStatusDto }) wizard!: WizardStatusDto;

  @ApiProperty({ type: SessionPreviewHintDto }) sessionPreview!: SessionPreviewHintDto;

  @ApiProperty({ example: '2026-10-21T18:00:00.000Z' }) createdAt!: string;
}

/** Normaliza un booleano de query (`?x=true`). */
export const BooleanQuery = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  );
