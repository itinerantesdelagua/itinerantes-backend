import { z } from 'zod';
import { DEMO_EMAIL_DOMAIN } from '../common/utils/demo';

/**
 * Esquema de variables de entorno. Se valida al arrancar (ConfigModule.validate):
 * si falta algo obligatorio la app no inicia y el error lista las variables inválidas.
 *
 * Para agregar una variable: añádela aquí, en `.env.example` (documentada) y, si aplica,
 * en `.env.test`. Léela con `ConfigService<Env, true>`: `config.get('PORT', { infer: true })`.
 */

/** Convierte "a,b , c" en ['a','b','c'] (vacíos descartados). */
const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

/** Booleano desde texto ("true"/"false"/"1"/"0"). */
const bool = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

/** Cadena opcional: trata "" como ausente. */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value : undefined));

/** Variables obligatorias de cada proveedor de reuniones: todas o ninguna. */
const MEETING_PROVIDER_ENV_GROUPS = [
  { name: 'Zoom', keys: ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'] },
  {
    name: 'Google Meet',
    keys: [
      'GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL',
      'GOOGLE_MEET_PRIVATE_KEY',
      'GOOGLE_MEET_IMPERSONATE_USER',
    ],
  },
] as const;

export const envSchema = z
  .object({
    // --- App ---
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** URL pública de esta API (enlaces en correos, servidor en OpenAPI). */
    APP_PUBLIC_URL: z.url().default('http://localhost:3000'),
    /** URL del frontend (sitio público). Base de los enlaces del portal si falta PORTAL_URL. */
    FRONTEND_URL: z.url().default('http://localhost:5173'),
    /**
     * Raíz del portal del participante, SIN el prefijo /portal (p. ej.
     * https://portal.itinerantesdelagua.com o http://localhost:4201). Base de los botones de los
     * correos, del regreso de Stripe y de los enlaces de pago de Seguimiento. Si falta: FRONTEND_URL.
     */
    PORTAL_URL: z.url().optional(),
    /** Orígenes permitidos por CORS, separados por coma. Vacío = ninguno (solo mismo origen). */
    CORS_ORIGINS: csv,
    /** Activa /docs y /docs/openapi.json. */
    DOCS_ENABLED: bool(true),

    // --- Rate limit global (por IP) ---
    THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

    // --- Base de datos ---
    /** Conexión de la app (en Supabase puede ser el pooler). */
    DATABASE_URL: z.string().min(1),
    /** Conexión para migraciones (directa / session pooler). Opcional. */
    DIRECT_URL: optionalString,

    // --- Auth (se usa desde la Fase 01) ---
    JWT_ACCESS_SECRET: z.string().min(32, 'Debe tener al menos 32 caracteres'),
    /** Vida del token de acceso: segundos o número con unidad s/m/h/d (`900`, `15m`, `1h`). */
    JWT_ACCESS_TTL: z
      .string()
      .regex(/^\d+[smhd]?$/, 'Formato: número de segundos o con unidad s/m/h/d (p. ej. 15m)')
      .default('15m'),
    /** Vida del refresh token (días) sin / con "recordarme". */
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    JWT_REFRESH_REMEMBER_TTL_DAYS: z.coerce.number().int().positive().default(30),

    // --- Correo ---
    MAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
    MAIL_FROM: z.string().default('Escuela Itinerante del Agua <no-reply@example.com>'),
    /** Buzón del equipo para notificaciones internas generales. */
    MAIL_TEAM_INBOX: optionalString,
    /** Buzón que recibe los mensajes de Contacto (HU-38). Si falta, se usa MAIL_TEAM_INBOX. */
    CONTACT_INBOX_EMAIL: optionalString,
    /**
     * Dominios a los que NUNCA se envía correo (coma). Por defecto el dominio de los datos de
     * demostración (`prisma/demo-data.ts`): sus notificaciones quedan como enviadas sin salir.
     * Cadena vacía = no suprimir ninguno.
     */
    MAIL_SUPPRESS_DOMAINS: z
      .string()
      .default(DEMO_EMAIL_DOMAIN)
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),

    // --- Anti-spam / privacidad ---
    /** Clave secreta de Cloudflare Turnstile. Si falta, la verificación de captcha está desactivada. */
    TURNSTILE_SECRET_KEY: optionalString,
    /** Secreto para el HMAC de IPs guardadas (Contacto). Si falta, se deriva de JWT_ACCESS_SECRET. */
    IP_HASH_SECRET: optionalString,
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: bool(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    RESEND_API_KEY: optionalString,

    // --- Almacenamiento S3 (MinIO / Supabase Storage / R2) ---
    STORAGE_ENDPOINT: optionalString,
    STORAGE_REGION: z.string().default('us-east-1'),
    STORAGE_BUCKET: z.string().default('eia-dev'),
    STORAGE_ACCESS_KEY_ID: z.string().default(''),
    STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
    /** MinIO y Supabase Storage requieren path-style. */
    STORAGE_FORCE_PATH_STYLE: bool(true),
    STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    /**
     * URL base pública para imágenes de difusión (portadas, carrusel, fotos de docentes), p. ej. un
     * bucket público o CDN: `${STORAGE_PUBLIC_BASE_URL}/${key}`. Vacía = URL firmada de larga duración.
     */
    STORAGE_PUBLIC_BASE_URL: optionalString.pipe(z.url().optional()),
    /**
     * Fase 06: bucket aparte (público / CDN) para las imágenes de difusión que sube el panel (keys bajo
     * `public/`). Vacío = se guardan en STORAGE_BUCKET. Úsalo junto con STORAGE_PUBLIC_BASE_URL.
     */
    STORAGE_PUBLIC_BUCKET: optionalString,

    // --- Tareas programadas (Fase 03) ---
    /**
     * Activa los jobs en proceso (@nestjs/schedule): avisos de "registro de asistencia abierto" y
     * "grupo de WhatsApp disponible" (HU-13/HU-18). Con varias réplicas, déjalo en true solo en una.
     */
    SCHEDULER_ENABLED: bool(true),

    // --- Stripe (Fase 05) ---
    /**
     * Llave secreta (sk_live_… / sk_test_… o restringida rk_…). Si falta, la app arranca igual pero
     * los endpoints de checkout responden 503 PAYMENTS_NOT_CONFIGURED (la transferencia sigue).
     */
    STRIPE_SECRET_KEY: optionalString,
    /** Secreto de firma del endpoint de webhook (whsec_…). Sin él, el webhook responde 503. */
    STRIPE_WEBHOOK_SECRET: optionalString,
    /** Llave publicable (pk_…). Informativa: Checkout es hospedado y el frontend no la necesita. */
    STRIPE_PUBLISHABLE_KEY: optionalString,

    // --- Transferencia bancaria México (Fase 05, HU-23) ---
    /** Titular de la cuenta. Si falta alguno de los tres datos, la transferencia no se ofrece. */
    BANK_TRANSFER_ACCOUNT_HOLDER: optionalString,
    /** Banco. */
    BANK_TRANSFER_BANK_NAME: optionalString,
    /** CLABE interbancaria (18 dígitos). */
    BANK_TRANSFER_CLABE: optionalString.pipe(
      z
        .string()
        .regex(/^\d{18}$/, 'La CLABE debe tener 18 dígitos')
        .optional(),
    ),

    // --- Primer SUPER_ADMIN (Fase 06; lo usa el seed, no la API) ---
    /**
     * Si no existe ningún SUPER_ADMIN activo, el seed crea (o promueve) esta cuenta en cada arranque.
     * Vacías = no hace nada. Ver docs/DEPLOY.md → "Primer administrador".
     */
    BOOTSTRAP_ADMIN_EMAIL: optionalString,
    BOOTSTRAP_ADMIN_PASSWORD: optionalString,
    BOOTSTRAP_ADMIN_NAME: optionalString,

    // --- Reuniones generadas desde el panel (Zoom / Google Meet; apoyo a HU-29 y HU-31) ---
    // Cada proveedor se habilita solo si TODAS sus variables obligatorias están presentes (o ninguna:
    // proveedor deshabilitado). Ver docs/DEPLOY.md → "Reuniones".
    /** Zoom Server-to-Server OAuth: Account ID de la app. */
    ZOOM_ACCOUNT_ID: optionalString,
    /** Zoom Server-to-Server OAuth: Client ID. */
    ZOOM_CLIENT_ID: optionalString,
    /** Zoom Server-to-Server OAuth: Client Secret. */
    ZOOM_CLIENT_SECRET: optionalString,
    /** Usuario de Zoom que será anfitrión (correo o id). Por defecto `me` (el dueño de la app). */
    ZOOM_HOST_USER: optionalString,
    /** Google Meet: correo de la cuenta de servicio (…@….iam.gserviceaccount.com). */
    GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL: optionalString,
    /** Google Meet: llave privada PEM de la cuenta de servicio (se aceptan saltos de línea como `\n`). */
    GOOGLE_MEET_PRIVATE_KEY: optionalString,
    /** Google Meet: usuario de Workspace al que la cuenta de servicio suplanta (delegación de dominio). */
    GOOGLE_MEET_IMPERSONATE_USER: optionalString,
    /** Google Meet: calendario donde se crean los eventos. Por defecto `primary`. */
    GOOGLE_MEET_CALENDAR_ID: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message: 'Obligatoria cuando MAIL_DRIVER=resend',
      });
    }
    for (const group of MEETING_PROVIDER_ENV_GROUPS) {
      const missing = group.keys.filter((key) => !env[key]);
      if (missing.length > 0 && missing.length < group.keys.length) {
        for (const key of missing) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `Configura todas las variables de ${group.name} (${group.keys.join(', ')}) o ninguna`,
          });
        }
      }
    }
    if (env.GOOGLE_MEET_PRIVATE_KEY && !env.GOOGLE_MEET_PRIVATE_KEY.includes('PRIVATE KEY')) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_MEET_PRIVATE_KEY'],
        message: 'Debe ser una llave PEM (-----BEGIN PRIVATE KEY----- …)',
      });
    }
  });

export type Env = z.output<typeof envSchema>;

/** Validador para ConfigModule.forRoot({ validate }). Lanza un error legible si algo falla. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}

/** Raíz del portal para armar enlaces absolutos (correos, Stripe): PORTAL_URL o FRONTEND_URL. */
export function portalBaseUrl(config: {
  get(key: 'PORTAL_URL', options: { infer: true }): string | undefined;
  get(key: 'FRONTEND_URL', options: { infer: true }): string;
}): string {
  return config.get('PORTAL_URL', { infer: true }) ?? config.get('FRONTEND_URL', { infer: true });
}
