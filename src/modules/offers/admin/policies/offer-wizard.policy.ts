import { BUSINESS_RULES, formatMegabytes } from '../../../../config/business-rules';
import { isWhatsappGroupUrl } from '../../../../common/utils/urls';
import type {
  OfferModality,
  OfferOrigin,
  OfferPublicationStatus,
  OfferType,
} from '../../../../generated/prisma/client';
import { OfferAvailability } from '../../policies/offer-status.policy';
import { safeParseScheduleRule } from '../../policies/schedule-rule';
import { validateOfferHours } from '../../policies/session-generation.policy';

/**
 * Asistente de 7 pasos de la oferta (HU-27) — reglas PURAS.
 *
 * - Cada paso se guarda como borrador aunque esté incompleto (autoguardado): aquí solo se calculan
 *   los problemas (`issues`) de cada paso para que el frontend bloquee "Siguiente" y "Publicar".
 * - Publicar exige los pasos 1–4 completos (+ que 6 y 7 no tengan datos inválidos).
 */

export const WizardStepKey = {
  GENERAL: 'GENERAL',
  CONTENT: 'CONTENT',
  SCHEDULE: 'SCHEDULE',
  ORIGIN_PRICING: 'ORIGIN_PRICING',
  RESOURCES: 'RESOURCES',
  ATTENDANCE: 'ATTENDANCE',
  WHATSAPP: 'WHATSAPP',
} as const;
export type WizardStepKey = (typeof WizardStepKey)[keyof typeof WizardStepKey];

export interface WizardStepDef {
  step: number;
  key: WizardStepKey;
  /** Segmento de la ruta `PATCH /admin/offers/{id}/steps/{slug}` y prefijo de `details[].field`. */
  slug: string;
  label: string;
  /** Obligatorio para publicar. */
  requiredToPublish: boolean;
}

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { step: 1, key: 'GENERAL', slug: 'general', label: 'Datos e imágenes', requiredToPublish: true },
  { step: 2, key: 'CONTENT', slug: 'content', label: 'Contenido', requiredToPublish: true },
  { step: 3, key: 'SCHEDULE', slug: 'schedule', label: 'Horarios', requiredToPublish: true },
  {
    step: 4,
    key: 'ORIGIN_PRICING',
    slug: 'origin-pricing',
    label: 'Origen y precio',
    requiredToPublish: true,
  },
  { step: 5, key: 'RESOURCES', slug: 'resources', label: 'Recursos', requiredToPublish: false },
  { step: 6, key: 'ATTENDANCE', slug: 'attendance', label: 'Asistencia', requiredToPublish: true },
  { step: 7, key: 'WHATSAPP', slug: 'whatsapp', label: 'WhatsApp', requiredToPublish: true },
];

/** Códigos de `issues[].code` / `details[].code` del asistente. */
export const WizardIssueCode = {
  REQUIRED: 'REQUIRED',
  MIN_LENGTH: 'MIN_LENGTH',
  MAX_LENGTH: 'MAX_LENGTH',
  INVALID: 'INVALID',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  COURSE_MAX_HOURS_EXCEEDED: 'COURSE_MAX_HOURS_EXCEEDED',
  DIPLOMA_HOURS_MISMATCH: 'DIPLOMA_HOURS_MISMATCH',
} as const;
export type WizardIssueCode = (typeof WizardIssueCode)[keyof typeof WizardIssueCode];

export interface WizardIssue {
  field: string;
  code: WizardIssueCode;
  message: string;
}

/** Campos de la oferta que revisa el asistente. */
export interface WizardOffer {
  name: string;
  type: OfferType;
  modality: OfferModality;
  origin: OfferOrigin;
  summary: string;
  coverImageKey: string | null;
  venueName: string | null;
  venueCity: string | null;
  description: string;
  eligibilityText: string | null;
  finalProjectSubmissionEnabled: boolean;
  enrollmentOpensAt: Date | null;
  enrollmentClosesAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  finalProjectDueAt: Date | null;
  totalMinutes: number | null;
  scheduleRule: unknown;
  isFree: boolean;
  priceMxnCents: number | null;
  priceUsdCents: number | null;
  installmentsEnabled: boolean;
  installmentsMax: number | null;
  scholarshipEnabled: boolean;
  /** Tipos de beca habilitados (solo importa si hay alguno activo). */
  scholarshipTypes: readonly { scholarshipType: { active: boolean } }[];
  scholarshipOpensAt: Date | null;
  scholarshipClosesAt: Date | null;
  attendanceWindowHours: number;
  whatsappGroupUrl: string | null;
}

const R = BUSINESS_RULES;
const blank = (value: string | null | undefined) => !value || value.trim() === '';

function generalIssues(o: WizardOffer): WizardIssue[] {
  const issues: WizardIssue[] = [];
  if (o.name.trim().length < 3) {
    issues.push({
      field: 'name',
      code: 'MIN_LENGTH',
      message: 'El nombre debe tener al menos 3 caracteres.',
    });
  }
  if (blank(o.summary)) {
    issues.push({
      field: 'summary',
      code: 'REQUIRED',
      message: 'Escribe el resumen de la tarjeta del catálogo.',
    });
  } else if (o.summary.length > R.OFFER_SUMMARY_MAX_LENGTH) {
    issues.push({
      field: 'summary',
      code: 'MAX_LENGTH',
      message: `El resumen admite máximo ${R.OFFER_SUMMARY_MAX_LENGTH} caracteres.`,
    });
  }
  if (blank(o.coverImageKey)) {
    issues.push({
      field: 'coverImageKey',
      code: 'REQUIRED',
      message: `Sube la portada (JPG, PNG o WebP de máximo ${formatMegabytes(R.FILE_LIMITS.OFFER_COVER.maxBytes)}).`,
    });
  }
  if (o.modality === 'IN_PERSON') {
    if (blank(o.venueName)) {
      issues.push({
        field: 'venueName',
        code: 'REQUIRED',
        message: 'El lugar es obligatorio en ofertas presenciales.',
      });
    }
    if (blank(o.venueCity)) {
      issues.push({
        field: 'venueCity',
        code: 'REQUIRED',
        message: 'La ciudad del lugar es obligatoria en ofertas presenciales.',
      });
    }
  }
  return issues;
}

function contentIssues(o: WizardOffer): WizardIssue[] {
  const issues: WizardIssue[] = [];
  if (blank(o.description)) {
    issues.push({
      field: 'description',
      code: 'REQUIRED',
      message: 'Escribe la descripción de la oferta.',
    });
  }
  if (o.type === 'OPEN_CALL' && blank(o.eligibilityText)) {
    issues.push({
      field: 'eligibilityText',
      code: 'REQUIRED',
      message: 'Describe la elegibilidad de la convocatoria.',
    });
  }
  if (o.finalProjectSubmissionEnabled && o.type !== 'DIPLOMA') {
    issues.push({
      field: 'finalProjectSubmissionEnabled',
      code: 'NOT_APPLICABLE',
      message: 'La entrega del proyecto final solo aplica a diplomados.',
    });
  }
  return issues;
}

function scheduleIssues(o: WizardOffer): WizardIssue[] {
  const issues: WizardIssue[] = [];
  const req = (field: string, value: unknown, message: string) => {
    if (value === null || value === undefined) issues.push({ field, code: 'REQUIRED', message });
  };
  req('startsAt', o.startsAt, 'Indica la fecha de inicio.');
  req('endsAt', o.endsAt, 'Indica la fecha de fin.');
  if (o.startsAt && o.endsAt && o.endsAt <= o.startsAt) {
    issues.push({
      field: 'endsAt',
      code: 'INVALID',
      message: 'El fin debe ser posterior al inicio.',
    });
  }
  if (o.type === 'OPEN_CALL') {
    req('enrollmentOpensAt', o.enrollmentOpensAt, 'Indica cuándo abre la convocatoria.');
    req('enrollmentClosesAt', o.enrollmentClosesAt, 'Indica cuándo cierra la convocatoria.');
  }
  if (o.enrollmentOpensAt && o.enrollmentClosesAt && o.enrollmentClosesAt <= o.enrollmentOpensAt) {
    issues.push({
      field: 'enrollmentClosesAt',
      code: 'INVALID',
      message: 'El cierre de inscripciones debe ser posterior a la apertura.',
    });
  }
  if (o.enrollmentClosesAt && o.endsAt && o.enrollmentClosesAt > o.endsAt) {
    issues.push({
      field: 'enrollmentClosesAt',
      code: 'INVALID',
      message: 'Las inscripciones deben cerrar antes del fin de la oferta.',
    });
  }
  if (o.type === 'DIPLOMA') {
    req(
      'finalProjectDueAt',
      o.finalProjectDueAt,
      'Los diplomados requieren la fecha del proyecto final.',
    );
  }
  if (o.finalProjectDueAt && o.startsAt && o.finalProjectDueAt < o.startsAt) {
    issues.push({
      field: 'finalProjectDueAt',
      code: 'INVALID',
      message: 'El proyecto final debe ser posterior al inicio.',
    });
  }
  if (o.type === 'DIPLOMA' || o.type === 'COURSE') {
    if (o.totalMinutes === null) {
      issues.push({
        field: 'totalHours',
        code: 'REQUIRED',
        message:
          o.type === 'DIPLOMA'
            ? `Los diplomados duran ${R.DIPLOMA_TOTAL_HOURS} h.`
            : 'Indica la duración total del curso.',
      });
    } else {
      for (const violation of validateOfferHours(o.type, o.totalMinutes)) {
        issues.push(
          violation === 'COURSE_MAX_HOURS_EXCEEDED'
            ? {
                field: 'totalHours',
                code: 'COURSE_MAX_HOURS_EXCEEDED',
                message: `Los cursos tienen una duración máxima de ${R.COURSE_MAX_HOURS} horas.`,
              }
            : {
                field: 'totalHours',
                code: 'DIPLOMA_HOURS_MISMATCH',
                message: `Los diplomados deben sumar ${R.DIPLOMA_TOTAL_HOURS} horas.`,
              },
        );
      }
    }
    if (o.modality === 'ONLINE_LIVE' && !safeParseScheduleRule(o.scheduleRule)) {
      issues.push({
        field: 'scheduleRule',
        code: 'REQUIRED',
        message: 'Define los días y el horario (hora CDMX) para generar las sesiones.',
      });
    }
  }
  return issues;
}

function originPricingIssues(o: WizardOffer): WizardIssue[] {
  const issues: WizardIssue[] = [];
  if (o.origin === 'MOODLE') return issues; // precio, cuotas y beca no aplican (se limpian al guardar)
  if (!o.isFree) {
    if (!o.priceMxnCents || o.priceMxnCents <= 0) {
      issues.push({
        field: 'priceMxnCents',
        code: 'REQUIRED',
        message: 'Indica el precio en MXN (mayor a 0).',
      });
    }
    if (!o.priceUsdCents || o.priceUsdCents <= 0) {
      issues.push({
        field: 'priceUsdCents',
        code: 'REQUIRED',
        message: 'Indica el precio en USD (mayor a 0).',
      });
    }
  }
  if (o.installmentsEnabled) {
    if (o.isFree) {
      issues.push({
        field: 'installmentsEnabled',
        code: 'NOT_APPLICABLE',
        message: 'Una oferta gratuita no tiene cuotas.',
      });
    } else if (
      o.installmentsMax === null ||
      o.installmentsMax < R.INSTALLMENTS_MIN ||
      o.installmentsMax > R.INSTALLMENTS_MAX
    ) {
      issues.push({
        field: 'installmentsMax',
        code: 'INVALID',
        message: `Elige entre ${R.INSTALLMENTS_MIN} y ${R.INSTALLMENTS_MAX} cuotas.`,
      });
    }
  }
  if (o.scholarshipEnabled) {
    if (o.type !== 'DIPLOMA') {
      issues.push({
        field: 'scholarshipEnabled',
        code: 'NOT_APPLICABLE',
        message: 'La beca solo aplica a diplomados.',
      });
    } else if (!o.scholarshipTypes.some((link) => link.scholarshipType.active)) {
      issues.push({
        field: 'scholarshipTypes',
        code: 'REQUIRED',
        message: 'Habilita al menos un tipo de beca activo.',
      });
    }
    if (o.isFree) {
      issues.push({
        field: 'scholarshipEnabled',
        code: 'NOT_APPLICABLE',
        message: 'Una oferta gratuita no tiene beca.',
      });
    }
    if (
      o.scholarshipOpensAt &&
      o.scholarshipClosesAt &&
      o.scholarshipClosesAt <= o.scholarshipOpensAt
    ) {
      issues.push({
        field: 'scholarshipClosesAt',
        code: 'INVALID',
        message: 'El cierre de la convocatoria de becas debe ser posterior a la apertura.',
      });
    }
  }
  return issues;
}

function attendanceIssues(o: WizardOffer): WizardIssue[] {
  const h = o.attendanceWindowHours;
  return h < R.ATTENDANCE_WINDOW_MIN_HOURS || h > R.ATTENDANCE_WINDOW_MAX_HOURS
    ? [
        {
          field: 'attendanceWindowHours',
          code: 'INVALID',
          message: `La ventana debe ser de ${R.ATTENDANCE_WINDOW_MIN_HOURS} a ${R.ATTENDANCE_WINDOW_MAX_HOURS} horas.`,
        },
      ]
    : [];
}

function whatsappIssues(o: WizardOffer): WizardIssue[] {
  return o.whatsappGroupUrl && !isWhatsappGroupUrl(o.whatsappGroupUrl)
    ? [
        {
          field: 'whatsappGroupUrl',
          code: 'INVALID',
          message: 'Usa un enlace https://chat.whatsapp.com/…',
        },
      ]
    : [];
}

const ISSUES_BY_STEP: Record<WizardStepKey, (o: WizardOffer) => WizardIssue[]> = {
  GENERAL: generalIssues,
  CONTENT: contentIssues,
  SCHEDULE: scheduleIssues,
  ORIGIN_PRICING: originPricingIssues,
  RESOURCES: () => [],
  ATTENDANCE: attendanceIssues,
  WHATSAPP: whatsappIssues,
};

export interface WizardStepStatus extends WizardStepDef {
  complete: boolean;
  issues: WizardIssue[];
}

export interface WizardStatus {
  steps: WizardStepStatus[];
  canPublish: boolean;
  /** Problemas que impiden publicar, con `field` = `<slug del paso>.<campo>`. */
  publishBlockers: WizardIssue[];
}

/** Estado del asistente: problemas por paso y si se puede publicar. */
export function offerWizardStatus(offer: WizardOffer): WizardStatus {
  const steps = WIZARD_STEPS.map((def) => {
    const issues = ISSUES_BY_STEP[def.key](offer);
    return { ...def, complete: issues.length === 0, issues };
  });
  const publishBlockers = steps
    .filter((s) => s.requiredToPublish)
    .flatMap((s) => s.issues.map((i) => ({ ...i, field: `${s.slug}.${i.field}` })));
  return { steps, canPublish: publishBlockers.length === 0, publishBlockers };
}

// -------------------------------------------------------------------------------------------------
// Estado de la oferta en el listado del panel (HU-27: Borrador / Publicado / Inscripciones cerradas /
// Finalizado) y transiciones de publicación
// -------------------------------------------------------------------------------------------------

export const AdminOfferStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ENROLLMENT_CLOSED: 'ENROLLMENT_CLOSED',
  FINISHED: 'FINISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AdminOfferStatus = (typeof AdminOfferStatus)[keyof typeof AdminOfferStatus];

export const ADMIN_OFFER_STATUS_LABELS: Record<AdminOfferStatus, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicado',
  ENROLLMENT_CLOSED: 'Inscripciones cerradas',
  FINISHED: 'Finalizado',
  ARCHIVED: 'Archivado',
};

export function adminOfferStatus(
  publication: OfferPublicationStatus,
  availability: OfferAvailability,
): AdminOfferStatus {
  if (publication === 'DRAFT') return 'DRAFT';
  if (publication === 'ARCHIVED') return 'ARCHIVED';
  if (availability === OfferAvailability.FINISHED) return 'FINISHED';
  if (availability === OfferAvailability.ENROLLMENT_CLOSED) return 'ENROLLMENT_CLOSED';
  return 'PUBLISHED';
}

export type PublicationAction = 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE';

/** Nuevo estado de publicación, o null si la acción no aplica desde `from`. */
export function publicationTransition(
  from: OfferPublicationStatus,
  action: PublicationAction,
): OfferPublicationStatus | null {
  switch (action) {
    case 'PUBLISH':
      return from === 'DRAFT' ? 'PUBLISHED' : null;
    case 'UNPUBLISH':
      return from === 'PUBLISHED' || from === 'ARCHIVED' ? 'DRAFT' : null;
    case 'ARCHIVE':
      return from === 'DRAFT' || from === 'PUBLISHED' ? 'ARCHIVED' : null;
  }
}

/** Nombre libre para "Duplicar": "X (copia)", "X (copia 2)"… (máx. 160). */
export function duplicateName(base: string, taken: (name: string) => boolean): string {
  const root = base.replace(/ \(copia(?: \d+)?\)$/, '').slice(0, 145);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? `${root} (copia)` : `${root} (copia ${n})`;
    if (!taken(candidate)) return candidate;
  }
  return `${root} (copia ${Date.now()})`;
}

/** Slug libre: `base`, `base-2`, `base-3`… (máx. 140). */
export function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  const root = (base || 'oferta').slice(0, 130).replace(/-+$/, '');
  if (!taken(root)) return root;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${root}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  return `${root}-${Date.now()}`;
}
