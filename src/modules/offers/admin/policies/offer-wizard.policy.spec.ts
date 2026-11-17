import {
  adminOfferStatus,
  duplicateName,
  offerWizardStatus,
  publicationTransition,
  uniqueSlug,
  type WizardOffer,
} from './offer-wizard.policy';
import {
  isCompletePermutation,
  isValidModuleResourceFile,
  isValidPublicImage,
  isValidScheduledPublish,
  isWithinOfferPeriod,
  keyMatchesPrefix,
  publicImagePrefix,
} from './admin-content.policy';

const d = (iso: string) => new Date(iso);

function diploma(overrides: Partial<WizardOffer> = {}): WizardOffer {
  return {
    name: 'Diplomado en Ecotecnologías del Agua',
    type: 'DIPLOMA',
    modality: 'ONLINE_LIVE',
    origin: 'NAS',
    summary: 'Diseña ecotecnologías.',
    coverImageKey: 'public/offers/x/cover/a.png',
    venueName: null,
    venueCity: null,
    description: 'Descripción',
    eligibilityText: null,
    finalProjectSubmissionEnabled: true,
    enrollmentOpensAt: d('2026-09-01T06:00:00Z'),
    enrollmentClosesAt: d('2026-11-01T06:00:00Z'),
    startsAt: d('2026-11-07T16:00:00Z'),
    endsAt: d('2027-01-31T19:00:00Z'),
    finalProjectDueAt: d('2027-01-31T16:00:00Z'),
    totalMinutes: 3600,
    scheduleRule: { weekdays: [6, 7], startTime: '10:00', endTime: '13:00' },
    isFree: false,
    priceMxnCents: 1_020_000,
    priceUsdCents: 58_500,
    installmentsEnabled: true,
    installmentsMax: 3,
    scholarshipEnabled: true,
    scholarshipTypes: [{ scholarshipType: { active: true } }],
    scholarshipOpensAt: null,
    scholarshipClosesAt: null,
    attendanceWindowHours: 24,
    whatsappGroupUrl: 'https://chat.whatsapp.com/abc',
    ...overrides,
  };
}

const issuesOf = (o: WizardOffer, key: string) =>
  offerWizardStatus(o)
    .steps.find((s) => s.key === key)!
    .issues.map((i) => `${i.field}:${i.code}`);

describe('offer-wizard.policy', () => {
  it('diplomado completo: se puede publicar', () => {
    const status = offerWizardStatus(diploma());
    expect(status.canPublish).toBe(true);
    expect(status.steps).toHaveLength(7);
    expect(status.steps.every((s) => s.complete)).toBe(true);
  });

  it('diplomado sin 60 h o sin proyecto final → bloquea (HU-27)', () => {
    expect(issuesOf(diploma({ totalMinutes: 58 * 60 }), 'SCHEDULE')).toEqual([
      'totalHours:DIPLOMA_HOURS_MISMATCH',
    ]);
    expect(issuesOf(diploma({ finalProjectDueAt: null }), 'SCHEDULE')).toEqual([
      'finalProjectDueAt:REQUIRED',
    ]);
    const status = offerWizardStatus(diploma({ totalMinutes: 3000 }));
    expect(status.canPublish).toBe(false);
    expect(status.publishBlockers[0].field).toBe('schedule.totalHours');
  });

  it('curso de más de 9 h → COURSE_MAX_HOURS_EXCEEDED', () => {
    const course = diploma({
      type: 'COURSE',
      totalMinutes: 10 * 60,
      finalProjectDueAt: null,
      finalProjectSubmissionEnabled: false,
      scholarshipEnabled: false,
    });
    expect(issuesOf(course, 'SCHEDULE')).toEqual(['totalHours:COURSE_MAX_HOURS_EXCEEDED']);
    expect(issuesOf({ ...course, totalMinutes: 9 * 60 }, 'SCHEDULE')).toEqual([]);
  });

  it('presencial exige lugar; convocatoria exige elegibilidad y ventana', () => {
    const call = diploma({
      type: 'OPEN_CALL',
      modality: 'IN_PERSON',
      totalMinutes: null,
      finalProjectDueAt: null,
      finalProjectSubmissionEnabled: false,
      scholarshipEnabled: false,
      enrollmentOpensAt: null,
      isFree: true,
      installmentsEnabled: false,
    });
    expect(issuesOf(call, 'GENERAL')).toEqual(['venueName:REQUIRED', 'venueCity:REQUIRED']);
    expect(issuesOf(call, 'CONTENT')).toEqual(['eligibilityText:REQUIRED']);
    expect(issuesOf(call, 'SCHEDULE')).toEqual(['enrollmentOpensAt:REQUIRED']);
    expect(issuesOf(call, 'ORIGIN_PRICING')).toEqual([]);
  });

  it('origen y precio: NAS de pago exige ambos precios; Moodle no exige nada; beca solo diplomados', () => {
    expect(issuesOf(diploma({ priceUsdCents: 0 }), 'ORIGIN_PRICING')).toEqual([
      'priceUsdCents:REQUIRED',
    ]);
    expect(
      issuesOf(
        diploma({ origin: 'MOODLE', priceMxnCents: null, priceUsdCents: null }),
        'ORIGIN_PRICING',
      ),
    ).toEqual([]);
    expect(issuesOf(diploma({ installmentsMax: 5 }), 'ORIGIN_PRICING')).toEqual([
      'installmentsMax:INVALID',
    ]);
    expect(issuesOf(diploma({ scholarshipTypes: [] }), 'ORIGIN_PRICING')).toEqual([
      'scholarshipTypes:REQUIRED',
    ]);
    // Solo tipos desactivados = como si no hubiera ninguno.
    expect(
      issuesOf(
        diploma({ scholarshipTypes: [{ scholarshipType: { active: false } }] }),
        'ORIGIN_PRICING',
      ),
    ).toEqual(['scholarshipTypes:REQUIRED']);
    expect(issuesOf(diploma({ type: 'COURSE' }), 'ORIGIN_PRICING')).toContain(
      'scholarshipEnabled:NOT_APPLICABLE',
    );
  });

  it('portada y resumen obligatorios; WhatsApp y ventana de asistencia validados', () => {
    expect(issuesOf(diploma({ coverImageKey: null, summary: ' ' }), 'GENERAL')).toEqual([
      'summary:REQUIRED',
      'coverImageKey:REQUIRED',
    ]);
    expect(issuesOf(diploma({ whatsappGroupUrl: 'https://wa.me/1' }), 'WHATSAPP')).toEqual([
      'whatsappGroupUrl:INVALID',
    ]);
    expect(issuesOf(diploma({ attendanceWindowHours: 80 }), 'ATTENDANCE')).toEqual([
      'attendanceWindowHours:INVALID',
    ]);
  });

  it('estado del listado y transiciones de publicación', () => {
    expect(adminOfferStatus('DRAFT', 'ENROLLMENT_OPEN')).toBe('DRAFT');
    expect(adminOfferStatus('PUBLISHED', 'UPCOMING')).toBe('PUBLISHED');
    expect(adminOfferStatus('PUBLISHED', 'ENROLLMENT_CLOSED')).toBe('ENROLLMENT_CLOSED');
    expect(adminOfferStatus('PUBLISHED', 'FINISHED')).toBe('FINISHED');
    expect(adminOfferStatus('ARCHIVED', 'FINISHED')).toBe('ARCHIVED');
    expect(publicationTransition('DRAFT', 'PUBLISH')).toBe('PUBLISHED');
    expect(publicationTransition('PUBLISHED', 'PUBLISH')).toBeNull();
    expect(publicationTransition('ARCHIVED', 'UNPUBLISH')).toBe('DRAFT');
    expect(publicationTransition('ARCHIVED', 'ARCHIVE')).toBeNull();
  });

  it('nombres y slugs libres', () => {
    const taken = new Set(['Curso (copia)']);
    expect(duplicateName('Curso', (n) => taken.has(n))).toBe('Curso (copia 2)');
    expect(duplicateName('Curso (copia)', () => false)).toBe('Curso (copia)');
    expect(uniqueSlug('curso', (s) => s === 'curso')).toBe('curso-2');
    expect(uniqueSlug('', () => false)).toBe('oferta');
  });
});

describe('admin-content.policy', () => {
  it('archivos por sección (HU-28)', () => {
    const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    expect(isValidModuleResourceFile('PRESENTATION', { mimeType: pptx, sizeBytes: 10 })).toBe(true);
    expect(isValidModuleResourceFile('PRE_READING', { mimeType: pptx, sizeBytes: 10 })).toBe(false);
    expect(
      isValidModuleResourceFile('PRE_READING', { mimeType: 'application/epub+zip', sizeBytes: 10 }),
    ).toBe(true);
    expect(
      isValidModuleResourceFile('ACTIVITY', {
        mimeType: 'application/pdf',
        sizeBytes: 51 * 1024 * 1024,
      }),
    ).toBe(false);
  });

  it('imágenes públicas JPG/PNG/WebP ≤ 15 MB', () => {
    const MB = 1024 * 1024;
    expect(isValidPublicImage({ mimeType: 'image/webp', sizeBytes: 1000 })).toBe(true);
    expect(isValidPublicImage({ mimeType: 'image/gif', sizeBytes: 1000 })).toBe(false);
    expect(isValidPublicImage({ mimeType: 'image/png', sizeBytes: 15 * MB })).toBe(true);
    expect(isValidPublicImage({ mimeType: 'image/png', sizeBytes: 15 * MB + 1 })).toBe(false);
  });

  it('prefijos y keys', () => {
    expect(publicImagePrefix('OFFER_COVER', 'o1')).toBe('public/offers/o1/cover/');
    expect(publicImagePrefix('TEACHER_PHOTO')).toBe('public/teachers/');
    expect(keyMatchesPrefix('public/teachers/a.png', 'public/teachers/')).toBe(true);
    expect(keyMatchesPrefix('public/teachers/../x', 'public/teachers/')).toBe(false);
    expect(keyMatchesPrefix('other/a.png', 'public/teachers/')).toBe(false);
  });

  it('publicación programada, periodo y permutaciones', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    expect(isValidScheduledPublish(null, now)).toBe(true);
    expect(isValidScheduledPublish(new Date('2026-10-31T00:00:00Z'), now)).toBe(false);
    expect(
      isWithinOfferPeriod(now, { startsAt: new Date('2026-11-02T00:00:00Z'), endsAt: null }),
    ).toBe(false);
    expect(isCompletePermutation(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(isCompletePermutation(['a', 'a'], ['a', 'b'])).toBe(false);
    expect(isCompletePermutation(['a'], ['a', 'b'])).toBe(false);
  });
});
