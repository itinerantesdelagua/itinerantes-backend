import { PrismaPg } from '@prisma/adapter-pg';
import { countTables, purgeDemoData, seedDemoData } from '../prisma/demo-data';
import { isDemoStripeId } from '../src/common/utils/demo';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Datos de demostración (prisma/demo-data.ts): el seed es idempotente y la purga deja la BD
 * EXACTAMENTE como estaba (mismo conteo por tabla) sin tocar cuentas del equipo.
 */
describe('Datos demo: seed y purga (e2e)', () => {
  let prisma: PrismaClient;
  const quiet = () => undefined;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
    });
    await purgeDemoData(prisma, { log: quiet }); // por si una corrida anterior quedó a medias
  });

  afterAll(async () => {
    await purgeDemoData(prisma, { log: quiet });
    await prisma.$disconnect();
  });

  it('siembra, no duplica y la purga devuelve cada tabla a su conteo original', async () => {
    const staffBefore = await prisma.user.findMany({
      where: { NOT: { roles: { equals: ['PARTICIPANT'] } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const before = await countTables(prisma);

    const first = await seedDemoData(prisma, { log: quiet });
    expect(first.skipped).toBe(false);
    const afterSeed = await countTables(prisma);
    expect(afterSeed.users - before.users).toBe(60);
    expect(afterSeed.offers - before.offers).toBe(4);
    expect(afterSeed.contact_messages - before.contact_messages).toBe(15);
    expect(afterSeed.notifications).toBeGreaterThan(before.notifications);

    // Idempotente: la segunda corrida no crea nada.
    const second = await seedDemoData(prisma, { log: quiet });
    expect(second.skipped).toBe(true);
    expect(await countTables(prisma)).toEqual(afterSeed);

    // Todos los ids de Stripe de las personas demo son ficticios (`*_demo_*`).
    const payments = await prisma.payment.findMany({
      where: { user: { email: { endsWith: '@demo.itinerantesdelagua.com' } } },
      select: { stripePaymentIntentId: true, stripeCheckoutSessionId: true },
    });
    expect(payments.length).toBeGreaterThan(0);
    for (const p of payments) {
      for (const id of [p.stripePaymentIntentId, p.stripeCheckoutSessionId]) {
        if (id) expect(isDemoStripeId(id)).toBe(true);
      }
    }
    const statuses = await prisma.application.groupBy({
      by: ['status'],
      where: { applicantEmail: { endsWith: '@demo.itinerantesdelagua.com' } },
    });
    expect(statuses.map((s) => s.status).sort()).toEqual(
      [
        'APPROVED_PENDING_CONFIRMATION',
        'APPROVED_PENDING_PAYMENT',
        'ENROLLED',
        'EXPIRED',
        'INTERVIEW_SCHEDULED',
        'IN_REVIEW',
        'NOT_SELECTED',
        'SUBMITTED',
      ].sort(),
    );

    await purgeDemoData(prisma, { log: quiet });
    expect(await countTables(prisma)).toEqual(before);
    const staffAfter = await prisma.user.findMany({
      where: { NOT: { roles: { equals: ['PARTICIPANT'] } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(staffAfter).toEqual(staffBefore);
  }, 180_000);
});
