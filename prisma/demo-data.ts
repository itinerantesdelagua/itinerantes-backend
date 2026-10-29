/**
 * DATOS DE DEMOSTRACIÓN realistas (para enseñar la plataforma a un cliente) y su PURGA completa.
 *
 *   pnpm demo:seed     # crea los datos demo (idempotente: si ya existen, no hace nada)
 *   pnpm demo:purge    # borra SOLO lo marcado como demo
 *   pnpm demo:counts   # filas por tabla
 *   # Producción: DEMO_DATA_ACTION=seed|purge al arrancar (prisma/seed.ts, docs/DEPLOY.md §10)
 *
 * MARCADORES (lo único que la purga considera demo):
 * - Personas: correo `*@demo.itinerantesdelagua.com` y solo rol PARTICIPANT. Todo lo que cuelga de ellas
 *   (inscripciones, asistencias, postulaciones y su historial/evaluaciones/entrevistas/notas, pagos,
 *   reembolsos, planes y cuotas, notificaciones, OTP, refresh tokens, entregas) se borra con ellas.
 * - Ofertas creadas por este script: slug con prefijo `demo-`. Se borran con sus módulos, recursos,
 *   sesiones, eventos, biblioteca exclusiva, códigos y listas Moodle, y CUALQUIER inscripción /
 *   postulación / pago en ellas (aunque sea de una persona real que probó la demo).
 *   NO se tocan las ofertas demo del seed (SEED_DEMO_DATA): a esas solo se les agregan inscripciones,
 *   postulaciones y pagos de personas demo (se borran por persona); no se les agregan sesiones ni módulos.
 * - Listas Moodle: correos del dominio demo. Códigos Moodle: los de ofertas `demo-` o usados por demo.
 * - Contacto: remitentes del dominio demo.
 * - Auditoría: `actorEmail = 'demo-data'` y registros cuyo `entityId` es una fila demo borrada.
 * - Stripe: ids `cs_demo_`, `pi_demo_`, `ch_demo_`, `cus_demo_`, `pm_demo_`, `re_demo_`; `stripe_events`
 *   con id `evt_demo_…`. La app nunca los envía a Stripe (src/common/utils/demo.ts).
 * Nunca borra cuentas del equipo (cualquier rol distinto de PARTICIPANT) ni nada sin marcador.
 *
 * Todo se inserta directo con Prisma en UNA transacción (todo o nada), sin servicios que envíen correo
 * ni llamen a Stripe. Contraseña de todas las personas demo: `Demo2026agua`.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { DateTime } from 'luxon';
import {
  type ApplicationActorType,
  type ApplicationKind,
  type ApplicationStatus,
  type Currency,
  type EnrollmentSource,
  type EnrollmentStatus,
  type FollowUpNoteKind,
  type FollowUpOutcome,
  type NotificationCategory,
  type NotificationType,
  Prisma,
  PrismaClient,
  type Role,
} from '../src/generated/prisma/client';
import { DEMO_EMAIL_DOMAIN } from '../src/common/utils/demo';
import { cdmxToUtc, utcToCdmx } from '../src/common/utils/time';
import {
  balanceAfterScholarship,
  formatFolio,
  responseDeadline,
} from '../src/modules/applications/policies/application-rules.policy';
import {
  accessCodeHint,
  generateAccessCode,
  hashAccessCode,
} from '../src/modules/moodle/policies/moodle-code.policy';
import { PORTAL_LINKS } from '../src/modules/notifications/portal-links';
import { buildImportantDates } from '../src/modules/offers/policies/important-dates.policy';
import { formatPaymentFolio } from '../src/modules/payments/policies/payment-amounts.policy';
import { transferReference } from '../src/modules/payments/policies/transfer.policy';
import {
  ATTENDANCE_COMMENTS,
  DEMO_CONTACT_MESSAGES,
  DEMO_PEOPLE,
  DEMO_PLACES,
  DEMO_ROSTER_ONLY_EMAILS,
  type DemoPerson,
  EVALUATION_COMMENTS,
  intentLetter,
  MANUAL_ATTENDANCE_REASONS,
  openCallExperience,
  openCallMotivation,
} from './data/demo-data-content';

export const DEMO_PASSWORD = 'Demo2026agua';
export const DEMO_OFFER_SLUG_PREFIX = 'demo-';
export const DEMO_AUDIT_ACTOR_EMAIL = 'demo-data';
const DOMAIN = DEMO_EMAIL_DOMAIN;
const DAY = 86_400_000;
const HOUR = 3_600_000;

type Db = Prisma.TransactionClient;
type Log = (message: string) => void;
type OfferKey =
  'DIP' | 'CUR' | 'FIN' | 'MDL' | 'ECO' | 'GES' | 'HUM' | 'MAS' | 'TAL' | 'APR' | 'SIE' | 'MOO';

/** Ofertas demo del seed (SEED_DEMO_DATA) que se reutilizan si existen. */
const EXISTING_OFFER_SLUGS: Partial<Record<OfferKey, string>> = {
  ECO: 'diplomado-en-ecotecnologias-del-agua',
  GES: 'diplomado-gestion-comunitaria-del-agua-2027',
  HUM: 'curso-humedales-construidos',
  MAS: 'masterclass-banos-secos-en-la-ciudad',
  TAL: 'taller-biofiltro-aguas-jabonosas',
  APR: 'aprendices-del-agua-2027',
  SIE: 'siembra-de-agua-2027',
  MOO: 'curso-captacion-y-cosecha-de-agua-moodle',
};

interface OfferRef {
  key: OfferKey;
  id: string;
  slug: string;
  name: string;
  type: string;
  origin: string;
  startsAt: Date | null;
  endsAt: Date | null;
  priceMxnCents: number | null;
  priceUsdCents: number | null;
}

interface DemoUser {
  idx: number;
  id: string;
  email: string;
  person: DemoPerson;
  countryCode: string;
  divisionName: string;
  municipalityName: string;
  phoneCountryCode: string;
  phoneNumber: string;
  timezone: string;
  currency: Currency;
  stripeCustomerId: string | null;
}

export interface DemoSeedResult {
  skipped: boolean;
  created: Record<string, number>;
}

// =================================================================================================
// Utilidades
// =================================================================================================

/** PRNG determinista (mulberry32): los mismos datos en cada entorno. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeAscii(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** "María de los Ángeles Cruz Ruiz" → "maria.cruz". */
function emailLocal(fullName: string): string {
  const particles = new Set(['de', 'del', 'la', 'los', 'las', 'y']);
  const tokens = fullName.split(/\s+/).filter((t) => !particles.has(t.toLowerCase()));
  // Nombre compuesto + 2 apellidos → apellido paterno; "Felipe de Jesús Aguilar" → "aguilar".
  const surname =
    tokens.length >= 4
      ? tokens[tokens.length - 2]
      : / de /i.test(fullName)
        ? tokens[tokens.length - 1]
        : tokens[1];
  return `${normalizeAscii(tokens[0])}.${normalizeAscii(surname ?? tokens[0])}`;
}

function splitAmount(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) =>
    i === count - 1 ? total - base * (count - 1) : base,
  );
}

const money = (cents: number, currency: Currency) =>
  `${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

// =================================================================================================
// Conteo por tabla (verificación seed / purge)
// =================================================================================================

/** Filas por tabla del esquema `public` (sin `_prisma_migrations`). */
export async function countTables(prisma: PrismaClient | Db): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  const result: Record<string, number> = {};
  for (const { tablename } of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "public"."${tablename.replace(/"/g, '')}"`,
    );
    result[tablename] = Number(rows[0].n);
  }
  return result;
}

// =================================================================================================
// SEED
// =================================================================================================

export async function seedDemoData(
  prisma: PrismaClient,
  options: { now?: Date; log?: Log } = {},
): Promise<DemoSeedResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const existing = await prisma.user.count({
    where: { email: { endsWith: `@${DOMAIN}`, mode: 'insensitive' } },
  });
  if (existing > 0) {
    log(
      `  Ya hay ${existing} personas demo (@${DOMAIN}): no se siembra de nuevo (usa purge primero).`,
    );
    return { skipped: true, created: {} };
  }
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const created = await prisma.$transaction(
    (tx) => new DemoBuilder(tx, options.now ?? new Date(), passwordHash, log).run(),
    { timeout: 10 * 60_000, maxWait: 60_000 },
  );
  for (const [entity, count] of Object.entries(created)) log(`  ${entity}: ${count}`);
  return { skipped: false, created };
}

interface AppInput {
  idx: number;
  key: OfferKey;
  kind: ApplicationKind;
  submittedDaysAgo: number;
  requestedType?: string;
  reviewDaysAgo?: number;
  interview?: {
    at: Date;
    status: 'SCHEDULED' | 'COMPLETED';
    scheduledDaysAgo: number;
    /** Las entrevistas solo aceptan enlaces de zoom.us (HU-31). */
    provider: 'zoom';
  };
  decision?: {
    outcome: 'APPROVED' | 'NOT_SELECTED';
    daysAgo: number;
    type?: string;
    percent?: number;
    note?: string;
  };
  /** Cierre: ENROLLED (pago/confirmación) o EXPIRED (plazo vencido). */
  final?: { status: 'ENROLLED' | 'EXPIRED'; at: Date; actor: ApplicationActorType };
  evaluations?: number;
  followUps?: Array<{
    kind: FollowUpNoteKind;
    outcome?: FollowUpOutcome;
    body: string;
    daysAgo: number;
  }>;
  pendingTransferDaysAgo?: number;
  transferRejectedDaysAgo?: number;
}

interface CreatedApp {
  id: string;
  kind: ApplicationKind;
  balanceCents: number;
  currency: Currency;
  decidedAt: Date | null;
  number?: number;
}

class DemoBuilder {
  private readonly rng = mulberry32(20261029);
  private readonly cdmxNow: DateTime;
  private readonly users: DemoUser[] = [];
  private readonly offers = new Map<OfferKey, OfferRef>();
  private readonly scholarshipTypes = new Map<string, { id: string; name: string }>();
  private staff: {
    coordinator: string | null;
    decider: string | null;
    committee: string[];
    followUp: string | null;
    finance: string | null;
    any: string[];
  } = { coordinator: null, decider: null, committee: [], followUp: null, finance: null, any: [] };

  private readonly apps: Array<{ input: AppInput; data: Prisma.ApplicationUncheckedCreateInput }> =
    [];
  private readonly appMeta = new Map<string, CreatedApp>();
  private readonly enrollments: Array<Prisma.EnrollmentUncheckedCreateInput & { id: string }> = [];
  private readonly enrollmentKeys = new Set<string>();
  private readonly plans: Prisma.InstallmentPlanUncheckedCreateInput[] = [];
  private readonly payments: Array<
    Prisma.PaymentUncheckedCreateInput & { id: string; transferAppId?: string }
  > = [];
  private readonly refunds: Prisma.PaymentRefundUncheckedCreateInput[] = [];
  private readonly notifications: Prisma.NotificationCreateManyInput[] = [];
  private readonly auditTargets: Record<string, string> = {};
  private readonly counts: Record<string, number> = {};

  constructor(
    private readonly tx: Db,
    private readonly now: Date,
    private readonly passwordHash: string,
    private readonly log: Log,
  ) {
    this.cdmxNow = utcToCdmx(now);
  }

  // --- tiempo y aleatoriedad ----------------------------------------------------------------------

  private ago(days: number, hours = 0): Date {
    return new Date(this.now.getTime() - days * DAY - hours * HOUR);
  }

  /** Día relativo (hora CDMX) → instante UTC. */
  private at(dayOffset: number, time: string): Date {
    return cdmxToUtc(this.cdmxNow.plus({ days: dayOffset }).toISODate()!, time);
  }

  private plus(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * HOUR);
  }

  private int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  private sid(prefix: string, length = 24): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = prefix;
    for (let i = 0; i < length; i++) out += alphabet[Math.floor(this.rng() * alphabet.length)];
    return out;
  }

  private digits(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += String(this.int(0, 9));
    return out;
  }

  private zoomUrl(): { joinUrl: string; hostUrl: string } {
    const id = `8${this.digits(10)}`;
    return {
      joinUrl: `https://us02web.zoom.us/j/${id}?pwd=${this.sid('', 32)}`,
      hostUrl: `https://us02web.zoom.us/s/${id}?zak=${this.sid('', 40)}`,
    };
  }

  private meetUrl(): string {
    const part = (n: number) =>
      Array.from({ length: n }, () => 'abcdefghijkmnopqrstuvwxyz'[this.int(0, 24)]).join('');
    return `https://meet.google.com/${part(3)}-${part(4)}-${part(3)}`;
  }

  private bump(entity: string, n = 1): void {
    this.counts[entity] = (this.counts[entity] ?? 0) + n;
  }

  // --- orquestación ---------------------------------------------------------------------------------

  async run(): Promise<Record<string, number>> {
    await this.loadReferences();
    await this.createOffers();
    await this.createUsers();
    this.buildScenarios();
    await this.flushApplications();
    await this.createMoodle();
    await this.flushEnrollments();
    await this.flushPlansAndPayments();
    await this.createAttendance();
    this.buildContentNotifications();
    await this.flushNotifications();
    await this.createContactMessages();
    await this.createAudit();
    return this.counts;
  }

  private async loadReferences(): Promise<void> {
    const staff = await this.tx.user.findMany({
      where: {
        status: 'ACTIVE',
        NOT: { email: { endsWith: `@${DOMAIN}`, mode: 'insensitive' } },
        roles: {
          hasSome: [
            'SUPER_ADMIN',
            'ACADEMIC_COORDINATOR',
            'REVIEW_COMMITTEE',
            'REVIEW_DECIDER',
            'FOLLOW_UP',
            'FINANCE',
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, roles: true },
    });
    const withRole = (role: Role) => staff.filter((s) => s.roles.includes(role)).map((s) => s.id);
    const admin = withRole('SUPER_ADMIN')[0] ?? null;
    this.staff = {
      coordinator: withRole('ACADEMIC_COORDINATOR')[0] ?? admin,
      decider: withRole('REVIEW_DECIDER')[0] ?? admin,
      committee: [...new Set([...withRole('REVIEW_COMMITTEE'), ...withRole('REVIEW_DECIDER')])],
      followUp: withRole('FOLLOW_UP')[0] ?? admin,
      finance: withRole('FINANCE')[0] ?? admin,
      any: staff.map((s) => s.id),
    };
    const types = await this.tx.scholarshipType.findMany({
      select: { id: true, key: true, name: true },
    });
    for (const t of types) this.scholarshipTypes.set(t.key, { id: t.id, name: t.name });

    for (const [key, slug] of Object.entries(EXISTING_OFFER_SLUGS) as Array<[OfferKey, string]>) {
      const offer = await this.tx.offer.findUnique({ where: { slug } });
      if (offer && offer.publicationStatus === 'PUBLISHED') this.offers.set(key, { key, ...offer });
      else this.log(`  Aviso: no existe la oferta "${slug}"; se omiten sus escenarios.`);
    }
    this.log(
      `  Equipo encontrado: ${staff.length} cuentas (comité: ${this.staff.committee.length}).`,
    );
  }

  // =================================================================================================
  // Ofertas demo (slug `demo-`)
  // =================================================================================================

  private async createOffers(): Promise<void> {
    const teachers = await this.tx.teacher.findMany({ select: { id: true, slug: true } });
    const teacherId = new Map(teachers.map((t) => [t.slug, t.id]));
    const img = (text: string, bg: string) =>
      `https://placehold.co/1200x630/${bg}/FFFFFF/png?text=${encodeURIComponent(text)}`;
    const typeIds = [...this.scholarshipTypes.values()].map((t) => t.id);

    // --- Diplomado en curso (sábados y domingos, 10 semanas, 20 sesiones · 60 h) ---
    let first = this.cdmxNow.minus({ days: 35 });
    while (first.weekday !== 6) first = first.minus({ days: 1 });
    const dipDays: string[] = [];
    for (let w = 0; w < 10; w++) {
      dipDays.push(
        first.plus({ weeks: w }).toISODate()!,
        first.plus({ weeks: w, days: 1 }).toISODate()!,
      );
    }
    const dipStart = cdmxToUtc(dipDays[0], '10:00');
    const dipEnd = cdmxToUtc(dipDays[dipDays.length - 1], '13:00');
    const dipZoom = this.zoomUrl();
    const dipSessions = dipDays.map((d, i) => ({
      startsAt: cdmxToUtc(d, '10:00'),
      endsAt: cdmxToUtc(d, '13:00'),
      moduleIndex: Math.floor(i / 4),
      ...dipZoom,
    }));
    const firstUpcoming = dipSessions.findIndex((s) => s.startsAt > this.now);
    const dip = await this.createOffer({
      key: 'DIP',
      data: {
        slug: 'demo-diplomado-agua-y-territorio',
        name: 'Diplomado Agua y Territorio',
        type: 'DIPLOMA',
        modality: 'ONLINE_LIVE',
        origin: 'NAS',
        cohortLabel: `Generación ${first.year}`,
        summary:
          'Diseña soluciones basadas en la naturaleza para el agua de tu territorio: captación, saneamiento, infiltración y gestión comunitaria.',
        description:
          'Diplomado en vivo de 60 horas en cinco módulos, con prácticas de diseño, acompañamiento docente y un proyecto final aplicado a tu comunidad. Incluye grabaciones de cada sesión y materiales descargables.',
        learningOutcomes: [
          'Leer el agua de un territorio con herramientas de diagnóstico participativo',
          'Dimensionar sistemas de captación pluvial para vivienda y escuela',
          'Diseñar humedales construidos y biofiltros para aguas grises',
          'Planear obras de infiltración y recarga',
          'Formular un proyecto comunitario de regeneración hídrica',
        ],
        requirements:
          'Disponibilidad sábados y domingos de 10:00 a 13:00 (hora CDMX) y conexión estable.',
        coverImageKey: img('Diplomado Agua y Territorio', '0E7490'),
        carouselImageKeys: [img('Prácticas de diseño', '155E75')],
        publicTopic: null,
        enrollmentOpensAt: new Date(dipStart.getTime() - 110 * DAY),
        enrollmentClosesAt: new Date(dipStart.getTime() - DAY),
        startsAt: dipStart,
        endsAt: dipEnd,
        finalProjectDueAt: new Date(dipEnd.getTime() + 21 * DAY),
        totalMinutes: 60 * 60,
        scheduleRule: { weekdays: [6, 7], startTime: '10:00', endTime: '13:00', excludedDates: [] },
        calendarCategory: 'TRAINING',
        priceMxnCents: 980_000,
        priceUsdCents: 56_000,
        installmentsEnabled: true,
        installmentsMax: 3,
        scholarshipEnabled: true,
        scholarshipOpensAt: new Date(dipStart.getTime() - 110 * DAY),
        scholarshipClosesAt: new Date(dipStart.getTime() - 60 * DAY),
        attendanceWindowHours: 24,
        whatsappGroupUrl: `https://chat.whatsapp.com/${this.sid('', 22)}`,
        whatsappVisibleFrom: new Date(dipStart.getTime() - 7 * DAY),
        whatsappNotifiedAt: new Date(dipStart.getTime() - 7 * DAY),
        classroomWelcome:
          '¡Bienvenida, bienvenido al Diplomado! Únete al grupo de WhatsApp, revisa la presentación del Módulo 1 y ten a la mano tu cuaderno de diagnóstico.',
        finalProjectSubmissionEnabled: true,
        finalProjectGuidelines:
          'Diseña una solución para el agua de tu comunidad: diagnóstico, propuesta, dimensionamiento y plan de mantenimiento. PDF, DOCX, PPTX o ZIP (máx. 20 MB).',
      },
      teacherIds: ['ana-solis-rios', 'tomas-ek-canche'].map((s) => teacherId.get(s)),
      scholarshipTypeIds: typeIds,
      modules: [
        ['Leer el agua del territorio', 'Ciclo hidrosocial, cuencas y diagnóstico participativo.'],
        ['Captación y cosecha de lluvia', 'Demanda, superficies, filtros y almacenamiento.'],
        ['Saneamiento ecológico', 'Humedales construidos, biofiltros y baños secos.'],
        ['Infiltración y recarga', 'Zanjas, pozos de absorción y obras de conservación de suelo.'],
        ['Proyecto final', 'Integración y presentación de propuestas.'],
      ],
      sessions: dipSessions.map((s, i) => {
        if (firstUpcoming >= 0 && i === firstUpcoming + 1) {
          // Reprogramada: del domingo al viernes previo, 18:00–21:00.
          const moved = utcToCdmx(s.startsAt).minus({ days: 2 }).toISODate()!;
          return {
            ...s,
            startsAt: cdmxToUtc(moved, '18:00'),
            endsAt: cdmxToUtc(moved, '21:00'),
            originalStartsAt: s.startsAt,
            changeReason:
              'Se mueve al viernes por el encuentro regional de comités de agua; mismo enlace de Zoom.',
          };
        }
        if (firstUpcoming >= 0 && i === firstUpcoming + 4) {
          return {
            ...s,
            status: 'CANCELLED' as const,
            cancelledAt: this.ago(2),
            changeReason:
              'Cancelada por el puente festivo. El contenido se cubre en la sesión siguiente y quedará grabado.',
          };
        }
        return s;
      }),
      publishedModules: 3,
    });

    // --- Curso en curso (3 sesiones semanales, Google Meet) ---
    const curDays = [-9, -2, 5].map((d) => this.cdmxNow.plus({ days: d }));
    const meet = this.meetUrl();
    await this.createOffer({
      key: 'CUR',
      data: {
        slug: 'demo-curso-biofiltros-y-jardineras',
        name: 'Curso de Biofiltros y jardineras de agua',
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        origin: 'NAS',
        summary: 'Tres sesiones para diseñar y construir un biofiltro de aguas jabonosas en casa.',
        description:
          'Curso práctico de 9 horas: principios de tratamiento, capas filtrantes, plantas, conexión y mantenimiento de jardineras de agua.',
        learningOutcomes: [
          'Dimensionar un biofiltro doméstico',
          'Elegir plantas y sustratos',
          'Dar mantenimiento',
        ],
        coverImageKey: img('Biofiltros y jardineras', '15803D'),
        carouselImageKeys: [],
        publicTopic: null,
        enrollmentOpensAt: cdmxToUtc(curDays[0].minus({ days: 45 }).toISODate()!, '00:00'),
        enrollmentClosesAt: cdmxToUtc(curDays[0].minus({ days: 1 }).toISODate()!, '23:59'),
        startsAt: cdmxToUtc(curDays[0].toISODate()!, '18:00'),
        endsAt: cdmxToUtc(curDays[2].toISODate()!, '21:00'),
        totalMinutes: 9 * 60,
        scheduleRule: { weekdays: [curDays[0].weekday], startTime: '18:00', endTime: '21:00' },
        calendarCategory: 'TRAINING',
        priceMxnCents: 180_000,
        priceUsdCents: 10_000,
        whatsappGroupUrl: `https://chat.whatsapp.com/${this.sid('', 22)}`,
        whatsappNotifiedAt: this.ago(10),
      },
      teacherIds: [teacherId.get('rafael-ortiz-luna')],
      modules: [['Contenido', 'Las tres sesiones del curso.']],
      sessions: curDays.map((d) => ({
        startsAt: cdmxToUtc(d.toISODate()!, '18:00'),
        endsAt: cdmxToUtc(d.toISODate()!, '21:00'),
        moduleIndex: 0,
        joinUrl: meet,
        hostUrl: meet,
      })),
      publishedModules: 1,
    });

    // --- Curso finalizado (hace ~2 meses), con cuotas habilitadas ---
    const finDays = [-70, -63, -56].map((d) => this.cdmxNow.plus({ days: d }));
    const finZoom = this.zoomUrl();
    await this.createOffer({
      key: 'FIN',
      data: {
        slug: 'demo-curso-saneamiento-ecologico',
        name: 'Curso de Saneamiento ecológico y baños secos',
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        origin: 'NAS',
        cohortLabel: `Edición ${finDays[0].year}`,
        summary: 'Edición finalizada: ciclo de nutrientes, tipos de baños secos y manejo seguro.',
        description: 'Curso de 9 horas con casos de estudio rurales y urbanos.',
        learningOutcomes: [
          'Elegir el baño seco adecuado',
          'Manejar de forma segura los subproductos',
        ],
        coverImageKey: img('Saneamiento ecológico', '7C3AED'),
        carouselImageKeys: [],
        publicTopic: null,
        enrollmentOpensAt: cdmxToUtc(finDays[0].minus({ days: 60 }).toISODate()!, '00:00'),
        enrollmentClosesAt: cdmxToUtc(finDays[0].minus({ days: 1 }).toISODate()!, '23:59'),
        startsAt: cdmxToUtc(finDays[0].toISODate()!, '18:00'),
        endsAt: cdmxToUtc(finDays[2].toISODate()!, '21:00'),
        totalMinutes: 9 * 60,
        scheduleRule: { weekdays: [finDays[0].weekday], startTime: '18:00', endTime: '21:00' },
        calendarCategory: 'TRAINING',
        priceMxnCents: 150_000,
        priceUsdCents: 8_500,
        installmentsEnabled: true,
        installmentsMax: 2,
      },
      teacherIds: [teacherId.get('rafael-ortiz-luna')],
      modules: [['Contenido', 'Saneamiento ecológico: teoría, diseño y casos.']],
      sessions: finDays.map((d) => ({
        startsAt: cdmxToUtc(d.toISODate()!, '18:00'),
        endsAt: cdmxToUtc(d.toISODate()!, '21:00'),
        moduleIndex: 0,
        ...finZoom,
      })),
      publishedModules: 1,
    });

    // --- Curso de origen Moodle (en curso; acceso por lista o código) ---
    const mdlDays = [-5, 2, 9].map((d) => this.cdmxNow.plus({ days: d }));
    const mdlZoom = this.zoomUrl();
    await this.createOffer({
      key: 'MDL',
      data: {
        slug: 'demo-curso-monitoreo-calidad-del-agua',
        name: 'Curso de Monitoreo comunitario de la calidad del agua',
        type: 'COURSE',
        modality: 'ONLINE_LIVE',
        origin: 'MOODLE',
        summary:
          'Cohorte administrada en Moodle: activa aquí tu acceso a las sesiones y materiales.',
        description:
          'Aprende a tomar muestras, usar kits de campo y organizar brigadas de monitoreo. Inscripción y pago gestionados en Moodle.',
        learningOutcomes: ['Tomar y conservar muestras', 'Interpretar parámetros básicos'],
        coverImageKey: img('Monitoreo de calidad del agua', '0369A1'),
        carouselImageKeys: [],
        publicTopic: null,
        enrollmentOpensAt: cdmxToUtc(mdlDays[0].minus({ days: 40 }).toISODate()!, '00:00'),
        enrollmentClosesAt: cdmxToUtc(mdlDays[0].minus({ days: 1 }).toISODate()!, '23:59'),
        startsAt: cdmxToUtc(mdlDays[0].toISODate()!, '18:00'),
        endsAt: cdmxToUtc(mdlDays[2].toISODate()!, '21:00'),
        totalMinutes: 9 * 60,
        scheduleRule: { weekdays: [mdlDays[0].weekday], startTime: '18:00', endTime: '21:00' },
        calendarCategory: 'TRAINING',
        moodleCourseUrl: 'https://moodle.itinerantesdelagua.com/course/view.php?id=87',
      },
      teacherIds: [teacherId.get('lucia-herrera-mendoza')],
      modules: [['Contenido', 'Sesiones en vivo y materiales de la cohorte Moodle.']],
      sessions: mdlDays.map((d) => ({
        startsAt: cdmxToUtc(d.toISODate()!, '18:00'),
        endsAt: cdmxToUtc(d.toISODate()!, '21:00'),
        moduleIndex: 0,
        ...mdlZoom,
      })),
      publishedModules: 1,
    });

    // Evento manual del calendario y recurso de biblioteca exclusivo del diplomado.
    const visit = this.cdmxNow.plus({ days: 8 }).toISODate()!;
    await this.tx.calendarEvent.create({
      data: {
        kind: 'MANUAL',
        title: 'Visita virtual: humedal comunitario de Amatlán',
        description: 'Recorrido en vivo con la comunidad que opera el humedal (solo inscritos).',
        category: 'COMMUNITY',
        audience: 'OFFER_ENROLLED',
        offerId: dip.id,
        startsAt: cdmxToUtc(visit, '17:00'),
        endsAt: cdmxToUtc(visit, '18:00'),
        joinUrl: this.meetUrl(),
      },
    });
    await this.tx.libraryResource.create({
      data: {
        slug: 'demo-cuaderno-de-diagnostico-hidrico',
        title: 'Cuaderno de diagnóstico hídrico (Diplomado Agua y Territorio)',
        description: 'Fichas de campo para el diagnóstico del Módulo 1.',
        type: 'COURSE_MATERIAL',
        author: 'Equipo docente',
        keywords: ['diagnóstico', 'cuenca', 'fichas'],
        url: 'https://www.gob.mx/conagua',
        audience: 'OFFER_ENROLLED',
        offerId: dip.id,
        visibility: 'PUBLISHED',
      },
    });
    this.bump('calendar_events (manual)');
    this.bump('library_resources');
  }

  private async createOffer(def: {
    key: OfferKey;
    data: Omit<Prisma.OfferUncheckedCreateInput, 'publicationStatus' | 'publishedAt'>;
    teacherIds: Array<string | undefined>;
    scholarshipTypeIds?: string[];
    modules: Array<[string, string]>;
    sessions: Array<{
      startsAt: Date;
      endsAt: Date;
      moduleIndex: number;
      joinUrl: string;
      hostUrl: string;
      status?: 'SCHEDULED' | 'CANCELLED';
      originalStartsAt?: Date;
      changeReason?: string;
      cancelledAt?: Date;
    }>;
    publishedModules: number;
  }): Promise<OfferRef> {
    const offer = await this.tx.offer.create({
      data: {
        ...def.data,
        publicationStatus: 'PUBLISHED',
        publishedAt: def.data.enrollmentOpensAt ?? this.ago(60),
        createdAt: new Date(
          ((def.data.enrollmentOpensAt as Date) ?? this.ago(60)).getTime() - 5 * DAY,
        ),
      },
    });
    const ref: OfferRef = { key: def.key, ...offer };
    this.offers.set(def.key, ref);
    this.auditTargets[`offer:${def.key}`] = offer.id;
    this.bump('offers (demo-)');

    const teacherIds = def.teacherIds.filter((t): t is string => !!t);
    if (teacherIds.length) {
      await this.tx.offerTeacher.createMany({
        data: teacherIds.map((teacherId, position) => ({ offerId: offer.id, teacherId, position })),
      });
    }
    if (def.scholarshipTypeIds?.length) {
      await this.tx.offerScholarshipType.createMany({
        data: def.scholarshipTypeIds.map((scholarshipTypeId) => ({
          offerId: offer.id,
          scholarshipTypeId,
        })),
      });
    }

    const moduleIds: string[] = [];
    for (const [index, [title, description]] of def.modules.entries()) {
      const published = index < def.publishedModules;
      // El siguiente al último publicado queda con publicación programada (HU-28).
      const scheduled = !published && index === def.publishedModules;
      const module = await this.tx.offerModule.create({
        data: {
          offerId: offer.id,
          position: index + 1,
          title,
          description,
          teacherId: teacherIds[index % Math.max(teacherIds.length, 1)] ?? null,
          visibility: published || scheduled ? 'PUBLISHED' : 'HIDDEN',
          publishAt: scheduled ? this.at(3, '09:00') : null,
          publishedNotifiedAt: published ? (offer.startsAt ?? this.now) : null,
        },
      });
      moduleIds.push(module.id);
      this.bump('offer_modules');
      if (published || scheduled) {
        const resources: Prisma.ModuleResourceCreateManyInput[] = [
          {
            moduleId: module.id,
            type: 'PRESENTATION' as const,
            title: `Presentación — ${title}`,
            description: 'Diapositivas de la sesión.',
            url: 'https://www.fao.org/land-water/es/',
            position: 1,
          },
          {
            moduleId: module.id,
            type: 'PRE_READING' as const,
            title: `Lectura previa — ${title}`,
            url: 'https://www.unwater.org/',
            position: 1,
          },
          {
            moduleId: module.id,
            type: 'ACTIVITY' as const,
            title: `Actividad — ${title}`,
            description: 'Comparte tu avance en el grupo y súbelo antes de la siguiente sesión.',
            url: 'https://sigagis.conagua.gob.mx/',
            activityDueAt: def.sessions.find((s) => s.moduleIndex === index)?.endsAt ?? null,
            position: 1,
          },
        ].map((r) => ({
          ...r,
          visibility: 'PUBLISHED' as const,
          publishAt: scheduled ? this.at(3, '09:00') : null,
          publishedNotifiedAt: published ? (offer.startsAt ?? this.now) : null,
        }));
        await this.tx.moduleResource.createMany({ data: resources });
        this.bump('module_resources', resources.length);
      }
    }

    await this.tx.offerSession.createMany({
      data: def.sessions.map(({ moduleIndex, ...s }) => {
        const past = s.endsAt < this.now && s.status !== 'CANCELLED';
        const recordingAt = new Date(s.endsAt.getTime() + 20 * HOUR);
        const recorded = past && recordingAt < this.now;
        return {
          ...s,
          offerId: offer.id,
          moduleId: moduleIds[moduleIndex] ?? null,
          category: offer.calendarCategory,
          recordingUrl: recorded ? `https://us02web.zoom.us/rec/share/${this.sid('', 43)}` : null,
          recordingPublishedAt: recorded ? recordingAt : null,
          attendanceNotifiedAt: past ? s.endsAt : null,
        };
      }),
    });
    this.bump('offer_sessions', def.sessions.length);

    const dates = buildImportantDates(offer);
    if (dates.length) {
      await this.tx.calendarEvent.createMany({
        data: dates.map((d) => ({ ...d, offerId: offer.id, category: 'IMPORTANT_DATES' as const })),
      });
      this.bump('calendar_events (fechas importantes)', dates.length);
    }
    return ref;
  }

  // =================================================================================================
  // Personas demo
  // =================================================================================================

  private async createUsers(): Promise<void> {
    const states = await this.tx.adminDivision.findMany({
      where: { countryCode: 'MX' },
      include: { municipalities: true },
    });
    const usedLocals = new Set<string>();
    const locals = DEMO_PEOPLE.map((p) => {
      let local = emailLocal(p.fullName);
      for (let n = 2; usedLocals.has(local); n++) local = `${emailLocal(p.fullName)}${n}`;
      usedLocals.add(local);
      return local;
    });
    const taken = new Set(
      (
        await this.tx.user.findMany({
          where: { username: { in: locals } },
          select: { username: true },
        })
      ).map((u) => u.username),
    );

    for (const [idx, person] of DEMO_PEOPLE.entries()) {
      const place = DEMO_PLACES[person.place];
      let location: {
        countryCode: string;
        divisionId: string | null;
        divisionName: string;
        municipalityId: string | null;
        municipalityName: string;
        phoneCountryCode: string;
        phoneNumber: string;
      };
      if ('state' in place) {
        const state = states.find((s) => s.code === place.state);
        const mun = state?.municipalities.find((m) => m.code === place.municipality);
        location = {
          countryCode: 'MX',
          divisionId: state?.id ?? null,
          divisionName: state?.name ?? 'Ciudad de México',
          municipalityId: mun?.id ?? null,
          municipalityName: mun?.name ?? 'Coyoacán',
          phoneCountryCode: '+52',
          phoneNumber: place.area + this.digits(10 - place.area.length),
        };
      } else {
        location = {
          countryCode: place.country,
          divisionId: null,
          divisionName: place.division,
          municipalityId: null,
          municipalityName: place.city,
          phoneCountryCode: place.phoneCode,
          phoneNumber: place.area + this.digits(place.digits - place.area.length),
        };
      }
      const local = locals[idx];
      const username = taken.has(local) ? `${local}.${this.digits(2)}`.slice(0, 30) : local;
      const email = `${local}@${DOMAIN}`;
      const registeredAt = this.ago(this.int(120, 200), this.int(0, 23));
      const status = idx === 59 ? 'DISABLED' : idx >= 57 ? 'PENDING_VERIFICATION' : 'ACTIVE';
      const user = await this.tx.user.create({
        data: {
          fullName: person.fullName,
          username,
          email,
          ...location,
          timezone: place.timezone,
          passwordHash: this.passwordHash,
          status,
          roles: ['PARTICIPANT'],
          emailVerifiedAt: status === 'PENDING_VERIFICATION' ? null : this.plus(registeredAt, 0.1),
          lastLoginAt: status === 'ACTIVE' ? this.ago(this.int(0, 12), this.int(0, 23)) : null,
          openCallsSeenAt: status === 'ACTIVE' ? this.ago(this.int(1, 20)) : null,
          createdAt: idx >= 57 && idx < 59 ? this.ago(this.int(1, 3)) : registeredAt,
        },
      });
      this.users.push({
        idx,
        id: user.id,
        email,
        person,
        countryCode: location.countryCode,
        divisionName: location.divisionName,
        municipalityName: location.municipalityName,
        phoneCountryCode: location.phoneCountryCode,
        phoneNumber: location.phoneNumber,
        timezone: place.timezone,
        currency: location.countryCode === 'MX' ? 'MXN' : 'USD',
        stripeCustomerId: null,
      });
      this.notify(this.users[idx], {
        type: 'GENERAL',
        category: 'GENERAL',
        title: 'Te damos la bienvenida a la Escuela Itinerante del Agua',
        body: 'Aquí encontrarás tu formación, el calendario, la biblioteca y tus avisos.',
        at: registeredAt,
        actionLabel: 'Ir a mi dashboard',
        actionPath: PORTAL_LINKS.dashboard(),
        email: false,
        dedupe: 'welcome',
      });
    }
    this.bump('users (personas demo)', this.users.length);
    this.auditTargets.disabledUser = this.users[59].id;
  }

  // =================================================================================================
  // Escenarios (inscripciones, postulaciones, pagos)
  // =================================================================================================

  private u(idx: number): DemoUser {
    return this.users[idx];
  }

  private price(offer: OfferRef, currency: Currency): number | null {
    return currency === 'MXN' ? offer.priceMxnCents : offer.priceUsdCents;
  }

  private customer(user: DemoUser): string {
    user.stripeCustomerId ??= this.sid('cus_demo_', 14);
    return user.stripeCustomerId;
  }

  private card(): { cardBrand: string; cardLast4: string } {
    const brand = this.pick(['visa', 'visa', 'mastercard', 'mastercard', 'amex']);
    return { cardBrand: brand, cardLast4: this.digits(4) };
  }

  private enroll(
    user: DemoUser,
    offer: OfferRef,
    data: {
      status: EnrollmentStatus;
      source: EnrollmentSource;
      at: Date;
      origin?: 'NAS' | 'MOODLE';
      applicationId?: string;
      completedAt?: Date;
      suspendedAt?: Date;
      statusReason?: string;
    },
  ): string {
    const key = `${user.idx}:${offer.key}`;
    if (this.enrollmentKeys.has(key)) throw new Error(`Inscripción demo duplicada ${key}`);
    this.enrollmentKeys.add(key);
    const id = randomUUID();
    this.enrollments.push({
      id,
      userId: user.id,
      offerId: offer.id,
      status: data.status,
      origin: data.origin ?? 'NAS',
      source: data.source,
      applicationId: data.applicationId ?? null,
      activatedAt: data.status === 'PENDING_PAYMENT' ? null : data.at,
      completedAt: data.completedAt ?? null,
      suspendedAt: data.suspendedAt ?? null,
      statusReason: data.statusReason ?? null,
      createdAt: data.at,
    });
    if (data.status !== 'PENDING_PAYMENT') {
      this.notify(user, {
        type: data.origin === 'MOODLE' ? 'MOODLE_ENROLLMENT_LINKED' : 'ENROLLMENT_CONFIRMED',
        category: 'TRAINING',
        title:
          data.origin === 'MOODLE'
            ? `Tu acceso a ${offer.name} está activo`
            : `Inscripción confirmada: ${offer.name}`,
        body:
          data.origin === 'MOODLE'
            ? 'Vinculamos tu inscripción de Moodle. Ya puedes ver sesiones y materiales en Mi formación.'
            : 'Ya estás inscrita/o. Revisa el aula para conocer las fechas y materiales.',
        at: this.plus(data.at, 0.02),
        actionLabel: 'Ir a mi aula',
        actionPath: PORTAL_LINKS.classroom(offer.id),
        data: { offerId: offer.id, enrollmentId: id },
        dedupe: `enrollment:${id}`,
      });
    }
    return id;
  }

  /** Cobro con tarjeta (Checkout o cuota off-session). */
  private cardPayment(
    user: DemoUser,
    offer: OfferRef,
    data: {
      concept: 'FULL_PRICE' | 'BALANCE' | 'INSTALLMENT';
      amountCents: number;
      currency: Currency;
      at: Date;
      enrollmentId?: string | null;
      applicationId?: string | null;
      planId?: string;
      installmentId?: string;
      card?: { cardBrand: string; cardLast4: string };
      checkout?: boolean;
      status?: 'PAID' | 'FAILED' | 'CANCELLED';
      refundedCents?: number;
      label?: string;
    },
  ): string {
    const id = randomUUID();
    const status = data.status ?? 'PAID';
    const checkout = data.checkout ?? true;
    const createdAt = checkout ? new Date(data.at.getTime() - 4 * 60_000) : data.at;
    this.customer(user);
    this.payments.push({
      id,
      userId: user.id,
      offerId: offer.id,
      enrollmentId: data.enrollmentId ?? null,
      applicationId: data.applicationId ?? null,
      planId: data.planId ?? null,
      installmentId: data.installmentId ?? null,
      concept: data.concept,
      method: 'CARD',
      status,
      amountCents: data.amountCents,
      currency: data.currency,
      refundedCents: data.refundedCents ?? 0,
      stripeCheckoutSessionId: checkout ? this.sid('cs_demo_') : null,
      stripePaymentIntentId: status === 'CANCELLED' ? null : this.sid('pi_demo_'),
      stripeChargeId: status === 'PAID' ? this.sid('ch_demo_') : null,
      checkoutExpiresAt: checkout ? new Date(createdAt.getTime() + 32 * 60_000) : null,
      ...(status === 'CANCELLED' ? {} : (data.card ?? this.card())),
      failureCode: status === 'FAILED' ? 'card_declined' : null,
      failureMessage:
        status === 'FAILED' ? 'La tarjeta fue rechazada por fondos insuficientes.' : null,
      paidAt: status === 'PAID' ? data.at : null,
      failedAt: status === 'FAILED' ? data.at : null,
      cancelledAt: status === 'CANCELLED' ? new Date(createdAt.getTime() + 35 * 60_000) : null,
      createdAt,
    });
    if (status === 'PAID') {
      this.notify(user, {
        type: data.concept === 'INSTALLMENT' ? 'INSTALLMENT_PAID' : 'PAYMENT_CONFIRMED',
        category: 'PAYMENTS',
        title:
          data.concept === 'INSTALLMENT'
            ? `Cuota pagada: ${offer.name}`
            : `Pago confirmado: ${offer.name}`,
        body: `Recibimos tu pago de ${money(data.amountCents, data.currency)}${data.label ? ` (${data.label})` : ''}. Puedes descargar tu recibo en Mis pagos.`,
        at: this.plus(data.at, 0.01),
        actionLabel: 'Ver recibo',
        actionPath: PORTAL_LINKS.payment(id),
        data: { paymentId: id, offerId: offer.id },
        dedupe: `payment:${id}`,
      });
    }
    return id;
  }

  /** Inscripción pagada en una exhibición con tarjeta (HU-22). */
  private fullPayment(idx: number, key: OfferKey, daysAgo: number, refundCents = 0): string | null {
    const user = this.u(idx);
    const offer = this.offers.get(key);
    if (!offer) return null;
    const amount = this.price(offer, user.currency);
    if (amount === null) return null;
    const at = this.ago(daysAgo, this.int(0, 10));
    const finished = !!offer.endsAt && offer.endsAt < this.now;
    const enrollmentId = this.enroll(user, offer, {
      status: finished ? 'COMPLETED' : 'ACTIVE',
      source: 'PAYMENT',
      at,
      completedAt: finished ? new Date(offer.endsAt!.getTime() + 3 * DAY) : undefined,
    });
    return this.cardPayment(user, offer, {
      concept: 'FULL_PRICE',
      amountCents: amount,
      currency: user.currency,
      at,
      enrollmentId,
      refundedCents: refundCents,
    });
  }

  /** Plan de cuotas (HU-24) con sus pagos. */
  private installmentPlan(
    user: DemoUser,
    offer: OfferRef,
    data: {
      concept: 'FULL_PRICE' | 'BALANCE';
      total: number;
      currency: Currency;
      enrollmentId: string;
      applicationId?: string;
      status: 'CURRENT' | 'PAST_DUE' | 'DELINQUENT' | 'COMPLETED';
      dues: Array<{
        at: Date;
        status: 'PAID' | 'FAILED' | 'SCHEDULED';
        attempts?: number;
        nextRetryAt?: Date | null;
      }>;
      failedSince?: Date;
      delinquentAt?: Date;
      accessSuspendedAt?: Date;
    },
  ): string {
    const planId = randomUUID();
    const card = this.card();
    const amounts = splitAmount(data.total, data.dues.length);
    const installments = data.dues.map((due, i) => ({
      id: randomUUID(),
      sequence: i + 1,
      amountCents: amounts[i],
      dueAt: due.at,
      status: due.status,
      attempts: due.attempts ?? (due.status === 'SCHEDULED' ? 0 : 1),
      lastAttemptAt: due.status === 'SCHEDULED' ? null : due.at,
      nextRetryAt: due.nextRetryAt ?? null,
      paidAt: due.status === 'PAID' ? due.at : null,
      failedAt: due.status === 'FAILED' ? due.at : null,
      failureMessage:
        due.status === 'FAILED' ? 'La tarjeta fue rechazada por fondos insuficientes.' : null,
      upcomingNotifiedAt:
        due.status !== 'SCHEDULED' && i > 0 ? new Date(due.at.getTime() - 7 * DAY) : null,
      createdAt: data.dues[0].at,
    }));
    this.plans.push({
      id: planId,
      userId: user.id,
      offerId: offer.id,
      enrollmentId: data.enrollmentId,
      applicationId: data.applicationId ?? null,
      concept: data.concept,
      status: data.status,
      currency: data.currency,
      totalCents: data.total,
      installmentCount: data.dues.length,
      stripeCustomerId: this.customer(user),
      stripePaymentMethodId: this.sid('pm_demo_'),
      ...card,
      cardExpMonth: this.int(1, 12),
      cardExpYear: this.cdmxNow.year + this.int(1, 4),
      autoDebitAuthorizedAt: data.dues[0].at,
      activatedAt: data.dues[0].at,
      failedSince: data.failedSince ?? null,
      delinquentAt: data.delinquentAt ?? null,
      accessSuspendedAt: data.accessSuspendedAt ?? null,
      completedAt: data.status === 'COMPLETED' ? data.dues[data.dues.length - 1].at : null,
      createdAt: new Date(data.dues[0].at.getTime() - 5 * 60_000),
      installments: { create: installments },
    });
    installments.forEach((inst, i) => {
      if (inst.status === 'SCHEDULED') return;
      this.cardPayment(user, offer, {
        concept: 'INSTALLMENT',
        amountCents: inst.amountCents,
        currency: data.currency,
        at: inst.dueAt,
        enrollmentId: data.enrollmentId,
        applicationId: data.applicationId,
        planId,
        installmentId: inst.id,
        card,
        checkout: i === 0,
        status: inst.status === 'FAILED' ? 'FAILED' : 'PAID',
        label: `cuota ${inst.sequence} de ${installments.length}`,
      });
    });
    return planId;
  }

  /** Transferencia SPEI del saldo tras beca (HU-23 / HU-33). */
  private transfer(
    user: DemoUser,
    offer: OfferRef,
    appId: string,
    data: {
      amountCents: number;
      declaredCents?: number;
      submittedAt: Date;
      status: 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
      reviewedAt?: Date;
      enrollmentId?: string | null;
    },
  ): string {
    const id = randomUUID();
    const declared = data.declaredCents ?? data.amountCents;
    this.payments.push({
      id,
      transferAppId: appId,
      userId: user.id,
      offerId: offer.id,
      enrollmentId: data.enrollmentId ?? null,
      applicationId: appId,
      concept: 'BALANCE',
      method: 'BANK_TRANSFER',
      status: data.status,
      amountCents: data.amountCents,
      currency: 'MXN',
      declaredAmountCents: declared,
      declaredPaidOn: new Date(`${utcToCdmx(data.submittedAt).toISODate()}T00:00:00.000Z`),
      trackingKey: `MBAN${this.digits(22)}`,
      // Comprobante: key ficticia (no hay archivo en storage; ver docs/DEPLOY.md §10).
      proofFileKey: `payments/transfers/${appId}/demo-${id}.pdf`,
      proofFileName: 'comprobante-spei.pdf',
      proofMimeType: 'application/pdf',
      proofSizeBytes: this.int(90_000, 400_000),
      receivedAmountCents: data.status === 'VALIDATED' ? data.amountCents : null,
      receivedOn:
        data.status === 'VALIDATED'
          ? new Date(`${utcToCdmx(data.submittedAt).toISODate()}T00:00:00.000Z`)
          : null,
      reviewedById: data.status === 'PENDING_VALIDATION' ? null : this.staff.finance,
      reviewedAt: data.reviewedAt ?? null,
      rejectionReason: data.status === 'REJECTED' ? 'AMOUNT_MISMATCH' : null,
      rejectionNote:
        data.status === 'REJECTED'
          ? `El monto del comprobante (${money(declared, 'MXN')}) no coincide con el saldo (${money(data.amountCents, 'MXN')}). Sube el comprobante del pago completo.`
          : null,
      submittedAt: data.submittedAt,
      paidAt: data.status === 'VALIDATED' ? (data.reviewedAt ?? null) : null,
      createdAt: data.submittedAt,
    });
    if (data.status !== 'PENDING_VALIDATION') {
      const ok = data.status === 'VALIDATED';
      this.notify(user, {
        type: ok ? 'TRANSFER_VALIDATED' : 'TRANSFER_REJECTED',
        category: 'PAYMENTS',
        title: ok ? 'Transferencia validada' : 'Comprobante de transferencia rechazado',
        body: ok
          ? `Validamos tu transferencia de ${money(data.amountCents, 'MXN')}. Tu inscripción a ${offer.name} está confirmada.`
          : 'El monto no coincide con tu saldo. Revisa el motivo y sube un nuevo comprobante.',
        at: this.plus(data.reviewedAt!, 0.01),
        actionLabel: ok ? 'Ver pago' : 'Subir otro comprobante',
        actionPath: ok ? PORTAL_LINKS.payment(id) : PORTAL_LINKS.payBalance(appId),
        priority: ok ? 'NORMAL' : 'HIGH',
        pinned: !ok,
        data: { paymentId: id, applicationId: appId },
        dedupe: `transfer:${id}`,
      });
    }
    return id;
  }

  private application(input: AppInput): CreatedApp | null {
    const user = this.u(input.idx);
    const offer = this.offers.get(input.key);
    if (!offer) return null;
    const requested = input.requestedType
      ? this.scholarshipTypes.get(input.requestedType)
      : undefined;
    if (input.kind === 'SCHOLARSHIP' && !requested) return null;
    const assigned = input.decision?.type
      ? this.scholarshipTypes.get(input.decision.type)
      : undefined;
    if (input.decision?.type && !assigned) return null;

    const id = randomUUID();
    const submittedAt = this.ago(input.submittedDaysAgo, this.int(1, 10));
    const draftAt = new Date(submittedAt.getTime() - this.int(20, 60) * HOUR);
    const reviewAt =
      input.reviewDaysAgo !== undefined ? this.ago(input.reviewDaysAgo, this.int(1, 6)) : null;
    const decidedAt = input.decision ? this.ago(input.decision.daysAgo, this.int(1, 5)) : null;
    const original = this.price(offer, user.currency);
    const percent = input.decision?.percent ?? null;
    const approved = input.decision?.outcome === 'APPROVED';
    const balance = approved
      ? input.kind === 'SCHOLARSHIP'
        ? balanceAfterScholarship(original, percent ?? 0)
        : Math.max(original ?? 0, 0)
      : 0;
    const responseKind = balance > 0 ? 'PAYMENT' : 'CONFIRMATION';

    const history: Array<{
      status: ApplicationStatus;
      at: Date;
      actor: ApplicationActorType;
      note?: string;
    }> = [
      { status: 'DRAFT', at: draftAt, actor: 'PARTICIPANT' },
      { status: 'SUBMITTED', at: submittedAt, actor: 'PARTICIPANT' },
    ];
    if (reviewAt) history.push({ status: 'IN_REVIEW', at: reviewAt, actor: 'STAFF' });
    if (input.interview) {
      history.push({
        status: 'INTERVIEW_SCHEDULED',
        at: this.ago(input.interview.scheduledDaysAgo, this.int(1, 5)),
        actor: 'STAFF',
      });
    }
    if (input.decision && decidedAt) {
      history.push({
        status: approved
          ? responseKind === 'PAYMENT'
            ? 'APPROVED_PENDING_PAYMENT'
            : 'APPROVED_PENDING_CONFIRMATION'
          : 'NOT_SELECTED',
        at: decidedAt,
        actor: 'STAFF',
        note: input.decision.note,
      });
    }
    if (input.final)
      history.push({ status: input.final.status, at: input.final.at, actor: input.final.actor });
    const last = history[history.length - 1];

    let responseDueAt: Date | null = null;
    if (approved && decidedAt) {
      responseDueAt = responseDeadline(decidedAt, responseKind, offer.startsAt);
      if (input.final?.status === 'EXPIRED') responseDueAt = input.final.at;
      else if (!input.final && responseDueAt.getTime() < this.now.getTime() + 2 * DAY) {
        // Plazo extendido por Seguimiento (HU-32) para que la demo no venza de inmediato.
        const extended = this.at(4, '23:59');
        responseDueAt =
          offer.startsAt && offer.startsAt > this.now && offer.startsAt < extended
            ? offer.startsAt
            : extended;
      }
    }

    const staffActor = (s: ApplicationActorType) =>
      s === 'STAFF'
        ? (this.staff.decider ?? this.staff.any[0] ?? null)
        : s === 'PARTICIPANT'
          ? user.id
          : null;
    const evaluators = this.staff.committee.slice(0, input.evaluations ?? 0);
    const recommendation = (i: number) =>
      input.decision?.outcome === 'APPROVED'
        ? i === 2
          ? 'UNSURE'
          : 'APPROVE'
        : input.decision?.outcome === 'NOT_SELECTED'
          ? 'NOT_SELECT'
          : this.pick(['APPROVE', 'APPROVE', 'UNSURE'] as const);
    const variant = input.idx;
    const evalBase = reviewAt ?? submittedAt;

    const data: Prisma.ApplicationUncheckedCreateInput = {
      id,
      userId: user.id,
      offerId: offer.id,
      kind: input.kind,
      status: last.status,
      statusChangedAt: last.at,
      applicantName: user.person.fullName,
      applicantEmail: user.email,
      phoneCountryCode: user.phoneCountryCode,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      divisionName: user.divisionName,
      municipalityName: user.municipalityName,
      age: user.person.age,
      partnerCode: variant % 4 === 0 ? this.pick(['RED-AGUA', 'COMUNA-23', 'ALIANZA-SUR']) : null,
      organization: user.person.org,
      organizationRole: user.person.role,
      requestedScholarshipTypeId: requested?.id ?? null,
      intentLetter: input.kind === 'SCHOLARSHIP' ? intentLetter(user.person, variant) : null,
      eligibilityConfirmed: input.kind === 'OPEN_CALL',
      experience: input.kind === 'OPEN_CALL' ? openCallExperience(user.person, variant) : null,
      motivation: input.kind === 'OPEN_CALL' ? openCallMotivation(user.person, variant + 1) : null,
      canTravel: input.kind === 'OPEN_CALL' ? true : null,
      evidenceLinks: [
        `https://placehold.co/1200x800/0F766E/FFFFFF/png?text=${encodeURIComponent(`Evidencia · ${user.person.org}`)}`,
        ...(variant % 2 === 0
          ? [
              `https://placehold.co/1200x800/155E75/FFFFFF/png?text=${encodeURIComponent('Trabajo comunitario')}`,
            ]
          : []),
      ],
      termsAcceptedAt: submittedAt,
      currency: user.currency,
      originalAmountCents: original,
      assignedScholarshipTypeId: approved ? (assigned?.id ?? null) : null,
      assignedScholarshipTypeName: approved ? (assigned?.name ?? null) : null,
      assignedPercent: approved ? percent : null,
      balanceCents: approved ? balance : null,
      decidedById: decidedAt ? this.staff.decider : null,
      decisionNote: input.decision?.note ?? null,
      responseDueAt,
      submittedAt,
      reviewStartedAt: reviewAt ?? (input.interview || decidedAt ? submittedAt : null),
      decidedAt,
      enrolledAt: input.final?.status === 'ENROLLED' ? input.final.at : null,
      expiredAt: input.final?.status === 'EXPIRED' ? input.final.at : null,
      paymentStartedAt:
        input.pendingTransferDaysAgo !== undefined || input.transferRejectedDaysAgo !== undefined
          ? this.ago(
              Math.max(input.pendingTransferDaysAgo ?? 0, input.transferRejectedDaysAgo ?? 0) + 1,
            )
          : input.final?.status === 'ENROLLED' && balance > 0
            ? input.final.at
            : null,
      pendingTransferSince:
        input.pendingTransferDaysAgo !== undefined ? this.ago(input.pendingTransferDaysAgo) : null,
      transferRejectedAt:
        input.transferRejectedDaysAgo !== undefined
          ? this.ago(input.transferRejectedDaysAgo)
          : null,
      createdAt: draftAt,
      statusEvents: {
        create: history.map((event, i) => ({
          fromStatus: i > 0 ? history[i - 1].status : null,
          toStatus: event.status,
          actorType: event.actor,
          actorId: staffActor(event.actor),
          note: event.note ?? null,
          createdAt: event.at,
        })),
      },
      interviews: input.interview
        ? {
            create: [
              {
                startsAt: input.interview.at,
                endsAt: new Date(input.interview.at.getTime() + 30 * 60_000),
                joinUrl: this.zoomUrl().joinUrl,
                status: input.interview.status,
                scheduledById: this.staff.coordinator ?? this.staff.committee[0] ?? null,
                completedAt:
                  input.interview.status === 'COMPLETED'
                    ? new Date(input.interview.at.getTime() + 35 * 60_000)
                    : null,
                reminderSentAt:
                  input.interview.status === 'COMPLETED'
                    ? new Date(input.interview.at.getTime() - 24 * HOUR)
                    : null,
                createdAt: this.ago(input.interview.scheduledDaysAgo, this.int(1, 5)),
              },
            ],
          }
        : undefined,
      evaluations: evaluators.length
        ? {
            create: evaluators.map((evaluatorId, i) => {
              const rec = recommendation(i);
              return {
                evaluatorId,
                recommendation: rec,
                suggestedScholarshipTypeId:
                  input.kind === 'SCHOLARSHIP' && rec === 'APPROVE'
                    ? (assigned?.id ?? requested?.id ?? null)
                    : null,
                comment: this.pick(
                  rec === 'APPROVE'
                    ? EVALUATION_COMMENTS.APPROVE
                    : rec === 'NOT_SELECT'
                      ? EVALUATION_COMMENTS.NOT_SELECT
                      : EVALUATION_COMMENTS.UNSURE,
                ),
                createdAt: this.plus(evalBase, 6 + i * 20),
              };
            }),
          }
        : undefined,
      followUpNotes: input.followUps?.length
        ? {
            create: input.followUps.map((note) => ({
              authorId: this.staff.followUp,
              kind: note.kind,
              outcome: note.outcome ?? null,
              body: note.body,
              createdAt: this.ago(note.daysAgo, this.int(1, 6)),
            })),
          }
        : undefined,
    };
    this.apps.push({ input, data });
    const meta: CreatedApp = {
      id,
      kind: input.kind,
      balanceCents: balance,
      currency: user.currency,
      decidedAt,
    };
    this.appMeta.set(id, meta);
    this.bump('applications');
    this.bump('application_status_events', history.length);
    if (input.interview) this.bump('application_interviews');
    this.bump('application_evaluations', evaluators.length);
    this.bump('application_follow_up_notes', input.followUps?.length ?? 0);

    // Notificaciones del recorrido (HU-13 / HU-21).
    const program = input.kind === 'SCHOLARSHIP' ? `beca de ${offer.name}` : offer.name;
    const path = PORTAL_LINKS.application(id);
    this.notify(user, {
      type: 'APPLICATION_SUBMITTED',
      category: 'APPLICATIONS',
      title: `Recibimos tu postulación: ${program}`,
      body: 'Te avisaremos por este medio y por correo cada vez que cambie su estado.',
      at: this.plus(submittedAt, 0.01),
      actionLabel: 'Ver postulación',
      actionPath: path,
      data: { applicationId: id },
      dedupe: `app-submitted:${id}`,
    });
    if (reviewAt) {
      this.notify(user, {
        type: 'APPLICATION_STATUS_CHANGED',
        category: 'APPLICATIONS',
        title: 'Tu postulación está en revisión',
        body: `El comité comenzó a revisar tu postulación a ${program}.`,
        at: reviewAt,
        actionLabel: 'Ver postulación',
        actionPath: path,
        email: false,
        data: { applicationId: id },
        dedupe: `app-review:${id}`,
      });
    }
    if (input.interview) {
      const when = utcToCdmx(input.interview.at).setLocale('es').toFormat("d 'de' LLLL, HH:mm");
      this.notify(user, {
        type: 'INTERVIEW_SCHEDULED',
        category: 'APPLICATIONS',
        title: 'Entrevista agendada',
        body: `Tu entrevista es el ${when} (hora CDMX). El enlace se habilita 10 minutos antes.`,
        at: this.ago(input.interview.scheduledDaysAgo),
        actionLabel: 'Ver entrevista',
        actionPath: path,
        data: { applicationId: id },
        dedupe: `app-interview:${id}`,
      });
    }
    if (decidedAt && input.decision) {
      this.notify(
        user,
        approved
          ? {
              type:
                input.kind === 'SCHOLARSHIP'
                  ? 'SCHOLARSHIP_APPROVED'
                  : 'APPLICATION_STATUS_CHANGED',
              category: 'APPLICATIONS',
              title:
                input.kind === 'SCHOLARSHIP'
                  ? `¡Beca aprobada! ${assigned?.name ?? ''} (${percent ?? 0}%)`
                  : `¡Fuiste seleccionada/o para ${offer.name}!`,
              body:
                balance > 0
                  ? `Tu saldo es de ${money(balance, user.currency)}. Págalo antes de la fecha límite para confirmar tu lugar.`
                  : 'Confirma tu participación antes de la fecha límite.',
              at: decidedAt,
              actionLabel: balance > 0 ? 'Pagar saldo' : 'Confirmar participación',
              actionPath: balance > 0 ? PORTAL_LINKS.payBalance(id) : path,
              data: { applicationId: id },
              dedupe: `app-decision:${id}`,
            }
          : {
              type: 'APPLICATION_STATUS_CHANGED',
              category: 'APPLICATIONS',
              title: 'Resultado de tu postulación',
              body: `En esta ocasión tu postulación a ${program} no fue seleccionada. ¡Te esperamos en la próxima convocatoria!`,
              at: decidedAt,
              actionLabel: 'Ver postulación',
              actionPath: path,
              data: { applicationId: id },
              dedupe: `app-decision:${id}`,
            },
      );
    }
    if (input.final?.status === 'EXPIRED') {
      this.notify(user, {
        type: 'APPLICATION_EXPIRED',
        category: 'APPLICATIONS',
        title: 'Tu postulación venció',
        body: 'El plazo para responder terminó. Si aún te interesa, escríbenos para revisar tu caso.',
        at: input.final.at,
        actionLabel: 'Ver postulación',
        actionPath: path,
        data: { applicationId: id },
        dedupe: `app-expired:${id}`,
      });
    }
    return meta;
  }

  private buildScenarios(): void {
    const dip = this.offers.get('DIP')!;
    const at = (d: number, h = 0) => this.ago(d, h);

    // --- Diplomado en curso: pagos completos (MXN y USD) ---
    for (const [idx, days] of [
      [0, 95],
      [1, 92],
      [2, 88],
      [3, 84],
      [4, 80],
      [5, 77],
      [6, 73],
      [7, 70],
    ] as const) {
      this.fullPayment(idx, 'DIP', days);
    }
    // Pago con reembolso PARCIAL (HU-33).
    const refundPaymentId = this.fullPayment(16, 'DIP', 66, 196_000);
    if (refundPaymentId) {
      this.refunds.push({
        paymentId: refundPaymentId,
        amountCents: 196_000,
        currency: 'MXN',
        method: 'CARD',
        status: 'SUCCEEDED',
        reason:
          'Baja parcial: no podrá cursar los módulos 4 y 5 por motivos de salud; se reembolsa la parte proporcional.',
        stripeRefundId: this.sid('re_demo_'),
        createdById: this.staff.finance,
        createdAt: at(10),
      });
      this.auditTargets.refundPayment = refundPaymentId;
    }

    // Cuotas: plan COMPLETADO (3/3), COBRO FALLIDO con reintento y EN MORA con acceso suspendido.
    const u8 = this.u(8);
    this.installmentPlan(u8, dip, {
      concept: 'FULL_PRICE',
      total: 980_000,
      currency: 'MXN',
      enrollmentId: this.enroll(u8, dip, { status: 'ACTIVE', source: 'INSTALLMENTS', at: at(100) }),
      status: 'COMPLETED',
      dues: [at(100), at(70), at(40)].map((d) => ({ at: d, status: 'PAID' as const })),
    });
    const u9 = this.u(9);
    const pastDuePlan = this.installmentPlan(u9, dip, {
      concept: 'FULL_PRICE',
      total: 980_000,
      currency: 'MXN',
      enrollmentId: this.enroll(u9, dip, { status: 'ACTIVE', source: 'INSTALLMENTS', at: at(64) }),
      status: 'PAST_DUE',
      failedSince: at(4),
      dues: [
        { at: at(64), status: 'PAID' },
        { at: at(4), status: 'FAILED', attempts: 2, nextRetryAt: this.at(2, '10:00') },
        { at: this.at(26, '10:00'), status: 'SCHEDULED' },
      ],
    });
    this.notify(u9, {
      type: 'INSTALLMENT_FAILED',
      category: 'PAYMENTS',
      priority: 'HIGH',
      pinned: true,
      title: 'No pudimos cobrar tu cuota 2 de 3',
      body: 'Tu banco rechazó el cargo. Reintentaremos automáticamente; también puedes actualizar tu tarjeta o pagar ahora.',
      at: at(4),
      actionLabel: 'Regularizar pago',
      actionPath: PORTAL_LINKS.myPayments(),
      data: { planId: pastDuePlan },
      dedupe: `installment-failed:${pastDuePlan}`,
    });
    const u10 = this.u(10);
    const delinquentPlan = this.installmentPlan(u10, dip, {
      concept: 'FULL_PRICE',
      total: 980_000,
      currency: 'MXN',
      enrollmentId: this.enroll(u10, dip, {
        status: 'SUSPENDED',
        source: 'INSTALLMENTS',
        at: at(78),
        suspendedAt: at(5),
        statusReason:
          'Acceso suspendido automáticamente: plan de cuotas en mora (15 días sin regularizar).',
      }),
      status: 'DELINQUENT',
      failedSince: at(20),
      delinquentAt: at(5),
      accessSuspendedAt: at(5),
      dues: [
        { at: at(78), status: 'PAID' },
        { at: at(20), status: 'FAILED', attempts: 3, nextRetryAt: null },
        { at: this.at(10, '10:00'), status: 'SCHEDULED' },
      ],
    });
    this.auditTargets.delinquentPlan = delinquentPlan;
    this.notify(u10, {
      type: 'INSTALLMENT_FAILED',
      category: 'PAYMENTS',
      title: 'No pudimos cobrar tu cuota 2 de 3',
      body: 'Tu banco rechazó el cargo. Reintentaremos en los próximos días.',
      at: at(20),
      actionLabel: 'Regularizar pago',
      actionPath: PORTAL_LINKS.myPayments(),
      data: { planId: delinquentPlan },
      dedupe: `installment-failed:${delinquentPlan}`,
    });
    this.notify(u10, {
      type: 'PLAN_DELINQUENT',
      category: 'PAYMENTS',
      priority: 'HIGH',
      pinned: true,
      title: 'Tu plan de cuotas está en mora',
      body: 'Suspendimos tu acceso al aula. Se restablece en cuanto regularices el pago pendiente.',
      at: at(5),
      actionLabel: 'Regularizar pago',
      actionPath: PORTAL_LINKS.myPayments(),
      data: { planId: delinquentPlan },
      dedupe: `plan-delinquent:${delinquentPlan}`,
    });

    // Becas del diplomado en curso (decididas antes del inicio).
    const dipScholar = (
      idx: number,
      type: string,
      percent: number,
      pay: 'card' | 'transfer' | 'plan',
      interview = false,
    ) => {
      const app = this.application({
        idx,
        key: 'DIP',
        kind: 'SCHOLARSHIP',
        requestedType: type,
        submittedDaysAgo: 100 - idx,
        reviewDaysAgo: 88 - idx,
        interview: interview
          ? { at: at(78, 3), status: 'COMPLETED', scheduledDaysAgo: 82, provider: 'zoom' }
          : undefined,
        decision: {
          outcome: 'APPROVED',
          daysAgo: 72,
          type,
          percent,
          note: 'Aprobada por unanimidad del comité.',
        },
        final: {
          status: 'ENROLLED',
          at: at(66 - (idx % 4)),
          actor: pay === 'transfer' ? 'STAFF' : 'SYSTEM',
        },
        evaluations: 3,
      });
      if (!app) return;
      const user = this.u(idx);
      const enrolledAt = at(66 - (idx % 4));
      const enrollmentId = this.enroll(user, dip, {
        status: 'ACTIVE',
        source: 'SCHOLARSHIP',
        at: enrolledAt,
        applicationId: app.id,
      });
      if (pay === 'card') {
        this.cardPayment(user, dip, {
          concept: 'BALANCE',
          amountCents: app.balanceCents,
          currency: user.currency,
          at: enrolledAt,
          enrollmentId,
          applicationId: app.id,
          label: 'saldo tras beca',
        });
      } else if (pay === 'transfer') {
        const paymentId = this.transfer(user, dip, app.id, {
          amountCents: app.balanceCents,
          submittedAt: new Date(enrolledAt.getTime() - 2 * DAY),
          status: 'VALIDATED',
          reviewedAt: enrolledAt,
          enrollmentId,
        });
        this.auditTargets.validatedTransfer ??= paymentId;
      } else {
        this.installmentPlan(user, dip, {
          concept: 'BALANCE',
          total: app.balanceCents,
          currency: user.currency,
          enrollmentId,
          applicationId: app.id,
          status: 'CURRENT',
          dues: [
            { at: enrolledAt, status: 'PAID' },
            { at: at(36), status: 'PAID' },
            { at: this.at(24, '10:00'), status: 'SCHEDULED' },
          ],
        });
      }
    };
    dipScholar(11, 'AGUA_VIVA', 10, 'card');
    dipScholar(12, 'AGUAS_LIBRES', 50, 'transfer');
    dipScholar(13, 'CENOTES_VIVOS', 70, 'card');
    dipScholar(14, 'SPECIAL', 75, 'transfer', true);
    dipScholar(15, 'RIOS_VIVOS', 25, 'plan');
    this.application({
      idx: 17,
      key: 'DIP',
      kind: 'SCHOLARSHIP',
      requestedType: 'CENOTES_VIVOS',
      submittedDaysAgo: 96,
      reviewDaysAgo: 86,
      decision: {
        outcome: 'NOT_SELECTED',
        daysAgo: 72,
        note: 'No se identifica un proyecto concreto; se sugiere postular a la siguiente generación.',
      },
      evaluations: 2,
    });
    this.application({
      idx: 18,
      key: 'DIP',
      kind: 'SCHOLARSHIP',
      requestedType: 'RIOS_VIVOS',
      submittedDaysAgo: 94,
      reviewDaysAgo: 85,
      decision: { outcome: 'APPROVED', daysAgo: 72, type: 'RIOS_VIVOS', percent: 25 },
      final: { status: 'EXPIRED', at: at(65), actor: 'SYSTEM' },
      evaluations: 2,
      followUps: [
        {
          kind: 'REMINDER_SENT',
          outcome: 'NO_RESPONSE',
          body: 'Recordatorio de saldo enviado por correo.',
          daysAgo: 67,
        },
        {
          kind: 'WHATSAPP_CONTACT',
          outcome: 'WITHDRAWS',
          body: 'Comenta que por trabajo no podrá cursar en esta generación.',
          daysAgo: 66,
        },
      ],
    });

    // --- Checkout abandonado (CANCELLED, sin cargo) en el curso de humedales ---
    const hum = this.offers.get('HUM');
    if (hum) {
      const u19 = this.u(19);
      const amount = this.price(hum, u19.currency);
      if (amount !== null) {
        this.cardPayment(u19, hum, {
          concept: 'FULL_PRICE',
          amountCents: amount,
          currency: u19.currency,
          at: at(2, 3),
          status: 'CANCELLED',
        });
      }
    }

    // --- Diplomado próximo (seed): plan AL DÍA 1/3, pagos completos y becas por resolver ---
    const eco = this.offers.get('ECO');
    if (eco) {
      const u22 = this.u(22);
      const total = this.price(eco, 'MXN');
      if (total) {
        this.installmentPlan(u22, eco, {
          concept: 'FULL_PRICE',
          total,
          currency: 'MXN',
          enrollmentId: this.enroll(u22, eco, {
            status: 'ACTIVE',
            source: 'INSTALLMENTS',
            at: at(14),
          }),
          status: 'CURRENT',
          dues: [
            { at: at(14), status: 'PAID' },
            { at: this.at(16, '10:00'), status: 'SCHEDULED' },
            { at: this.at(46, '10:00'), status: 'SCHEDULED' },
          ],
        });
      }
    }
    this.fullPayment(23, 'ECO', 20);
    this.fullPayment(24, 'ECO', 12);
    const pending = this.application({
      idx: 25,
      key: 'ECO',
      kind: 'SCHOLARSHIP',
      requestedType: 'AGUAS_LIBRES',
      submittedDaysAgo: 30,
      reviewDaysAgo: 26,
      decision: { outcome: 'APPROVED', daysAgo: 6, type: 'AGUAS_LIBRES', percent: 50 },
      evaluations: 3,
      pendingTransferDaysAgo: 1,
      followUps: [
        {
          kind: 'NOTE',
          outcome: 'WILL_PAY_SOON',
          body: 'Avisó por teléfono que paga por SPEI esta semana.',
          daysAgo: 3,
        },
        { kind: 'NOTE', body: 'Subió comprobante; pendiente de validar por Finanzas.', daysAgo: 1 },
      ],
    });
    if (pending && eco) {
      const user = this.u(25);
      this.enroll(user, eco, {
        status: 'PENDING_PAYMENT',
        source: 'SCHOLARSHIP',
        at: pending.decidedAt!,
        applicationId: pending.id,
      });
      this.auditTargets.pendingTransfer = this.transfer(user, eco, pending.id, {
        amountCents: pending.balanceCents,
        submittedAt: at(1, 2),
        status: 'PENDING_VALIDATION',
      });
    }
    const rejected = this.application({
      idx: 26,
      key: 'ECO',
      kind: 'SCHOLARSHIP',
      requestedType: 'RIOS_VIVOS',
      submittedDaysAgo: 28,
      reviewDaysAgo: 24,
      decision: { outcome: 'APPROVED', daysAgo: 5, type: 'RIOS_VIVOS', percent: 25 },
      evaluations: 2,
      transferRejectedDaysAgo: 2,
      followUps: [
        {
          kind: 'WHATSAPP_CONTACT',
          outcome: 'WILL_PAY_SOON',
          body: 'Se le explicó que el comprobante debe ser por el saldo completo; dice que transfiere la diferencia mañana.',
          daysAgo: 1,
        },
      ],
    });
    if (rejected && eco) {
      const user = this.u(26);
      this.enroll(user, eco, {
        status: 'PENDING_PAYMENT',
        source: 'SCHOLARSHIP',
        at: rejected.decidedAt!,
        applicationId: rejected.id,
      });
      this.auditTargets.rejectedTransfer = this.transfer(user, eco, rejected.id, {
        amountCents: rejected.balanceCents,
        declaredCents: 350_000,
        submittedAt: at(3, 4),
        status: 'REJECTED',
        reviewedAt: at(2, 1),
      });
    }
    const unpaid = this.application({
      idx: 27,
      key: 'ECO',
      kind: 'SCHOLARSHIP',
      requestedType: 'CENOTES_VIVOS',
      submittedDaysAgo: 27,
      reviewDaysAgo: 22,
      decision: { outcome: 'APPROVED', daysAgo: 6, type: 'CENOTES_VIVOS', percent: 70 },
      evaluations: 3,
      followUps: [
        {
          kind: 'REMINDER_SENT',
          outcome: 'NO_RESPONSE',
          body: 'Recordatorio de saldo enviado desde el panel.',
          daysAgo: 2,
        },
        {
          kind: 'NOTE',
          outcome: 'REQUESTS_INSTALLMENTS',
          body: 'Pregunta si puede pagar el saldo en cuotas; se le indicó la opción en la pantalla de pago.',
          daysAgo: 1,
        },
      ],
    });
    if (unpaid && eco) {
      this.enroll(this.u(27), eco, {
        status: 'PENDING_PAYMENT',
        source: 'SCHOLARSHIP',
        at: unpaid.decidedAt!,
        applicationId: unpaid.id,
      });
    }
    const enrolledEco = this.application({
      idx: 28,
      key: 'ECO',
      kind: 'SCHOLARSHIP',
      requestedType: 'AGUA_VIVA',
      submittedDaysAgo: 33,
      reviewDaysAgo: 29,
      decision: { outcome: 'APPROVED', daysAgo: 10, type: 'AGUA_VIVA', percent: 10 },
      final: { status: 'ENROLLED', at: at(8), actor: 'SYSTEM' },
      evaluations: 2,
    });
    if (enrolledEco && eco) {
      const user = this.u(28);
      const enrollmentId = this.enroll(user, eco, {
        status: 'ACTIVE',
        source: 'SCHOLARSHIP',
        at: at(8),
        applicationId: enrolledEco.id,
      });
      this.cardPayment(user, eco, {
        concept: 'BALANCE',
        amountCents: enrolledEco.balanceCents,
        currency: user.currency,
        at: at(8),
        enrollmentId,
        applicationId: enrolledEco.id,
        label: 'saldo tras beca',
      });
    }
    this.application({
      idx: 29,
      key: 'ECO',
      kind: 'SCHOLARSHIP',
      requestedType: 'CENOTES_VIVOS',
      submittedDaysAgo: 31,
      reviewDaysAgo: 25,
      decision: {
        outcome: 'NOT_SELECTED',
        daysAgo: 9,
        note: 'Cupo del tipo de beca completo; el perfil no prioriza frente a otras postulaciones.',
      },
      evaluations: 3,
    });
    this.application({
      idx: 30,
      key: 'ECO',
      kind: 'SCHOLARSHIP',
      requestedType: 'SPECIAL',
      submittedDaysAgo: 25,
      reviewDaysAgo: 20,
      interview: {
        at: this.at(2, '11:00'),
        status: 'SCHEDULED',
        scheduledDaysAgo: 3,
        provider: 'zoom',
      },
      evaluations: 2,
    });

    // --- Diplomado con convocatoria de becas abierta (seed): enviadas, en revisión y entrevista ---
    for (const [idx, days, type] of [
      [31, 1, 'AGUA_VIVA'],
      [32, 2, 'RIOS_VIVOS'],
      [33, 4, 'AGUAS_LIBRES'],
      [34, 6, 'CENOTES_VIVOS'],
    ] as const) {
      this.application({
        idx,
        key: 'GES',
        kind: 'SCHOLARSHIP',
        requestedType: type,
        submittedDaysAgo: days,
      });
    }
    for (const [idx, days, review, evals, type] of [
      [35, 12, 7, 2, 'AGUAS_LIBRES'],
      [36, 10, 5, 1, 'RIOS_VIVOS'],
      [38, 9, 3, 1, 'AGUA_VIVA'],
    ] as const) {
      this.application({
        idx,
        key: 'GES',
        kind: 'SCHOLARSHIP',
        requestedType: type,
        submittedDaysAgo: days,
        reviewDaysAgo: review,
        evaluations: evals,
      });
    }
    this.application({
      idx: 37,
      key: 'GES',
      kind: 'SCHOLARSHIP',
      requestedType: 'SPECIAL',
      submittedDaysAgo: 14,
      reviewDaysAgo: 9,
      interview: {
        at: this.at(5, '17:00'),
        status: 'SCHEDULED',
        scheduledDaysAgo: 4,
        provider: 'zoom',
      },
      evaluations: 2,
    });

    // --- Convocatoria Aprendices del Agua (gratuita, con entrevista) ---
    const apr = this.offers.get('APR');
    for (const [idx, days] of [
      [39, 2],
      [40, 3],
      [41, 5],
    ] as const) {
      this.application({ idx, key: 'APR', kind: 'OPEN_CALL', submittedDaysAgo: days });
    }
    this.application({
      idx: 42,
      key: 'APR',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 11,
      reviewDaysAgo: 6,
      evaluations: 2,
    });
    this.application({
      idx: 43,
      key: 'APR',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 16,
      reviewDaysAgo: 10,
      evaluations: 2,
      interview: {
        at: this.at(3, '10:00'),
        status: 'SCHEDULED',
        scheduledDaysAgo: 5,
        provider: 'zoom',
      },
    });
    this.application({
      idx: 44,
      key: 'APR',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 17,
      reviewDaysAgo: 11,
      evaluations: 1,
      interview: {
        at: this.at(4, '12:30'),
        status: 'SCHEDULED',
        scheduledDaysAgo: 4,
        provider: 'zoom',
      },
    });
    this.application({
      idx: 45,
      key: 'APR',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 20,
      reviewDaysAgo: 15,
      evaluations: 3,
      interview: { at: at(8, 2), status: 'COMPLETED', scheduledDaysAgo: 12, provider: 'zoom' },
      decision: {
        outcome: 'APPROVED',
        daysAgo: 3,
        note: 'Excelente entrevista; liderazgo juvenil comprobado.',
      },
    });
    const aprEnrolled = this.application({
      idx: 46,
      key: 'APR',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 24,
      reviewDaysAgo: 19,
      evaluations: 3,
      interview: { at: at(15, 2), status: 'COMPLETED', scheduledDaysAgo: 18, provider: 'zoom' },
      decision: { outcome: 'APPROVED', daysAgo: 12 },
      final: { status: 'ENROLLED', at: at(10), actor: 'PARTICIPANT' },
    });
    if (aprEnrolled && apr) {
      this.enroll(this.u(46), apr, {
        status: 'ACTIVE',
        source: 'OPEN_CALL',
        at: at(10),
        applicationId: aprEnrolled.id,
      });
    }
    this.application({
      idx: 47,
      key: 'APR',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 23,
      reviewDaysAgo: 18,
      evaluations: 2,
      interview: { at: at(14, 3), status: 'COMPLETED', scheduledDaysAgo: 17, provider: 'zoom' },
      decision: {
        outcome: 'NOT_SELECTED',
        daysAgo: 11,
        note: 'No cuenta con respaldo de una organización o colectivo.',
      },
    });

    // --- Convocatoria Siembra de Agua (mujeres lideresas) ---
    const sie = this.offers.get('SIE');
    this.application({ idx: 48, key: 'SIE', kind: 'OPEN_CALL', submittedDaysAgo: 3 });
    this.application({
      idx: 49,
      key: 'SIE',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 13,
      reviewDaysAgo: 10,
      evaluations: 2,
      interview: { at: at(7, 4), status: 'COMPLETED', scheduledDaysAgo: 9, provider: 'zoom' },
      decision: { outcome: 'APPROVED', daysAgo: 2 },
    });
    this.application({
      idx: 50,
      key: 'SIE',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 22,
      reviewDaysAgo: 18,
      evaluations: 2,
      interview: { at: at(15, 4), status: 'COMPLETED', scheduledDaysAgo: 17, provider: 'zoom' },
      decision: { outcome: 'APPROVED', daysAgo: 12 },
      final: { status: 'EXPIRED', at: at(5), actor: 'SYSTEM' },
      followUps: [
        {
          kind: 'WHATSAPP_CONTACT',
          outcome: 'NO_RESPONSE',
          body: 'Mensaje por WhatsApp sin respuesta.',
          daysAgo: 7,
        },
      ],
    });
    const sieEnrolled = this.application({
      idx: 51,
      key: 'SIE',
      kind: 'OPEN_CALL',
      submittedDaysAgo: 19,
      reviewDaysAgo: 15,
      evaluations: 3,
      interview: { at: at(12, 3), status: 'COMPLETED', scheduledDaysAgo: 14, provider: 'zoom' },
      decision: { outcome: 'APPROVED', daysAgo: 9 },
      final: { status: 'ENROLLED', at: at(8), actor: 'PARTICIPANT' },
    });
    if (sieEnrolled && sie) {
      this.enroll(this.u(51), sie, {
        status: 'ACTIVE',
        source: 'OPEN_CALL',
        at: at(8),
        applicationId: sieEnrolled.id,
      });
    }

    // --- Curso en curso, curso finalizado, curso de humedales y taller presencial (pago completo) ---
    [52, 53, 54, 55, 56, 1, 2, 3, 23, 31, 39].forEach((idx, i) =>
      this.fullPayment(idx, 'CUR', 30 - i * 2),
    );
    const fin = this.offers.get('FIN')!;
    [0, 4, 7, 12, 21, 33, 40, 42, 59].forEach((idx, i) =>
      this.fullPayment(idx, 'FIN', 100 - i * 3),
    );
    const u20 = this.u(20);
    this.installmentPlan(u20, fin, {
      concept: 'FULL_PRICE',
      total: 150_000,
      currency: 'MXN',
      enrollmentId: this.enroll(u20, fin, {
        status: 'COMPLETED',
        source: 'INSTALLMENTS',
        at: at(95),
        completedAt: new Date(fin.endsAt!.getTime() + 3 * DAY),
      }),
      status: 'COMPLETED',
      dues: [at(95), at(65)].map((d) => ({ at: d, status: 'PAID' as const })),
    });
    [2, 8, 13, 35, 37, 43].forEach((idx, i) => this.fullPayment(idx, 'HUM', 25 - i * 4));
    [4, 11, 17, 25, 28, 50].forEach((idx, i) => this.fullPayment(idx, 'TAL', 18 - i * 2));

    // --- Actividad gratuita (masterclass): inscripción libre ---
    const mas = this.offers.get('MAS');
    if (mas) {
      [1, 3, 10, 14, 16, 24, 27, 30, 36, 39, 46, 49, 52, 55].forEach((idx, i) =>
        this.enroll(this.u(idx), mas, {
          status: 'ACTIVE',
          source: 'FREE_SIGNUP',
          at: at(15 - i, this.int(0, 8)),
        }),
      );
    }
  }

  // =================================================================================================
  // Inserción ordenada (los folios BEC-/CONV-/PAG- quedan cronológicos)
  // =================================================================================================

  private async flushApplications(): Promise<void> {
    const sorted = [...this.apps].sort(
      (a, b) => (a.data.submittedAt as Date).getTime() - (b.data.submittedAt as Date).getTime(),
    );
    for (const { data } of sorted) {
      const app = await this.tx.application.create({ data, select: { id: true, number: true } });
      this.appMeta.get(app.id)!.number = app.number;
    }
    const first = sorted.find((a) => a.data.status === 'APPROVED_PENDING_PAYMENT');
    if (first) this.auditTargets.approvedApplication = first.data.id!;
  }

  private async flushEnrollments(): Promise<void> {
    await this.tx.enrollment.createMany({ data: this.enrollments });
    this.bump('enrollments', this.enrollments.length);
  }

  private async flushPlansAndPayments(): Promise<void> {
    for (const plan of this.plans) {
      await this.tx.installmentPlan.create({ data: plan });
      this.bump('installment_plans');
      this.bump('installments', (plan.installments?.create as unknown[]).length);
    }
    const sorted = [...this.payments].sort(
      (a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
    );
    for (const { transferAppId, ...payment } of sorted) {
      if (transferAppId) {
        const meta = this.appMeta.get(transferAppId)!;
        payment.transferReference = transferReference(formatFolio(meta.kind, meta.number!));
      }
      await this.tx.payment.create({ data: payment });
    }
    this.bump('payments', sorted.length);
    if (this.refunds.length) {
      await this.tx.paymentRefund.createMany({ data: this.refunds });
      this.bump('payment_refunds', this.refunds.length);
    }
    for (const user of this.users) {
      if (user.stripeCustomerId) {
        await this.tx.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: user.stripeCustomerId },
        });
      }
    }
  }

  // =================================================================================================
  // Asistencia (HU-18 / HU-30): ~80 % de las sesiones pasadas; algunas manuales por el equipo
  // =================================================================================================

  private async createAttendance(): Promise<void> {
    const byOffer = new Map<string, typeof this.enrollments>();
    for (const e of this.enrollments) {
      if (!['ACTIVE', 'COMPLETED', 'SUSPENDED'].includes(e.status as string)) continue;
      byOffer.set(e.offerId, [...(byOffer.get(e.offerId) ?? []), e]);
    }
    const sessions = await this.tx.offerSession.findMany({
      where: {
        offerId: { in: [...byOffer.keys()] },
        status: 'SCHEDULED',
        endsAt: { lt: this.now },
      },
      orderBy: { startsAt: 'asc' },
    });
    const rows: Prisma.SessionAttendanceCreateManyInput[] = [];
    for (const session of sessions) {
      for (const e of byOffer.get(session.offerId) ?? []) {
        if ((e.activatedAt as Date) > session.startsAt) continue;
        if (e.suspendedAt && (e.suspendedAt as Date) < session.startsAt) continue;
        if (this.rng() > 0.82) continue;
        const manual = this.rng() < 0.1;
        rows.push({
          sessionId: session.id,
          userId: e.userId,
          enrollmentId: e.id,
          source: manual ? 'MANUAL' : 'PARTICIPANT',
          comment: !manual && this.rng() < 0.35 ? this.pick(ATTENDANCE_COMMENTS) : null,
          registeredAt: manual
            ? new Date(session.endsAt.getTime() + this.int(26, 50) * HOUR)
            : new Date(session.endsAt.getTime() + this.int(2, 18 * 60) * 60_000),
          recordedById: manual ? this.staff.coordinator : null,
          manualReason: manual ? this.pick(MANUAL_ATTENDANCE_REASONS) : null,
        });
      }
    }
    if (rows.length) await this.tx.sessionAttendance.createMany({ data: rows });
    this.bump('session_attendances', rows.length);
    this.bump('session_attendances (manuales)', rows.filter((r) => r.source === 'MANUAL').length);
  }

  /** Avisos de formación del diplomado en curso: reprogramación, cancelación, grabación y material. */
  private buildContentNotifications(): void {
    const dip = this.offers.get('DIP')!;
    const enrolled = this.enrollments.filter((e) => e.offerId === dip.id && e.status === 'ACTIVE');
    for (const e of enrolled) {
      const user = this.users.find((u) => u.id === e.userId)!;
      const items: Array<[NotificationType, string, string, number]> = [
        [
          'RECORDING_PUBLISHED',
          'Grabación disponible',
          `Ya está la grabación de la última sesión de ${dip.name}.`,
          1,
        ],
        [
          'MATERIAL_PUBLISHED',
          'Nuevo material: Módulo 3',
          'Se publicaron la presentación, la lectura previa y la actividad del Módulo 3.',
          6,
        ],
        [
          'SESSION_RESCHEDULED',
          'Sesión reprogramada',
          'Una sesión del diplomado se movió al viernes de 18:00 a 21:00 (hora CDMX). Mismo enlace de Zoom.',
          3,
        ],
        [
          'SESSION_CANCELLED',
          'Sesión cancelada',
          'Se cancela una sesión por el puente festivo; el contenido se cubre en la siguiente.',
          2,
        ],
      ];
      for (const [type, title, body, daysAgo] of items) {
        this.notify(user, {
          type,
          category: 'TRAINING',
          title: `${title}: ${dip.name}`,
          body,
          at: this.ago(daysAgo, this.int(0, 6)),
          actionLabel: type === 'MATERIAL_PUBLISHED' ? 'Ver materiales' : 'Ver sesiones',
          actionPath:
            type === 'MATERIAL_PUBLISHED'
              ? PORTAL_LINKS.materials(dip.id)
              : PORTAL_LINKS.sessions(),
          data: { offerId: dip.id },
          dedupe: `${type.toLowerCase()}:${dip.id}`,
        });
      }
    }
  }

  // =================================================================================================
  // Moodle (HU-25): lista de correos y códigos de un solo uso
  // =================================================================================================

  private async createMoodle(): Promise<void> {
    const mdl = this.offers.get('MDL')!;
    const linkedIdx = [20, 21, 32, 34, 36, 38, 41];
    const roster: Prisma.MoodleRosterEntryCreateManyInput[] = [];
    for (const [i, idx] of linkedIdx.entries()) {
      const user = this.u(idx);
      const linkedAt = this.ago(7 - i, this.int(0, 8));
      roster.push({
        offerId: mdl.id,
        email: user.email,
        linkedUserId: user.id,
        linkedAt,
        createdById: this.staff.coordinator,
        createdAt: this.ago(12),
      });
      this.enroll(user, mdl, {
        status: 'ACTIVE',
        source: 'MOODLE_LIST',
        origin: 'MOODLE',
        at: linkedAt,
      });
    }
    for (const local of DEMO_ROSTER_ONLY_EMAILS.slice(0, 3)) {
      roster.push({
        offerId: mdl.id,
        email: `${local}@${DOMAIN}`,
        createdById: this.staff.coordinator,
        createdAt: this.ago(12),
      });
    }
    const moo = this.offers.get('MOO');
    if (moo) {
      for (const idx of [53, 54]) {
        const user = this.u(idx);
        const linkedAt = this.ago(this.int(2, 9));
        roster.push({
          offerId: moo.id,
          email: user.email,
          linkedUserId: user.id,
          linkedAt,
          createdById: this.staff.coordinator,
          createdAt: this.ago(14),
        });
        this.enroll(user, moo, {
          status: 'ACTIVE',
          source: 'MOODLE_LIST',
          origin: 'MOODLE',
          at: linkedAt,
        });
      }
      roster.push({
        offerId: moo.id,
        email: `${DEMO_ROSTER_ONLY_EMAILS[3]}@${DOMAIN}`,
        createdById: this.staff.coordinator,
        createdAt: this.ago(14),
      });
    }
    await this.tx.moodleRosterEntry.createMany({ data: roster });
    this.bump('moodle_roster_entries', roster.length);

    // Códigos ALEATORIOS (no viven en el repositorio): 2 usados y 4 disponibles.
    const codes: Prisma.MoodleAccessCodeCreateManyInput[] = [];
    for (let i = 0; i < 6; i++) {
      const code = generateAccessCode();
      const usedBy = i === 0 ? this.u(44) : i === 1 ? this.u(47) : null;
      const usedAt = usedBy ? this.ago(3 - i, 4) : null;
      codes.push({
        offerId: mdl.id,
        codeHash: hashAccessCode(code),
        codeHint: accessCodeHint(code),
        expiresAt: mdl.endsAt,
        usedById: usedBy?.id ?? null,
        usedAt,
        createdById: this.staff.coordinator,
        createdAt: this.ago(12),
      });
      if (usedBy && usedAt) {
        this.enroll(usedBy, mdl, {
          status: 'ACTIVE',
          source: 'MOODLE_ACCESS_CODE',
          origin: 'MOODLE',
          at: usedAt,
        });
      }
    }
    await this.tx.moodleAccessCode.createMany({ data: codes });
    this.bump('moodle_access_codes', codes.length);
  }

  // =================================================================================================
  // Notificaciones (HU-13): leídas/no leídas; correo SENT (nunca se envía: inserción directa)
  // =================================================================================================

  private notify(
    user: DemoUser,
    n: {
      type: NotificationType;
      category: NotificationCategory;
      title: string;
      body: string;
      at: Date;
      actionLabel?: string;
      actionPath?: string;
      data?: Record<string, string>;
      priority?: 'NORMAL' | 'HIGH';
      pinned?: boolean;
      email?: boolean;
      dedupe: string;
    },
  ): void {
    if (n.at > this.now) return;
    const ageDays = (this.now.getTime() - n.at.getTime()) / DAY;
    const read = !n.pinned && (ageDays > 2 ? this.rng() < 0.85 : this.rng() < 0.3);
    const email = n.email ?? true;
    this.notifications.push({
      userId: user.id,
      type: n.type,
      category: n.category,
      priority: n.priority ?? 'NORMAL',
      title: n.title.slice(0, 200),
      body: n.body,
      actionLabel: n.actionLabel ?? null,
      actionPath: n.actionPath ?? null,
      data: n.data ?? undefined,
      dedupeKey: `demo:${n.dedupe}`.slice(0, 200),
      pinned: n.pinned ?? false,
      readAt: read
        ? new Date(Math.min(n.at.getTime() + this.int(1, 30) * HOUR, this.now.getTime()))
        : null,
      emailStatus: email ? 'SENT' : 'NOT_REQUESTED',
      emailSentAt: email ? new Date(n.at.getTime() + 30_000) : null,
      createdAt: n.at,
    });
  }

  private async flushNotifications(): Promise<void> {
    await this.tx.notification.createMany({ data: this.notifications, skipDuplicates: true });
    this.bump('notifications', this.notifications.length);
    this.bump('notifications (fijadas)', this.notifications.filter((n) => n.pinned).length);
  }

  // =================================================================================================
  // Contacto (HU-38) y auditoría
  // =================================================================================================

  private async createContactMessages(): Promise<void> {
    const ids: string[] = [];
    for (const m of DEMO_CONTACT_MESSAGES) {
      const createdAt = this.ago(m.daysAgo, this.int(1, 9));
      const handled = m.status !== 'NEW';
      const row = await this.tx.contactMessage.create({
        data: {
          name: m.name,
          email: `${m.email}@${DOMAIN}`,
          organization: m.organization ?? null,
          phoneCountryCode: m.phone?.[0] ?? null,
          phoneNumber: m.phone?.[1] ?? null,
          subject: m.subject,
          projectType: m.projectType ?? null,
          projectLocation: m.projectLocation ?? null,
          service: m.service ?? null,
          message: m.message,
          privacyAcceptedAt: createdAt,
          origin: m.origin,
          status: m.status,
          internalNote: m.internalNote ?? null,
          handledById: handled ? (this.staff.coordinator ?? this.staff.any[0] ?? null) : null,
          handledAt: handled
            ? new Date(Math.min(createdAt.getTime() + this.int(3, 40) * HOUR, this.now.getTime()))
            : null,
          userAgent: this.pick([
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
            'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
          ]),
          createdAt,
        },
      });
      ids.push(row.id);
    }
    this.auditTargets.contact = ids[3];
    this.bump('contact_messages', ids.length);
  }

  private async createAudit(): Promise<void> {
    const t = this.auditTargets;
    const dip = this.offers.get('DIP')!;
    const payments = new Map(this.payments.map((p) => [p.id, p]));
    const folio = async (paymentId?: string) => {
      if (!paymentId) return 'el pago';
      const row = await this.tx.payment.findUnique({
        where: { id: paymentId },
        select: { number: true },
      });
      return row ? formatPaymentFolio(row.number) : 'el pago';
    };
    const entries: Array<Omit<Prisma.AdminAuditLogCreateManyInput, 'actorEmail'>> = [
      {
        action: 'offer.publish',
        entityType: 'Offer',
        entityId: t['offer:DIP'],
        summary: `Publicó la oferta «${dip.name}».`,
        createdAt: this.ago(150),
      },
      {
        action: 'offer.publish',
        entityType: 'Offer',
        entityId: t['offer:CUR'],
        summary: `Publicó la oferta «${this.offers.get('CUR')!.name}».`,
        createdAt: this.ago(55),
      },
      {
        action: 'session.reschedule',
        entityType: 'Offer',
        entityId: t['offer:DIP'],
        summary: `Reprogramó una sesión de «${dip.name}» al viernes 18:00 (CDMX).`,
        createdAt: this.ago(3),
      },
      {
        action: 'session.cancel',
        entityType: 'Offer',
        entityId: t['offer:DIP'],
        summary: `Canceló una sesión de «${dip.name}» por el puente festivo.`,
        createdAt: this.ago(2),
      },
      ...(t.approvedApplication
        ? [
            {
              action: 'application.approve',
              entityType: 'Application',
              entityId: t.approvedApplication,
              summary: 'Aprobó una postulación a beca (Aguas Libres 50%).',
              createdAt: this.ago(6),
            },
          ]
        : []),
      ...(t.validatedTransfer
        ? [
            {
              action: 'transfer.validate',
              entityType: 'Payment',
              entityId: t.validatedTransfer,
              summary: `Validó la transferencia ${await folio(t.validatedTransfer)}.`,
              createdAt: (payments.get(t.validatedTransfer)?.reviewedAt as Date) ?? this.ago(60),
            },
          ]
        : []),
      ...(t.rejectedTransfer
        ? [
            {
              action: 'transfer.reject',
              entityType: 'Payment',
              entityId: t.rejectedTransfer,
              summary: `Rechazó la transferencia ${await folio(t.rejectedTransfer)}: el monto no coincide.`,
              createdAt: this.ago(2),
            },
          ]
        : []),
      ...(t.refundPayment
        ? [
            {
              action: 'payment.refund',
              entityType: 'Payment',
              entityId: t.refundPayment,
              summary: `Reembolsó 1,960.00 MXN de ${await folio(t.refundPayment)} (confirmado).`,
              createdAt: this.ago(10),
            },
          ]
        : []),
      {
        action: 'plan.mark-delinquent',
        entityType: 'InstallmentPlan',
        entityId: t.delinquentPlan,
        summary: 'Plan de cuotas marcado "En mora" y acceso suspendido.',
        createdAt: this.ago(5),
      },
      {
        action: 'contact.update',
        entityType: 'ContactMessage',
        entityId: t.contact,
        summary: 'Cambió un mensaje de Contacto a "En proceso" y agregó una nota interna.',
        createdAt: this.ago(3),
      },
      {
        action: 'user.disable',
        entityType: 'User',
        entityId: t.disabledUser,
        summary: 'Deshabilitó una cuenta de participante a petición de la persona.',
        createdAt: this.ago(20),
      },
      {
        action: 'demo.seed',
        entityType: 'System',
        entityId: null,
        summary:
          'Cargó los datos de demostración (prisma/demo-data.ts). Se eliminan con DEMO_DATA_ACTION=purge.',
        createdAt: this.now,
      },
    ];
    await this.tx.adminAuditLog.createMany({
      data: entries.map((e) => ({ ...e, actorId: null, actorEmail: DEMO_AUDIT_ACTOR_EMAIL })),
    });
    this.bump('admin_audit_logs', entries.length);
  }
}

// =================================================================================================
// PURGE
// =================================================================================================

/**
 * Borra SOLO los datos demo (ver marcadores en la cabecera), en orden seguro para las FK y en una
 * transacción. Devuelve las filas borradas por tabla.
 */
export async function purgeDemoData(
  prisma: PrismaClient,
  options: { log?: Log } = {},
): Promise<Record<string, number>> {
  const log = options.log ?? ((m: string) => console.log(m));
  const deleted = await prisma.$transaction(
    async (tx) => {
      const out: Record<string, number> = {};
      const add = (table: string, n: number) => {
        if (n > 0) out[table] = (out[table] ?? 0) + n;
      };
      const demoEmail = { endsWith: `@${DOMAIN}`, mode: 'insensitive' as const };
      const candidates = await tx.user.findMany({
        where: { email: demoEmail },
        select: { id: true, email: true, roles: true },
      });
      // Salvaguarda: nunca se borra una cuenta con rol de equipo aunque use el dominio demo.
      const skipped = candidates.filter((u) => u.roles.some((r) => r !== 'PARTICIPANT'));
      for (const s of skipped) log(`  Se conserva ${s.email}: tiene rol de equipo.`);
      const userIds = candidates.filter((u) => !skipped.includes(u)).map((u) => u.id);
      const offerIds = (
        await tx.offer.findMany({
          where: { slug: { startsWith: DEMO_OFFER_SLUG_PREFIX } },
          select: { id: true },
        })
      ).map((o) => o.id);
      const byUserOrOffer = { OR: [{ userId: { in: userIds } }, { offerId: { in: offerIds } }] };
      const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((r) => r.id);

      const sessionIds = await ids(
        tx.offerSession.findMany({ where: { offerId: { in: offerIds } }, select: { id: true } }),
      );
      const moduleIds = await ids(
        tx.offerModule.findMany({ where: { offerId: { in: offerIds } }, select: { id: true } }),
      );
      const applicationIds = await ids(
        tx.application.findMany({ where: byUserOrOffer, select: { id: true } }),
      );
      const paymentIds = await ids(
        tx.payment.findMany({ where: byUserOrOffer, select: { id: true } }),
      );
      const planIds = await ids(
        tx.installmentPlan.findMany({ where: byUserOrOffer, select: { id: true } }),
      );
      const enrollmentIds = await ids(
        tx.enrollment.findMany({ where: byUserOrOffer, select: { id: true } }),
      );
      const contactIds = await ids(
        tx.contactMessage.findMany({ where: { email: demoEmail }, select: { id: true } }),
      );

      add(
        'session_attendances',
        (
          await tx.sessionAttendance.deleteMany({
            where: {
              OR: [
                { userId: { in: userIds } },
                { sessionId: { in: sessionIds } },
                { enrollmentId: { in: enrollmentIds } },
              ],
            },
          })
        ).count,
      );
      add(
        'final_project_submissions',
        (await tx.finalProjectSubmission.deleteMany({ where: byUserOrOffer })).count,
      );
      add(
        'payment_refunds',
        (await tx.paymentRefund.deleteMany({ where: { paymentId: { in: paymentIds } } })).count,
      );
      add('payments', (await tx.payment.deleteMany({ where: { id: { in: paymentIds } } })).count);
      add(
        'installments',
        (await tx.installment.deleteMany({ where: { planId: { in: planIds } } })).count,
      );
      add(
        'installment_plans',
        (await tx.installmentPlan.deleteMany({ where: { id: { in: planIds } } })).count,
      );
      add(
        'enrollments',
        (await tx.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } })).count,
      );
      const byApp = { applicationId: { in: applicationIds } };
      add(
        'application_evaluations',
        (await tx.applicationEvaluation.deleteMany({ where: byApp })).count,
      );
      add(
        'application_follow_up_notes',
        (await tx.applicationFollowUpNote.deleteMany({ where: byApp })).count,
      );
      add(
        'application_interviews',
        (await tx.applicationInterview.deleteMany({ where: byApp })).count,
      );
      add(
        'application_status_events',
        (await tx.applicationStatusEvent.deleteMany({ where: byApp })).count,
      );
      add(
        'application_documents',
        (await tx.applicationDocument.deleteMany({ where: byApp })).count,
      );
      add(
        'applications',
        (await tx.application.deleteMany({ where: { id: { in: applicationIds } } })).count,
      );
      add(
        'notifications',
        (await tx.notification.deleteMany({ where: { userId: { in: userIds } } })).count,
      );
      add('otp_codes', (await tx.otpCode.deleteMany({ where: { userId: { in: userIds } } })).count);
      add(
        'refresh_tokens',
        (await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } })).count,
      );
      add(
        'moodle_roster_entries',
        (
          await tx.moodleRosterEntry.deleteMany({
            where: {
              OR: [
                { email: demoEmail },
                { offerId: { in: offerIds } },
                { linkedUserId: { in: userIds } },
              ],
            },
          })
        ).count,
      );
      add(
        'moodle_access_codes',
        (
          await tx.moodleAccessCode.deleteMany({
            where: { OR: [{ offerId: { in: offerIds } }, { usedById: { in: userIds } }] },
          })
        ).count,
      );
      add(
        'contact_messages',
        (await tx.contactMessage.deleteMany({ where: { id: { in: contactIds } } })).count,
      );
      const entityIds = [
        ...userIds,
        ...offerIds,
        ...sessionIds,
        ...moduleIds,
        ...applicationIds,
        ...paymentIds,
        ...planIds,
        ...enrollmentIds,
        ...contactIds,
      ];
      add(
        'admin_audit_logs',
        (
          await tx.adminAuditLog.deleteMany({
            where: {
              OR: [{ actorEmail: DEMO_AUDIT_ACTOR_EMAIL }, { entityId: { in: entityIds } }],
            },
          })
        ).count,
      );
      add(
        'stripe_events',
        (await tx.stripeEvent.deleteMany({ where: { id: { startsWith: 'evt_demo_' } } })).count,
      );

      // Ofertas `demo-` y todo su contenido.
      const byOffer = { offerId: { in: offerIds } };
      add('calendar_events', (await tx.calendarEvent.deleteMany({ where: byOffer })).count);
      add('library_resources', (await tx.libraryResource.deleteMany({ where: byOffer })).count);
      add(
        'module_resources',
        (await tx.moduleResource.deleteMany({ where: { moduleId: { in: moduleIds } } })).count,
      );
      add('offer_sessions', (await tx.offerSession.deleteMany({ where: byOffer })).count);
      add('offer_modules', (await tx.offerModule.deleteMany({ where: byOffer })).count);
      add('offer_teachers', (await tx.offerTeacher.deleteMany({ where: byOffer })).count);
      add(
        'offer_scholarship_types',
        (await tx.offerScholarshipType.deleteMany({ where: byOffer })).count,
      );
      add('offers', (await tx.offer.deleteMany({ where: { id: { in: offerIds } } })).count);
      add('users', (await tx.user.deleteMany({ where: { id: { in: userIds } } })).count);
      return out;
    },
    { timeout: 10 * 60_000, maxWait: 60_000 },
  );
  const entries = Object.entries(deleted);
  if (entries.length === 0) log('  No hay datos demo que borrar.');
  for (const [table, n] of entries) log(`  ${table}: ${n} borradas`);
  return deleted;
}

// =================================================================================================
// CLI: pnpm demo:seed | demo:purge | demo:counts
// =================================================================================================

function printDiff(before: Record<string, number>, after: Record<string, number>): void {
  const rows = Object.keys({ ...before, ...after })
    .sort()
    .map((t) => ({
      tabla: t,
      antes: before[t] ?? 0,
      despues: after[t] ?? 0,
      delta: (after[t] ?? 0) - (before[t] ?? 0),
    }))
    .filter((r) => r.delta !== 0);
  if (rows.length) console.table(rows);
  else console.log('  Sin cambios en el conteo de filas.');
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (!['seed', 'purge', 'counts'].includes(action ?? '')) {
    throw new Error('Uso: demo-data.ts seed | purge | counts');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no está definida');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const before = await countTables(prisma);
    if (action === 'counts') {
      console.table(before);
      return;
    }
    console.log(`Datos demo: ${action}...`);
    if (action === 'seed') await seedDemoData(prisma);
    else await purgeDemoData(prisma);
    printDiff(before, await countTables(prisma));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Datos demo: falló:', error);
    process.exit(1);
  });
}
