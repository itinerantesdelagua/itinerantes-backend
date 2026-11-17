import { BUSINESS_RULES } from '../../../../config/business-rules';
import type { ModuleResourceType } from '../../../../generated/prisma/client';

/**
 * Reglas PURAS del contenido del aula en el panel (HU-27 imágenes, HU-28 módulos y recursos).
 */

const PDF = 'application/pdf';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EPUB = 'application/epub+zip';

/**
 * Tipos permitidos por sección (HU-28): Presentación PDF/PPTX; Lecturas PDF/DOCX/EPUB; Actividades
 * cualquiera de los anteriores. Todos ≤ 50 MB (FILE_LIMITS.MODULE_RESOURCE).
 */
export const MODULE_RESOURCE_MIME_TYPES: Record<ModuleResourceType, readonly string[]> = {
  PRESENTATION: [PDF, PPTX],
  PRE_READING: [PDF, DOCX, EPUB],
  ACTIVITY: BUSINESS_RULES.FILE_LIMITS.MODULE_RESOURCE.mimeTypes,
};

export function isValidModuleResourceFile(
  type: ModuleResourceType,
  file: { mimeType: string; sizeBytes: number },
): boolean {
  return (
    MODULE_RESOURCE_MIME_TYPES[type].includes(file.mimeType) &&
    file.sizeBytes > 0 &&
    file.sizeBytes <= BUSINESS_RULES.FILE_LIMITS.MODULE_RESOURCE.maxBytes
  );
}

/** Imágenes de difusión (portada, carrusel, foto de docente): JPG/PNG/WebP ≤ 15 MB (HU-27, FILE_LIMITS.OFFER_COVER). */
export function isValidPublicImage(file: { mimeType: string; sizeBytes: number }): boolean {
  const limit = BUSINESS_RULES.FILE_LIMITS.OFFER_COVER;
  return (
    (limit.mimeTypes as readonly string[]).includes(file.mimeType) &&
    file.sizeBytes > 0 &&
    file.sizeBytes <= limit.maxBytes
  );
}

export type ImagePurpose = 'OFFER_COVER' | 'OFFER_CAROUSEL' | 'TEACHER_PHOTO';

/** Prefijo de storage (bucket público si existe STORAGE_PUBLIC_BUCKET) de cada imagen. */
export function publicImagePrefix(purpose: ImagePurpose, offerId?: string): string {
  if (purpose === 'TEACHER_PHOTO') return 'public/teachers/';
  return `public/offers/${offerId}/${purpose === 'OFFER_COVER' ? 'cover' : 'carousel'}/`;
}

/** Prefijo privado de los archivos de un módulo (URL firmada solo para inscritos / panel). */
export function moduleResourcePrefix(offerId: string, moduleId: string): string {
  return `offers/${offerId}/modules/${moduleId}/`;
}

/** Una key enviada por el cliente es aceptable solo bajo el prefijo esperado y sin `..`. */
export function keyMatchesPrefix(key: string, prefix: string): boolean {
  return key.startsWith(prefix) && !key.includes('..') && key.length > prefix.length;
}

/** `publishAt` de una publicación programada debe ser futuro (HU-28). */
export function isValidScheduledPublish(publishAt: Date | null | undefined, now: Date): boolean {
  return publishAt === null || publishAt === undefined || publishAt.getTime() > now.getTime();
}

/** Fecha de una actividad dentro del periodo de la oferta (HU-28). */
export function isWithinOfferPeriod(
  date: Date,
  offer: { startsAt: Date | null; endsAt: Date | null },
): boolean {
  if (offer.startsAt && date < offer.startsAt) return false;
  if (offer.endsAt && date > offer.endsAt) return false;
  return true;
}

/**
 * Orden completo: `ids` debe contener exactamente los ids existentes, sin repetir (reordenar módulos
 * o recursos con arrastrar y soltar).
 */
export function isCompletePermutation(
  ids: readonly string[],
  existing: readonly string[],
): boolean {
  if (ids.length !== existing.length || new Set(ids).size !== ids.length) return false;
  const set = new Set(existing);
  return ids.every((id) => set.has(id));
}
