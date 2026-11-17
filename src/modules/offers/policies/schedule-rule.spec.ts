import {
  firstOccurrence,
  hasUniformTimes,
  parseScheduleRule,
  safeParseScheduleRule,
  scheduleRuleSchema,
  slotForWeekday,
} from './schedule-rule';

describe('scheduleRule: horario por día de clase', () => {
  it('normaliza la forma clásica (guardada antes) a slots con el mismo horario', () => {
    const rule = parseScheduleRule({ weekdays: [7, 6], startTime: '10:00', endTime: '13:00' });
    expect(rule).toEqual({
      weekdays: [6, 7],
      startTime: '10:00',
      endTime: '13:00',
      slots: [
        { weekday: 6, startTime: '10:00', endTime: '13:00' },
        { weekday: 7, startTime: '10:00', endTime: '13:00' },
      ],
      excludedDates: [],
      excludeMexicanHolidays: false,
    });
    expect(hasUniformTimes(rule)).toBe(true);
  });

  it('acepta un horario distinto por día y deriva los campos clásicos', () => {
    const rule = parseScheduleRule({
      slots: [
        { weekday: 4, startTime: '16:00', endTime: '18:00' },
        { weekday: 1, startTime: '10:00', endTime: '12:00' },
      ],
      excludedDates: ['2026-12-24'],
    });
    expect(rule.slots).toEqual([
      { weekday: 1, startTime: '10:00', endTime: '12:00' },
      { weekday: 4, startTime: '16:00', endTime: '18:00' },
    ]);
    expect(rule.weekdays).toEqual([1, 4]);
    expect(rule.startTime).toBe('10:00');
    expect(rule.endTime).toBe('12:00');
    expect(rule.excludedDates).toEqual(['2026-12-24']);
    expect(hasUniformTimes(rule)).toBe(false);
    expect(slotForWeekday(rule, 4)).toEqual({ weekday: 4, startTime: '16:00', endTime: '18:00' });
    expect(slotForWeekday(rule, 2)).toBeNull();
  });

  it('con slots, los campos clásicos que vengan se ignoran', () => {
    const rule = parseScheduleRule({
      weekdays: [6],
      startTime: '08:00',
      endTime: '09:00',
      slots: [{ weekday: 2, startTime: '18:00', endTime: '20:00' }],
    });
    expect(rule.weekdays).toEqual([2]);
    expect(rule.startTime).toBe('18:00');
  });

  it('la regla normalizada se vuelve a leer igual (idempotente)', () => {
    const rule = parseScheduleRule({
      slots: [
        { weekday: 1, startTime: '10:00', endTime: '12:00' },
        { weekday: 3, startTime: '17:30', endTime: '19:00' },
      ],
      excludeMexicanHolidays: true,
    });
    expect(parseScheduleRule(JSON.parse(JSON.stringify(rule)))).toEqual(rule);
  });

  it('rechaza slots con días repetidos, fin antes del inicio u horas mal escritas', () => {
    const issues = (value: unknown) => {
      const result = scheduleRuleSchema.safeParse(value);
      return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    };
    expect(
      issues({
        slots: [
          { weekday: 1, startTime: '10:00', endTime: '12:00' },
          { weekday: 1, startTime: '16:00', endTime: '18:00' },
        ],
      }),
    ).toEqual(['slots']);
    expect(
      issues({
        slots: [
          { weekday: 1, startTime: '10:00', endTime: '12:00' },
          { weekday: 4, startTime: '18:00', endTime: '16:00' },
        ],
      }),
    ).toEqual(['slots.1.endTime']);
    expect(issues({ slots: [{ weekday: 8, startTime: '10:00', endTime: '12:00' }] })).toEqual([
      'slots.0.weekday',
    ]);
    expect(issues({ slots: [{ weekday: 1, startTime: '9:00', endTime: '12:00' }] })).toEqual([
      'slots.0.startTime',
    ]);
    expect(issues({ slots: [] })).toEqual(['slots']);
    // Forma clásica: el error de horas conserva su ruta de siempre.
    expect(issues({ weekdays: [6], startTime: '13:00', endTime: '10:00' })).toEqual(['endTime']);
    expect(issues({ weekdays: [6] })).toEqual(['startTime', 'endTime']);
    expect(issues({})).toContain('weekdays');
  });

  it('safeParseScheduleRule devuelve null con JSON guardado inválido', () => {
    expect(safeParseScheduleRule({ slots: 'lunes' })).toBeNull();
    expect(safeParseScheduleRule(undefined)).toBeNull();
  });

  it('firstOccurrence usa el horario del día (y puede buscar un día concreto)', () => {
    const rule = parseScheduleRule({
      slots: [
        { weekday: 1, startTime: '10:00', endTime: '12:00' },
        { weekday: 4, startTime: '16:00', endTime: '18:00' },
      ],
      excludedDates: ['2026-11-12'],
    });
    // 2026-11-10 es martes → primera clase el jueves 12 (excluido) → lunes 16.
    expect(firstOccurrence(rule, '2026-11-10')).toMatchObject({ date: '2026-11-16' });
    const thursday = firstOccurrence(rule, '2026-11-10', undefined, 4);
    expect(thursday?.date).toBe('2026-11-19');
    // 16:00 CDMX = 22:00 UTC.
    expect(thursday?.startsAt.toISOString()).toBe('2026-11-19T22:00:00.000Z');
    expect(thursday?.endsAt.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });
});
