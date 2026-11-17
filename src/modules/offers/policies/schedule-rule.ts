import { DateTime } from 'luxon';
import { z } from 'zod';
import { OFFICIAL_TIMEZONE } from '../../../common/utils/time';

/**
 * Regla de horario de una oferta (HU-27 paso 3 / HU-29), guardada en `Offer.scheduleRule` (JSON).
 * Las horas son SIEMPRE hora oficial CDMX (America/Mexico_City); la API devuelve además los
 * instantes UTC de la primera sesión para que el frontend convierta a la zona del visitante.
 *
 * Acepta dos formas de entrada (compatibilidad con las reglas ya guardadas):
 *  - Clásica, mismo horario todos los días:
 *    `{ weekdays: [6, 7], startTime: '10:00', endTime: '13:00', excludedDates: ['2026-12-19'] }`
 *  - Horario por día de clase (`slots` manda; `weekdays`/`startTime`/`endTime` se ignoran):
 *    `{ slots: [{ weekday: 1, startTime: '10:00', endTime: '12:00' },
 *               { weekday: 4, startTime: '16:00', endTime: '18:00' }] }`
 *
 * Ambas se NORMALIZAN a la misma salida: `slots` (uno por día, ordenados de lunes a domingo) más
 * los campos clásicos derivados (`weekdays` = días de `slots`; `startTime`/`endTime` = horario del
 * primer día) para que los consumidores anteriores sigan funcionando.
 */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Ambas horas son "HH:mm" válidas (solo entonces tiene sentido comparar inicio y fin). */
const isOrderedPair = (start?: string, end?: string) =>
  !!start && !!end && TIME.test(start) && TIME.test(end);

const weekday = z.number().int().min(1).max(7);
const time = z.string().regex(TIME, 'Usa el formato HH:mm');

/** Horario de un día de clase. */
const slotSchema = z
  .object({
    /** Día ISO: 1 = lunes … 7 = domingo. */
    weekday,
    /** Hora de inicio en CDMX, "HH:mm". */
    startTime: time,
    /** Hora de fin en CDMX, "HH:mm" (posterior al inicio, mismo día). */
    endTime: time,
  })
  .refine((slot) => !isOrderedPair(slot.startTime, slot.endTime) || slot.endTime > slot.startTime, {
    message: 'endTime debe ser posterior a startTime',
    path: ['endTime'],
  });

export type ScheduleSlot = z.output<typeof slotSchema>;

export const scheduleRuleSchema = z
  .object({
    /** Horario por día de clase. Si viene, es la fuente de verdad. */
    slots: z.array(slotSchema).min(1).max(7).optional(),
    /** Forma clásica: días ISO (1 = lunes … 7 = domingo) con el mismo horario. */
    weekdays: z.array(weekday).optional(),
    startTime: time.optional(),
    endTime: time.optional(),
    /** Fechas (CDMX) que se omiten sin reprogramar (recesos manuales, HU-29). */
    excludedDates: z
      .array(z.string().regex(DATE))
      .default([])
      .refine((d) => new Set(d).size === d.length, 'excludedDates no debe repetir fechas'),
    /** Omite también los festivos oficiales de México (precargados, HU-29). */
    excludeMexicanHolidays: z.boolean().default(false),
  })
  .superRefine((rule, ctx) => {
    if (rule.slots) {
      const days = rule.slots.map((s) => s.weekday);
      if (new Set(days).size !== days.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'slots no debe repetir días',
          path: ['slots'],
        });
      }
      return;
    }
    if (!rule.weekdays || rule.weekdays.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Elige al menos un día', path: ['weekdays'] });
    } else if (new Set(rule.weekdays).size !== rule.weekdays.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'weekdays no debe repetir días',
        path: ['weekdays'],
      });
    }
    if (!rule.startTime) {
      ctx.addIssue({ code: 'custom', message: 'Falta startTime', path: ['startTime'] });
    }
    if (!rule.endTime) {
      ctx.addIssue({ code: 'custom', message: 'Falta endTime', path: ['endTime'] });
    }
    if (isOrderedPair(rule.startTime, rule.endTime) && rule.endTime! <= rule.startTime!) {
      ctx.addIssue({
        code: 'custom',
        message: 'endTime debe ser posterior a startTime',
        path: ['endTime'],
      });
    }
  })
  .transform((rule) => {
    const slots = (
      rule.slots ??
      rule.weekdays!.map((day) => ({
        weekday: day,
        startTime: rule.startTime!,
        endTime: rule.endTime!,
      }))
    )
      .map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime }))
      .sort((a, b) => a.weekday - b.weekday);
    return {
      weekdays: slots.map((s) => s.weekday),
      startTime: slots[0].startTime,
      endTime: slots[0].endTime,
      slots,
      excludedDates: rule.excludedDates,
      excludeMexicanHolidays: rule.excludeMexicanHolidays,
    };
  });

export type ScheduleRule = z.output<typeof scheduleRuleSchema>;
export type ScheduleRuleInput = z.input<typeof scheduleRuleSchema>;

/** Valida y normaliza una regla (lanza ZodError si no es válida). */
export function parseScheduleRule(value: unknown): ScheduleRule {
  return scheduleRuleSchema.parse(value);
}

/** Igual que `parseScheduleRule` pero devuelve null si el JSON guardado no es válido. */
export function safeParseScheduleRule(value: unknown): ScheduleRule | null {
  if (value === null || value === undefined) return null;
  const result = scheduleRuleSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Horario del día ISO `weekday` en la regla (o null si ese día no hay clase). */
export function slotForWeekday(
  rule: Pick<ScheduleRule, 'slots'>,
  weekday: number,
): ScheduleSlot | null {
  return rule.slots.find((s) => s.weekday === weekday) ?? null;
}

/** true si todos los días de la regla tienen el mismo horario ("mismo horario todos los días"). */
export function hasUniformTimes(rule: Pick<ScheduleRule, 'slots'>): boolean {
  const [first, ...rest] = rule.slots;
  return rest.every((s) => s.startTime === first.startTime && s.endTime === first.endTime);
}

/** Minutos de una ocurrencia (endTime − startTime). */
export function ruleSlotMinutes(slot: Pick<ScheduleSlot, 'startTime' | 'endTime'>): number {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return toMinutes(slot.endTime) - toMinutes(slot.startTime);
}

/** Fecha (YYYY-MM-DD) de un instante en la zona oficial. */
export function cdmxDate(instant: Date, zone: string = OFFICIAL_TIMEZONE): string {
  return DateTime.fromJSDate(instant, { zone: 'utc' }).setZone(zone).toISODate()!;
}

/** Instantes UTC de inicio y fin de un horario (`startTime`/`endTime`) en una fecha CDMX dada. */
export function slotOnDate(
  date: string,
  slot: Pick<ScheduleSlot, 'startTime' | 'endTime'>,
  zone: string = OFFICIAL_TIMEZONE,
): { startsAt: Date; endsAt: Date } {
  const day = DateTime.fromISO(date, { zone });
  const at = (time: string) =>
    day
      .set({ hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) })
      .toUTC()
      .toJSDate();
  return { startsAt: at(slot.startTime), endsAt: at(slot.endTime) };
}

/**
 * Primera ocurrencia de la regla en o después de `from` (fecha CDMX), saltando fechas excluidas,
 * con el horario de su día. Con `onlyWeekday` busca solo ese día de la semana.
 * La usa el catálogo para dar los instantes UTC de referencia del horario (hora CDMX + local).
 */
export function firstOccurrence(
  rule: ScheduleRule,
  from: string,
  zone: string = OFFICIAL_TIMEZONE,
  onlyWeekday?: number,
): { date: string; startsAt: Date; endsAt: Date } | null {
  const excluded = new Set(rule.excludedDates);
  let day = DateTime.fromISO(from, { zone });
  if (!day.isValid) return null;
  for (let i = 0; i < 60; i++, day = day.plus({ days: 1 })) {
    if (onlyWeekday !== undefined && day.weekday !== onlyWeekday) continue;
    const slot = slotForWeekday(rule, day.weekday);
    const date = day.toISODate();
    if (slot && !excluded.has(date)) {
      return { date, ...slotOnDate(date, slot, zone) };
    }
  }
  return null;
}
