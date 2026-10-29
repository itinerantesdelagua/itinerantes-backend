import { AppException } from '../errors/app.exception';

/**
 * Datos de DEMOSTRACIÓN (`prisma/demo-data.ts`, `DEMO_DATA_ACTION=seed|purge`). Marcadores estables
 * que usan el generador, la purga y las salvaguardas de la app:
 * - Personas demo: correos `*@demo.itinerantesdelagua.com` (nunca reciben correo: MAIL_SUPPRESS_DOMAINS).
 * - Ids de Stripe ficticios con prefijo `*_demo_` (cs_, pi_, ch_, cus_, pm_, re_, evt_): nunca se
 *   envían a Stripe (cobros de cuotas, conciliación, reembolsos y reintentos los omiten o rechazan).
 */
export const DEMO_EMAIL_DOMAIN = 'demo.itinerantesdelagua.com';

export const DEMO_STRIPE_ID_PREFIXES = [
  'cs_demo_',
  'pi_demo_',
  'ch_demo_',
  'cus_demo_',
  'pm_demo_',
  're_demo_',
  'evt_demo_',
] as const;

export const DEMO_STRIPE_BLOCKED_MESSAGE = 'Dato de demostración: no se envía a Stripe.';

/** ¿Es un id de Stripe ficticio de los datos demo? (`pi_demo_…`, `cus_demo_…`, ...). */
export function isDemoStripeId(id: string | null | undefined): boolean {
  return !!id && DEMO_STRIPE_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** ¿Es el correo de una persona demo? (`*@demo.itinerantesdelagua.com`). */
export function isDemoEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/** Error claro (422) para acciones que llamarían a Stripe con datos demo (en lugar de un 502). */
export function demoStripeBlocked(): AppException {
  return new AppException('BUSINESS_RULE_VIOLATION', {
    message: DEMO_STRIPE_BLOCKED_MESSAGE,
    meta: { demoData: true },
  });
}

/** Lanza `demoStripeBlocked()` si alguno de los ids es ficticio. */
export function assertNotDemoStripe(...ids: Array<string | null | undefined>): void {
  if (ids.some(isDemoStripeId)) throw demoStripeBlocked();
}
