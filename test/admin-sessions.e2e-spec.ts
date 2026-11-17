import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDaysInZone, addHours } from '../src/common/utils/time';
import type { Prisma } from '../src/generated/prisma/client';
import { MAIL_DRIVER } from '../src/infra/mail/mail.types';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { StorageService } from '../src/infra/storage/storage.service';
import { createParticipant, createStaffUser, type TestUser } from './utils/admin';
import { createTestApp } from './utils/create-test-app';
import { FakeStorage } from './utils/fake-storage';
import { MailCapture } from './utils/mail-capture';

/**
 * Panel — sesiones, calendario y asistencia (Fase 06, HU-29 / HU-30): permisos por rol, generación
 * con vista previa (excluidas, conflictos, curso > 9 h), reprogramación/cancelación con aviso en la
 * zona de cada persona, grabación (HU-28), eventos manuales, asistencia manual, recordatorio, CSV y
 * auditoría.
 */
describe('Admin sesiones y asistencia (e2e) — Fase 06', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const mail = new MailCapture();
  const storage = new FakeStorage();

  const token = `ses${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const days = (n: number) => addDaysInZone(now, n);
  const ids: Record<string, string> = {};

  let coord: TestUser;
  let finance: TestUser;
  let ana: TestUser; // inscrita (zona America/Bogota)
  let beto: TestUser; // inscrito
  let outsider: TestUser; // sin inscripción

  const api = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const get = (path: string, u: TestUser) => api().get(`/api/v1${path}`).set(as(u));
  const post = (path: string, u: TestUser, body: object = {}) =>
    api().post(`/api/v1${path}`).set(as(u)).send(body);
  const patch = (path: string, u: TestUser, body: object = {}) =>
    api().patch(`/api/v1${path}`).set(as(u)).send(body);
  const del = (path: string, u: TestUser) => api().delete(`/api/v1${path}`).set(as(u));

  const offerData = (
    key: string,
    o: Partial<Prisma.OfferUncheckedCreateInput> = {},
  ): Prisma.OfferUncheckedCreateInput => ({
    slug: `e2e-${token}-${key}`,
    name: `${token} ${key}`,
    type: 'DIPLOMA',
    modality: 'ONLINE_LIVE',
    origin: 'NAS',
    publicationStatus: 'PUBLISHED',
    summary: 'Resumen',
    description: 'Descripción',
    learningOutcomes: [],
    // Diplomado de HU-29: sáb y dom 10:00–13:00 CDMX del 07/11/2026 al 31/01/2027.
    enrollmentOpensAt: new Date('2026-10-01T06:00:00.000Z'),
    enrollmentClosesAt: new Date('2026-11-06T06:00:00.000Z'),
    startsAt: new Date('2026-11-07T16:00:00.000Z'),
    endsAt: new Date('2027-01-31T19:00:00.000Z'),
    finalProjectDueAt: new Date('2027-01-30T16:00:00.000Z'),
    totalMinutes: 3600,
    scheduleRule: {
      weekdays: [6, 7],
      startTime: '10:00',
      endTime: '13:00',
      excludedDates: [],
      excludeMexicanHolidays: true,
    },
    ...o,
  });

  const notificationsOf = (userId: string, type: string) =>
    prisma.notification.findMany({ where: { userId, type: type as never } });

  beforeAll(async () => {
    app = await createTestApp({
      customize: (b) =>
        b
          .overrideProvider(MAIL_DRIVER)
          .useValue(mail)
          .overrideProvider(StorageService)
          .useValue(storage),
    });
    prisma = app.get(PrismaService);
    coord = await createStaffUser(app, mail, ['ACADEMIC_COORDINATOR']);
    finance = await createStaffUser(app, mail, ['FINANCE']);
    ana = await createParticipant(app, mail, { timezone: 'America/Bogota' });
    beto = await createParticipant(app, mail, { timezone: 'America/Mexico_City' });
    outsider = await createParticipant(app, mail);

    ids.diploma = (await prisma.offer.create({ data: offerData('diploma') })).id;
    ids.course = (
      await prisma.offer.create({
        data: offerData('course', {
          type: 'COURSE',
          totalMinutes: 540,
          startsAt: new Date('2026-11-05T00:00:00.000Z'),
          endsAt: new Date('2026-12-04T03:00:00.000Z'),
          finalProjectDueAt: null,
          // jue 18:00–21:00 → 5 jueves = 15 h > 9 h.
          scheduleRule: { weekdays: [4], startTime: '18:00', endTime: '21:00' },
        }),
      })
    ).id;
    ids.module1 = (
      await prisma.offerModule.create({
        data: { offerId: ids.diploma, position: 1, title: 'Módulo A' },
      })
    ).id;
    await prisma.offerModule.create({
      data: { offerId: ids.diploma, position: 2, title: 'Módulo B' },
    });
    for (const u of [ana, beto]) {
      await prisma.enrollment.create({
        data: {
          userId: u.id,
          offerId: ids.diploma,
          status: 'ACTIVE',
          source: 'MANUAL',
          activatedAt: now,
        },
      });
    }
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  describe('permisos', () => {
    it('participante → 403 en todo /admin; FINANCE solo consulta sesiones', async () => {
      await get(`/admin/offers/${ids.diploma}/sessions`, ana).expect(403);
      await get(`/admin/offers/${ids.diploma}/sessions`, finance).expect(200);
      const res = await post(`/admin/offers/${ids.diploma}/sessions/preview`, finance).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.meta.missingPermissions).toEqual(['offers.write']);
      await get(`/admin/offers/${ids.diploma}/attendance/sessions`, finance).expect(403);
      await post('/admin/calendar-events', finance, {}).expect(403);
    });

    it('sin token → 401; id mal formado → 404', async () => {
      await api().get(`/api/v1/admin/offers/${ids.diploma}/sessions`).expect(401);
      await get('/admin/sessions/no-es-uuid', coord).expect(404);
    });
  });

  describe('HU-29: generación de sesiones', () => {
    const body = {
      rule: {
        weekdays: [6, 7],
        startTime: '10:00',
        endTime: '13:00',
        excludedDates: ['2026-12-26', '2026-12-27'],
        excludeMexicanHolidays: true,
      },
      joinUrl: 'https://us02web.zoom.us/j/123456?pwd=x',
      hostUrl: 'https://us02web.zoom.us/s/123456',
      importantDates: ['OFFER_STARTS', 'FINAL_PROJECT'],
    };

    it('vista previa: excluidas, módulos, resumen y fechas importantes (sin guardar)', async () => {
      const res = await post(`/admin/offers/${ids.diploma}/sessions/preview`, coord, body).expect(
        200,
      );
      const excluded = res.body.items.filter((i: { status: string }) => i.status === 'EXCLUDED');
      expect(excluded.map((i: { date: string }) => i.date)).toEqual(['2026-12-26', '2026-12-27']);
      expect(excluded[0].exclusionReason).toBe('MANUAL');
      expect(res.body.summary).toMatchObject({ excludedCount: 2, conflictCount: 0 });
      expect(res.body.summary.label).toMatch(/sesiones · .* h · 2 excluidas/);
      expect(res.body.canConfirm).toBe(true);
      expect(res.body.items[0]).toMatchObject({ date: '2026-11-07', status: 'NEW' });
      expect(res.body.items[0].module.number).toBe(1);
      expect(res.body.importantDates.map((d: { kind: string }) => d.kind).sort()).toEqual([
        'FINAL_PROJECT',
        'OFFER_STARTS',
      ]);
      expect(await prisma.offerSession.count({ where: { offerId: ids.diploma } })).toBe(0);
    });

    it('vista previa con horario distinto por día (sáb 10–13, dom 09–11)', async () => {
      const res = await post(`/admin/offers/${ids.diploma}/sessions/preview`, coord, {
        ...body,
        rule: {
          slots: [
            { weekday: 6, startTime: '10:00', endTime: '13:00' },
            { weekday: 7, startTime: '09:00', endTime: '11:00' },
          ],
          excludeMexicanHolidays: true,
        },
      }).expect(200);
      const [sat, sun] = res.body.items;
      // CDMX = UTC−6.
      expect(sat).toMatchObject({
        date: '2026-11-07',
        startsAt: '2026-11-07T16:00:00.000Z',
        endsAt: '2026-11-07T19:00:00.000Z',
      });
      expect(sun).toMatchObject({
        date: '2026-11-08',
        startsAt: '2026-11-08T15:00:00.000Z',
        endsAt: '2026-11-08T17:00:00.000Z',
      });
      expect(await prisma.offerSession.count({ where: { offerId: ids.diploma } })).toBe(0);
    });

    it('enlace que no es zoom/meet → 400 INVALID_MEETING_URL', async () => {
      const res = await post(`/admin/offers/${ids.diploma}/sessions/preview`, coord, {
        ...body,
        joinUrl: 'https://teams.microsoft.com/l/x',
      }).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'joinUrl', code: 'INVALID_MEETING_URL' });
    });

    it('rango fuera del periodo de la oferta → 400', async () => {
      const res = await post(`/admin/offers/${ids.diploma}/sessions/preview`, coord, {
        startDate: '2026-10-01',
      }).expect(400);
      expect(res.body.details[0].field).toBe('startDate');
    });

    it('curso mayor a 9 h: "Crear sesiones" deshabilitado y generate → 422', async () => {
      const preview = await post(`/admin/offers/${ids.course}/sessions/preview`, coord, {}).expect(
        200,
      );
      expect(preview.body.canConfirm).toBe(false);
      expect(preview.body.violations).toEqual(['COURSE_MAX_HOURS_EXCEEDED']);
      expect(preview.body.blockedReason).toBe('Los cursos tienen una duración máxima de 9 horas.');
      const res = await post(`/admin/offers/${ids.course}/sessions/generate`, coord, {}).expect(
        422,
      );
      expect(res.body.code).toBe('SESSION_GENERATION_BLOCKED');
      expect(res.body.meta.violations).toEqual(['COURSE_MAX_HOURS_EXCEEDED']);
      expect(await prisma.offerSession.count({ where: { offerId: ids.course } })).toBe(0);
    });

    it('confirmar crea todas las sesiones, la regla y las fechas importantes; auditoría', async () => {
      const preview = await post(`/admin/offers/${ids.diploma}/sessions/preview`, coord, body);
      const res = await post(`/admin/offers/${ids.diploma}/sessions/generate`, coord, body).expect(
        201,
      );
      const expected = preview.body.summary.sessionCount as number;
      expect(res.body.createdSessions).toBe(expected);
      expect(res.body.importantDates).toBe(2);
      expect(res.body.message).toBe(`Se crearon ${expected} sesiones y 2 fechas importantes`);
      const first = res.body.sessions[0];
      expect(first).toMatchObject({
        joinUrl: body.joinUrl,
        hostUrl: body.hostUrl,
        category: 'TRAINING',
        state: 'SCHEDULED',
      });
      expect(first.attendance).toEqual({ registered: 0, enrolled: 2 });
      const offer = await prisma.offer.findUniqueOrThrow({ where: { id: ids.diploma } });
      expect((offer.scheduleRule as { excludedDates: string[] }).excludedDates).toContain(
        '2026-12-26',
      );
      expect(
        await prisma.calendarEvent.count({
          where: { offerId: ids.diploma, kind: { in: ['OFFER_STARTS', 'FINAL_PROJECT'] } },
        }),
      ).toBe(2);
      const audit = await prisma.adminAuditLog.findFirst({
        where: { action: 'session.generate', entityId: ids.diploma },
      });
      expect(audit).toMatchObject({ actorId: coord.id, entityType: 'Offer' });
    });

    it('volver a generar: todo en conflicto → bloqueado; fechas importantes se actualizan (no duplican)', async () => {
      const preview = await post(
        `/admin/offers/${ids.diploma}/sessions/preview`,
        coord,
        body,
      ).expect(200);
      expect(preview.body.summary.conflictCount).toBeGreaterThan(0);
      expect(preview.body.canConfirm).toBe(false);
      expect(preview.body.importantDates.every((d: { exists: boolean }) => d.exists)).toBe(true);
      await post(`/admin/offers/${ids.diploma}/sessions/generate`, coord, body).expect(422);
    });
  });

  describe('HU-29: edición, reprogramación y cancelación', () => {
    let sessionId: string;
    let secondId: string;

    beforeAll(async () => {
      const sessions = await prisma.offerSession.findMany({
        where: { offerId: ids.diploma },
        orderBy: { startsAt: 'asc' },
      });
      sessionId = sessions[2].id;
      secondId = sessions[3].id;
    });

    it('reprogramar avisa con la hora de cada persona y CDMX; guarda hora original', async () => {
      const original = await prisma.offerSession.findUniqueOrThrow({ where: { id: sessionId } });
      const startsAt = addHours(original.startsAt, 24 * 3);
      const res = await post(`/admin/sessions/${sessionId}/reschedule`, coord, {
        startsAt: startsAt.toISOString(),
        endsAt: addHours(startsAt, 3).toISOString(),
        reason: 'La docente no puede ese día.',
      }).expect(200);
      expect(res.body.notifiedCount).toBe(2);
      expect(res.body.session.originalStartsAt).toBe(original.startsAt.toISOString());
      expect(res.body.session.flags.edited).toBe(true);
      const [anaNote] = await notificationsOf(ana.id, 'SESSION_RESCHEDULED');
      expect(anaNote.body).toContain('(tu hora)');
      expect(anaNote.body).toContain('hora CDMX');
      expect(anaNote.body).toContain('La docente no puede ese día.');
      const [betoNote] = await notificationsOf(beto.id, 'SESSION_RESCHEDULED');
      expect(betoNote.body).not.toContain('(tu hora)');
      expect(await notificationsOf(outsider.id, 'SESSION_RESCHEDULED')).toHaveLength(0);
    });

    it('reprogramar encima de otra sesión → 409 SESSION_CONFLICT; sin motivo → 400', async () => {
      const other = await prisma.offerSession.findUniqueOrThrow({ where: { id: secondId } });
      const res = await post(`/admin/sessions/${sessionId}/reschedule`, coord, {
        startsAt: other.startsAt.toISOString(),
        endsAt: other.endsAt.toISOString(),
        reason: 'Choque',
      }).expect(409);
      expect(res.body.code).toBe('SESSION_CONFLICT');
      await post(`/admin/sessions/${sessionId}/reschedule`, coord, {
        startsAt: other.startsAt.toISOString(),
        endsAt: other.endsAt.toISOString(),
      }).expect(400);
    });

    it('grabación (HU-28): publica y notifica una sola vez', async () => {
      const first = await patch(`/admin/sessions/${secondId}`, coord, {
        recordingUrl: 'https://youtu.be/abc123',
      }).expect(200);
      expect(first.body.notifiedCount).toBe(2);
      expect(first.body.session.recordingPublishedAt).not.toBeNull();
      const again = await patch(`/admin/sessions/${secondId}`, coord, {
        recordingUrl: 'https://youtu.be/otro',
      }).expect(200);
      expect(again.body.notifiedCount).toBe(0);
      expect(await notificationsOf(ana.id, 'RECORDING_PUBLISHED')).toHaveLength(1);
      await patch(`/admin/sessions/${secondId}`, coord, { recordingUrl: 'http://x' }).expect(400);
    });

    it('cancelar con motivo avisa; repetir → 422 SESSION_CANCELLED', async () => {
      const res = await post(`/admin/sessions/${secondId}/cancel`, coord, {
        reason: 'Suspensión por lluvias',
      }).expect(200);
      expect(res.body.session).toMatchObject({ status: 'CANCELLED', state: 'CANCELLED' });
      expect(res.body.notifiedCount).toBe(2);
      expect((await notificationsOf(beto.id, 'SESSION_CANCELLED'))[0].body).toContain(
        'Suspensión por lluvias',
      );
      const again = await post(`/admin/sessions/${secondId}/cancel`, coord, { reason: 'Otra vez' });
      expect(again.status).toBe(422);
      expect(again.body.code).toBe('SESSION_CANCELLED');
      const logs = await prisma.adminAuditLog.findMany({
        where: { entityId: { in: [sessionId, secondId] } },
        select: { action: true },
      });
      expect(logs.map((l) => l.action)).toEqual(
        expect.arrayContaining([
          'session.reschedule',
          'session.publish-recording',
          'session.cancel',
        ]),
      );
    });

    it('listado del panel incluye hostUrl y banderas', async () => {
      const res = await get(`/admin/offers/${ids.diploma}/sessions`, coord).expect(200);
      const cancelled = res.body.data.find((s: { id: string }) => s.id === secondId);
      expect(cancelled.flags.cancelled).toBe(true);
      expect(res.body.data[0].hostUrl).toMatch(/zoom\.us/);
    });
  });

  describe('HU-30: asistencia', () => {
    let pastId: string; // terminó hace 1 h: registro abierto
    let cancelledId: string;

    beforeAll(async () => {
      const startsAt = addHours(now, -4);
      const res = await post(`/admin/offers/${ids.diploma}/sessions`, coord, {
        startsAt: startsAt.toISOString(),
        endsAt: addHours(startsAt, 3).toISOString(),
        moduleId: ids.module1,
        joinUrl: 'https://meet.google.com/abc-defg-hij',
      }).expect(201);
      pastId = res.body.id;
      const c = await prisma.offerSession.create({
        data: {
          offerId: ids.diploma,
          startsAt: days(-3),
          endsAt: addHours(days(-3), 2),
          status: 'CANCELLED',
        },
      });
      cancelledId = c.id;
    });

    it('marcar manual con motivo (origen MANUAL, quién y motivo)', async () => {
      const res = await post(`/admin/sessions/${pastId}/attendance/mark`, coord, {
        userIds: [ana.id],
        reason: 'Pasó lista en sitio',
      }).expect(200);
      expect(res.body).toEqual({ marked: 1, alreadyRegistered: 0 });
      const again = await post(`/admin/sessions/${pastId}/attendance/mark`, coord, {
        userIds: [ana.id],
        reason: 'Pasó lista en sitio',
      }).expect(200);
      expect(again.body).toEqual({ marked: 0, alreadyRegistered: 1 });
      const record = await prisma.sessionAttendance.findFirstOrThrow({
        where: { sessionId: pastId, userId: ana.id },
      });
      expect(record).toMatchObject({
        source: 'MANUAL',
        recordedById: coord.id,
        manualReason: 'Pasó lista en sitio',
      });
    });

    it('sin inscripción → 422 ATTENDANCE_NOT_ENROLLED; cancelada → 422 SESSION_CANCELLED; sin motivo → 400', async () => {
      const res = await post(`/admin/sessions/${pastId}/attendance/mark`, coord, {
        userIds: [outsider.id],
        reason: 'x y z',
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'ATTENDANCE_NOT_ENROLLED',
        meta: { userIds: [outsider.id] },
      });
      const c = await post(`/admin/sessions/${cancelledId}/attendance/mark`, coord, {
        userIds: [ana.id],
        reason: 'x y z',
      }).expect(422);
      expect(c.body.code).toBe('SESSION_CANCELLED');
      await post(`/admin/sessions/${pastId}/attendance/mark`, coord, { userIds: [ana.id] }).expect(
        400,
      );
    });

    it('"Por sesión": filas, resumen y filtros', async () => {
      const res = await get(`/admin/sessions/${pastId}/attendance`, coord).expect(200);
      expect(res.body.summary).toEqual({
        registered: 1,
        total: 2,
        percent: 50,
        label: '1 de 2 registraron asistencia (50%)',
      });
      expect(res.body.session.state).toBe('REGISTRATION_OPEN');
      const anaRow = res.body.rows.find((r: { userId: string }) => r.userId === ana.id);
      expect(anaRow).toMatchObject({
        status: 'REGISTERED',
        source: 'MANUAL',
        manualReason: 'Pasó lista en sitio',
      });
      expect(anaRow.recordedBy.id).toBe(coord.id);
      const pending = await get(
        `/admin/sessions/${pastId}/attendance?status=PENDING`,
        coord,
      ).expect(200);
      expect(pending.body.rows.map((r: { userId: string }) => r.userId)).toEqual([beto.id]);
    });

    it('chips y "Por participante" (% sobre sesiones realizadas, sin canceladas)', async () => {
      const chips = await get(`/admin/offers/${ids.diploma}/attendance/sessions`, coord).expect(
        200,
      );
      const chip = chips.body.data.find((c: { sessionId: string }) => c.sessionId === pastId);
      expect(chip).toMatchObject({
        state: 'REGISTRATION_OPEN',
        registered: 1,
        total: 2,
        percent: 50,
      });
      expect(
        chips.body.data.find((c: { sessionId: string }) => c.sessionId === cancelledId).state,
      ).toBe('CANCELLED');
      const res = await get(`/admin/offers/${ids.diploma}/attendance/participants`, coord).expect(
        200,
      );
      expect(res.body.heldSessions).toBe(1);
      const anaRow = res.body.rows.find((r: { userId: string }) => r.userId === ana.id);
      expect(anaRow).toMatchObject({
        attended: 1,
        heldSessions: 1,
        percent: 100,
        belowThreshold: false,
      });
      const below = await get(
        `/admin/offers/${ids.diploma}/attendance/participants?belowThreshold=true`,
        coord,
      ).expect(200);
      expect(below.body.rows.map((r: { userId: string }) => r.userId)).toEqual([beto.id]);
    });

    it('exportar CSV (respeta filtros)', async () => {
      const res = await get(
        `/admin/sessions/${pastId}/attendance/export?status=REGISTERED`,
        coord,
      ).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(
        /attachment; filename="asistencia-sesion-/,
      );
      const text = res.text;
      expect(text.startsWith('﻿Nombre,Correo')).toBe(true);
      expect(text).toContain(ana.email);
      expect(text).not.toContain(beto.email);
      const byPerson = await get(`/admin/offers/${ids.diploma}/attendance/export`, coord).expect(
        200,
      );
      expect(byPerson.text).toContain('% asistencia');
    });

    it('"Recordar a pendientes": solo pendientes, máx. uno por día', async () => {
      const res = await post(`/admin/sessions/${pastId}/attendance/remind`, coord).expect(200);
      expect(res.body.notified).toBe(1);
      expect(await notificationsOf(beto.id, 'ATTENDANCE_OPEN')).toHaveLength(1);
      const again = await post(`/admin/sessions/${pastId}/attendance/remind`, coord).expect(200);
      expect(again.body.notified).toBe(0);
      const c = await post(`/admin/sessions/${cancelledId}/attendance/remind`, coord).expect(422);
      expect(c.body.code).toBe('SESSION_CANCELLED');
    });

    it('desmarcar con motivo; borrar sesión con asistencia → 409', async () => {
      await post(`/admin/sessions/${pastId}/attendance/mark`, coord, {
        userIds: [beto.id],
        reason: 'Corrección',
      }).expect(200);
      const del409 = await del(`/admin/sessions/${pastId}`, coord).expect(409);
      expect(del409.body.code).toBe('SESSION_HAS_ATTENDANCE');
      const res = await post(`/admin/sessions/${pastId}/attendance/unmark`, coord, {
        userIds: [beto.id],
        reason: 'Marcada por error',
      }).expect(200);
      expect(res.body.unmarked).toBe(1);
      const actions = await prisma.adminAuditLog.findMany({
        where: { entityId: pastId },
        select: { action: true },
      });
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'session.create',
          'attendance.mark',
          'attendance.unmark',
          'attendance.remind',
        ]),
      );
      await del(`/admin/sessions/${cancelledId}`, coord).expect(204);
    });

    it('participante no puede marcar (403)', async () => {
      await post(`/admin/sessions/${pastId}/attendance/mark`, ana, {
        userIds: [ana.id],
        reason: 'yo mismo',
      }).expect(403);
    });
  });

  describe('HU-29: calendario y "+ Evento manual"', () => {
    let eventId: string;

    it('OFFER_ENROLLED sin oferta → 400; crear webinar → 201 (categoría Eventos por defecto)', async () => {
      const bad = await post('/admin/calendar-events', coord, {
        title: 'Webinar',
        audience: 'OFFER_ENROLLED',
        startsAt: '2026-11-20T00:00:00.000Z',
      }).expect(400);
      expect(bad.body.details[0]).toMatchObject({ field: 'offerId', code: 'REQUIRED' });
      const res = await post('/admin/calendar-events', coord, {
        title: `Webinar ${token}`,
        audience: 'OFFER_ENROLLED',
        offerId: ids.diploma,
        startsAt: '2026-11-20T00:00:00.000Z',
        endsAt: '2026-11-20T01:30:00.000Z',
        joinUrl: 'https://zoom.us/j/1',
      }).expect(201);
      expect(res.body).toMatchObject({
        kind: 'MANUAL',
        category: 'EVENTS',
        audience: 'OFFER_ENROLLED',
      });
      eventId = res.body.id;
    });

    it('el evento aparece en el calendario de la inscrita (HU-10) y en el del panel', async () => {
      const portal = await get(
        '/me/calendar?from=2026-11-15T00:00:00.000Z&to=2026-11-25T00:00:00.000Z',
        ana,
      ).expect(200);
      expect(JSON.stringify(portal.body)).toContain(`Webinar ${token}`);
      const panel = await get(
        `/admin/calendar?from=2026-11-01T00:00:00.000Z&to=2026-11-30T00:00:00.000Z&offerId=${ids.diploma}`,
        coord,
      ).expect(200);
      const sources = new Set(panel.body.data.map((i: { source: string }) => i.source));
      expect(sources).toEqual(new Set(['SESSION', 'EVENT']));
      await get(
        '/admin/calendar?from=2026-01-01T00:00:00.000Z&to=2026-06-01T00:00:00.000Z',
        coord,
      ).expect(400);
    });

    it('editar, cancelar, listar y borrar (auditoría)', async () => {
      await patch(`/admin/calendar-events/${eventId}`, coord, {
        title: `Webinar ${token} v2`,
      }).expect(200);
      const c = await post(`/admin/calendar-events/${eventId}/cancel`, coord).expect(200);
      expect(c.body.status).toBe('CANCELLED');
      await post(`/admin/calendar-events/${eventId}/cancel`, coord).expect(409);
      const list = await get(
        `/admin/calendar-events?offerId=${ids.diploma}&kind=MANUAL`,
        coord,
      ).expect(200);
      expect(list.body.meta.total).toBe(1);
      await del(`/admin/calendar-events/${eventId}`, coord).expect(204);
      const actions = await prisma.adminAuditLog.findMany({
        where: { entityId: eventId },
        select: { action: true },
      });
      expect(actions.map((a) => a.action).sort()).toEqual([
        'calendar-event.cancel',
        'calendar-event.create',
        'calendar-event.delete',
        'calendar-event.update',
      ]);
    });
  });
});
