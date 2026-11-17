import { applyPercentDiscount } from '../../../common/utils/money';
import { addDaysInZone } from '../../../common/utils/time';
import { BUSINESS_RULES } from '../../../config/business-rules';
import type { ApplicationKind, OfferOrigin, OfferType } from '../../../generated/prisma/client';
import {
  OfferActionReason,
  windowState,
  type WindowState,
} from '../../offers/policies/offer-actions.policy';
import {
  deriveOfferAvailability,
  effectiveEnrollmentClose,
  OfferAvailability,
  type OfferDates,
} from '../../offers/policies/offer-status.policy';
import { offersScholarship } from '../../offers/policies/scholarship.policy';
import {
  type OfferScholarshipTypeLink,
  resolveAssignedPercent,
  type ScholarshipOption,
  scholarshipOptions,
} from '../../scholarship-types/policies/scholarship-type.policy';

/**
 * Reglas puras de las postulaciones (HU-19, 20, 21): a qué ofertas se postula, ventana, elegibilidad,
 * validación del envío, archivos de evidencia, montos y plazos de la decisión (HU-23/31/32).
 */

// -------------------------------------------------------------------------------------------------
// Tipo de postulación y ventana
// -------------------------------------------------------------------------------------------------

export interface ApplicableOffer extends OfferDates {
  type: OfferType;
  origin: OfferOrigin;
  scholarshipEnabled: boolean;
  scholarshipTypes: readonly OfferScholarshipTypeLink[];
  scholarshipOpensAt: Date | null;
  scholarshipClosesAt: Date | null;
}

/**
 * Diplomado NAS con beca → SCHOLARSHIP (HU-19); convocatoria NAS → OPEN_CALL (HU-20).
 * Cursos, talleres, eventos, diplomados sin beca y ofertas Moodle → null (no se postula).
 */
export function applicationKindFor(offer: ApplicableOffer): ApplicationKind | null {
  if (offer.origin !== 'NAS') return null;
  if (offer.type === 'OPEN_CALL') return 'OPEN_CALL';
  if (offersScholarship(offer)) return 'SCHOLARSHIP';
  return null;
}

export interface ApplicationWindow {
  state: WindowState;
  opensAt: Date | null;
  closesAt: Date | null;
  /** Motivo si no está abierta (mismos valores que `actions[].reason` de la ficha). */
  reason: OfferActionReason | null;
}

/**
 * Ventana de postulación. Beca: `scholarshipOpensAt/ClosesAt` (o la de inscripción si faltan).
 * Convocatoria: la ventana de inscripción (= postulación) con el estado derivado de la oferta.
 */
export function applicationWindow(
  offer: ApplicableOffer,
  kind: ApplicationKind,
  now: Date,
): ApplicationWindow {
  const availability = deriveOfferAvailability(offer, now);
  if (kind === 'SCHOLARSHIP') {
    const opensAt = offer.scholarshipOpensAt ?? offer.enrollmentOpensAt;
    const closesAt = offer.scholarshipClosesAt ?? effectiveEnrollmentClose(offer);
    if (availability === OfferAvailability.FINISHED) {
      return { state: 'CLOSED', opensAt, closesAt, reason: OfferActionReason.OFFER_FINISHED };
    }
    const state = windowState(opensAt, closesAt, now);
    const reason =
      state === 'UPCOMING'
        ? OfferActionReason.SCHOLARSHIP_NOT_OPEN_YET
        : state === 'CLOSED'
          ? OfferActionReason.SCHOLARSHIP_CLOSED
          : null;
    return { state, opensAt, closesAt, reason };
  }
  const opensAt = offer.enrollmentOpensAt;
  const closesAt = effectiveEnrollmentClose(offer);
  switch (availability) {
    case OfferAvailability.ENROLLMENT_OPEN:
      return { state: 'OPEN', opensAt, closesAt, reason: null };
    case OfferAvailability.UPCOMING:
      return {
        state: 'UPCOMING',
        opensAt,
        closesAt,
        reason: OfferActionReason.ENROLLMENT_NOT_OPEN_YET,
      };
    case OfferAvailability.FINISHED:
      return { state: 'CLOSED', opensAt, closesAt, reason: OfferActionReason.OFFER_FINISHED };
    default:
      return { state: 'CLOSED', opensAt, closesAt, reason: OfferActionReason.ENROLLMENT_CLOSED };
  }
}

// -------------------------------------------------------------------------------------------------
// Elegibilidad (HU-20)
// -------------------------------------------------------------------------------------------------

export const IneligibilityReason = {
  /** El país del perfil no está entre los elegibles ("dirigida a … de Centroamérica y México"). */
  COUNTRY_NOT_ELIGIBLE: 'COUNTRY_NOT_ELIGIBLE',
  /** Respondió "No" a la disponibilidad para viajar (asistencia presencial completa). */
  TRAVEL_REQUIRED: 'TRAVEL_REQUIRED',
} as const;
export type IneligibilityReason = (typeof IneligibilityReason)[keyof typeof IneligibilityReason];

export function eligibilityIssues(
  offer: { eligibleCountryCodes: readonly string[]; requiresTravel: boolean },
  applicant: { countryCode: string; canTravel: boolean | null },
): IneligibilityReason[] {
  const reasons: IneligibilityReason[] = [];
  if (
    offer.eligibleCountryCodes.length > 0 &&
    !offer.eligibleCountryCodes.includes(applicant.countryCode.toUpperCase())
  ) {
    reasons.push(IneligibilityReason.COUNTRY_NOT_ELIGIBLE);
  }
  if (offer.requiresTravel && applicant.canTravel === false) {
    reasons.push(IneligibilityReason.TRAVEL_REQUIRED);
  }
  return reasons;
}

// -------------------------------------------------------------------------------------------------
// Validación del envío (HU-19 / HU-20: "Enviar" deshabilitado mientras falten obligatorios)
// -------------------------------------------------------------------------------------------------

/** Códigos de `details[].code` / `missingRequirements[].code` del formulario. */
export const ApplicationFieldCode = {
  REQUIRED: 'REQUIRED',
  MIN_LENGTH: 'MIN_LENGTH',
  MAX_LENGTH: 'MAX_LENGTH',
  /** Faltan archivos de evidencia (mínimo 1 en becas). */
  MIN_FILES: 'MIN_FILES',
  /** Casilla obligatoria sin marcar (términos, elegibilidad). */
  MUST_ACCEPT: 'MUST_ACCEPT',
  /** Tipo de beca no habilitado (o desactivado) en la oferta. Antes `LEVEL_NOT_ENABLED`. */
  SCHOLARSHIP_TYPE_NOT_ENABLED: 'SCHOLARSHIP_TYPE_NOT_ENABLED',
  /** Tipo de beca sin cupo: no se puede solicitar en una postulación nueva. */
  SCHOLARSHIP_TYPE_FULL: 'SCHOLARSHIP_TYPE_FULL',
  /** Campo que no corresponde al tipo de postulación (beca / convocatoria). */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type ApplicationFieldCode = (typeof ApplicationFieldCode)[keyof typeof ApplicationFieldCode];

export interface FieldIssue {
  field: string;
  code: ApplicationFieldCode;
  message: string;
}

export interface SubmissionInput {
  kind: ApplicationKind;
  /** Ids de los tipos de beca ACTIVOS de la oferta (`scholarshipOptions`). */
  enabledScholarshipTypeIds: readonly string[];
  /** Ids de los tipos de la oferta sin cupo (`isFull`). Opcional: vacío = todos con cupo. */
  fullScholarshipTypeIds?: readonly string[];
  requiresTravel: boolean;
  age: number | null;
  requestedScholarshipTypeId: string | null;
  intentLetter: string | null;
  eligibilityConfirmed: boolean;
  organization: string | null;
  organizationRole: string | null;
  experience: string | null;
  motivation: string | null;
  canTravel: boolean | null;
  termsAccepted: boolean;
  documentCount: number;
}

/** Longitud que cuenta el contador del formulario (texto sin espacios al inicio/fin). */
export function textLength(value: string | null | undefined): number {
  return value?.trim().length ?? 0;
}

function lengthIssue(
  field: string,
  value: string | null,
  min: number,
  max: number,
  label: string,
): FieldIssue | null {
  const length = textLength(value);
  if (length === 0) return { field, code: 'REQUIRED', message: `Escribe ${label}.` };
  if (length < min) {
    return {
      field,
      code: 'MIN_LENGTH',
      message: `${capitalize(label)} debe tener al menos ${min} caracteres (llevas ${length}).`,
    };
  }
  if (length > max) {
    return {
      field,
      code: 'MAX_LENGTH',
      message: `${capitalize(label)} debe tener como máximo ${max} caracteres.`,
    };
  }
  return null;
}

/** Lista de pendientes para poder enviar (vacía = lista para enviar). */
export function submissionIssues(input: SubmissionInput): FieldIssue[] {
  const issues: Array<FieldIssue | null> = [];
  if (input.kind === 'SCHOLARSHIP') {
    issues.push(
      input.age === null ? { field: 'age', code: 'REQUIRED', message: 'Indica tu edad.' } : null,
      input.requestedScholarshipTypeId === null
        ? {
            field: 'requestedScholarshipTypeId',
            code: 'REQUIRED',
            message: 'Elige un tipo de beca.',
          }
        : !input.enabledScholarshipTypeIds.includes(input.requestedScholarshipTypeId)
          ? {
              field: 'requestedScholarshipTypeId',
              code: 'SCHOLARSHIP_TYPE_NOT_ENABLED',
              message: 'Ese tipo de beca no está disponible para este diplomado.',
            }
          : input.fullScholarshipTypeIds?.includes(input.requestedScholarshipTypeId)
            ? {
                field: 'requestedScholarshipTypeId',
                code: 'SCHOLARSHIP_TYPE_FULL',
                message: 'Ya no hay cupo para ese tipo de beca: elige otro.',
              }
            : null,
      lengthIssue(
        'intentLetter',
        input.intentLetter,
        BUSINESS_RULES.SCHOLARSHIP_LETTER_MIN_LENGTH,
        BUSINESS_RULES.SCHOLARSHIP_LETTER_MAX_LENGTH,
        'la carta de intención',
      ),
      input.documentCount < BUSINESS_RULES.FILE_LIMITS.EVIDENCE_MIN_FILES
        ? {
            field: 'documents',
            code: 'MIN_FILES',
            message: 'Adjunta al menos una foto o video de tu experiencia territorial.',
          }
        : null,
    );
  } else {
    const min = BUSINESS_RULES.OPEN_CALL_ANSWER_MIN_LENGTH;
    const max = BUSINESS_RULES.OPEN_CALL_ANSWER_MAX_LENGTH;
    issues.push(
      input.eligibilityConfirmed
        ? null
        : {
            field: 'eligibilityConfirmed',
            code: 'MUST_ACCEPT',
            message: 'Confirma que cumples con la elegibilidad de la convocatoria.',
          },
      textLength(input.organization) === 0
        ? { field: 'organization', code: 'REQUIRED', message: 'Indica tu organización.' }
        : null,
      textLength(input.organizationRole) === 0
        ? { field: 'organizationRole', code: 'REQUIRED', message: 'Indica tu rol.' }
        : null,
      lengthIssue('experience', input.experience, min, max, 'tu experiencia'),
      lengthIssue('motivation', input.motivation, min, max, 'tu motivación'),
      input.requiresTravel && input.canTravel === null
        ? {
            field: 'canTravel',
            code: 'REQUIRED',
            message: 'Indica tu disponibilidad para viajar.',
          }
        : null,
    );
  }
  issues.push(
    input.termsAccepted
      ? null
      : {
          field: 'termsAccepted',
          code: 'MUST_ACCEPT',
          message: 'Acepta los términos para enviar.',
        },
  );
  return issues.filter((i): i is FieldIssue => i !== null);
}

// -------------------------------------------------------------------------------------------------
// Evidencias (HU-19: JPG/PNG/HEIC ≤ 15 MB, MP4/MOV ≤ 100 MB, máx. 10 archivos)
// -------------------------------------------------------------------------------------------------

export type EvidenceMediaType = 'IMAGE' | 'VIDEO';

export function evidenceMediaType(mimeType: string): EvidenceMediaType | null {
  const { EVIDENCE_IMAGE, EVIDENCE_VIDEO } = BUSINESS_RULES.FILE_LIMITS;
  if ((EVIDENCE_IMAGE.mimeTypes as readonly string[]).includes(mimeType)) return 'IMAGE';
  if ((EVIDENCE_VIDEO.mimeTypes as readonly string[]).includes(mimeType)) return 'VIDEO';
  return null;
}

/** Tipo permitido y tamaño (> 0 y ≤ límite de su tipo). */
export function isValidEvidenceFile(file: { mimeType: string; sizeBytes: number }): boolean {
  const media = evidenceMediaType(file.mimeType);
  if (!media || file.sizeBytes <= 0) return false;
  const limits =
    media === 'IMAGE'
      ? BUSINESS_RULES.FILE_LIMITS.EVIDENCE_IMAGE
      : BUSINESS_RULES.FILE_LIMITS.EVIDENCE_VIDEO;
  return file.sizeBytes <= limits.maxBytes;
}

/** Prefijo de storage de las evidencias de una postulación (la confirmación lo exige). */
export function evidenceKeyPrefix(applicationId: string): string {
  return `applications/${applicationId}/evidence/`;
}

// -------------------------------------------------------------------------------------------------
// Folio
// -------------------------------------------------------------------------------------------------

/** Folio legible de la confirmación (HU-19/20): BEC-000123 (beca) o CONV-000123 (convocatoria). */
export function formatFolio(kind: ApplicationKind, number: number): string {
  return `${kind === 'SCHOLARSHIP' ? 'BEC' : 'CONV'}-${String(number).padStart(6, '0')}`;
}

// -------------------------------------------------------------------------------------------------
// Decisión, saldo y plazos (HU-21, 23, 31, 32) — los usa la Fase 06 al aprobar
// -------------------------------------------------------------------------------------------------

/**
 * Entrevista por Zoom obligatoria (HU-19 / HU-31): siempre en convocatorias; en becas, si el tipo de
 * beca (asignado o, antes de la decisión, solicitado) tiene `requiresInterview`.
 */
export function interviewRequired(
  kind: ApplicationKind,
  scholarshipTypeRequiresInterview: boolean | null | undefined,
): boolean {
  if (kind === 'OPEN_CALL') return true;
  return scholarshipTypeRequiresInterview === true;
}

export type ScholarshipAssignment =
  | { ok: true; option: ScholarshipOption; percent: number }
  | { ok: false; issue: { field: string; code: string; message: string } };

/**
 * Tipo y % que asigna el comité (HU-31). El tipo debe estar habilitado en la oferta (aunque se haya
 * desactivado después: la persona lo pudo solicitar cuando estaba vigente) y el % caer en su rango
 * efectivo (fijo → se toma solo).
 */
export function resolveScholarshipAssignment(
  links: readonly OfferScholarshipTypeLink[],
  scholarshipTypeId: string | null | undefined,
  percent: number | null | undefined,
): ScholarshipAssignment {
  if (!scholarshipTypeId) {
    return {
      ok: false,
      issue: {
        field: 'assignedScholarshipTypeId',
        code: 'REQUIRED',
        message: 'Elige el tipo de beca asignado.',
      },
    };
  }
  const option =
    scholarshipOptions(links, { activeOnly: false }).find((o) => o.id === scholarshipTypeId) ??
    null;
  if (!option) {
    return {
      ok: false,
      issue: {
        field: 'assignedScholarshipTypeId',
        code: ApplicationFieldCode.SCHOLARSHIP_TYPE_NOT_ENABLED,
        message: 'El tipo de beca no está habilitado en esta oferta.',
      },
    };
  }
  const resolved = resolveAssignedPercent(option, percent);
  if (!resolved.ok) {
    return {
      ok: false,
      issue: { field: 'assignedPercent', code: 'INVALID', message: resolved.message },
    };
  }
  return { ok: true, option, percent: resolved.percent };
}

/** Saldo tras la beca (HU-23): 10,200 MXN con 50% → 5,100 MXN. Sin precio → 0. */
export function balanceAfterScholarship(originalCents: number | null, percent: number): number {
  if (originalCents === null || originalCents <= 0) return 0;
  return applyPercentDiscount(originalCents, percent);
}

/**
 * Plazo para pagar o confirmar (Anexo A HU-21/23): N días naturales desde la aprobación, sin
 * superar el inicio de la oferta (si el inicio ya pasó o no existe, solo los N días).
 */
export function responseDeadline(
  decidedAt: Date,
  kind: 'PAYMENT' | 'CONFIRMATION',
  offerStartsAt: Date | null,
): Date {
  const days =
    kind === 'PAYMENT'
      ? BUSINESS_RULES.PAYMENT_DEADLINE_AFTER_APPROVAL_DAYS
      : BUSINESS_RULES.OPEN_CALL_CONFIRMATION_DEADLINE_DAYS;
  const byDays = addDaysInZone(decidedAt, days);
  if (offerStartsAt && offerStartsAt.getTime() > decidedAt.getTime()) {
    return offerStartsAt.getTime() < byDays.getTime() ? offerStartsAt : byDays;
  }
  return byDays;
}

/** ¿Vence ya? Con comprobante de transferencia "Pendiente de validación" nunca vence (HU-21). */
export function isResponseOverdue(
  input: { responseDueAt: Date | null; pendingTransferSince: Date | null },
  now: Date,
): boolean {
  return (
    input.responseDueAt !== null &&
    input.pendingTransferSince === null &&
    input.responseDueAt.getTime() <= now.getTime()
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
