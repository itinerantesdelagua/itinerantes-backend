import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BUSINESS_RULES } from '../../../config/business-rules';
import {
  ApplicationKind,
  ApplicationStatus,
  CalendarCategory,
  OfferModality,
  OfferOrigin,
  OfferType,
  PublicTopic,
} from '../../../generated/prisma/client';
import { ScholarshipTypeSummaryDto } from '../../scholarship-types/dto/scholarship-types.dto';
import { OfferActionReason, OfferActionType } from '../policies/offer-actions.policy';
import { OFFER_AVAILABILITY_VALUES, OpenCallStatus } from '../policies/offer-status.policy';
import { PublicTopicGroup, TopicAvailability, TopicLinkKind } from '../policies/public-topics';
import { CurrencySource } from '../policies/viewer-currency.policy';

const CURRENCIES = ['MXN', 'USD'] as const;
const OPTIONAL_DATE = { type: String, format: 'date-time', nullable: true } as const;

export class MoneyDto {
  @ApiProperty({ example: 1020000, description: 'Centavos enteros.' })
  amountCents!: number;

  @ApiProperty({ enum: CURRENCIES, example: 'MXN' })
  currency!: 'MXN' | 'USD';
}

export class AmountRangeDto {
  @ApiProperty({ example: 724200 })
  minAmountCents!: number;

  @ApiProperty({ example: 816000 })
  maxAmountCents!: number;

  @ApiProperty({ enum: CURRENCIES, example: 'MXN' })
  currency!: 'MXN' | 'USD';
}

export class OfferDatesDto {
  @ApiProperty({
    ...OPTIONAL_DATE,
    example: '2026-09-01T06:00:00.000Z',
    description: 'Apertura de inscripciones (o de postulación en convocatorias).',
  })
  enrollmentOpensAt!: string | null;

  @ApiProperty({
    ...OPTIONAL_DATE,
    example: '2026-11-06T05:59:59.000Z',
    description: 'Cierre de inscripciones (o de postulación).',
  })
  enrollmentClosesAt!: string | null;

  @ApiProperty({ ...OPTIONAL_DATE, example: '2026-11-07T16:00:00.000Z' })
  startsAt!: string | null;

  @ApiProperty({ ...OPTIONAL_DATE, example: '2027-01-31T19:00:00.000Z' })
  endsAt!: string | null;
}

export class OfferDetailDatesDto extends OfferDatesDto {
  @ApiProperty({
    ...OPTIONAL_DATE,
    example: '2027-02-27T16:00:00.000Z',
    description: 'Proyecto final (diplomados).',
  })
  finalProjectDueAt!: string | null;
}

export class SessionSlotDto {
  @ApiProperty({ example: '2026-11-07T16:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ example: '2026-11-07T19:00:00.000Z' })
  endsAt!: string;
}

export class OfferScheduleSlotDto {
  @ApiProperty({ example: 1, description: 'Día ISO: 1 = lunes … 7 = domingo.' })
  weekday!: number;

  @ApiProperty({ example: '10:00', description: 'Hora de inicio en CDMX (HH:mm) de ese día.' })
  startTime!: string;

  @ApiProperty({ example: '12:00', description: 'Hora de fin en CDMX (HH:mm) de ese día.' })
  endTime!: string;

  @ApiProperty({
    type: SessionSlotDto,
    nullable: true,
    description:
      'Primera sesión de ESE día según la regla, en UTC (para mostrarlo también en la hora del ' +
      'visitante). null si la oferta no tiene fecha de inicio.',
  })
  firstSession!: SessionSlotDto | null;
}

export class OfferScheduleDto {
  @ApiProperty({
    example: 'America/Mexico_City',
    description: 'Zona de la regla (hora oficial CDMX).',
  })
  timezone!: string;

  @ApiProperty({
    type: [Number],
    example: [6, 7],
    description: 'Días ISO: 1 = lunes … 7 = domingo.',
  })
  weekdays!: number[];

  @ApiProperty({
    example: '10:00',
    description:
      'Hora de inicio en CDMX (HH:mm) del primer día de la semana con clase (ver `slots`).',
  })
  startTime!: string;

  @ApiProperty({
    example: '13:00',
    description: 'Hora de fin en CDMX (HH:mm) del primer día de la semana con clase (ver `slots`).',
  })
  endTime!: string;

  @ApiProperty({
    example: true,
    description: 'true si todos los días tienen el mismo horario (`startTime`–`endTime`).',
  })
  sameTimeAllDays!: boolean;

  @ApiProperty({
    type: [OfferScheduleSlotDto],
    description: 'Horario de cada día de clase, de lunes a domingo (puede variar por día).',
  })
  slots!: OfferScheduleSlotDto[];

  @ApiProperty({
    type: SessionSlotDto,
    nullable: true,
    description:
      'Primera sesión según la regla, en UTC: sirve para mostrar "10:00 hora CDMX · 11:00 tu hora" ' +
      'con `Intl` (HU-11). null si la oferta no tiene fecha de inicio.',
  })
  firstSession!: SessionSlotDto | null;
}

export class OfferInstallmentsDto {
  @ApiProperty({
    example: 3,
    minimum: BUSINESS_RULES.INSTALLMENTS_MIN,
    maximum: BUSINESS_RULES.INSTALLMENTS_MAX,
    description: '"Hasta N cuotas sin recargo" (HU-16 / HU-24).',
  })
  maxInstallments!: number;
}

export class OfferPricingDto {
  @ApiProperty({
    enum: ['PAID', 'FREE', 'EXTERNAL_ENROLLMENT'],
    example: 'PAID',
    description:
      'PAID: con costo; FREE: "Gratuito"; EXTERNAL_ENROLLMENT: origen Moodle ("Inscripción externa", sin precio).',
  })
  kind!: 'PAID' | 'FREE' | 'EXTERNAL_ENROLLMENT';

  @ApiProperty({ enum: CURRENCIES, example: 'MXN', description: 'Moneda del visitante.' })
  currency!: 'MXN' | 'USD';

  @ApiProperty({
    enum: Object.values(CurrencySource),
    example: 'TIMEZONE',
    description:
      'PROFILE: país del perfil; TIMEZONE: zona del navegador (sin sesión); DEFAULT: sin datos (USD).',
  })
  currencySource!: CurrencySource;

  @ApiProperty({
    type: MoneyDto,
    nullable: true,
    description: 'Precio en `currency` (null si no es PAID o no hay precio en esa moneda).',
  })
  price!: MoneyDto | null;

  @ApiProperty({
    type: OfferInstallmentsDto,
    nullable: true,
    description: 'Solo si la oferta permite cuotas.',
  })
  installments!: OfferInstallmentsDto | null;
}

export class ScholarshipBadgeDto {
  @ApiProperty({ example: 10 })
  minPercent!: number;

  @ApiProperty({ example: 80 })
  maxPercent!: number;
}

export class OfferVenueSummaryDto {
  @ApiProperty({ example: 'Centro de Saberes del Agua' })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Tepoztlán, Morelos' })
  city!: string | null;
}

export class OfferVenueDto extends OfferVenueSummaryDto {
  @ApiProperty({ type: String, nullable: true, example: 'Camino a Amatlán s/n, Tepoztlán, Mor.' })
  address!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://maps.google.com/?q=Tepoztlan',
    description: '"Cómo llegar".',
  })
  mapsUrl!: string | null;
}

export class OfferSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    example: 'diplomado-en-ecotecnologias-del-agua',
    description: 'Ruta /escuela/oferta/[slug].',
  })
  slug!: string;

  @ApiProperty({ example: 'Diplomado en Ecotecnologías del Agua' })
  name!: string;

  @ApiProperty({ enum: OfferType, example: 'DIPLOMA' })
  type!: OfferType;

  @ApiProperty({ enum: OfferModality, example: 'ONLINE_LIVE' })
  modality!: OfferModality;

  @ApiProperty({ enum: OfferOrigin, example: 'NAS' })
  origin!: OfferOrigin;

  @ApiProperty({
    enum: OFFER_AVAILABILITY_VALUES,
    example: 'ENROLLMENT_OPEN',
    description: 'Estado derivado de publicación y fechas.',
  })
  availability!: string;

  @ApiProperty({
    enum: Object.values(OpenCallStatus),
    nullable: true,
    example: null,
    description: 'Solo convocatorias: estado de la postulación.',
  })
  openCallStatus!: OpenCallStatus | null;

  @ApiProperty({
    example:
      'Aprende a diseñar y construir ecotecnologías para cuidar, tratar y regenerar el agua.',
  })
  summary!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/offers/diplomado/portada.webp',
  })
  coverImageUrl!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Generación 2026–2027' })
  cohortLabel!: string | null;

  @ApiProperty({ enum: PublicTopic, nullable: true, example: 'ECOTECH_WATER_DIPLOMA' })
  publicTopic!: PublicTopic | null;

  @ApiProperty({ type: OfferDatesDto })
  dates!: OfferDatesDto;

  @ApiProperty({
    type: OfferScheduleDto,
    nullable: true,
    description: 'null si la oferta no tiene regla de horario.',
  })
  schedule!: OfferScheduleDto | null;

  @ApiProperty({ type: Number, nullable: true, example: 60 })
  totalHours!: number | null;

  @ApiProperty({ type: OfferVenueSummaryDto, nullable: true, description: 'Solo presenciales.' })
  venue!: OfferVenueSummaryDto | null;

  @ApiProperty({ type: OfferPricingDto })
  pricing!: OfferPricingDto;

  @ApiProperty({
    type: ScholarshipBadgeDto,
    nullable: true,
    description: 'Badge "Beca 10%–80%": solo diplomados NAS con beca.',
  })
  scholarship!: ScholarshipBadgeDto | null;

  @ApiProperty({ type: [String], example: ['Ana Solís Ríos', 'Tomás Ek Canché'] })
  teacherNames!: string[];

  @ApiProperty({
    example: false,
    description: 'Con sesión: inscripción activa → "Inscrito" y la tarjeta lleva al Aula (HU-17).',
  })
  enrolled!: boolean;
}

export class TeacherDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Ana Solís Ríos' })
  fullName!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://cdn.example.com/teachers/ana.webp',
  })
  photoUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ingeniera ambiental con 15 años en humedales construidos.',
  })
  bio!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://example.com/cv/ana-solis.pdf',
    description: '"Ver CV".',
  })
  cvUrl!: string | null;
}

export class OfferModuleDto {
  @ApiProperty({ example: 3, description: 'Número de módulo (1..n) en el temario publicado.' })
  number!: number;

  @ApiProperty({ example: 'Humedales construidos' })
  title!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Diseño y operación de humedales para aguas grises.',
  })
  description!: string | null;
}

export class OfferScholarshipTypeDto {
  @ApiProperty({ format: 'uuid', example: '0b9a3c52-5f3e-4c1b-9d8e-1c2f3a4b5c6d' })
  scholarshipTypeId!: string;

  @ApiProperty({
    type: ScholarshipTypeSummaryDto,
    description:
      'Tipo de beca con el rango EFECTIVO en esta oferta (la oferta puede ajustar el rango del ' +
      'tipo). `requiresInterview` = la postulación pasa por entrevista por Zoom.',
  })
  scholarshipType!: ScholarshipTypeSummaryDto;

  @ApiProperty({ type: String, nullable: true, example: null })
  description!: string | null;

  @ApiProperty({
    type: AmountRangeDto,
    nullable: true,
    description: 'Monto estimado de la beca en la moneda del visitante.',
  })
  estimatedScholarship!: AmountRangeDto | null;

  @ApiProperty({
    type: AmountRangeDto,
    nullable: true,
    description: 'Saldo estimado a pagar ("el tipo final lo asigna el equipo").',
  })
  estimatedBalance!: AmountRangeDto | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 12,
    description:
      'Becas de este tipo que aún se pueden asignar en esta oferta (mínimo entre el cupo global ' +
      'del tipo y el de la oferta). null = sin límite.',
  })
  availableRecipients!: number | null;

  @ApiProperty({
    example: false,
    description: 'Cupo agotado: muéstralo como "Agotado"; no se puede solicitar.',
  })
  isFull!: boolean;
}

export class OfferScholarshipDto extends ScholarshipBadgeDto {
  @ApiProperty({
    enum: ['OPEN', 'UPCOMING', 'CLOSED'],
    example: 'OPEN',
    description: 'Convocatoria de becas.',
  })
  windowStatus!: 'OPEN' | 'UPCOMING' | 'CLOSED';

  @ApiProperty({ ...OPTIONAL_DATE, example: '2026-09-01T06:00:00.000Z' })
  opensAt!: string | null;

  @ApiProperty({ ...OPTIONAL_DATE, example: '2026-10-25T05:59:59.000Z' })
  closesAt!: string | null;

  @ApiProperty({
    type: [OfferScholarshipTypeDto],
    description: 'Tipos de beca activos de esta oferta, ordenados (antes `levels`).',
  })
  scholarshipTypes!: OfferScholarshipTypeDto[];
}

export class EligibleCountryDto {
  @ApiProperty({ example: 'GT' })
  code!: string;

  @ApiProperty({ example: 'Guatemala' })
  name!: string;
}

export class OfferEligibilityDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Dirigida a mujeres lideresas de Centroamérica y México.',
  })
  text!: string | null;

  @ApiProperty({ type: [EligibleCountryDto], description: 'Vacío = sin restricción de país.' })
  countries!: EligibleCountryDto[];

  @ApiProperty({
    example: true,
    description: 'Requiere disponibilidad para viajar (asistencia presencial completa).',
  })
  requiresTravel!: boolean;
}

export class OfferCapacityDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 25,
    description: 'Cupo total (null = sin cupo).',
  })
  total!: number | null;

  @ApiProperty({ example: false, description: '"Cupo agotado".' })
  soldOut!: boolean;
}

export class OfferActionDto {
  @ApiProperty({
    enum: Object.values(OfferActionType),
    example: 'ENROLL_AND_PAY',
    description:
      'Fase 05: ENROLL_AND_PAY / PAY_IN_INSTALLMENTS → pantalla de pago (`GET /me/payments/quote?offerId=`), ' +
      'PAY_BALANCE → `/postulaciones/{applicationId}/pago`, CONTINUE_PAYMENT [Continuar pago] ' +
      '(checkout abierto: `POST /me/payments/checkout` devuelve la misma sesión), ' +
      'PAYMENT_IN_VALIDATION "Pago en validación" (deshabilitado), REGULARIZE_PAYMENT [Regularizar ' +
      'pago] → Mis pagos (acceso suspendido por mora).',
  })
  type!: OfferActionType;

  @ApiProperty({ example: true })
  enabled!: boolean;

  @ApiProperty({ example: true, description: 'Botón principal (máximo uno).' })
  primary!: boolean;

  @ApiProperty({
    example: false,
    description: 'Sin sesión: llevar a login/registro y regresar a la ficha con la acción.',
  })
  requiresLogin!: boolean;

  @ApiProperty({
    enum: Object.values(OfferActionReason),
    nullable: true,
    example: null,
    description: 'Motivo si `enabled = false`.',
  })
  reason!: OfferActionReason | null;

  @ApiProperty({
    ...OPTIONAL_DATE,
    example: null,
    description: 'Para *_NOT_OPEN_YET: cuándo se habilita.',
  })
  availableFrom!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    example: null,
    description:
      'Fase 04: en `VIEW_APPLICATION` / `PAY_BALANCE`, id de mi postulación → ' +
      '`/postulaciones/{applicationId}` (`GET /me/applications/{id}`).',
  })
  applicationId!: string | null;

  @ApiProperty({
    enum: ApplicationStatus,
    nullable: true,
    example: null,
    description: 'Fase 04: estado de mi postulación (mismos textos que "Mis postulaciones").',
  })
  applicationStatus!: ApplicationStatus | null;
}

export class OfferViewerApplicationDto {
  @ApiProperty({ format: 'uuid', example: '3a1f5c2e-7b9d-4e8a-9c1b-2d3e4f5a6b7c' })
  id!: string;

  @ApiProperty({ enum: ApplicationKind, example: 'SCHOLARSHIP' })
  kind!: ApplicationKind;

  @ApiProperty({ enum: ApplicationStatus, example: 'SUBMITTED' })
  status!: ApplicationStatus;

  @ApiProperty({ example: 'BEC-000123' })
  folio!: string;

  @ApiProperty({
    example: false,
    required: false,
    description: 'Fase 05: comprobante de transferencia "Pendiente de validación".',
  })
  transferPending?: boolean;
}

export class OfferViewerDto {
  @ApiProperty({ example: false })
  authenticated!: boolean;

  @ApiProperty({ example: false, description: '"Ya estás inscrito".' })
  enrolled!: boolean;

  @ApiProperty({
    type: OfferViewerApplicationDto,
    nullable: true,
    description:
      'Fase 04: mi postulación (beca o convocatoria) en esta oferta, una por cohorte (HU-16: "con una ' +
      'postulación a beca en curso veo su estado o [Pagar saldo]"). null sin sesión o sin postulación.',
  })
  application!: OfferViewerApplicationDto | null;
}

export class OfferDetailDto extends OfferSummaryDto {
  @ApiProperty({ example: 'El diplomado recorre las principales ecotecnologías…' })
  description!: string;

  @ApiProperty({
    type: [String],
    example: ['Diseñar un humedal construido', 'Dimensionar un sistema de captación'],
  })
  learningOutcomes!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Conexión estable a internet y disponibilidad sábados y domingos.',
  })
  requirements!: string | null;

  @ApiProperty({ type: [String], description: 'Carrusel de imágenes (URLs).' })
  carouselImageUrls!: string[];

  @ApiProperty({ type: OfferDetailDatesDto })
  declare dates: OfferDetailDatesDto;

  @ApiProperty({ type: OfferVenueDto, nullable: true })
  declare venue: OfferVenueDto | null;

  @ApiProperty({ example: 20, description: 'Sesiones programadas (sin canceladas).' })
  sessionCount!: number;

  @ApiProperty({ enum: CalendarCategory, example: 'TRAINING' })
  calendarCategory!: CalendarCategory;

  @ApiProperty({ type: [TeacherDto] })
  teachers!: TeacherDto[];

  @ApiProperty({ type: [OfferModuleDto], description: 'Temario: solo módulos publicados.' })
  modules!: OfferModuleDto[];

  @ApiProperty({
    type: OfferScholarshipDto,
    nullable: true,
    description: 'Bloque de beca: solo diplomados NAS con beca.',
  })
  scholarshipDetails!: OfferScholarshipDto | null;

  @ApiProperty({
    type: OfferEligibilityDto,
    nullable: true,
    description: 'Requisitos de elegibilidad (convocatorias).',
  })
  eligibility!: OfferEligibilityDto | null;

  @ApiProperty({ type: OfferCapacityDto })
  capacity!: OfferCapacityDto;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: null,
    description: 'Moodle: enlace informativo al curso.',
  })
  moodleCourseUrl!: string | null;

  @ApiProperty({ type: OfferViewerDto })
  viewer!: OfferViewerDto;

  @ApiProperty({
    type: [OfferActionDto],
    description: 'CTA calculados por el backend, en orden de jerarquía.',
  })
  actions!: OfferActionDto[];
}

export class TopicLinkDto {
  @ApiProperty({ enum: Object.values(TopicLinkKind), example: 'OFFER' })
  kind!: TopicLinkKind;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'diplomado-en-ecotecnologias-del-agua',
    description: 'kind = OFFER: slug de la ficha.',
  })
  slug!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'topic=CONSTRUCTED_WETLANDS&status=ENROLLMENT_OPEN,UPCOMING,ENROLLMENT_CLOSED',
    description: 'kind = CATALOG: query string para /escuela/oferta.',
  })
  catalogQuery!: string | null;
}

export class TopicAvailabilityDto {
  @ApiProperty({ enum: PublicTopic, example: 'ECOTECH_WATER_DIPLOMA' })
  topic!: PublicTopic;

  @ApiProperty({ enum: Object.values(PublicTopicGroup), example: 'SPECIALIZED_TRAINING' })
  group!: PublicTopicGroup;

  @ApiProperty({
    example: 'Diplomado en Ecotecnologías del Agua',
    description: 'Texto literal del cliente.',
  })
  label!: string;

  @ApiProperty({ enum: Object.values(TopicAvailability), example: 'ENROLLMENT_OPEN' })
  availability!: TopicAvailability;

  @ApiProperty({ example: 1, description: 'Ofertas vigentes (publicadas, no finalizadas).' })
  offerCount!: number;

  @ApiProperty({ type: TopicLinkDto })
  link!: TopicLinkDto;
}

export class TopicAvailabilityListDto {
  @ApiProperty({ type: [TopicAvailabilityDto] })
  data!: TopicAvailabilityDto[];
}
