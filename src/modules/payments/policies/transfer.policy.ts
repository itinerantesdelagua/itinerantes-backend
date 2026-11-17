import { BUSINESS_RULES } from '../../../config/business-rules';

/**
 * Transferencia bancaria (HU-23 / HU-33, Anexo A): solo México, solo el saldo de una postulación
 * aprobada, en MXN y en una exhibición; la valida el equipo (sin integración bancaria). Reglas PURAS.
 */

export const TransferUnavailableReason = {
  /** El país del perfil no es México ("Solo México"). */
  NOT_MEXICO: 'NOT_MEXICO',
  /** El saldo no está en MXN (la postulación se envió con otra moneda). */
  CURRENCY_NOT_MXN: 'CURRENCY_NOT_MXN',
  /** Solo el saldo tras beca / convocatoria con costo (el pago completo es solo con tarjeta). */
  NOT_A_BALANCE: 'NOT_A_BALANCE',
  /** La Escuela aún no configuró sus datos bancarios. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
} as const;
export type TransferUnavailableReason =
  (typeof TransferUnavailableReason)[keyof typeof TransferUnavailableReason];

export function transferAvailability(input: {
  isBalance: boolean;
  profileCountryCode: string;
  currency: string | null;
  bankConfigured: boolean;
}): { available: boolean; reason: TransferUnavailableReason | null } {
  const reason = !input.isBalance
    ? TransferUnavailableReason.NOT_A_BALANCE
    : input.profileCountryCode.toUpperCase() !== BUSINESS_RULES.MXN_COUNTRY_CODE
      ? TransferUnavailableReason.NOT_MEXICO
      : input.currency !== 'MXN'
        ? TransferUnavailableReason.CURRENCY_NOT_MXN
        : !input.bankConfigured
          ? TransferUnavailableReason.NOT_CONFIGURED
          : null;
  return { available: reason === null, reason };
}

/** Referencia única por postulación (HU-23): el folio, p. ej. "EIA BEC-000123". */
export function transferReference(applicationFolio: string): string {
  return `EIA ${applicationFolio}`;
}

/** Tipo y tamaño REALES del comprobante: PDF/JPG/PNG ≤ 15 MB (FILE_LIMITS.TRANSFER_RECEIPT). */
export function isValidTransferProof(file: { mimeType: string; sizeBytes: number }): boolean {
  const limits = BUSINESS_RULES.FILE_LIMITS.TRANSFER_RECEIPT;
  return (
    (limits.mimeTypes as readonly string[]).includes(file.mimeType) &&
    file.sizeBytes > 0 &&
    file.sizeBytes <= limits.maxBytes
  );
}

/** Prefijo de storage del comprobante (privado). */
export function transferProofPrefix(applicationId: string): string {
  return `payments/transfers/${applicationId}`;
}

export type TransferReviewDecision =
  { ok: true } | { ok: false; code: 'PAYMENT_TRANSFER_AMOUNT_MISMATCH'; differenceCents: number };

/**
 * HU-33: "Dado que el monto recibido es menor al saldo esperado, no puedo validar; solo rechazar con
 * Monto no coincide, indicando la diferencia". Un monto mayor se acepta (el excedente lo concilia
 * el equipo fuera de la plataforma).
 */
export function decideTransferApproval(
  expectedCents: number,
  receivedCents: number,
): TransferReviewDecision {
  if (receivedCents < expectedCents) {
    return {
      ok: false,
      code: 'PAYMENT_TRANSFER_AMOUNT_MISMATCH',
      differenceCents: expectedCents - receivedCents,
    };
  }
  return { ok: true };
}

export const TRANSFER_REJECTION_LABELS = {
  ILLEGIBLE: 'Comprobante ilegible',
  AMOUNT_MISMATCH: 'El monto no coincide',
  NOT_FOUND: 'No encontramos la transferencia',
  OTHER: 'Otro motivo',
} as const;
