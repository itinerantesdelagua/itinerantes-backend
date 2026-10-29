import { AppException } from '../../common/errors/app.exception';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { PaymentGateway } from '../../infra/stripe/payment-gateway';
import type { NotificationsService } from '../notifications/notifications.service';
import { InstallmentCollectionService } from './installment-collection.service';
import type { PaymentLedgerService } from './payment-ledger.service';

/** Salvaguarda de datos demo: nunca se cobra en Stripe un plan con ids `*_demo_*`. */
describe('InstallmentCollectionService — datos demo', () => {
  const demoPlan = {
    id: 'plan-1',
    status: 'PAST_DUE',
    stripeCustomerId: 'cus_demo_abc',
    stripePaymentMethodId: 'pm_demo_abc',
    offer: { name: 'Diplomado' },
  };
  const gateway = {
    configured: true,
    chargeOffSession: jest.fn(),
  } as unknown as PaymentGateway;
  const prisma = {
    installment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'inst-2',
        status: 'FAILED',
        attempts: 1,
        plan: demoPlan,
      }),
      updateMany: jest.fn(),
    },
    installmentPlan: {
      findFirst: jest.fn().mockResolvedValue({
        ...demoPlan,
        installments: [{ id: 'inst-2', status: 'FAILED' }],
      }),
    },
    payment: { upsert: jest.fn() },
  } as unknown as PrismaService;
  const service = new InstallmentCollectionService(
    prisma,
    {} as PaymentLedgerService,
    {} as NotificationsService,
    gateway,
  );

  it('el job omite la cuota (SKIPPED) sin reclamarla ni llamar a Stripe', async () => {
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
    const result = await service.chargeInstallment('inst-2', ['FAILED']);
    expect(result.outcome).toBe('SKIPPED');
    expect(prisma.installment.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.upsert).not.toHaveBeenCalled();
    expect(gateway.chargeOffSession).not.toHaveBeenCalled();
  });

  it('[Pagar ahora] / [Reintentar cobro] responden 422 claro en lugar de llamar a Stripe', async () => {
    await expect(service.payNow('user-1', 'plan-1')).rejects.toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: 'Dato de demostración: no se envía a Stripe.',
    });
    await expect(service.payNow('user-1', 'plan-1')).rejects.toBeInstanceOf(AppException);
    expect(gateway.chargeOffSession).not.toHaveBeenCalled();
  });
});
