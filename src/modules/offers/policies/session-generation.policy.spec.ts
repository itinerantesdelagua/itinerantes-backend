import { parseScheduleRule, ruleSlotMinutes, safeParseScheduleRule } from './schedule-rule';
import {
  distributeAcrossModules,
  generateSessions,
  mexicanFederalHolidays,
  validateOfferHours,
} from './session-generation.policy';

/** Receso de fin de año del diplomado demo (6 fechas). */
const WINTER_BREAK = [
  '2026-12-19',
  '2026-12-20',
  '2026-12-26',
  '2026-12-27',
  '2027-01-02',
  '2027-01-03',
];

describe('generateSessions (HU-29)', () => {
  const diplomaRule = parseScheduleRule({
    weekdays: [6, 7],
    startTime: '10:00',
    endTime: '13:00',
    excludedDates: WINTER_BREAK,
  });

  it('Diplomado sáb y dom 10:00–13:00 CDMX del 07/11/2026 al 31/01/2027 → 20 sesiones · 60 h', () => {
    const result = generateSessions({
      rule: diplomaRule,
      startDate: '2026-11-07',
      endDate: '2027-01-31',
      moduleCount: 9,
    });
    expect(result.items).toHaveLength(26);
    expect(result.excludedCount).toBe(6);
    expect(result.sessionCount).toBe(20);
    expect(result.totalMinutes).toBe(60 * 60);
    expect(validateOfferHours('DIPLOMA', result.totalMinutes)).toEqual([]);

    const first = result.sessions[0];
    expect(first.date).toBe('2026-11-07');
    // CDMX = UTC−6 todo el año.
    expect(first.startsAt.toISOString()).toBe('2026-11-07T16:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2026-11-07T19:00:00.000Z');
    expect(result.sessions.at(-1)?.date).toBe('2027-01-31');
    expect(result.sessions.map((s) => s.date)).not.toContain('2026-12-19');

    // Reparto en 9 módulos, en orden.
    expect(result.sessions.map((s) => s.moduleIndex)).toEqual(distributeAcrossModules(20, 9));
    expect(result.sessions[0].moduleIndex).toBe(0);
    expect(result.sessions.at(-1)?.moduleIndex).toBe(8);
  });

  it('marca exclusiones manuales y festivos de México', () => {
    const rule = parseScheduleRule({
      weekdays: [1],
      startTime: '18:00',
      endTime: '20:00',
      excludedDates: ['2026-11-09'],
      excludeMexicanHolidays: true,
    });
    const result = generateSessions({ rule, startDate: '2026-11-01', endDate: '2026-11-30' });
    const byDate = Object.fromEntries(result.items.map((i) => [i.date, i]));
    expect(byDate['2026-11-09']).toMatchObject({ status: 'EXCLUDED', exclusionReason: 'MANUAL' });
    // Tercer lunes de noviembre de 2026 (Revolución).
    expect(byDate['2026-11-16']).toMatchObject({
      status: 'EXCLUDED',
      exclusionReason: 'MX_HOLIDAY',
    });
    expect(result.sessionCount).toBe(3);
    expect(result.totalMinutes).toBe(3 * 120);
  });

  it('marca conflictos con sesiones existentes y no las cuenta', () => {
    const rule = parseScheduleRule({ weekdays: [4], startTime: '18:00', endTime: '21:00' });
    const existing = [
      { startsAt: new Date('2026-11-05T01:00:00Z'), endsAt: new Date('2026-11-05T02:00:00Z') },
    ];
    // Jueves 2026-11-05 18:00 CDMX = 2026-11-06T00:00Z → no choca; el 2026-11-04 (mié) no aplica.
    const clash = [
      { startsAt: new Date('2026-11-06T01:00:00Z'), endsAt: new Date('2026-11-06T02:00:00Z') },
    ];
    expect(
      generateSessions({ rule, startDate: '2026-11-05', endDate: '2026-11-05', existing })
        .conflictCount,
    ).toBe(0);
    const result = generateSessions({
      rule,
      startDate: '2026-11-05',
      endDate: '2026-11-19',
      existing: clash,
    });
    expect(result.conflictCount).toBe(1);
    expect(result.sessionCount).toBe(2);
  });

  it('curso jueves 18:00–21:00 durante 3 semanas = 9 h (máximo permitido)', () => {
    const rule = parseScheduleRule({ weekdays: [4], startTime: '18:00', endTime: '21:00' });
    const ok = generateSessions({ rule, startDate: '2026-11-05', endDate: '2026-11-19' });
    expect(ok.totalMinutes).toBe(9 * 60);
    expect(validateOfferHours('COURSE', ok.totalMinutes)).toEqual([]);
    const tooLong = generateSessions({ rule, startDate: '2026-11-05', endDate: '2026-11-26' });
    expect(validateOfferHours('COURSE', tooLong.totalMinutes)).toEqual([
      'COURSE_MAX_HOURS_EXCEEDED',
    ]);
    expect(validateOfferHours('DIPLOMA', 58 * 60)).toEqual(['DIPLOMA_HOURS_MISMATCH']);
  });

  it('horario distinto por día: lun 10:00–12:00 y jue 16:00–18:00', () => {
    const rule = parseScheduleRule({
      slots: [
        { weekday: 1, startTime: '10:00', endTime: '12:00' },
        { weekday: 4, startTime: '16:00', endTime: '18:30' },
      ],
    });
    // Del lunes 2026-11-02 al jueves 2026-11-12: lun 2, jue 5, lun 9, jue 12.
    const result = generateSessions({ rule, startDate: '2026-11-02', endDate: '2026-11-12' });
    expect(
      result.sessions.map((s) => [s.date, s.startsAt.toISOString(), s.endsAt.toISOString()]),
    ).toEqual([
      ['2026-11-02', '2026-11-02T16:00:00.000Z', '2026-11-02T18:00:00.000Z'],
      ['2026-11-05', '2026-11-05T22:00:00.000Z', '2026-11-06T00:30:00.000Z'],
      ['2026-11-09', '2026-11-09T16:00:00.000Z', '2026-11-09T18:00:00.000Z'],
      ['2026-11-12', '2026-11-12T22:00:00.000Z', '2026-11-13T00:30:00.000Z'],
    ]);
    // 2 × 120 min + 2 × 150 min.
    expect(result.totalMinutes).toBe(2 * 120 + 2 * 150);
  });

  it('horario por día: exclusiones y conflictos usan el horario de ese día', () => {
    const rule = parseScheduleRule({
      slots: [
        { weekday: 1, startTime: '10:00', endTime: '12:00' },
        { weekday: 4, startTime: '16:00', endTime: '18:00' },
      ],
      excludedDates: ['2026-11-09'],
    });
    // Sesión manual el jueves 5 de 17:00 a 17:30 CDMX: choca solo con el horario del jueves.
    const existing = [
      { startsAt: new Date('2026-11-05T23:00:00Z'), endsAt: new Date('2026-11-05T23:30:00Z') },
    ];
    const result = generateSessions({
      rule,
      startDate: '2026-11-02',
      endDate: '2026-11-12',
      existing,
    });
    const byDate = Object.fromEntries(result.items.map((i) => [i.date, i]));
    expect(byDate['2026-11-05'].status).toBe('CONFLICT');
    expect(byDate['2026-11-09']).toMatchObject({
      status: 'EXCLUDED',
      exclusionReason: 'MANUAL',
      startsAt: new Date('2026-11-09T16:00:00Z'),
    });
    expect(result.sessions.map((s) => s.date)).toEqual(['2026-11-02', '2026-11-12']);
    expect(result.totalMinutes).toBe(2 * 120);
  });

  it('una regla antigua (sin slots) genera lo mismo que antes', () => {
    const legacy = { weekdays: [6, 7], startTime: '10:00', endTime: '13:00' };
    const result = generateSessions({
      rule: parseScheduleRule(legacy),
      startDate: '2026-11-07',
      endDate: '2026-11-15',
    });
    expect(result.sessions.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-11-07T16:00:00.000Z',
      '2026-11-08T16:00:00.000Z',
      '2026-11-14T16:00:00.000Z',
      '2026-11-15T16:00:00.000Z',
    ]);
    expect(result.totalMinutes).toBe(4 * 180);
  });

  it('rechaza rangos inválidos', () => {
    expect(() =>
      generateSessions({ rule: diplomaRule, startDate: '2027-01-01', endDate: '2026-01-01' }),
    ).toThrow();
  });
});

describe('mexicanFederalHolidays', () => {
  it('2026 y año de transmisión del Poder Ejecutivo (2030)', () => {
    expect(mexicanFederalHolidays(2026)).toEqual([
      '2026-01-01',
      '2026-02-02',
      '2026-03-16',
      '2026-05-01',
      '2026-09-16',
      '2026-11-16',
      '2026-12-25',
    ]);
    expect(mexicanFederalHolidays(2030)).toContain('2030-10-01');
    expect(mexicanFederalHolidays(2027)).not.toContain('2027-10-01');
  });
});

describe('scheduleRule', () => {
  it('valida horas y días', () => {
    expect(() =>
      parseScheduleRule({ weekdays: [], startTime: '10:00', endTime: '13:00' }),
    ).toThrow();
    expect(() =>
      parseScheduleRule({ weekdays: [8], startTime: '10:00', endTime: '13:00' }),
    ).toThrow();
    expect(() =>
      parseScheduleRule({ weekdays: [6], startTime: '13:00', endTime: '10:00' }),
    ).toThrow();
    expect(() =>
      parseScheduleRule({ weekdays: [6, 6], startTime: '10:00', endTime: '13:00' }),
    ).toThrow();
    expect(safeParseScheduleRule({ foo: 1 })).toBeNull();
    expect(safeParseScheduleRule(null)).toBeNull();
    expect(ruleSlotMinutes({ startTime: '10:00', endTime: '13:30' })).toBe(210);
  });

  it('distributeAcrossModules', () => {
    expect(distributeAcrossModules(5, 2)).toEqual([0, 0, 0, 1, 1]);
    expect(distributeAcrossModules(3, 0)).toEqual([]);
  });
});
