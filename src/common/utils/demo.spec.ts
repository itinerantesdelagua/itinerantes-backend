import { AppException } from '../errors/app.exception';
import {
  assertNotDemoStripe,
  DEMO_STRIPE_BLOCKED_MESSAGE,
  isDemoEmail,
  isDemoStripeId,
} from './demo';

describe('datos demo', () => {
  it('reconoce los ids de Stripe ficticios', () => {
    for (const id of [
      'cs_demo_1',
      'pi_demo_x',
      'ch_demo_x',
      'cus_demo_a',
      'pm_demo_b',
      're_demo_c',
    ]) {
      expect(isDemoStripeId(id)).toBe(true);
    }
    for (const id of ['cs_test_a1', 'pi_3Nx', 'cus_Q1', 'pm_card_visa', null, undefined, '']) {
      expect(isDemoStripeId(id)).toBe(false);
    }
  });

  it('reconoce los correos del dominio demo (sin importar mayúsculas)', () => {
    expect(isDemoEmail('ana.lopez@demo.itinerantesdelagua.com')).toBe(true);
    expect(isDemoEmail(' Ana@DEMO.itinerantesdelagua.com ')).toBe(true);
    expect(isDemoEmail('ana@itinerantesdelagua.com')).toBe(false);
    expect(isDemoEmail('ana@fakedemo.itinerantesdelagua.com')).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });

  it('assertNotDemoStripe lanza BUSINESS_RULE_VIOLATION con un mensaje claro', () => {
    expect(() => assertNotDemoStripe('pi_3Nx', null)).not.toThrow();
    try {
      assertNotDemoStripe(null, 'pi_demo_abc');
      fail('debió lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('BUSINESS_RULE_VIOLATION');
      expect((error as AppException).message).toBe(DEMO_STRIPE_BLOCKED_MESSAGE);
    }
  });
});
