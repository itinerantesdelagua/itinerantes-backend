import { DateTime } from 'luxon';
import { OFFICIAL_TIMEZONE } from '../../../common/utils/time';
import { BUSINESS_RULES } from '../../../config/business-rules';
import type { OfferType } from '../../../generated/prisma/client';
import { type ScheduleRule, slotForWeekday, slotOnDate } from './schedule-rule';

/**
 * Generación automática de sesiones desde la regla de horario (HU-29). Función PURA: la usa el seed
 * (Fase 02) y la vista previa / "Crear sesiones" del panel (Fase 06).
 *
 * - Recorre cada día del rango [startDate, endDate] (fechas CDMX, inclusivas) cuyo día de la semana
 *   tenga horario en `rule.slots`, con el horario PROPIO de ese día (p. ej. lun 10–12, jue 16–18).
 * - Las fechas excluidas (manuales y, si se pide, festivos de México) se OMITEN sin reprogramar
 *   (Anexo A, HU-29) y aparecen en la vista previa como EXCLUDED.
 * - Una ocurrencia que se traslapa con una sesión existente queda como CONFLICT (no se crea).
 * - Los instantes se calculan en hora CDMX y se devuelven en UTC.
 */

export type GeneratedSessionStatus = 'NEW' | 'EXCLUDED' | 'CONFLICT';
export type ExclusionReason = 'MANUAL' | 'MX_HOLIDAY';

export interface SessionPreviewItem {
  /** Fecha CDMX (YYYY-MM-DD). */
  date: string;
  startsAt: Date;
  endsAt: Date;
  status: GeneratedSessionStatus;
  exclusionReason?: ExclusionReason;
  /** Índice (0..moduleCount-1) del módulo asignado; solo en NEW cuando se pasó `moduleCount`. */
  moduleIndex?: number;
}

export interface GenerateSessionsInput {
  rule: ScheduleRule;
  /** Primer día del rango (CDMX, YYYY-MM-DD). */
  startDate: string;
  /** Último día del rango (CDMX, YYYY-MM-DD), inclusivo. */
  endDate: string;
  /** Sesiones ya existentes de la oferta (para detectar conflictos). */
  existing?: ReadonlyArray<{ startsAt: Date; endsAt: Date }>;
  /** Si se indica, reparte las sesiones nuevas entre N módulos en orden (ver `distributeAcrossModules`). */
  moduleCount?: number;
  zone?: string;
}

export interface GenerateSessionsResult {
  items: SessionPreviewItem[];
  /** Solo las sesiones a crear (status NEW). */
  sessions: SessionPreviewItem[];
  sessionCount: number;
  excludedCount: number;
  conflictCount: number;
  /** Minutos totales de las sesiones NEW (suma del horario de cada día). */
  totalMinutes: number;
}

/** Máximo de días que se recorren (protección ante rangos absurdos). */
const MAX_RANGE_DAYS = 3 * 366;

export function generateSessions(input: GenerateSessionsInput): GenerateSessionsResult {
  const zone = input.zone ?? OFFICIAL_TIMEZONE;
  const start = DateTime.fromISO(input.startDate, { zone });
  const end = DateTime.fromISO(input.endDate, { zone });
  if (!start.isValid || !end.isValid) throw new Error('Rango de fechas inválido');
  if (end < start) throw new Error('endDate debe ser igual o posterior a startDate');
  if (end.diff(start, 'days').days > MAX_RANGE_DAYS)
    throw new Error('Rango de fechas demasiado largo');

  const manual = new Set(input.rule.excludedDates);
  const holidays = new Set<string>();
  if (input.rule.excludeMexicanHolidays) {
    for (let year = start.year; year <= end.year; year++) {
      for (const day of mexicanFederalHolidays(year)) holidays.add(day);
    }
  }
  const existing = input.existing ?? [];

  const items: SessionPreviewItem[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const times = slotForWeekday(input.rule, day.weekday);
    if (!times) continue;
    const date = day.toISODate();
    const slot = slotOnDate(date, times, zone);
    if (manual.has(date)) {
      items.push({ date, ...slot, status: 'EXCLUDED', exclusionReason: 'MANUAL' });
    } else if (holidays.has(date)) {
      items.push({ date, ...slot, status: 'EXCLUDED', exclusionReason: 'MX_HOLIDAY' });
    } else if (existing.some((e) => overlaps(slot, e))) {
      items.push({ date, ...slot, status: 'CONFLICT' });
    } else {
      items.push({ date, ...slot, status: 'NEW' });
    }
  }

  const sessions = items.filter((item) => item.status === 'NEW');
  if (input.moduleCount && input.moduleCount > 0) {
    const assignment = distributeAcrossModules(sessions.length, input.moduleCount);
    sessions.forEach((session, i) => (session.moduleIndex = assignment[i]));
  }
  return {
    items,
    sessions,
    sessionCount: sessions.length,
    excludedCount: items.filter((i) => i.status === 'EXCLUDED').length,
    conflictCount: items.filter((i) => i.status === 'CONFLICT').length,
    totalMinutes: sessions.reduce((sum, s) => sum + sessionMinutes(s), 0),
  };
}

/** Minutos de una sesión (cada día puede tener su propio horario). */
function sessionMinutes(session: { startsAt: Date; endsAt: Date }): number {
  return Math.round((session.endsAt.getTime() - session.startsAt.getTime()) / 60_000);
}

function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Reparte `sessionCount` sesiones consecutivas entre `moduleCount` módulos en orden; los primeros
 * módulos reciben una sesión extra cuando no es exacto.
 * @example distributeAcrossModules(20, 9) → [0,0,0, 1,1,1, 2,2, 3,3, …, 8,8]
 */
export function distributeAcrossModules(sessionCount: number, moduleCount: number): number[] {
  if (moduleCount <= 0) return [];
  const base = Math.floor(sessionCount / moduleCount);
  const extra = sessionCount % moduleCount;
  const result: number[] = [];
  for (let m = 0; m < moduleCount; m++) {
    const count = base + (m < extra ? 1 : 0);
    for (let i = 0; i < count; i++) result.push(m);
  }
  return result;
}

/** Día N de la semana (1 = lunes) número `nth` del mes, como YYYY-MM-DD. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string {
  let day = DateTime.fromObject({ year, month, day: 1 });
  while (day.weekday !== weekday) day = day.plus({ days: 1 });
  return day.plus({ weeks: nth - 1 }).toISODate()!;
}

/**
 * Días de descanso obligatorio en México (LFT art. 74) para precargar como fechas excluidas (HU-29):
 * 1 ene, primer lunes de febrero, tercer lunes de marzo, 1 may, 16 sep, tercer lunes de noviembre,
 * 25 dic y 1 oct de cada sexenio (2024, 2030, …).
 */
export function mexicanFederalHolidays(year: number): string[] {
  const fixed = (month: number, day: number) =>
    DateTime.fromObject({ year, month, day }).toISODate()!;
  const days = [
    fixed(1, 1),
    nthWeekdayOfMonth(year, 2, 1, 1),
    nthWeekdayOfMonth(year, 3, 1, 3),
    fixed(5, 1),
    fixed(9, 16),
    nthWeekdayOfMonth(year, 11, 1, 3),
    fixed(12, 25),
  ];
  if (year >= 2024 && (year - 2024) % 6 === 0) days.push(fixed(10, 1));
  return days.sort();
}

export type HoursViolation = 'COURSE_MAX_HOURS_EXCEEDED' | 'DIPLOMA_HOURS_MISMATCH';

/**
 * Reglas de duración por tipo (HU-27 / HU-29): curso ≤ 9 h; diplomado exactamente 60 h
 * (Anexo A: confirmar si se admiten variaciones). Devuelve las reglas incumplidas.
 */
export function validateOfferHours(type: OfferType, totalMinutes: number): HoursViolation[] {
  const violations: HoursViolation[] = [];
  if (type === 'COURSE' && totalMinutes > BUSINESS_RULES.COURSE_MAX_HOURS * 60) {
    violations.push('COURSE_MAX_HOURS_EXCEEDED');
  }
  if (type === 'DIPLOMA' && totalMinutes !== BUSINESS_RULES.DIPLOMA_TOTAL_HOURS * 60) {
    violations.push('DIPLOMA_HOURS_MISMATCH');
  }
  return violations;
}
