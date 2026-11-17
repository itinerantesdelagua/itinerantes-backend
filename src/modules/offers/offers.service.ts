import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app.exception';
import { paginate, type PaginatedResponseDto } from '../../common/dto/pagination.dto';
import type { Currency } from '../../common/utils/money';
import { nowUtc, OFFICIAL_TIMEZONE } from '../../common/utils/time';
import { BUSINESS_RULES } from '../../config/business-rules';
import type { Prisma, PublicTopic } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { LocationsService } from '../locations/locations.service';
import { UsersService } from '../users/users.service';
import type { ListOffersQueryDto } from './dto/offers.query.dto';
import type {
  OfferDetailDto,
  OfferPricingDto,
  OfferScheduleDto,
  OfferSummaryDto,
  TopicAvailabilityDto,
} from './dto/offers.response.dto';
import {
  OFFER_APPLICATION_LOOKUP,
  type OfferApplicationLookup,
  type OfferApplicationRef,
} from './application-lookup';
import {
  OFFER_ENROLLMENT_LOOKUP,
  type OfferEnrollmentLookup,
  type OfferEnrollmentState,
} from './enrollment-lookup';
import {
  type CatalogEntry,
  compareCatalogEntries,
  matchesCatalogFilters,
} from './policies/catalog.policy';
import { computeOfferActions, windowState } from './policies/offer-actions.policy';
import {
  deriveOfferAvailability,
  deriveOpenCallStatus,
  effectiveEnrollmentClose,
  type OfferAvailability,
} from './policies/offer-status.policy';
import { PUBLIC_TOPICS, resolveTopic } from './policies/public-topics';
import { estimateScholarshipTypes, offersScholarship } from './policies/scholarship.policy';
import {
  scholarshipOptions,
  scholarshipPercentRange,
} from '../scholarship-types/policies/scholarship-type.policy';
import { OFFER_SCHOLARSHIP_TYPES_RELATION } from '../scholarship-types/scholarship-type.select';
import { ScholarshipTypesService } from '../scholarship-types/scholarship-types.service';
import type { OfferQuotaState } from '../scholarship-types/policies/scholarship-quota.policy';
import {
  cdmxDate,
  firstOccurrence,
  hasUniformTimes,
  safeParseScheduleRule,
} from './policies/schedule-rule';
import { resolveViewerCurrency, type ViewerCurrency } from './policies/viewer-currency.policy';

/**
 * Campos que salen de la BD hacia el catálogo/ficha. Lista BLANCA: WhatsApp, enlaces de sesión,
 * grabaciones y recursos nunca se seleccionan aquí (HU-16 / HU-17).
 */
const PUBLIC_OFFER_SELECT = {
  id: true,
  slug: true,
  name: true,
  type: true,
  modality: true,
  origin: true,
  cohortLabel: true,
  summary: true,
  coverImageKey: true,
  publicTopic: true,
  enrollmentOpensAt: true,
  enrollmentClosesAt: true,
  startsAt: true,
  endsAt: true,
  totalMinutes: true,
  scheduleRule: true,
  venueName: true,
  venueCity: true,
  capacity: true,
  isFree: true,
  priceMxnCents: true,
  priceUsdCents: true,
  installmentsEnabled: true,
  installmentsMax: true,
  scholarshipEnabled: true,
  scholarshipTypes: OFFER_SCHOLARSHIP_TYPES_RELATION,
  teachers: {
    orderBy: { position: 'asc' },
    select: { teacher: { select: { id: true, fullName: true } } },
  },
} as const satisfies Prisma.OfferSelect;

type PublicOfferRow = Prisma.OfferGetPayload<{ select: typeof PUBLIC_OFFER_SELECT }>;

/** Contexto del visitante (sesión opcional + zona del navegador). */
export interface ViewerInput {
  user?: AuthUser;
  timezone?: string;
}

interface ViewerContext {
  userId: string | null;
  currency: ViewerCurrency;
}

/**
 * Catálogo y ficha públicos (HU-15, HU-16) y disponibilidad por temática (HU-34).
 * El estado se deriva en cada consulta (`deriveOfferAvailability`); el catálogo filtra y ordena en
 * memoria sobre las ofertas publicadas (volumen pequeño; ver docs/ARCHITECTURE.md).
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly users: UsersService,
    private readonly locations: LocationsService,
    @Inject(OFFER_ENROLLMENT_LOOKUP) private readonly enrollments: OfferEnrollmentLookup,
    @Inject(OFFER_APPLICATION_LOOKUP) private readonly applications: OfferApplicationLookup,
    private readonly scholarshipTypes: ScholarshipTypesService,
  ) {}

  async list(
    query: ListOffersQueryDto,
    viewerInput: ViewerInput,
  ): Promise<PaginatedResponseDto<OfferSummaryDto>> {
    const now = nowUtc();
    const viewer = await this.viewerContext(viewerInput);
    const rows = await this.prisma.offer.findMany({
      where: { publicationStatus: 'PUBLISHED' },
      select: PUBLIC_OFFER_SELECT,
    });

    const entries = rows
      .map((row) => ({ row, entry: toCatalogEntry(row, now) }))
      .filter(({ entry }) =>
        matchesCatalogFilters(entry, {
          types: query.type,
          modality: query.modality,
          statuses: query.statuses,
          scholarship: query.scholarship,
          topic: query.topic,
          q: query.q,
        }),
      )
      .sort((a, b) => compareCatalogEntries(a.entry, b.entry));

    const page = entries.slice(query.skip, query.skip + query.take);
    const enrolled = viewer.userId
      ? await this.enrollments.activeOfferIdsForUser(
          viewer.userId,
          page.map(({ row }) => row.id),
        )
      : new Set<string>();
    const data = await Promise.all(
      page.map(({ row, entry }) =>
        this.toSummary(row, entry.availability, viewer, enrolled.has(row.id)),
      ),
    );
    return paginate(data, entries.length, query);
  }

  async detail(slug: string, viewerInput: ViewerInput): Promise<OfferDetailDto> {
    const now = nowUtc();
    const offer = await this.prisma.offer.findUnique({
      where: { slug },
      select: {
        ...PUBLIC_OFFER_SELECT,
        publicationStatus: true,
        description: true,
        learningOutcomes: true,
        requirements: true,
        carouselImageKeys: true,
        finalProjectDueAt: true,
        venueAddress: true,
        venueMapsUrl: true,
        calendarCategory: true,
        moodleCourseUrl: true,
        scholarshipOpensAt: true,
        scholarshipClosesAt: true,
        eligibilityText: true,
        eligibleCountryCodes: true,
        requiresTravel: true,
        teachers: {
          orderBy: { position: 'asc' },
          select: {
            teacher: {
              select: { id: true, fullName: true, photoKey: true, bio: true, cvUrl: true },
            },
          },
        },
        modules: {
          where: {
            visibility: 'PUBLISHED',
            OR: [{ publishAt: null }, { publishAt: { lte: now } }],
          },
          orderBy: { position: 'asc' },
          select: { title: true, description: true },
        },
        _count: { select: { sessions: { where: { status: 'SCHEDULED' } } } },
      },
    });
    if (!offer || offer.publicationStatus !== 'PUBLISHED') {
      throw new AppException('OFFER_NOT_AVAILABLE');
    }

    const viewer = await this.viewerContext(viewerInput);
    const availability = deriveOfferAvailability(offer, now);
    const [enrolledIds, applications, seatsTaken, countryNames, enrollmentStates] =
      await Promise.all([
        viewer.userId
          ? this.enrollments.activeOfferIdsForUser(viewer.userId, [offer.id])
          : Promise.resolve(new Set<string>()),
        viewer.userId
          ? this.applications.applicationsForUser(viewer.userId, [offer.id])
          : Promise.resolve(new Map<string, OfferApplicationRef>()),
        offer.capacity !== null
          ? this.enrollments.countSeatsTaken([offer.id])
          : Promise.resolve(new Map<string, number>()),
        this.locations.getCountryNames(offer.eligibleCountryCodes),
        viewer.userId
          ? this.enrollments.enrollmentStatesForUser(viewer.userId, [offer.id])
          : Promise.resolve(new Map<string, OfferEnrollmentState>()),
      ]);
    const enrollmentState = enrollmentStates.get(offer.id) ?? null;
    const enrolled = enrolledIds.has(offer.id);
    const application = applications.get(offer.id) ?? null;
    const soldOut = offer.capacity !== null && (seatsTaken.get(offer.id) ?? 0) >= offer.capacity;
    const summary = await this.toSummary(offer, availability, viewer, enrolled);

    const currency = viewer.currency.currency;
    const priceCents = priceFor(offer, currency);
    const scholarshipOffered = offersScholarship(offer);
    const scholarshipOpensAt = offer.scholarshipOpensAt ?? offer.enrollmentOpensAt;
    const scholarshipClosesAt = offer.scholarshipClosesAt ?? effectiveEnrollmentClose(offer);
    const scholarshipWindow = windowState(scholarshipOpensAt, scholarshipClosesAt, now);

    const actions = computeOfferActions({
      type: offer.type,
      origin: offer.origin,
      isFree: offer.isFree,
      availability,
      enrollmentOpensAt: offer.enrollmentOpensAt,
      installmentsEnabled: summary.pricing.installments !== null,
      scholarshipOffered,
      scholarshipWindow,
      scholarshipOpensAt,
      hasPriceInCurrency: priceCents !== null && priceCents > 0,
      soldOut,
      viewer: {
        authenticated: viewer.userId !== null,
        enrolled,
        application,
        enrollment: enrollmentState,
      },
    });

    const scholarshipRange = scholarshipPercentRange(scholarshipOptions(offer.scholarshipTypes));
    const quotas = scholarshipOffered
      ? await this.scholarshipTypes.offerQuotas(offer.id, offer.scholarshipTypes)
      : new Map<string, OfferQuotaState>();
    const hasEligibility =
      offer.type === 'OPEN_CALL' ||
      !!offer.eligibilityText ||
      offer.eligibleCountryCodes.length > 0 ||
      offer.requiresTravel;

    return {
      ...summary,
      description: offer.description,
      learningOutcomes: offer.learningOutcomes,
      requirements: offer.requirements,
      carouselImageUrls: await Promise.all(
        offer.carouselImageKeys.map((key) => this.publicImageUrl(key)),
      ),
      dates: { ...summary.dates, finalProjectDueAt: iso(offer.finalProjectDueAt) },
      venue:
        offer.modality === 'IN_PERSON' && offer.venueName
          ? {
              name: offer.venueName,
              city: offer.venueCity,
              address: offer.venueAddress,
              mapsUrl: offer.venueMapsUrl,
            }
          : null,
      sessionCount: offer._count.sessions,
      calendarCategory: offer.calendarCategory,
      teachers: await Promise.all(
        offer.teachers.map(async ({ teacher }) => ({
          id: teacher.id,
          fullName: teacher.fullName,
          photoUrl: teacher.photoKey ? await this.publicImageUrl(teacher.photoKey) : null,
          bio: teacher.bio,
          cvUrl: teacher.cvUrl,
        })),
      ),
      modules: offer.modules.map((module, index) => ({
        number: index + 1,
        title: module.title,
        description: module.description,
      })),
      scholarshipDetails:
        scholarshipOffered && scholarshipRange
          ? {
              ...scholarshipRange,
              windowStatus: scholarshipWindow,
              opensAt: iso(scholarshipOpensAt),
              closesAt: iso(scholarshipClosesAt),
              scholarshipTypes: estimateScholarshipTypes(
                offer.scholarshipTypes,
                priceCents,
                currency,
                quotas,
              ),
            }
          : null,
      eligibility: hasEligibility
        ? {
            text: offer.eligibilityText,
            countries: offer.eligibleCountryCodes.map((code) => ({
              code,
              name: countryNames.get(code) ?? code,
            })),
            requiresTravel: offer.requiresTravel,
          }
        : null,
      capacity: { total: offer.capacity, soldOut },
      moodleCourseUrl: offer.origin === 'MOODLE' ? offer.moodleCourseUrl : null,
      viewer: { authenticated: viewer.userId !== null, enrolled, application },
      actions: actions.map((action) => ({ ...action, availableFrom: iso(action.availableFrom) })),
    };
  }

  /** HU-34: etiqueta y destino de cada temática pública. */
  async topicAvailability(topics?: readonly PublicTopic[]): Promise<TopicAvailabilityDto[]> {
    const now = nowUtc();
    const selected = topics?.length
      ? PUBLIC_TOPICS.filter((t) => topics.includes(t.topic))
      : PUBLIC_TOPICS;
    const offers = await this.prisma.offer.findMany({
      where: {
        publicationStatus: 'PUBLISHED',
        publicTopic: { in: selected.map((t) => t.topic) },
      },
      select: {
        slug: true,
        type: true,
        publicTopic: true,
        enrollmentOpensAt: true,
        enrollmentClosesAt: true,
        startsAt: true,
        endsAt: true,
      },
    });
    return selected.map(({ topic, group, label }) => {
      const resolution = resolveTopic(
        offers
          .filter((o) => o.publicTopic === topic)
          .map((o) => ({
            slug: o.slug,
            type: o.type,
            startsAt: o.startsAt,
            availability: deriveOfferAvailability(o, now),
          })),
      );
      return {
        topic,
        group,
        label,
        availability: resolution.availability,
        offerCount: resolution.offerCount,
        link: {
          kind: resolution.linkKind,
          slug: resolution.slug,
          catalogQuery:
            resolution.linkKind === 'CATALOG'
              ? `topic=${topic}&status=ENROLLMENT_OPEN,UPCOMING,ENROLLMENT_CLOSED`
              : null,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async viewerContext(input: ViewerInput): Promise<ViewerContext> {
    const user = input.user ? await this.users.findById(input.user.id) : null;
    return {
      userId: user?.id ?? null,
      currency: resolveViewerCurrency({
        profileCountryCode: user?.countryCode,
        timezone: input.timezone,
      }),
    };
  }

  private async toSummary(
    row: PublicOfferRow,
    availability: OfferAvailability,
    viewer: ViewerContext,
    enrolled: boolean,
  ): Promise<OfferSummaryDto> {
    const scholarshipRange = offersScholarship(row)
      ? scholarshipPercentRange(scholarshipOptions(row.scholarshipTypes))
      : null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      type: row.type,
      modality: row.modality,
      origin: row.origin,
      availability,
      openCallStatus: deriveOpenCallStatus(row.type, availability),
      summary: row.summary,
      coverImageUrl: row.coverImageKey ? await this.publicImageUrl(row.coverImageKey) : null,
      cohortLabel: row.cohortLabel,
      publicTopic: row.publicTopic,
      dates: {
        enrollmentOpensAt: iso(row.enrollmentOpensAt),
        enrollmentClosesAt: iso(row.enrollmentClosesAt),
        startsAt: iso(row.startsAt),
        endsAt: iso(row.endsAt),
      },
      schedule: toSchedule(row),
      totalHours: row.totalMinutes !== null ? row.totalMinutes / 60 : null,
      venue:
        row.modality === 'IN_PERSON' && row.venueName
          ? { name: row.venueName, city: row.venueCity }
          : null,
      pricing: toPricing(row, viewer.currency),
      scholarship: scholarshipRange,
      teacherNames: row.teachers.map(({ teacher }) => teacher.fullName),
      enrolled,
    };
  }

  private publicImageUrl(keyOrUrl: string): Promise<string> {
    return this.storage.getPublicUrl(keyOrUrl, BUSINESS_RULES.PUBLIC_IMAGE_SIGNED_URL_TTL_SECONDS);
  }
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function toCatalogEntry(row: PublicOfferRow, now: Date): CatalogEntry {
  return {
    name: row.name,
    type: row.type,
    modality: row.modality,
    publicTopic: row.publicTopic,
    availability: deriveOfferAvailability(row, now),
    scholarshipOffered: offersScholarship(row),
    startsAt: row.startsAt,
    teacherNames: row.teachers.map(({ teacher }) => teacher.fullName),
  };
}

function priceFor(
  row: Pick<PublicOfferRow, 'priceMxnCents' | 'priceUsdCents'>,
  currency: Currency,
): number | null {
  return currency === 'MXN' ? row.priceMxnCents : row.priceUsdCents;
}

function toPricing(row: PublicOfferRow, viewer: ViewerCurrency): OfferPricingDto {
  const base = { currency: viewer.currency, currencySource: viewer.source };
  if (row.origin === 'MOODLE') {
    return { ...base, kind: 'EXTERNAL_ENROLLMENT', price: null, installments: null };
  }
  if (row.isFree) return { ...base, kind: 'FREE', price: null, installments: null };
  const cents = priceFor(row, viewer.currency);
  return {
    ...base,
    kind: 'PAID',
    price: cents !== null && cents > 0 ? { amountCents: cents, currency: viewer.currency } : null,
    installments:
      row.installmentsEnabled && row.installmentsMax
        ? { maxInstallments: row.installmentsMax }
        : null,
  };
}

function toSchedule(row: PublicOfferRow): OfferScheduleDto | null {
  const rule = safeParseScheduleRule(row.scheduleRule);
  if (!rule) return null;
  const from = row.startsAt ? cdmxDate(row.startsAt) : null;
  const utc = (o: { startsAt: Date; endsAt: Date } | null) =>
    o ? { startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString() } : null;
  return {
    timezone: OFFICIAL_TIMEZONE,
    weekdays: rule.weekdays,
    startTime: rule.startTime,
    endTime: rule.endTime,
    sameTimeAllDays: hasUniformTimes(rule),
    slots: rule.slots.map((slot) => ({
      ...slot,
      firstSession: from ? utc(firstOccurrence(rule, from, OFFICIAL_TIMEZONE, slot.weekday)) : null,
    })),
    firstSession: from ? utc(firstOccurrence(rule, from)) : null,
  };
}
