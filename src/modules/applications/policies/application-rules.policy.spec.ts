import { BUSINESS_RULES } from '../../../config/business-rules';
import { testLink } from '../../scholarship-types/policies/scholarship-type.fixtures';
import {
  type ApplicableOffer,
  applicationKindFor,
  applicationWindow,
  balanceAfterScholarship,
  eligibilityIssues,
  evidenceMediaType,
  formatFolio,
  interviewRequired,
  isResponseOverdue,
  isValidEvidenceFile,
  responseDeadline,
  type SubmissionInput,
  submissionIssues,
} from './application-rules.policy';

const MB = 1024 * 1024;
const d = (iso: string) => new Date(iso);
const now = d('2026-10-21T12:00:00Z');

const diploma: ApplicableOffer = {
  type: 'DIPLOMA',
  origin: 'NAS',
  scholarshipEnabled: true,
  scholarshipTypes: [testLink('AGUA_VIVA'), testLink('AGUAS_LIBRES'), testLink('SPECIAL')],
  scholarshipOpensAt: d('2026-10-01T06:00:00Z'),
  scholarshipClosesAt: d('2026-10-31T06:00:00Z'),
  enrollmentOpensAt: d('2026-09-01T06:00:00Z'),
  enrollmentClosesAt: d('2026-11-06T06:00:00Z'),
  startsAt: d('2026-11-07T16:00:00Z'),
  endsAt: d('2027-01-31T19:00:00Z'),
};
const call: ApplicableOffer = {
  ...diploma,
  type: 'OPEN_CALL',
  scholarshipEnabled: false,
  scholarshipTypes: [],
  scholarshipOpensAt: null,
  scholarshipClosesAt: null,
};

describe('applicationKindFor / applicationWindow (HU-19 / HU-20)', () => {
  it('diplomado NAS con beca → beca; convocatoria → convocatoria; resto no se postula', () => {
    expect(applicationKindFor(diploma)).toBe('SCHOLARSHIP');
    expect(applicationKindFor(call)).toBe('OPEN_CALL');
    expect(applicationKindFor({ ...diploma, scholarshipEnabled: false })).toBeNull();
    expect(applicationKindFor({ ...diploma, scholarshipTypes: [] })).toBeNull();
    // Solo tipos desactivados → ya no se ofrece beca.
    expect(
      applicationKindFor({
        ...diploma,
        scholarshipTypes: [testLink('AGUA_VIVA', { active: false })],
      }),
    ).toBeNull();
    expect(applicationKindFor({ ...diploma, type: 'COURSE' })).toBeNull();
    expect(applicationKindFor({ ...diploma, origin: 'MOODLE' })).toBeNull();
    expect(applicationKindFor({ ...call, origin: 'MOODLE' })).toBeNull();
  });

  it('beca: usa la ventana de becas', () => {
    expect(applicationWindow(diploma, 'SCHOLARSHIP', now)).toMatchObject({
      state: 'OPEN',
      reason: null,
      closesAt: diploma.scholarshipClosesAt,
    });
    expect(applicationWindow(diploma, 'SCHOLARSHIP', d('2026-09-15T00:00:00Z'))).toMatchObject({
      state: 'UPCOMING',
      reason: 'SCHOLARSHIP_NOT_OPEN_YET',
    });
    expect(applicationWindow(diploma, 'SCHOLARSHIP', d('2026-11-01T00:00:00Z'))).toMatchObject({
      state: 'CLOSED',
      reason: 'SCHOLARSHIP_CLOSED',
    });
    expect(applicationWindow(diploma, 'SCHOLARSHIP', d('2027-03-01T00:00:00Z')).reason).toBe(
      'OFFER_FINISHED',
    );
  });

  it('beca sin ventana propia: usa la de inscripción', () => {
    const offer = { ...diploma, scholarshipOpensAt: null, scholarshipClosesAt: null };
    expect(applicationWindow(offer, 'SCHOLARSHIP', d('2026-11-05T00:00:00Z')).state).toBe('OPEN');
    expect(applicationWindow(offer, 'SCHOLARSHIP', d('2026-11-06T07:00:00Z')).state).toBe('CLOSED');
  });

  it('convocatoria: ventana de inscripción = postulación', () => {
    expect(applicationWindow(call, 'OPEN_CALL', now).state).toBe('OPEN');
    expect(applicationWindow(call, 'OPEN_CALL', d('2026-08-01T00:00:00Z')).reason).toBe(
      'ENROLLMENT_NOT_OPEN_YET',
    );
    expect(applicationWindow(call, 'OPEN_CALL', d('2026-11-06T07:00:00Z')).reason).toBe(
      'ENROLLMENT_CLOSED',
    );
  });
});

describe('eligibilityIssues (HU-20)', () => {
  const offer = { eligibleCountryCodes: ['MX', 'GT'], requiresTravel: true };
  it('país fuera de la lista y "No" a viajar', () => {
    expect(eligibilityIssues(offer, { countryCode: 'mx', canTravel: true })).toEqual([]);
    expect(eligibilityIssues(offer, { countryCode: 'AR', canTravel: false })).toEqual([
      'COUNTRY_NOT_ELIGIBLE',
      'TRAVEL_REQUIRED',
    ]);
    // Sin responder aún no es inelegible (falta el dato: lo reporta submissionIssues).
    expect(eligibilityIssues(offer, { countryCode: 'GT', canTravel: null })).toEqual([]);
    expect(
      eligibilityIssues(
        { eligibleCountryCodes: [], requiresTravel: false },
        {
          countryCode: 'ES',
          canTravel: false,
        },
      ),
    ).toEqual([]);
  });
});

describe('submissionIssues (HU-19 / HU-20)', () => {
  const letter = 'a'.repeat(BUSINESS_RULES.SCHOLARSHIP_LETTER_MIN_LENGTH);
  const answer = 'b'.repeat(BUSINESS_RULES.OPEN_CALL_ANSWER_MIN_LENGTH);
  const scholarship: SubmissionInput = {
    kind: 'SCHOLARSHIP',
    enabledScholarshipTypeIds: ['st-AGUAS_LIBRES'],
    requiresTravel: false,
    age: 30,
    requestedScholarshipTypeId: 'st-AGUAS_LIBRES',
    intentLetter: letter,
    eligibilityConfirmed: false,
    organization: null,
    organizationRole: null,
    experience: null,
    motivation: null,
    canTravel: null,
    termsAccepted: true,
    documentCount: 1,
  };
  const codes = (input: SubmissionInput) =>
    submissionIssues(input).map((i) => `${i.field}:${i.code}`);

  it('beca completa → sin pendientes', () => {
    expect(submissionIssues(scholarship)).toEqual([]);
  });

  it('beca: carta corta, sin evidencia, sin términos, tipo no habilitado', () => {
    expect(
      codes({
        ...scholarship,
        age: null,
        requestedScholarshipTypeId: 'st-SPECIAL',
        intentLetter: '  corta  ',
        documentCount: 0,
        termsAccepted: false,
      }),
    ).toEqual([
      'age:REQUIRED',
      'requestedScholarshipTypeId:SCHOLARSHIP_TYPE_NOT_ENABLED',
      'intentLetter:MIN_LENGTH',
      'documents:MIN_FILES',
      'termsAccepted:MUST_ACCEPT',
    ]);
    expect(codes({ ...scholarship, intentLetter: 'x'.repeat(4001) })).toEqual([
      'intentLetter:MAX_LENGTH',
    ]);
    expect(codes({ ...scholarship, intentLetter: '   ' })).toEqual(['intentLetter:REQUIRED']);
    expect(submissionIssues({ ...scholarship, intentLetter: 'corta' })[0].message).toContain(
      'llevas 5',
    );
  });

  it('beca: tipo agotado → SCHOLARSHIP_TYPE_FULL (no se puede enviar)', () => {
    expect(codes({ ...scholarship, fullScholarshipTypeIds: ['st-AGUAS_LIBRES'] })).toEqual([
      'requestedScholarshipTypeId:SCHOLARSHIP_TYPE_FULL',
    ]);
    expect(codes({ ...scholarship, fullScholarshipTypeIds: ['st-SPECIAL'] })).toEqual([]);
  });

  it('convocatoria: elegibilidad, organización, respuestas y viaje; evidencia opcional', () => {
    const openCall: SubmissionInput = {
      ...scholarship,
      kind: 'OPEN_CALL',
      requiresTravel: true,
      age: null,
      requestedScholarshipTypeId: null,
      intentLetter: null,
      documentCount: 0,
      eligibilityConfirmed: true,
      organization: 'Colectivo',
      organizationRole: 'Coordinadora',
      experience: answer,
      motivation: answer,
      canTravel: true,
    };
    expect(submissionIssues(openCall)).toEqual([]);
    expect(
      codes({
        ...openCall,
        eligibilityConfirmed: false,
        organization: ' ',
        experience: 'corta',
        motivation: null,
        canTravel: null,
      }),
    ).toEqual([
      'eligibilityConfirmed:MUST_ACCEPT',
      'organization:REQUIRED',
      'experience:MIN_LENGTH',
      'motivation:REQUIRED',
      'canTravel:REQUIRED',
    ]);
    expect(codes({ ...openCall, requiresTravel: false, canTravel: null })).toEqual([]);
  });
});

describe('evidencias (HU-19: JPG/PNG/HEIC ≤ 15 MB, MP4/MOV ≤ 100 MB)', () => {
  it('tipo y tamaño por medio', () => {
    expect(evidenceMediaType('image/heic')).toBe('IMAGE');
    expect(evidenceMediaType('video/quicktime')).toBe('VIDEO');
    expect(evidenceMediaType('application/pdf')).toBeNull();
    expect(isValidEvidenceFile({ mimeType: 'image/jpeg', sizeBytes: 15 * MB })).toBe(true);
    expect(isValidEvidenceFile({ mimeType: 'image/jpeg', sizeBytes: 15 * MB + 1 })).toBe(false);
    expect(isValidEvidenceFile({ mimeType: 'video/mp4', sizeBytes: 100 * MB })).toBe(true);
    expect(isValidEvidenceFile({ mimeType: 'video/mp4', sizeBytes: 100 * MB + 1 })).toBe(false);
    expect(isValidEvidenceFile({ mimeType: 'image/png', sizeBytes: 0 })).toBe(false);
    expect(isValidEvidenceFile({ mimeType: 'application/pdf', sizeBytes: 10 })).toBe(false);
  });
});

describe('folio, decisión y plazos (HU-21, 23, 31, 32)', () => {
  it('folio legible', () => {
    expect(formatFolio('SCHOLARSHIP', 123)).toBe('BEC-000123');
    expect(formatFolio('OPEN_CALL', 45)).toBe('CONV-000045');
  });

  it('entrevista obligatoria: convocatorias y tipos de beca con requiresInterview', () => {
    expect(interviewRequired('OPEN_CALL', null)).toBe(true);
    expect(interviewRequired('OPEN_CALL', false)).toBe(true);
    expect(interviewRequired('SCHOLARSHIP', false)).toBe(false);
    expect(interviewRequired('SCHOLARSHIP', true)).toBe(true);
    expect(interviewRequired('SCHOLARSHIP', null)).toBe(false);
  });

  it('saldo: 10,200 MXN con 50% → 5,100 MXN; sin precio → 0', () => {
    expect(balanceAfterScholarship(1_020_000, 50)).toBe(510_000);
    expect(balanceAfterScholarship(58_500, 50)).toBe(29_250);
    expect(balanceAfterScholarship(null, 50)).toBe(0);
  });

  it('plazo: 7 días naturales sin superar el inicio', () => {
    const decided = d('2026-10-21T18:00:00Z');
    expect(responseDeadline(decided, 'PAYMENT', d('2027-01-01T00:00:00Z'))).toEqual(
      d('2026-10-28T18:00:00Z'),
    );
    expect(responseDeadline(decided, 'PAYMENT', d('2026-10-24T16:00:00Z'))).toEqual(
      d('2026-10-24T16:00:00Z'),
    );
    // Inicio ya pasado o sin inicio → solo los días.
    expect(responseDeadline(decided, 'CONFIRMATION', d('2026-10-01T00:00:00Z'))).toEqual(
      d('2026-10-28T18:00:00Z'),
    );
    expect(responseDeadline(decided, 'CONFIRMATION', null)).toEqual(d('2026-10-28T18:00:00Z'));
  });

  it('vencimiento: con comprobante pendiente no vence', () => {
    const due = d('2026-10-21T11:00:00Z');
    expect(isResponseOverdue({ responseDueAt: due, pendingTransferSince: null }, now)).toBe(true);
    expect(isResponseOverdue({ responseDueAt: due, pendingTransferSince: due }, now)).toBe(false);
    expect(isResponseOverdue({ responseDueAt: null, pendingTransferSince: null }, now)).toBe(false);
    expect(
      isResponseOverdue(
        { responseDueAt: d('2026-10-22T00:00:00Z'), pendingTransferSince: null },
        now,
      ),
    ).toBe(false);
  });
});
