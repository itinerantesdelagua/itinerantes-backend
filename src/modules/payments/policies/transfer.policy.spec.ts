import {
  decideTransferApproval,
  isValidTransferProof,
  transferAvailability,
  transferProofPrefix,
  transferReference,
} from './transfer.policy';

describe('transfer.policy (HU-23/33)', () => {
  const ok = { isBalance: true, profileCountryCode: 'MX', currency: 'MXN', bankConfigured: true };

  it('solo México, saldo, MXN y con datos bancarios', () => {
    expect(transferAvailability(ok)).toEqual({ available: true, reason: null });
    expect(transferAvailability({ ...ok, profileCountryCode: 'GT' }).reason).toBe('NOT_MEXICO');
    expect(transferAvailability({ ...ok, currency: 'USD' }).reason).toBe('CURRENCY_NOT_MXN');
    expect(transferAvailability({ ...ok, isBalance: false }).reason).toBe('NOT_A_BALANCE');
    expect(transferAvailability({ ...ok, bankConfigured: false }).reason).toBe('NOT_CONFIGURED');
  });

  it('comprobante PDF/JPG/PNG ≤ 15 MB', () => {
    const MB = 1024 * 1024;
    expect(isValidTransferProof({ mimeType: 'application/pdf', sizeBytes: 1000 })).toBe(true);
    expect(isValidTransferProof({ mimeType: 'application/pdf', sizeBytes: 12 * MB })).toBe(true);
    expect(isValidTransferProof({ mimeType: 'image/png', sizeBytes: 15 * MB })).toBe(true);
    expect(isValidTransferProof({ mimeType: 'image/png', sizeBytes: 15 * MB + 1 })).toBe(false);
    expect(isValidTransferProof({ mimeType: 'image/heic', sizeBytes: 1000 })).toBe(false);
    expect(isValidTransferProof({ mimeType: 'application/pdf', sizeBytes: 0 })).toBe(false);
  });

  it('monto recibido menor al esperado → solo rechazar, con la diferencia', () => {
    expect(decideTransferApproval(510_000, 510_000)).toEqual({ ok: true });
    expect(decideTransferApproval(510_000, 600_000)).toEqual({ ok: true });
    expect(decideTransferApproval(510_000, 500_000)).toEqual({
      ok: false,
      code: 'PAYMENT_TRANSFER_AMOUNT_MISMATCH',
      differenceCents: 10_000,
    });
  });

  it('referencia y prefijo', () => {
    expect(transferReference('BEC-000123')).toBe('EIA BEC-000123');
    expect(transferProofPrefix('abc')).toBe('payments/transfers/abc');
  });
});
