import { BUSINESS_RULES, formatMegabytes } from './business-rules';

const MB = 1024 * 1024;

describe('FILE_LIMITS', () => {
  const L = BUSINESS_RULES.FILE_LIMITS;

  it('límite general de 15 MB para comprobantes, evidencias (imagen) e imágenes de difusión', () => {
    expect(L.UPLOAD_MAX_BYTES).toBe(15 * MB);
    expect(L.TRANSFER_RECEIPT.maxBytes).toBe(L.UPLOAD_MAX_BYTES);
    expect(L.EVIDENCE_IMAGE.maxBytes).toBe(L.UPLOAD_MAX_BYTES);
    expect(L.OFFER_COVER.maxBytes).toBe(L.UPLOAD_MAX_BYTES);
  });

  it('ningún tipo de archivo admite menos que el límite general', () => {
    for (const limit of [
      L.FINAL_PROJECT,
      L.EVIDENCE_IMAGE,
      L.EVIDENCE_VIDEO,
      L.TRANSFER_RECEIPT,
      L.OFFER_COVER,
      L.MODULE_RESOURCE,
    ]) {
      expect(limit.maxBytes).toBeGreaterThanOrEqual(L.UPLOAD_MAX_BYTES);
    }
  });
});

describe('formatMegabytes', () => {
  it('muestra el tamaño en MB redondeado', () => {
    expect(formatMegabytes(15 * MB)).toBe('15 MB');
    expect(formatMegabytes(100 * MB)).toBe('100 MB');
  });
});
