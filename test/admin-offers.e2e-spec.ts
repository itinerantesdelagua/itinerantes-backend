import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDaysInZone } from '../src/common/utils/time';
import { MAIL_DRIVER } from '../src/infra/mail/mail.types';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { StorageService } from '../src/infra/storage/storage.service';
import { AdminContentService } from '../src/modules/offers/admin/admin-content.service';
import { createParticipant, createStaffUser, type TestUser } from './utils/admin';
import { createTestApp } from './utils/create-test-app';
import { FakeStorage } from './utils/fake-storage';
import { MailCapture } from './utils/mail-capture';
import { scholarshipTypeIds } from './utils/scholarship-types';

/**
 * Panel — ofertas y contenido (Fase 06): HU-27 (asistente de 7 pasos, publicar, duplicar, docentes,
 * imágenes), HU-28 (módulos y recursos, notificación al publicar, publicación programada) y Moodle
 * (lista de correos y códigos). Permisos por rol y auditoría.
 */
describe('Admin — ofertas y contenido (e2e) — Fase 06', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const mail = new MailCapture();
  const storage = new FakeStorage();
  const token = `ao${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const days = (n: number) => addDaysInZone(now, n);

  let coord: TestUser;
  let finance: TestUser;
  let committee: TestUser;
  let participant: TestUser;
  let types: Record<string, string>;

  const api = () => request(app.getHttpServer());
  const as = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });
  const get = (path: string, u: TestUser) => api().get(`/api/v1${path}`).set(as(u));
  const post = (path: string, u: TestUser, body: object = {}) =>
    api().post(`/api/v1${path}`).set(as(u)).send(body);
  const patch = (path: string, u: TestUser, body: object = {}) =>
    api().patch(`/api/v1${path}`).set(as(u)).send(body);
  const put = (path: string, u: TestUser, body: object = {}) =>
    api().put(`/api/v1${path}`).set(as(u)).send(body);
  const del = (path: string, u: TestUser) => api().delete(`/api/v1${path}`).set(as(u));

  const audits = (entityId: string) =>
    prisma.adminAuditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'asc' } });

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
    committee = await createStaffUser(app, mail, ['REVIEW_COMMITTEE']);
    participant = await createParticipant(app, mail);
    types = await scholarshipTypeIds(prisma);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  describe('Permisos', () => {
    it('participante → 403 en todo /admin/offers', async () => {
      const res = await get('/admin/offers', participant).expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.meta.missingPermissions).toEqual(['offers.read']);
      await post('/admin/offers', participant, {
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        name: `${token} x`,
      }).expect(403);
    });

    it('finanzas consulta pero no crea; comité no publica', async () => {
      await get('/admin/offers', finance).expect(200);
      await get('/admin/teachers', committee).expect(200);
      const res = await post('/admin/offers', finance, {
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        name: `${token} finanzas`,
      }).expect(403);
      expect(res.body.meta.missingPermissions).toEqual(['offers.write']);
      await post(`/admin/offers/${randomUUID()}/publish`, committee).expect(403);
      await post('/admin/teachers', finance, { fullName: 'No permitido' }).expect(403);
    });

    it('sin token → 401', async () => {
      await api().get('/api/v1/admin/offers').expect(401);
    });
  });

  describe('HU-27: asistente de 7 pasos', () => {
    let offerId: string;
    let teacherId: string;
    const name = `${token} Diplomado en Ecotecnologías`;

    it('crea el borrador y el asistente marca los pasos incompletos', async () => {
      const res = await post('/admin/offers', coord, {
        type: 'DIPLOMA',
        modality: 'ONLINE_LIVE',
        name,
      }).expect(201);
      offerId = res.body.id;
      expect(res.body).toMatchObject({
        publicationStatus: 'DRAFT',
        adminStatus: 'DRAFT',
        hasEnrollments: false,
      });
      expect(res.body.wizard.canPublish).toBe(false);
      expect(res.body.wizard.steps.map((s: { key: string }) => s.key)).toEqual([
        'GENERAL',
        'CONTENT',
        'SCHEDULE',
        'ORIGIN_PRICING',
        'RESOURCES',
        'ATTENDANCE',
        'WHATSAPP',
      ]);
      const dup = await post('/admin/offers', coord, {
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        name: name.toUpperCase(),
      }).expect(409);
      expect(dup.body.code).toBe('OFFER_NAME_TAKEN');
    });

    it('publicar incompleta → 422 OFFER_INCOMPLETE con el campo y el paso', async () => {
      const res = await post(`/admin/offers/${offerId}/publish`, coord).expect(422);
      expect(res.body.code).toBe('OFFER_INCOMPLETE');
      expect(res.body.meta.steps).toEqual(expect.arrayContaining([1, 2, 3, 4]));
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'general.coverImageKey', code: 'REQUIRED' }),
        ]),
      );
    });

    it('paso 1: docente, portada (URL firmada + verificación) y datos', async () => {
      const t = await post('/admin/teachers', coord, {
        fullName: `${token} Dra. Ana Torres`,
        cvUrl: 'https://example.org/cv.pdf',
      }).expect(201);
      teacherId = t.body.id;

      const bad = await post('/admin/uploads/images', coord, {
        purpose: 'OFFER_COVER',
        offerId,
        fileName: 'portada.gif',
        contentType: 'image/gif',
        sizeBytes: 1000,
      }).expect(422);
      expect(bad.body.code).toBe('ADMIN_UPLOAD_INVALID_FILE');
      // Límite de imágenes: 15 MB (antes 5 MB).
      const heavy = await post('/admin/uploads/images', coord, {
        purpose: 'OFFER_COVER',
        offerId,
        fileName: 'portada.png',
        contentType: 'image/png',
        sizeBytes: 15 * 1024 * 1024 + 1,
      }).expect(422);
      expect(heavy.body.code).toBe('ADMIN_UPLOAD_INVALID_FILE');

      const up = await post('/admin/uploads/images', coord, {
        purpose: 'OFFER_COVER',
        offerId,
        fileName: 'Portada.PNG',
        contentType: 'image/png',
        sizeBytes: 2000,
      }).expect(201);
      expect(up.body.key).toMatch(new RegExp(`^public/offers/${offerId}/cover/`));

      const missing = await patch(`/admin/offers/${offerId}/steps/general`, coord, {
        coverImageKey: up.body.key,
      }).expect(422);
      expect(missing.body.code).toBe('ADMIN_UPLOAD_NOT_FOUND');

      storage.put(up.body.key, 'image/png', 2000);
      const res = await patch(`/admin/offers/${offerId}/steps/general`, coord, {
        coverImageKey: up.body.key,
        summary: 'Diseña ecotecnologías del agua.',
        teacherIds: [teacherId],
        cohortLabel: 'Generación 2027',
      }).expect(200);
      expect(res.body.general.coverImage.url).toContain(up.body.key);
      expect(res.body.general.teachers[0].id).toBe(teacherId);
      expect(res.body.wizard.steps[0]).toMatchObject({ key: 'GENERAL', complete: true });

      await patch(`/admin/offers/${offerId}/steps/general`, coord, { summary: null }).expect(400);
    });

    it('pasos 2–4, 6 y 7: reglas del diplomado (60 h + proyecto final)', async () => {
      await patch(`/admin/offers/${offerId}/steps/content`, coord, {
        description: 'Descripción del diplomado.',
        learningOutcomes: ['Diseñar humedales'],
        finalProjectSubmissionEnabled: true,
      }).expect(200);

      const partial = await patch(`/admin/offers/${offerId}/steps/schedule`, coord, {
        startsAt: days(30).toISOString(),
        endsAt: days(120).toISOString(),
        enrollmentOpensAt: days(-1).toISOString(),
        enrollmentClosesAt: days(25).toISOString(),
        totalHours: 58,
        scheduleRule: {
          weekdays: [6, 7],
          startTime: '10:00',
          endTime: '13:00',
          excludeMexicanHolidays: true,
        },
      }).expect(200);
      const schedule = partial.body.wizard.steps[2];
      expect(schedule.issues.map((i: { code: string }) => i.code).sort()).toEqual([
        'DIPLOMA_HOURS_MISMATCH',
        'REQUIRED',
      ]);

      const badRule = await patch(`/admin/offers/${offerId}/steps/schedule`, coord, {
        scheduleRule: { weekdays: [6], startTime: '13:00', endTime: '10:00' },
      }).expect(400);
      expect(badRule.body.details[0].field).toBe('scheduleRule.endTime');

      // Horario distinto por día de clase (sáb 10–13, dom 09–12): se guarda normalizado.
      const perDay = await patch(`/admin/offers/${offerId}/steps/schedule`, coord, {
        scheduleRule: {
          slots: [
            { weekday: 7, startTime: '09:00', endTime: '12:00' },
            { weekday: 6, startTime: '10:00', endTime: '13:00' },
          ],
          excludeMexicanHolidays: true,
        },
      }).expect(200);
      expect(perDay.body.schedule.scheduleRule).toEqual({
        weekdays: [6, 7],
        startTime: '10:00',
        endTime: '13:00',
        slots: [
          { weekday: 6, startTime: '10:00', endTime: '13:00' },
          { weekday: 7, startTime: '09:00', endTime: '12:00' },
        ],
        excludedDates: [],
        excludeMexicanHolidays: true,
      });
      const badSlot = await patch(`/admin/offers/${offerId}/steps/schedule`, coord, {
        scheduleRule: { slots: [{ weekday: 6, startTime: '13:00', endTime: '10:00' }] },
      }).expect(400);
      expect(badSlot.body.details[0].field).toBe('scheduleRule.slots.0.endTime');
      // De vuelta a la forma clásica (mismo horario): también se acepta.
      await patch(`/admin/offers/${offerId}/steps/schedule`, coord, {
        scheduleRule: {
          weekdays: [6, 7],
          startTime: '10:00',
          endTime: '13:00',
          excludeMexicanHolidays: true,
        },
      }).expect(200);

      const ok = await patch(`/admin/offers/${offerId}/steps/schedule`, coord, {
        totalHours: 60,
        finalProjectDueAt: days(119).toISOString(),
      }).expect(200);
      expect(ok.body.wizard.steps[2].complete).toBe(true);
      expect(ok.body.schedule.totalHours).toBe(60);

      await patch(`/admin/offers/${offerId}/steps/origin-pricing`, coord, {
        installmentsMax: 5,
      }).expect(400);
      const pricing = await patch(`/admin/offers/${offerId}/steps/origin-pricing`, coord, {
        origin: 'NAS',
        isFree: false,
        priceMxnCents: 1_020_000,
        priceUsdCents: 58_500,
        installmentsEnabled: true,
        installmentsMax: 3,
        scholarshipEnabled: true,
        scholarshipTypes: [
          { scholarshipTypeId: types.AGUAS_LIBRES },
          { scholarshipTypeId: types.SPECIAL, minPercent: 75 },
        ],
      }).expect(200);
      expect(pricing.body.wizard.canPublish).toBe(true);
      // Rango propio de la oferta: Beca especial 75–80 solo aquí; el tipo sigue en 71–80.
      expect(pricing.body.originPricing.scholarshipTypes).toEqual([
        expect.objectContaining({
          scholarshipTypeId: types.AGUAS_LIBRES,
          minPercent: null,
          active: true,
          scholarshipType: expect.objectContaining({ minPercent: 50, maxPercent: 50 }),
        }),
        expect.objectContaining({
          scholarshipTypeId: types.SPECIAL,
          minPercent: 75,
          maxPercent: null,
          scholarshipType: expect.objectContaining({ minPercent: 75, maxPercent: 80 }),
        }),
      ]);
      // Tipo inexistente → 422 por campo; rango propio inválido → 422.
      const missing = await patch(`/admin/offers/${offerId}/steps/origin-pricing`, coord, {
        scholarshipTypes: [{ scholarshipTypeId: randomUUID() }],
      }).expect(422);
      expect(missing.body).toMatchObject({
        code: 'SCHOLARSHIP_TYPE_NOT_AVAILABLE',
        details: [
          { field: 'scholarshipTypes.0.scholarshipTypeId', code: 'SCHOLARSHIP_TYPE_NOT_FOUND' },
        ],
      });
      const badRange = await patch(`/admin/offers/${offerId}/steps/origin-pricing`, coord, {
        scholarshipTypes: [{ scholarshipTypeId: types.SPECIAL, minPercent: 90 }],
      }).expect(422);
      expect(badRange.body).toMatchObject({
        code: 'SCHOLARSHIP_TYPE_INVALID_RANGE',
        details: [{ field: 'scholarshipTypes.0.maxPercent', code: 'INVALID' }],
      });
      // Duplicado → 400.
      await patch(`/admin/offers/${offerId}/steps/origin-pricing`, coord, {
        scholarshipTypes: [
          { scholarshipTypeId: types.SPECIAL },
          { scholarshipTypeId: types.SPECIAL },
        ],
      }).expect(400);

      await patch(`/admin/offers/${offerId}/steps/attendance`, coord, {
        attendanceWindowHours: 80,
      }).expect(400);
      await patch(`/admin/offers/${offerId}/steps/attendance`, coord, {
        attendanceWindowHours: 48,
      }).expect(200);
      await patch(`/admin/offers/${offerId}/steps/whatsapp`, coord, {
        whatsappGroupUrl: 'https://wa.me/5215512345678',
      }).expect(400);
      const wa = await patch(`/admin/offers/${offerId}/steps/whatsapp`, coord, {
        whatsappGroupUrl: 'https://chat.whatsapp.com/AbCdEf123',
      }).expect(200);
      expect(wa.body.whatsapp.whatsappGroupUrl).toBe('https://chat.whatsapp.com/AbCdEf123');
    });

    it('publica: aparece en el catálogo y ofrece la vista previa de sesiones', async () => {
      const res = await post(`/admin/offers/${offerId}/publish`, coord).expect(200);
      expect(res.body).toMatchObject({ publicationStatus: 'PUBLISHED', adminStatus: 'PUBLISHED' });
      expect(res.body.sessionPreview.available).toBe(true);
      await api().get(`/api/v1/offers/${res.body.slug}`).expect(200);
      const again = await post(`/admin/offers/${offerId}/publish`, coord).expect(409);
      expect(again.body.code).toBe('OFFER_INVALID_STATE');

      const list = await get(`/admin/offers?q=${token}&status=PUBLISHED`, finance).expect(200);
      expect(list.body.data.map((o: { id: string }) => o.id)).toContain(offerId);
    });

    it('con inscritos: tipo y origen bloqueados; no se puede borrar; docente en uso', async () => {
      await prisma.enrollment.create({
        data: {
          userId: participant.id,
          offerId,
          status: 'ACTIVE',
          source: 'PAYMENT',
          activatedAt: now,
        },
      });
      const res = await patch(`/admin/offers/${offerId}/steps/general`, coord, {
        type: 'COURSE',
      }).expect(409);
      expect(res.body.code).toBe('OFFER_HAS_ENROLLMENTS');
      await patch(`/admin/offers/${offerId}/steps/origin-pricing`, coord, {
        origin: 'MOODLE',
      }).expect(409);
      await del(`/admin/offers/${offerId}`, coord).expect(409);
      const teacher = await del(`/admin/teachers/${teacherId}`, coord).expect(409);
      expect(teacher.body.code).toBe('TEACHER_IN_USE');
      const detail = await get(`/admin/offers/${offerId}`, coord).expect(200);
      expect(detail.body.hasEnrollments).toBe(true);
    });

    describe('HU-28: módulos y recursos', () => {
      let moduleId: string;
      let module2Id: string;

      it('agrega módulos al final, ocultos', async () => {
        const m1 = await post(`/admin/offers/${offerId}/modules`, coord, {
          title: 'Humedales construidos',
        }).expect(201);
        const m2 = await post(`/admin/offers/${offerId}/modules`, coord, {
          title: 'Baños secos',
        }).expect(201);
        moduleId = m1.body.module.id;
        module2Id = m2.body.module.id;
        expect(m1.body.module).toMatchObject({
          number: 1,
          visibility: 'HIDDEN',
          visibleNow: false,
        });
        expect(m2.body.module.number).toBe(2);
        expect(m1.body.module.sections).toEqual({
          presentation: null,
          preReadings: [],
          activities: [],
          recordings: [],
        });
      });

      it('archivo no permitido → 422; presentación publicada en módulo oculto no notifica', async () => {
        const bad = await post(`/admin/modules/${moduleId}/resources/upload-url`, coord, {
          type: 'PRESENTATION',
          fileName: 'x.epub',
          contentType: 'application/epub+zip',
          sizeBytes: 100,
        }).expect(422);
        expect(bad.body.code).toBe('ADMIN_UPLOAD_INVALID_FILE');
        const big = await post(`/admin/modules/${moduleId}/resources/upload-url`, coord, {
          type: 'PRESENTATION',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 51 * 1024 * 1024,
        }).expect(422);
        expect(big.body.code).toBe('ADMIN_UPLOAD_INVALID_FILE');

        const up = await post(`/admin/modules/${moduleId}/resources/upload-url`, coord, {
          type: 'PRESENTATION',
          fileName: 'modulo-1.pdf',
          contentType: 'application/pdf',
          sizeBytes: 5000,
        }).expect(201);
        storage.put(up.body.key, 'application/pdf', 5000);
        const res = await post(`/admin/modules/${moduleId}/resources`, coord, {
          type: 'PRESENTATION',
          title: 'Presentación del módulo 1',
          fileKey: up.body.key,
          visibility: 'PUBLISHED',
        }).expect(201);
        expect(res.body).toMatchObject({ notifiedCount: 0, replacedResourceId: null });
        expect(res.body.resource).toMatchObject({ source: 'FILE', visibleNow: false });
        expect(res.body.resource.file.downloadUrl).toContain(up.body.key);

        await post(`/admin/modules/${moduleId}/resources`, coord, {
          type: 'PRE_READING',
          title: 'Dos fuentes',
          url: 'https://example.org/a',
          fileKey: up.body.key,
        }).expect(400);
      });

      it('al publicar el módulo se notifica una sola vez (incluye su material)', async () => {
        const res = await patch(`/admin/modules/${moduleId}`, coord, {
          visibility: 'PUBLISHED',
        }).expect(200);
        expect(res.body.notifiedCount).toBe(1);
        expect(res.body.module.visibleNow).toBe(true);
        expect(res.body.module.sections.presentation.notifiedAt).not.toBeNull();
        const notes = await prisma.notification.findMany({
          where: { userId: participant.id, type: 'MATERIAL_PUBLISHED' },
        });
        expect(notes).toHaveLength(1);
        expect(notes[0].dedupeKey).toBe(`material:module:${moduleId}`);

        const again = await patch(`/admin/modules/${moduleId}`, coord, {
          title: 'Humedales construidos (v2)',
        }).expect(200);
        expect(again.body.notifiedCount).toBe(0);
      });

      it('recurso nuevo en módulo visible notifica; una nueva presentación reemplaza la anterior', async () => {
        const reading = await post(`/admin/modules/${moduleId}/resources`, coord, {
          type: 'PRE_READING',
          title: 'Lectura: humedales en México',
          url: 'https://example.org/lectura',
          visibility: 'PUBLISHED',
        }).expect(201);
        expect(reading.body.notifiedCount).toBe(1);

        const hidden = await post(`/admin/modules/${moduleId}/resources`, coord, {
          type: 'ACTIVITY',
          title: 'Actividad sin aviso',
          url: 'https://example.org/act',
          visibility: 'PUBLISHED',
          notifyEnrollees: false,
          activityDueAt: days(40).toISOString(),
        }).expect(201);
        expect(hidden.body.notifiedCount).toBe(0);
        await post(`/admin/modules/${moduleId}/resources`, coord, {
          type: 'ACTIVITY',
          title: 'Fuera de periodo',
          url: 'https://example.org/act2',
          activityDueAt: days(500).toISOString(),
        }).expect(400);

        const before = await get(`/admin/offers/${offerId}/modules`, coord).expect(200);
        const oldId = before.body.modules[0].sections.presentation.id;
        const replace = await post(`/admin/modules/${moduleId}/resources`, coord, {
          type: 'PRESENTATION',
          title: 'Presentación v2',
          url: 'https://example.org/slides',
        }).expect(201);
        expect(replace.body.replacedResourceId).toBe(oldId);
        expect(storage.deleted.some((k) => k.includes(`/modules/${moduleId}/`))).toBe(true);
      });

      it('publicación programada: solo a futuro; el job avisa al llegar la fecha', async () => {
        await patch(`/admin/modules/${module2Id}`, coord, {
          visibility: 'PUBLISHED',
          publishAt: days(-1).toISOString(),
        }).expect(400);
        const res = await patch(`/admin/modules/${module2Id}`, coord, {
          visibility: 'PUBLISHED',
          publishAt: days(2).toISOString(),
        }).expect(200);
        expect(res.body).toMatchObject({ notifiedCount: 0 });
        expect(res.body.module.visibleNow).toBe(false);
        const content = app.get(AdminContentService);
        expect(await content.publishPending(days(3), offerId)).toBe(1);
        expect(await content.publishPending(days(3), offerId)).toBe(0);
      });

      it('reordena módulos y recursos', async () => {
        await put(`/admin/offers/${offerId}/modules/order`, coord, {
          moduleIds: [moduleId],
        }).expect(400);
        const res = await put(`/admin/offers/${offerId}/modules/order`, coord, {
          moduleIds: [module2Id, moduleId],
        }).expect(200);
        expect(
          res.body.modules.map((m: { id: string; number: number }) => [m.id, m.number]),
        ).toEqual([
          [module2Id, 1],
          [moduleId, 2],
        ]);
        const mod = res.body.modules[1];
        const ids = [
          mod.sections.presentation.id,
          ...mod.sections.preReadings.map((r: { id: string }) => r.id),
          ...mod.sections.activities.map((r: { id: string }) => r.id),
        ].reverse();
        await put(`/admin/modules/${moduleId}/resources/order`, coord, { resourceIds: ids }).expect(
          200,
        );
      });

      it('oculto: el participante no lo ve en sus materiales', async () => {
        await patch(`/admin/modules/${module2Id}`, coord, { visibility: 'HIDDEN' }).expect(200);
        const res = await get('/admin/offers/' + offerId + '/modules', finance).expect(200);
        expect(res.body.modules[0]).toMatchObject({
          id: module2Id,
          visibility: 'HIDDEN',
          visibleNow: false,
        });
        expect(res.body.activeEnrollees).toBe(1);
      });
    });

    it('duplicar (nueva cohorte) → borrador con módulos ocultos; despublicar/archivar/borrar', async () => {
      const res = await post(`/admin/offers/${offerId}/duplicate`, coord, {}).expect(201);
      expect(res.body.name).toBe(`${name} (copia)`);
      expect(res.body).toMatchObject({ publicationStatus: 'DRAFT', hasEnrollments: false });
      expect(res.body.schedule.startsAt).toBeNull();
      expect(res.body.whatsapp.whatsappGroupUrl).toBeNull();
      expect(res.body.resources).toMatchObject({ moduleCount: 2, publishedModuleCount: 0 });
      // Copia los tipos de beca con su rango propio.
      expect(
        res.body.originPricing.scholarshipTypes.map(
          (t: { scholarshipType: { key: string }; minPercent: number | null }) => [
            t.scholarshipType.key,
            t.minPercent,
          ],
        ),
      ).toEqual([
        ['AGUAS_LIBRES', null],
        ['SPECIAL', 75],
      ]);
      const copyId = res.body.id;

      await post(`/admin/offers/${copyId}/unpublish`, coord).expect(409);
      await post(`/admin/offers/${copyId}/archive`, coord).expect(200);
      await del(`/admin/offers/${copyId}`, coord).expect(409);
      await post(`/admin/offers/${copyId}/unpublish`, coord).expect(200);
      await del(`/admin/offers/${copyId}`, coord).expect(204);
      await get(`/admin/offers/${copyId}`, coord).expect(404);
    });

    it('auditoría: cada acción queda registrada con actor y cambios', async () => {
      const logs = await audits(offerId);
      const actions = logs.map((l) => l.action);
      expect(actions).toEqual(
        expect.arrayContaining(['offer.create', 'offer.update-step', 'offer.publish']),
      );
      const publish = logs.find((l) => l.action === 'offer.publish')!;
      expect(publish).toMatchObject({
        actorId: coord.id,
        actorEmail: coord.email,
        entityType: 'Offer',
      });
      expect(publish.changes).toEqual({
        before: { publicationStatus: 'DRAFT' },
        after: { publicationStatus: 'PUBLISHED' },
      });
      const modules = await prisma.adminAuditLog.count({
        where: { action: { startsWith: 'module.' }, actorId: coord.id },
      });
      expect(modules).toBeGreaterThan(0);
    });
  });

  describe('Curso: regla de 9 h', () => {
    it('curso de más de 9 h no se puede publicar', async () => {
      const c = await post('/admin/offers', coord, {
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        name: `${token} Curso largo`,
      }).expect(201);
      const res = await patch(`/admin/offers/${c.body.id}/steps/schedule`, coord, {
        totalHours: 12,
      }).expect(200);
      expect(res.body.wizard.steps[2].issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'COURSE_MAX_HOURS_EXCEEDED' })]),
      );
    });
  });

  describe('Moodle: lista de correos y códigos (HU-25 / HU-27 paso 4)', () => {
    let moodleOfferId: string;
    let nasOfferId: string;

    beforeAll(async () => {
      const m = await post('/admin/offers', coord, {
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        name: `${token} Moodle`,
      }).expect(201);
      moodleOfferId = m.body.id;
      const res = await patch(`/admin/offers/${moodleOfferId}/steps/origin-pricing`, coord, {
        origin: 'MOODLE',
        priceMxnCents: 100,
        installmentsEnabled: true,
      }).expect(200);
      expect(res.body.originPricing).toMatchObject({
        origin: 'MOODLE',
        priceMxnCents: null,
        installmentsEnabled: false,
        scholarshipEnabled: false,
      });
      await prisma.offer.update({ where: { id: moodleOfferId }, data: { endsAt: days(90) } });
      const n = await post('/admin/offers', coord, {
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        name: `${token} NAS`,
      }).expect(201);
      nasOfferId = n.body.id;
    });

    it('oferta NAS → 422 OFFER_NOT_MOODLE', async () => {
      const res = await post(`/admin/offers/${nasOfferId}/moodle/roster`, coord, {
        emails: ['a@b.mx'],
      }).expect(422);
      expect(res.body.code).toBe('OFFER_NOT_MOODLE');
    });

    it('importa CSV: agrega, detecta inválidos y vincula a quien ya tiene cuenta', async () => {
      const csv = `nombre,email\nPart,${participant.email.toUpperCase()}\nOtra,otra-${token}@example.com\nMal,no-es-correo\nDup,otra-${token}@example.com\n`;
      await post(`/admin/offers/${moodleOfferId}/moodle/roster`, finance, { csv }).expect(403);
      const res = await post(`/admin/offers/${moodleOfferId}/moodle/roster`, coord, { csv }).expect(
        200,
      );
      expect(res.body).toMatchObject({ added: 2, invalid: ['no-es-correo'], linkedUsers: 1 });
      const enrollment = await prisma.enrollment.findUnique({
        where: { userId_offerId: { userId: participant.id, offerId: moodleOfferId } },
      });
      expect(enrollment).toMatchObject({
        status: 'ACTIVE',
        origin: 'MOODLE',
        source: 'MOODLE_LIST',
      });

      const list = await get(
        `/admin/offers/${moodleOfferId}/moodle/roster?linked=false`,
        coord,
      ).expect(200);
      expect(list.body.data).toHaveLength(1);
      await del(
        `/admin/offers/${moodleOfferId}/moodle/roster/${list.body.data[0].id}`,
        coord,
      ).expect(204);
      const linked = await get(
        `/admin/offers/${moodleOfferId}/moodle/roster?linked=true`,
        coord,
      ).expect(200);
      await del(
        `/admin/offers/${moodleOfferId}/moodle/roster/${linked.body.data[0].id}`,
        coord,
      ).expect(409);
      await post(`/admin/offers/${moodleOfferId}/moodle/roster`, coord, {}).expect(400);
    });

    it('genera códigos (en claro una sola vez) y lista sus pistas', async () => {
      const res = await post(`/admin/offers/${moodleOfferId}/moodle/codes`, coord, {
        count: 3,
      }).expect(201);
      expect(res.body.codes).toHaveLength(3);
      expect(res.body.codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const list = await get(
        `/admin/offers/${moodleOfferId}/moodle/codes?used=false`,
        finance,
      ).expect(200);
      expect(list.body.meta.total).toBe(3);
      expect(list.body.data[0].hint).toHaveLength(4);
      await post(`/admin/offers/${moodleOfferId}/moodle/codes`, coord, { count: 500 }).expect(400);
      const log = await prisma.adminAuditLog.findFirst({
        where: { entityId: moodleOfferId, action: 'moodle.generate-codes' },
      });
      expect(log?.summary).toContain('3 códigos');
    });
  });
});
