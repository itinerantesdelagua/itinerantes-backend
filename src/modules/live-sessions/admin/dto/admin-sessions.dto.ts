import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BUSINESS_RULES } from '../../../../config/business-rules';
import {
  CalendarCategory,
  CalendarEventKind,
  SessionStatus,
} from '../../../../generated/prisma/client';
import { AdminSessionState } from '../policies/session-admin.policy';

const R = BUSINESS_RULES;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IMPORTANT_KINDS = Object.values(CalendarEventKind).filter((k) => k !== 'MANUAL');

// --- Lectura ---------------------------------------------------------------------------------------

export class AdminSessionModuleRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 3, description: '"Módulo N" (orden actual de los módulos).' })
  number!: number;

  @ApiProperty({ example: 'Humedales construidos' })
  title!: string;
}

export class AdminSessionFlagsDto {
  @ApiProperty({ example: false, description: 'Reprogramada (tiene hora original).' })
  edited!: boolean;

  @ApiProperty({ example: false })
  cancelled!: boolean;

  @ApiProperty({
    example: false,
    description: 'En línea sin enlace de participante ("Sin enlace").',
  })
  missingLink!: boolean;

  @ApiProperty({
    example: true,
    description: 'En línea, ya terminó y sin grabación ("Grabación pendiente").',
  })
  recordingPending!: boolean;
}

export class AdminSessionAttendanceCountDto {
  @ApiProperty({ example: 18, description: 'Registros de asistencia de la sesión.' })
  registered!: number;

  @ApiProperty({
    example: 25,
    description: 'Inscritos vigentes de la oferta (ACTIVE, COMPLETED, SUSPENDED).',
  })
  enrolled!: number;
}

export class AdminSessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  offerId!: string;

  @ApiProperty({ example: '2026-11-07T16:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ example: '2026-11-07T19:00:00.000Z' })
  endsAt!: string;

  @ApiProperty({ enum: SessionStatus, example: 'SCHEDULED' })
  status!: SessionStatus;

  @ApiProperty({
    enum: AdminSessionState,
    example: 'SCHEDULED',
    description: 'Chip de HU-30 (Programada / Registro abierto / Cerrada / Cancelada).',
  })
  state!: AdminSessionState;

  @ApiProperty({ enum: CalendarCategory, example: 'TRAINING' })
  category!: CalendarCategory;

  @ApiProperty({ type: AdminSessionModuleRefDto, nullable: true })
  module!: AdminSessionModuleRefDto | null;

  @ApiProperty({
    example: 'https://us02web.zoom.us/j/123?pwd=x',
    nullable: true,
    type: String,
    description: 'Enlace de participante.',
  })
  joinUrl!: string | null;

  @ApiProperty({
    example: 'https://us02web.zoom.us/s/123?zak=x',
    nullable: true,
    type: String,
    description: 'Enlace de ANFITRIÓN (solo panel; nunca al participante).',
  })
  hostUrl!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  recordingUrl!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  recordingPublishedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Number,
    description: 'Override de la ventana (h); null = la de la oferta.',
  })
  attendanceWindowHours!: number | null;

  @ApiProperty({ example: 24, description: 'Ventana efectiva (h).' })
  effectiveAttendanceWindowHours!: number;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Hora original si se reprogramó.',
  })
  originalStartsAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Motivo de la reprogramación/cancelación.',
  })
  changeReason!: string | null;

  @ApiProperty({ example: null, nullable: true, type: String })
  cancelledAt!: string | null;

  @ApiProperty({ type: AdminSessionFlagsDto })
  flags!: AdminSessionFlagsDto;

  @ApiProperty({ type: AdminSessionAttendanceCountDto })
  attendance!: AdminSessionAttendanceCountDto;
}

export class AdminSessionListDto {
  @ApiProperty({ type: [AdminSessionDto] })
  data!: AdminSessionDto[];
}

// --- Generación (HU-29) --------------------------------------------------------------------------

export class ScheduleSlotBodyDto {
  @ApiProperty({ example: 1, description: 'Día ISO (1 = lunes … 7 = domingo).' })
  weekday!: number;

  @ApiProperty({ example: '10:00', description: 'Inicio en hora CDMX (HH:mm).' })
  startTime!: string;

  @ApiProperty({ example: '12:00', description: 'Fin en hora CDMX (HH:mm), posterior al inicio.' })
  endTime!: string;
}

/**
 * Regla de horario: `slots` (horario propio por día, p. ej. lun 10–12 y jue 16–18) o la forma
 * clásica `weekdays` + `startTime` + `endTime` (mismo horario todos los días). `slots` manda.
 */
export class ScheduleRuleBodyDto {
  @ApiPropertyOptional({
    type: [ScheduleSlotBodyDto],
    description: 'Horario por día de clase (sin días repetidos).',
  })
  slots?: ScheduleSlotBodyDto[];

  @ApiPropertyOptional({
    example: [6, 7],
    description: 'Forma clásica: días ISO (1 = lunes … 7 = domingo).',
  })
  weekdays?: number[];

  @ApiPropertyOptional({ example: '10:00', description: 'Forma clásica: inicio en CDMX (HH:mm).' })
  startTime?: string;

  @ApiPropertyOptional({
    example: '13:00',
    description: 'Forma clásica: fin en CDMX (HH:mm), posterior al inicio.',
  })
  endTime?: string;

  @ApiPropertyOptional({
    example: ['2026-12-26'],
    description: 'Fechas CDMX que se omiten sin reprogramar (recesos).',
  })
  excludedDates?: string[];

  @ApiPropertyOptional({ example: true, description: 'Omitir festivos oficiales de México.' })
  excludeMexicanHolidays?: boolean;
}

export class GenerateSessionsRequestDto {
  @ApiPropertyOptional({
    type: ScheduleRuleBodyDto,
    description:
      'Regla (paso "Regla" + "Excepciones"). Omitir = la regla guardada en la oferta (HU-27 paso 3). Si se envía y se confirma, se guarda en la oferta.',
  })
  @IsOptional()
  @IsObject()
  rule?: ScheduleRuleBodyDto;

  @ApiPropertyOptional({
    example: '2026-11-07',
    description:
      'Primer día (CDMX). Default: inicio de la oferta. Dentro del periodo de la oferta.',
  })
  @IsOptional()
  @Matches(DATE, { message: 'Usa el formato YYYY-MM-DD.' })
  startDate?: string;

  @ApiPropertyOptional({
    example: '2027-01-31',
    description: 'Último día (CDMX, inclusivo). Default: fin de la oferta.',
  })
  @IsOptional()
  @Matches(DATE, { message: 'Usa el formato YYYY-MM-DD.' })
  endDate?: string;

  @ApiPropertyOptional({
    example: 'https://us02web.zoom.us/j/123?pwd=x',
    description: 'Enlace recurrente de participante (zoom.us o meet.google.com; solo en línea).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  joinUrl?: string;

  @ApiPropertyOptional({
    example: 'https://us02web.zoom.us/s/123',
    description: 'Enlace recurrente de anfitrión (zoom.us o meet.google.com).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hostUrl?: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Repartir las sesiones entre los módulos en orden.',
  })
  @IsOptional()
  @IsBoolean()
  assignModules?: boolean;

  @ApiPropertyOptional({
    enum: IMPORTANT_KINDS,
    isArray: true,
    example: ['ENROLLMENT_CLOSES', 'OFFER_STARTS', 'SCHOLARSHIP_DEADLINE', 'FINAL_PROJECT'],
    description:
      'Fechas importantes automáticas a crear/actualizar (solo las que existen en la oferta).',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(IMPORTANT_KINDS, { each: true })
  importantDates?: Array<Exclude<CalendarEventKind, 'MANUAL'>>;
}

export class SessionPreviewItemDto {
  @ApiProperty({ example: '2026-11-07', description: 'Fecha CDMX.' })
  date!: string;

  @ApiProperty({ example: '2026-11-07T16:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ example: '2026-11-07T19:00:00.000Z' })
  endsAt!: string;

  @ApiProperty({
    enum: ['NEW', 'EXCLUDED', 'CONFLICT'],
    example: 'NEW',
    description: 'Nueva / Excluida / Conflicto.',
  })
  status!: 'NEW' | 'EXCLUDED' | 'CONFLICT';

  @ApiProperty({
    enum: ['MANUAL', 'MX_HOLIDAY'],
    nullable: true,
    example: null,
    description: 'Receso manual o festivo de México.',
  })
  exclusionReason!: 'MANUAL' | 'MX_HOLIDAY' | null;

  @ApiProperty({ type: AdminSessionModuleRefDto, nullable: true })
  module!: AdminSessionModuleRefDto | null;
}

export class SessionPreviewSummaryDto {
  @ApiProperty({ example: 20, description: 'Sesiones nuevas.' })
  sessionCount!: number;

  @ApiProperty({ example: 60, description: 'Horas de las sesiones nuevas.' })
  newHours!: number;

  @ApiProperty({ example: 0, description: 'Horas de las sesiones ya existentes (no canceladas).' })
  existingHours!: number;

  @ApiProperty({ example: 60, description: 'Total de la oferta tras crear (existentes + nuevas).' })
  totalHours!: number;

  @ApiProperty({ example: 6 })
  excludedCount!: number;

  @ApiProperty({ example: 0 })
  conflictCount!: number;

  @ApiProperty({ example: '20 sesiones · 60 h · 6 excluidas' })
  label!: string;
}

export class ImportantDatePreviewDto {
  @ApiProperty({ enum: IMPORTANT_KINDS, example: 'OFFER_STARTS' })
  kind!: string;

  @ApiProperty({ example: 'Inicio: Diplomado en Ecotecnologías del Agua' })
  title!: string;

  @ApiProperty({ example: '2026-11-07T16:00:00.000Z' })
  startsAt!: string;

  @ApiProperty({ enum: ['ALL_REGISTERED', 'OFFER_ENROLLED'], example: 'OFFER_ENROLLED' })
  audience!: string;

  @ApiProperty({ example: false, description: 'Ya existe (se actualizará).' })
  exists!: boolean;
}

export class SessionPreviewDto {
  @ApiProperty({ type: [SessionPreviewItemDto] })
  items!: SessionPreviewItemDto[];

  @ApiProperty({ type: SessionPreviewSummaryDto })
  summary!: SessionPreviewSummaryDto;

  @ApiProperty({
    enum: ['COURSE_MAX_HOURS_EXCEEDED'],
    isArray: true,
    example: [],
    description: 'Bloquean "Crear sesiones".',
  })
  violations!: string[];

  @ApiProperty({
    enum: ['DIPLOMA_HOURS_MISMATCH'],
    isArray: true,
    example: [],
    description: 'Solo advertencia.',
  })
  warnings!: string[];

  @ApiProperty({ example: true, description: '"Crear sesiones" habilitado.' })
  canConfirm!: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Motivo del bloqueo ("Los cursos tienen una duración máxima de 9 horas").',
  })
  blockedReason!: string | null;

  @ApiProperty({ type: [ImportantDatePreviewDto] })
  importantDates!: ImportantDatePreviewDto[];
}

export class GenerateSessionsResultDto {
  @ApiProperty({ example: 20 })
  createdSessions!: number;

  @ApiProperty({ example: 4, description: 'Fechas importantes creadas o actualizadas.' })
  importantDates!: number;

  @ApiProperty({ example: 'Se crearon 20 sesiones y 4 fechas importantes' })
  message!: string;

  @ApiProperty({ type: [AdminSessionDto] })
  sessions!: AdminSessionDto[];
}

// --- Escritura -------------------------------------------------------------------------------------

export class CreateSessionRequestDto {
  @ApiProperty({ example: '2026-11-21T16:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-11-21T19:00:00.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Módulo de la misma oferta.' })
  @IsOptional()
  @IsUUID('all')
  moduleId?: string;

  @ApiPropertyOptional({ enum: CalendarCategory, description: 'Default: categoría de la oferta.' })
  @IsOptional()
  @IsEnum(CalendarCategory)
  category?: CalendarCategory;

  @ApiPropertyOptional({ example: 'https://meet.google.com/abc-defg-hij' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  joinUrl?: string;

  @ApiPropertyOptional({ example: 'https://meet.google.com/abc-defg-hij' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hostUrl?: string;
}

export class UpdateSessionRequestDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'null = sin módulo.',
  })
  @IsOptional()
  @IsUUID('all')
  moduleId?: string | null;

  @ApiPropertyOptional({ enum: CalendarCategory })
  @IsOptional()
  @IsEnum(CalendarCategory)
  category?: CalendarCategory;

  @ApiPropertyOptional({
    example: 'https://us02web.zoom.us/j/123',
    nullable: true,
    type: String,
    description: 'Por sesión (zoom.us o meet.google.com). null = quitar.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  joinUrl?: string | null;

  @ApiPropertyOptional({ example: 'https://us02web.zoom.us/s/123', nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  hostUrl?: string | null;

  @ApiPropertyOptional({
    example: 'https://youtu.be/abc123',
    nullable: true,
    type: String,
    description:
      'HU-28: enlace https de la grabación (Zoom Cloud, YouTube no listado, Vimeo, Drive). null = quitar.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  recordingUrl?: string | null;

  @ApiPropertyOptional({
    example: 48,
    nullable: true,
    type: Number,
    minimum: R.ATTENDANCE_WINDOW_MIN_HOURS,
    maximum: R.ATTENDANCE_WINDOW_MAX_HOURS,
    description: 'Override de la ventana (h); null = la de la oferta.',
  })
  @IsOptional()
  @IsInt()
  @Min(R.ATTENDANCE_WINDOW_MIN_HOURS)
  @Max(R.ATTENDANCE_WINDOW_MAX_HOURS)
  attendanceWindowHours?: number | null;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: '"Notificar a inscritos" al publicar la grabación.',
  })
  @IsOptional()
  @IsBoolean()
  notifyRecording?: boolean;
}

export class RescheduleSessionRequestDto {
  @ApiProperty({ example: '2026-11-14T16:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-11-14T19:00:00.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiProperty({
    example: 'La docente no puede asistir ese día.',
    description: 'Motivo obligatorio (se envía a los inscritos).',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CancelSessionRequestDto {
  @ApiProperty({
    example: 'Suspensión por lluvias en la sede.',
    description: 'Motivo obligatorio (se envía a los inscritos).',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class SessionChangeResultDto {
  @ApiProperty({ type: AdminSessionDto })
  session!: AdminSessionDto;

  @ApiProperty({ example: 25, description: 'Personas notificadas (portal + correo).' })
  notifiedCount!: number;
}
