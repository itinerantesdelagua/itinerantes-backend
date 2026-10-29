/**
 * Seed de datos demo (idempotente). Uso: `pnpm db:seed` (también corre tras `pnpm db:reset`).
 *
 * Producción (Railway): lo ejecuta `scripts/docker-entrypoint.sh` en cada arranque, después de
 * `prisma migrate deploy`. Siempre siembra catálogos de referencia; los datos demo dependen de:
 * - Usuarios demo: nunca con NODE_ENV=production.
 * - Ofertas demo (Fase 02) y contenido demo del portal (Fase 03: biblioteca, recursos de módulo, eventos):
 *   SEED_DEMO_DATA=true|false (por defecto true fuera de producción y false en producción).
 * - Inscripciones, asistencias y notificaciones demo (Fase 03): solo para el usuario demo, que nunca
 *   existe con NODE_ENV=production.
 * - Postulaciones demo (Fase 04): solo para el usuario demo y nunca con NODE_ENV=production; se crean
 *   solo si no existen (no pisan lo que se haga desde el portal).
 * - Pagos demo (Fase 05: plan de cuotas, pago completo) y acceso Moodle demo (lista y código): nunca
 *   con NODE_ENV=production ni sin SEED_DEMO_DATA; se crean solo si no existen.
 * - Tipos de beca por defecto: en TODOS los entornos, solo los que falten por `key` (nunca pisa lo
 *   editado en el panel).
 * - Primer SUPER_ADMIN (Fase 06): en TODOS los entornos, solo si hay BOOTSTRAP_ADMIN_EMAIL y no existe
 *   ningún SUPER_ADMIN activo (seguro en producción; nunca usa contraseñas demo).
 *
 * Reglas para las fases:
 * - Usa SIEMPRE `upsert` (o `createMany({ skipDuplicates: true })`) con claves estables (email, slug),
 *   para poder correrlo N veces sin duplicar.
 * - Agrega una función `seedXxx(prisma)` por fase y llámala desde `main()` en orden de dependencias.
 * - Datos previstos (ARCHITECTURE.md): usuario demo, admin demo, ofertas de ejemplo
 *   ("Diplomado en Ecotecnologías del Agua", ...). Nunca contraseñas reales.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { Prisma, PrismaClient, Role, UserStatus } from '../src/generated/prisma/client';
import { accessCodeHint, hashAccessCode } from '../src/modules/moodle/policies/moodle-code.policy';
import { buildImportantDates } from '../src/modules/offers/policies/important-dates.policy';
import { cdmxDate, parseScheduleRule } from '../src/modules/offers/policies/schedule-rule';
import { generateSessions } from '../src/modules/offers/policies/session-generation.policy';
import { bootstrapMessage, bootstrapSuperAdmin } from './bootstrap-admin';
import { purgeDemoData, seedDemoData } from './demo-data';
import { COUNTRIES } from './data/countries';
import { DEMO_APPLICATIONS } from './data/demo-applications';
import { DEMO_OFFERS, DEMO_TEACHERS } from './data/demo-offers';
import { DEFAULT_SITE_METRICS } from '../src/modules/site/site-metrics.defaults';
import { DEFAULT_SCHOLARSHIP_TYPES } from '../src/modules/scholarship-types/scholarship-types.defaults';
import {
  DEMO_CALENDAR_EVENTS,
  DEMO_ENROLLMENTS,
  DEMO_LIBRARY,
  DEMO_MODULE_RESOURCES,
} from './data/demo-portal';

type Seeder = (prisma: PrismaClient) => Promise<void>;

interface InegiDataset {
  states: Array<{
    code: string;
    name: string;
    municipalities: Array<{ code: string; name: string }>;
  }>;
}

/** Fase 01: países (LatAm + ES + US), 32 estados y 2,478 municipios de México (INEGI). */
async function seedLocations(prisma: PrismaClient): Promise<void> {
  for (const country of COUNTRIES) {
    const { code, ...data } = country;
    await prisma.country.upsert({ where: { code }, create: country, update: data });
  }

  const dataset = JSON.parse(
    readFileSync(resolve(__dirname, 'data', 'mx-inegi-municipalities.json'), 'utf8'),
  ) as InegiDataset;
  let municipalities = 0;
  for (const state of dataset.states) {
    const division = await prisma.adminDivision.upsert({
      where: { countryCode_code: { countryCode: 'MX', code: state.code } },
      create: { countryCode: 'MX', code: state.code, name: state.name },
      update: { name: state.name },
    });
    const result = await prisma.municipality.createMany({
      data: state.municipalities.map((m) => ({
        divisionId: division.id,
        code: m.code,
        name: m.name,
      })),
      skipDuplicates: true,
    });
    municipalities += result.count;
  }
  console.log(
    `  ${COUNTRIES.length} países, ${dataset.states.length} estados de México, ${municipalities} municipios nuevos.`,
  );
}

/**
 * Fase 01: usuarios demo SOLO fuera de producción. Credenciales en README.md ("Usuarios demo").
 */
const DEMO_USERS = [
  {
    email: 'participante@example.com',
    username: 'participante.demo',
    fullName: 'Participante Demo',
    password: 'Demo12345',
    roles: [Role.PARTICIPANT],
  },
  {
    email: 'admin@example.com',
    username: 'admin.demo',
    fullName: 'Administración Demo',
    password: 'Admin12345',
    roles: [Role.SUPER_ADMIN],
  },
  // Un usuario por rol del equipo (para probar permisos del panel, Fase 06).
  {
    email: 'coordinacion@example.com',
    username: 'coordinacion.demo',
    fullName: 'Coordinación Académica Demo',
    password: 'Demo12345',
    roles: [Role.PARTICIPANT, Role.ACADEMIC_COORDINATOR],
  },
  {
    email: 'comite@example.com',
    username: 'comite.demo',
    fullName: 'Comité de Revisión Demo',
    password: 'Demo12345',
    roles: [Role.PARTICIPANT, Role.REVIEW_COMMITTEE],
  },
  {
    email: 'comite.decision@example.com',
    username: 'comite.decision.demo',
    fullName: 'Comité con Decisión Demo',
    password: 'Demo12345',
    roles: [Role.PARTICIPANT, Role.REVIEW_DECIDER],
  },
  {
    email: 'seguimiento@example.com',
    username: 'seguimiento.demo',
    fullName: 'Seguimiento Demo',
    password: 'Demo12345',
    roles: [Role.PARTICIPANT, Role.FOLLOW_UP],
  },
  {
    email: 'finanzas@example.com',
    username: 'finanzas.demo',
    fullName: 'Administración y Finanzas Demo',
    password: 'Demo12345',
    roles: [Role.PARTICIPANT, Role.FINANCE],
  },
];

async function seedDemoUsers(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  NODE_ENV=production: se omiten los usuarios demo.');
    return;
  }
  const cdmx = await prisma.adminDivision.findUniqueOrThrow({
    where: { countryCode_code: { countryCode: 'MX', code: '09' } },
  });
  const coyoacan = await prisma.municipality.findUniqueOrThrow({
    where: { divisionId_code: { divisionId: cdmx.id, code: '003' } },
  });
  for (const demo of DEMO_USERS) {
    const passwordHash = await argon2.hash(demo.password, { type: argon2.argon2id });
    const data = {
      fullName: demo.fullName,
      passwordHash,
      phoneCountryCode: '+52',
      phoneNumber: '5512345678',
      countryCode: 'MX',
      divisionId: cdmx.id,
      divisionName: cdmx.name,
      municipalityId: coyoacan.id,
      municipalityName: coyoacan.name,
      timezone: 'America/Mexico_City',
      status: UserStatus.ACTIVE,
      roles: demo.roles,
      emailVerifiedAt: new Date(),
      failedLoginAttempts: 0,
      loginLockedUntil: null,
    };
    await prisma.user.upsert({
      where: { email: demo.email },
      create: { email: demo.email, username: demo.username, ...data },
      update: data,
    });
  }
  console.log(`  ${DEMO_USERS.length} usuarios demo (ver README).`);
}

/** ¿Sembrar datos demo de oferta? SEED_DEMO_DATA explícito, o por defecto solo fuera de producción. */
function demoDataEnabled(): boolean {
  const flag = process.env.SEED_DEMO_DATA?.trim().toLowerCase();
  if (flag === 'true' || flag === '1') return true;
  if (flag === 'false' || flag === '0') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Fase 02: docentes y ofertas demo (diplomado, curso, taller, evento, 2 convocatorias, Moodle,
 * una finalizada y un borrador) con módulos, sesiones generadas (HU-29) y fechas importantes.
 * Idempotente: upsert por slug; sesiones únicas por (oferta, inicio).
 */
async function seedDemoOffers(prisma: PrismaClient): Promise<void> {
  if (!demoDataEnabled()) {
    console.log('  SEED_DEMO_DATA desactivado: se omiten las ofertas demo.');
    return;
  }
  const teacherIds = new Map<string, string>();
  for (const { slug, ...data } of DEMO_TEACHERS) {
    const teacher = await prisma.teacher.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
    teacherIds.set(slug, teacher.id);
  }

  let sessionCount = 0;
  for (const demo of DEMO_OFFERS) {
    const { slug, scheduleRule, ...fields } = demo.data;
    const rule = scheduleRule ? parseScheduleRule(scheduleRule) : null;
    const data = { ...fields, scheduleRule: rule ?? Prisma.DbNull };
    const offer = await prisma.offer.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });

    await prisma.offerScholarshipType.deleteMany({ where: { offerId: offer.id } });
    if (demo.scholarshipTypeKeys?.length) {
      const types = await prisma.scholarshipType.findMany({
        where: { key: { in: demo.scholarshipTypeKeys } },
        select: { id: true },
      });
      await prisma.offerScholarshipType.createMany({
        data: types.map((type) => ({ offerId: offer.id, scholarshipTypeId: type.id })),
      });
    }

    await prisma.offerTeacher.deleteMany({ where: { offerId: offer.id } });
    await prisma.offerTeacher.createMany({
      data: demo.teacherSlugs.map((teacherSlug, position) => ({
        offerId: offer.id,
        teacherId: teacherIds.get(teacherSlug)!,
        position,
      })),
    });

    const moduleIds: string[] = [];
    for (const [index, module] of demo.modules.entries()) {
      const position = index + 1;
      const existing = await prisma.offerModule.findFirst({
        where: { offerId: offer.id, position },
      });
      // Fase 06: contenido demo ya "notificado" (el job de publicación del panel no lo anuncia).
      const moduleData = {
        ...module,
        visibility: 'PUBLISHED' as const,
        publishAt: null,
        publishedNotifiedAt: existing?.publishedNotifiedAt ?? new Date(),
      };
      const saved = existing
        ? await prisma.offerModule.update({ where: { id: existing.id }, data: moduleData })
        : await prisma.offerModule.create({ data: { offerId: offer.id, position, ...moduleData } });
      moduleIds.push(saved.id);
    }
    await prisma.offerModule.deleteMany({
      where: { offerId: offer.id, position: { gt: demo.modules.length } },
    });

    if (demo.generateSessions && rule && offer.startsAt && offer.endsAt) {
      const generated = generateSessions({
        rule,
        startDate: cdmxDate(offer.startsAt),
        endDate: cdmxDate(offer.endsAt),
        moduleCount: moduleIds.length || undefined,
      });
      const result = await prisma.offerSession.createMany({
        data: generated.sessions.map((session) => ({
          offerId: offer.id,
          moduleId: session.moduleIndex !== undefined ? moduleIds[session.moduleIndex] : null,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          category: offer.calendarCategory,
          // PRIVADO: join_url de participante (demo).
          joinUrl:
            offer.modality === 'ONLINE_LIVE' ? 'https://zoom.us/j/0000000000?pwd=demo' : null,
        })),
        skipDuplicates: true,
      });
      sessionCount += result.count;
    }

    await prisma.calendarEvent.deleteMany({
      where: { offerId: offer.id, kind: { not: 'MANUAL' } },
    });
    if (offer.publicationStatus === 'PUBLISHED') {
      await prisma.calendarEvent.createMany({
        data: buildImportantDates(offer).map((date) => ({
          ...date,
          offerId: offer.id,
          category: 'IMPORTANT_DATES' as const,
          allDay: false,
        })),
      });
    }
  }
  console.log(
    `  ${DEMO_TEACHERS.length} docentes, ${DEMO_OFFERS.length} ofertas demo, ${sessionCount} sesiones nuevas.`,
  );
}

/**
 * Fase 03: contenido demo del portal (biblioteca, recursos de módulo, eventos manuales, grabaciones
 * de la oferta finalizada) con SEED_DEMO_DATA, e inscripciones/asistencias/notificaciones del usuario
 * demo (nunca en producción). Idempotente: claves estables (slug, título, userId+offerId, dedupeKey).
 */
async function seedDemoPortal(prisma: PrismaClient): Promise<void> {
  if (!demoDataEnabled()) {
    console.log('  SEED_DEMO_DATA desactivado: se omite el contenido demo del portal.');
    return;
  }
  const offers = await prisma.offer.findMany({ select: { id: true, slug: true } });
  const offerIdBySlug = new Map(offers.map((o) => [o.slug, o.id]));

  const libraryIds = new Map<string, string>();
  for (const { slug, offerSlug, ...data } of DEMO_LIBRARY) {
    const offerId = offerSlug ? (offerIdBySlug.get(offerSlug) ?? null) : null;
    const fields = { ...data, offerId, visibility: 'PUBLISHED' as const, publishAt: null };
    const saved = await prisma.libraryResource.upsert({
      where: { slug },
      create: { slug, ...fields },
      update: fields,
    });
    libraryIds.set(slug, saved.id);
  }

  let resources = 0;
  for (const group of DEMO_MODULE_RESOURCES) {
    const offerId = offerIdBySlug.get(group.offerSlug);
    if (!offerId) continue;
    const module = await prisma.offerModule.findFirst({
      where: { offerId, position: group.modulePosition },
    });
    if (!module) continue;
    for (const { libraryResourceSlug, ...resource } of group.resources) {
      const data = {
        ...resource,
        libraryResourceId: libraryResourceSlug
          ? (libraryIds.get(libraryResourceSlug) ?? null)
          : null,
        visibility: 'PUBLISHED' as const,
        publishAt: null,
        // Fase 06: contenido demo ya "notificado" (el job de publicación del panel no lo anuncia).
        publishedNotifiedAt: new Date(),
      };
      const existing = await prisma.moduleResource.findFirst({
        where: { moduleId: module.id, title: resource.title },
      });
      if (existing) await prisma.moduleResource.update({ where: { id: existing.id }, data });
      else {
        await prisma.moduleResource.create({ data: { moduleId: module.id, ...data } });
        resources++;
      }
    }
  }

  for (const { offerSlug, ...event } of DEMO_CALENDAR_EVENTS) {
    const data = {
      ...event,
      kind: 'MANUAL' as const,
      offerId: offerSlug ? (offerIdBySlug.get(offerSlug) ?? null) : null,
    };
    const existing = await prisma.calendarEvent.findFirst({
      where: { kind: 'MANUAL', title: event.title },
    });
    if (existing) await prisma.calendarEvent.update({ where: { id: existing.id }, data });
    else await prisma.calendarEvent.create({ data });
  }

  // Grabaciones demo de la oferta finalizada (HU-08 / HU-12: "Ver grabación").
  const finishedId = offerIdBySlug.get('curso-introduccion-sistemas-de-tratamiento-2026');
  if (finishedId) {
    await prisma.offerSession.updateMany({
      where: { offerId: finishedId, recordingUrl: null },
      data: {
        recordingUrl: 'https://example.com/grabaciones/curso-tratamiento',
        recordingPublishedAt: new Date(),
      },
    });
  }
  console.log(
    `  ${DEMO_LIBRARY.length} recursos de biblioteca, ${resources} recursos de módulo nuevos, ${DEMO_CALENDAR_EVENTS.length} eventos manuales.`,
  );

  if (process.env.NODE_ENV === 'production') {
    console.log('  NODE_ENV=production: se omiten inscripciones y notificaciones demo.');
    return;
  }
  const participant = await prisma.user.findUnique({
    where: { email: 'participante@example.com' },
  });
  if (!participant) return;

  for (const demo of DEMO_ENROLLMENTS) {
    const offerId = offerIdBySlug.get(demo.offerSlug);
    if (!offerId) continue;
    const enrollment = await prisma.enrollment.upsert({
      where: { userId_offerId: { userId: participant.id, offerId } },
      create: {
        userId: participant.id,
        offerId,
        status: 'ACTIVE',
        origin: demo.origin,
        source: demo.source,
        activatedAt: new Date(),
      },
      update: { status: 'ACTIVE', origin: demo.origin, source: demo.source },
    });
    if (demo.attendedSessionIndexes?.length) {
      const sessions = await prisma.offerSession.findMany({
        where: { offerId },
        orderBy: { startsAt: 'asc' },
        select: { id: true, endsAt: true },
      });
      await prisma.sessionAttendance.createMany({
        data: demo.attendedSessionIndexes
          .filter((i) => sessions[i])
          .map((i) => ({
            sessionId: sessions[i].id,
            userId: participant.id,
            enrollmentId: enrollment.id,
            source: 'PARTICIPANT' as const,
            comment: 'Me llevo ideas para aplicar en mi comunidad.',
            registeredAt: sessions[i].endsAt,
          })),
        skipDuplicates: true,
      });
    }
  }

  const diplomaId = offerIdBySlug.get('diplomado-en-ecotecnologias-del-agua');
  await prisma.notification.createMany({
    data: [
      {
        userId: participant.id,
        type: 'GENERAL' as const,
        category: 'GENERAL' as const,
        title: 'Te damos la bienvenida al portal',
        body: 'Aquí encontrarás tu formación, calendario, biblioteca y avisos.',
        actionLabel: 'Ir a mi dashboard',
        actionPath: '/portal',
        dedupeKey: 'demo:welcome',
        emailStatus: 'NOT_REQUESTED' as const,
      },
      ...(diplomaId
        ? [
            {
              userId: participant.id,
              type: 'ENROLLMENT_CONFIRMED' as const,
              category: 'TRAINING' as const,
              title: 'Inscripción confirmada: Diplomado en Ecotecnologías del Agua',
              body: 'Ya estás inscrito. Primera sesión: 7/11/2026 10:00 hora CDMX.',
              actionLabel: 'Ir a mi aula',
              actionPath: `/portal/aula/${diplomaId}`,
              data: { offerId: diplomaId },
              dedupeKey: 'demo:enrollment-diploma',
              emailStatus: 'NOT_REQUESTED' as const,
            },
          ]
        : []),
    ],
    skipDuplicates: true,
  });
  console.log(`  ${DEMO_ENROLLMENTS.length} inscripciones demo de participante@example.com.`);
}

/**
 * Fase 04: postulaciones demo de `participante@example.com` (beca aprobada pendiente de pago,
 * convocatoria con entrevista agendada y un borrador). Nunca en producción. Idempotente: se crean
 * solo si no existe la postulación de esa persona en esa oferta (única por persona y oferta).
 */
async function seedDemoApplications(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production' || !demoDataEnabled()) {
    console.log('  Se omiten las postulaciones demo (producción o SEED_DEMO_DATA desactivado).');
    return;
  }
  const participant = await prisma.user.findUnique({
    where: { email: 'participante@example.com' },
  });
  if (!participant) return;

  let created = 0;
  for (const demo of DEMO_APPLICATIONS) {
    const offer = await prisma.offer.findUnique({ where: { slug: demo.offerSlug } });
    if (!offer) continue;
    const existing = await prisma.application.findUnique({
      where: { userId_offerId: { userId: participant.id, offerId: offer.id } },
    });
    if (existing) continue;
    const typeByKey = (key?: string) =>
      key ? prisma.scholarshipType.findUnique({ where: { key } }) : Promise.resolve(null);
    const requestedType = await typeByKey(demo.requestedScholarshipTypeKey);
    const assignedType = await typeByKey(demo.assignedScholarshipTypeKey);
    const application = await prisma.application.create({
      data: {
        ...demo.data,
        requestedScholarshipTypeId: requestedType?.id ?? null,
        assignedScholarshipTypeId: assignedType?.id ?? null,
        assignedScholarshipTypeName: assignedType?.name ?? null,
        userId: participant.id,
        offerId: offer.id,
        applicantName: participant.fullName,
        applicantEmail: participant.email,
        phoneCountryCode: participant.phoneCountryCode,
        phoneNumber: participant.phoneNumber,
        countryCode: participant.countryCode,
        divisionName: participant.divisionName,
        municipalityName: participant.municipalityName,
        statusEvents: {
          create: demo.history.map((event, index) => ({
            fromStatus: index > 0 ? demo.history[index - 1].status : null,
            toStatus: event.status,
            actorType: event.actor,
            actorId: event.actor === 'PARTICIPANT' ? participant.id : null,
            createdAt: event.at,
          })),
        },
        ...(demo.interview ? { interviews: { create: [demo.interview] } } : {}),
      },
    });
    created++;
    if (demo.enrollment) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { userId_offerId: { userId: participant.id, offerId: offer.id } },
      });
      if (!enrollment) {
        await prisma.enrollment.create({
          data: {
            userId: participant.id,
            offerId: offer.id,
            applicationId: application.id,
            origin: 'NAS',
            ...demo.enrollment,
          },
        });
      }
    }
  }
  console.log(`  ${created} postulaciones demo nuevas de participante@example.com.`);
}

/**
 * Fase 05: pagos demo de `participante@example.com` (nunca en producción; solo si no existen):
 * - Plan de 3 cuotas "Al día" en el Diplomado en Ecotecnologías del Agua: 1.ª pagada y la 2.ª en
 *   5 días (aviso "cuota próxima" del Dashboard). Sin tarjeta real: el job no la cobra sin Stripe.
 * - Pago completo "Pagado" del Curso de Humedales construidos (recibo PDF descargable).
 * - Moodle: el correo demo en la lista del curso Moodle (vinculado), `moodle.demo@example.com` en la
 *   lista sin cuenta (se vincula al registrarse) y el código de un solo uso `AGUA-2345`.
 */
async function seedDemoPayments(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production' || !demoDataEnabled()) {
    console.log('  Se omiten los pagos demo (producción o SEED_DEMO_DATA desactivado).');
    return;
  }
  const participant = await prisma.user.findUnique({
    where: { email: 'participante@example.com' },
  });
  if (!participant) return;
  const offerBySlug = async (slug: string) => prisma.offer.findUnique({ where: { slug } });
  const now = new Date();
  const day = 86_400_000;
  let created = 0;

  const diploma = await offerBySlug('diplomado-en-ecotecnologias-del-agua');
  if (diploma) {
    const existing = await prisma.installmentPlan.findFirst({
      where: { userId: participant.id, offerId: diploma.id },
    });
    if (!existing) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { userId_offerId: { userId: participant.id, offerId: diploma.id } },
      });
      const plan = await prisma.installmentPlan.create({
        data: {
          userId: participant.id,
          offerId: diploma.id,
          enrollmentId: enrollment?.id ?? null,
          concept: 'FULL_PRICE',
          status: 'CURRENT',
          currency: 'MXN',
          totalCents: 1_020_000,
          installmentCount: 3,
          cardBrand: 'visa',
          cardLast4: '4242',
          cardExpMonth: 12,
          cardExpYear: 2030,
          autoDebitAuthorizedAt: new Date(now.getTime() - 26 * day),
          activatedAt: new Date(now.getTime() - 26 * day),
          installments: {
            create: [
              {
                sequence: 1,
                amountCents: 340_000,
                dueAt: new Date(now.getTime() - 26 * day),
                status: 'PAID',
                attempts: 1,
                paidAt: new Date(now.getTime() - 26 * day),
              },
              { sequence: 2, amountCents: 340_000, dueAt: new Date(now.getTime() + 5 * day) },
              { sequence: 3, amountCents: 340_000, dueAt: new Date(now.getTime() + 35 * day) },
            ],
          },
        },
        include: { installments: { where: { sequence: 1 } } },
      });
      await prisma.payment.create({
        data: {
          userId: participant.id,
          offerId: diploma.id,
          enrollmentId: enrollment?.id ?? null,
          planId: plan.id,
          installmentId: plan.installments[0].id,
          concept: 'INSTALLMENT',
          method: 'CARD',
          status: 'PAID',
          amountCents: 340_000,
          currency: 'MXN',
          cardBrand: 'visa',
          cardLast4: '4242',
          paidAt: new Date(now.getTime() - 26 * day),
        },
      });
      created++;
    }
  }

  const course = await offerBySlug('curso-humedales-construidos');
  if (course) {
    const existing = await prisma.payment.findFirst({
      where: { userId: participant.id, offerId: course.id },
    });
    if (!existing) {
      const enrollment = await prisma.enrollment.findUnique({
        where: { userId_offerId: { userId: participant.id, offerId: course.id } },
      });
      await prisma.payment.create({
        data: {
          userId: participant.id,
          offerId: course.id,
          enrollmentId: enrollment?.id ?? null,
          concept: 'FULL_PRICE',
          method: 'CARD',
          status: 'PAID',
          amountCents: 180_000,
          currency: 'MXN',
          cardBrand: 'visa',
          cardLast4: '4242',
          paidAt: new Date(now.getTime() - 40 * day),
        },
      });
      created++;
    }
  }

  const moodleCourse = await offerBySlug('curso-captacion-y-cosecha-de-agua-moodle');
  if (moodleCourse) {
    await prisma.moodleRosterEntry.createMany({
      data: [
        {
          offerId: moodleCourse.id,
          email: participant.email,
          linkedUserId: participant.id,
          linkedAt: now,
        },
        { offerId: moodleCourse.id, email: 'moodle.demo@example.com' },
      ],
      skipDuplicates: true,
    });
    await prisma.moodleAccessCode.createMany({
      data: [
        {
          offerId: moodleCourse.id,
          codeHash: hashAccessCode('AGUA-2345'),
          codeHint: accessCodeHint('AGUA-2345'),
          expiresAt: moodleCourse.endsAt,
        },
      ],
      skipDuplicates: true,
    });
  }
  console.log(`  ${created} pagos/planes demo nuevos; lista y código Moodle demo (AGUA-2345).`);
}

/**
 * Fase 06: primer SUPER_ADMIN en PRODUCCIÓN (y en cualquier entorno) desde BOOTSTRAP_ADMIN_EMAIL /
 * BOOTSTRAP_ADMIN_PASSWORD / BOOTSTRAP_ADMIN_NAME. Solo actúa si no hay ningún SUPER_ADMIN activo;
 * si el correo ya existe lo promueve sin tocar su contraseña. Ver docs/DEPLOY.md.
 */
async function seedBootstrapAdmin(prisma: PrismaClient): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const result = await bootstrapSuperAdmin(
    prisma,
    {
      email,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      fullName: process.env.BOOTSTRAP_ADMIN_NAME,
    },
    { force: false },
  );
  console.log(`  ${bootstrapMessage(result, email)}`);
}

/**
 * Verificación manual del correo para cuentas que no pueden recibir el OTP (p. ej. el equipo, antes
 * de que alguien pueda entrar al panel). Solo los correos EXPLÍCITOS de BOOTSTRAP_VERIFY_EMAILS
 * (separados por coma); sin la variable no hace nada. Idempotente: ignora las ya verificadas.
 * PENDING_VERIFICATION → ACTIVE (DISABLED se respeta), invalida OTP pendientes y deja auditoría.
 * Quita la variable cuando termine (docs/DEPLOY.md, sección 8).
 */
async function seedVerifyEmails(prisma: PrismaClient): Promise<void> {
  const emails = (process.env.BOOTSTRAP_VERIFY_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    console.log('  BOOTSTRAP_VERIFY_EMAILS vacío: nada que verificar.');
    return;
  }
  const users = await prisma.user.findMany({
    where: { email: { in: emails }, emailVerifiedAt: null },
    select: { id: true, email: true, status: true },
  });
  const now = new Date();
  for (const u of users) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: u.id },
        data: { emailVerifiedAt: now, status: u.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE' },
      }),
      prisma.otpCode.updateMany({
        where: { userId: u.id, purpose: 'EMAIL_VERIFICATION', consumedAt: null },
        data: { consumedAt: now },
      }),
      prisma.adminAuditLog.create({
        data: {
          actorId: null,
          actorEmail: 'bootstrap',
          action: 'user.verify-email',
          entityType: 'User',
          entityId: u.id,
          summary: `Verificó manualmente el correo de ${u.email} (BOOTSTRAP_VERIFY_EMAILS).`,
        },
      }),
    ]);
    console.log(`  Verificado: ${u.email}`);
  }
  console.log(
    `  ${users.length} de ${emails.length} correo(s) verificados (el resto ya lo estaba o no existe).`,
  );
}

/**
 * Datos de DEMOSTRACIÓN para enseñar la plataforma (prisma/demo-data.ts): DEMO_DATA_ACTION=seed los
 * crea (idempotente: si ya existen no hace nada) y DEMO_DATA_ACTION=purge borra SOLO lo marcado como
 * demo. Vacío o cualquier otro valor = no hace nada. Un fallo se registra pero NO impide arrancar
 * (la transacción se revierte completa). Quita la variable al terminar (docs/DEPLOY.md, sección 10).
 */
async function seedDemoDataAction(prisma: PrismaClient): Promise<void> {
  const action = (process.env.DEMO_DATA_ACTION ?? '').trim().toLowerCase();
  if (action !== 'seed' && action !== 'purge') {
    console.log('  DEMO_DATA_ACTION vacío: no se tocan los datos de demostración.');
    return;
  }
  try {
    if (action === 'seed') await seedDemoData(prisma);
    else await purgeDemoData(prisma);
  } catch (error) {
    console.error(
      `  DEMO_DATA_ACTION=${action} falló (sin cambios, la transacción se revirtió):`,
      error,
    );
  }
}

/** Cifras de la landing: crea las que falten, nunca pisa lo editado en el panel (seguro en producción). */
async function seedSiteMetrics(prisma: PrismaClient): Promise<void> {
  const { count } = await prisma.siteMetric.createMany({
    data: DEFAULT_SITE_METRICS.map((metric) => ({ ...metric })),
    skipDuplicates: true,
  });
  console.log(`  ${count} cifras nuevas de la landing.`);
}

/**
 * Tipos de beca por defecto (Agua Viva 10% … Beca especial 71–80%): crea los que falten por `key`,
 * nunca pisa lo editado en el panel (seguro en producción). En BDs migradas ya existen (los inserta la
 * migración `scholarship_types`).
 */
/**
 * Solo siembra los tipos por defecto si el catálogo está vacío (BD nueva). Así, si el equipo borra
 * un tipo desde el panel, no reaparece en el siguiente arranque.
 */
async function seedScholarshipTypes(prisma: PrismaClient): Promise<void> {
  if ((await prisma.scholarshipType.count()) > 0) {
    console.log('  Catálogo de tipos de beca ya existe; no se modifica.');
    return;
  }
  const { count } = await prisma.scholarshipType.createMany({
    data: DEFAULT_SCHOLARSHIP_TYPES.map((type) => ({ ...type })),
    skipDuplicates: true,
  });
  console.log(`  ${count} tipos de beca nuevos.`);
}

const seeders: Array<[name: string, run: Seeder]> = [
  ['Fase 01 — ubicaciones', seedLocations],
  ['Sitio — cifras de la landing', seedSiteMetrics],
  ['Becas — tipos de beca por defecto', seedScholarshipTypes],
  ['Fase 01 — usuarios demo', seedDemoUsers],
  ['Fase 06 — primer SUPER_ADMIN (BOOTSTRAP_ADMIN_*)', seedBootstrapAdmin],
  ['Equipo — verificar correos (BOOTSTRAP_VERIFY_EMAILS)', seedVerifyEmails],
  ['Fase 02 — ofertas demo', seedDemoOffers],
  ['Fase 03 — portal demo', seedDemoPortal],
  ['Fase 04 — postulaciones demo', seedDemoApplications],
  ['Fase 05 — pagos y Moodle demo', seedDemoPayments],
  ['Demo — datos de demostración (DEMO_DATA_ACTION)', seedDemoDataAction],
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no está definida');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await prisma.$queryRaw`SELECT 1`;
    for (const [name, run] of seeders) {
      console.log(`Seed: ${name}...`);
      await run(prisma);
    }
    console.log('Seed completado.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed falló:', error);
  process.exit(1);
});
