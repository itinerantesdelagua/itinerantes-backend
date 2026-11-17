/**
 * Reglas de negocio configurables.
 *
 * Centraliza los valores que el documento de requerimientos marca como supuestos o "por
 * confirmar" (Anexo A de docs/requirements/HU_EIA_Fases_1-3.md). Nunca uses números mágicos
 * repartidos en el código: impórtalos de aquí. Si el cliente confirma otro valor, se cambia en un
 * solo lugar. Los valores que varían por oferta (p. ej. cupo, precio) van en la BD, no aquí.
 *
 * Unidades explícitas en el nombre: *_MINUTES, *_SECONDS, *_HOURS, *_DAYS, *_BYTES, *_PERCENT.
 */

const MB = 1024 * 1024;

/**
 * Tamaño máximo general de los archivos que suben participantes y equipo (comprobantes,
 * evidencias, imágenes de difusión). Petición del cliente (nov. 2026): de 5 MB a 15 MB. Los
 * archivos que ya admitían más (proyecto final, materiales del módulo, videos) conservan su límite.
 */
const UPLOAD_MAX_BYTES = 15 * MB;

/** "15 MB": tamaño legible para mensajes y documentación (redondeado a MB). */
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

export const BUSINESS_RULES = {
  // ---------------------------------------------------------------------------
  // Tiempo
  // ---------------------------------------------------------------------------
  /** Hora oficial de las actividades (Anexo A, HU-11): CDMX, UTC−6 todo el año, sin horario de verano. */
  OFFICIAL_TIMEZONE: 'America/Mexico_City',
  /** Zona por defecto del usuario al registrarse (HU-02, HU-11). */
  DEFAULT_USER_TIMEZONE: 'America/Mexico_City',

  // ---------------------------------------------------------------------------
  // Identidad (Fase 01)
  // ---------------------------------------------------------------------------
  /** HU-02 / HU-05 / HU-14: mínimo 8 caracteres, al menos una letra y un número. */
  PASSWORD_MIN_LENGTH: 8,
  /** HU-03: el OTP es numérico de 6 dígitos. */
  OTP_LENGTH: 6,
  /** HU-03 / HU-05: "expira tras un tiempo definido" (supuesto: 10 min). */
  OTP_TTL_MINUTES: 10,
  /** HU-03: cuenta regresiva antes de "Reenviar código" (ejemplo de la HU: 00:30). */
  OTP_RESEND_COOLDOWN_SECONDS: 30,
  /** HU-03: intentos fallidos consecutivos antes del bloqueo temporal (supuesto). */
  OTP_MAX_ATTEMPTS: 5,
  /** HU-03: duración del bloqueo temporal tras agotar intentos (supuesto). */
  OTP_LOCKOUT_MINUTES: 15,
  /** HU-04: intentos de login fallidos consecutivos antes del bloqueo temporal (supuesto). */
  LOGIN_MAX_ATTEMPTS: 5,
  /** HU-04: duración del bloqueo temporal de login (supuesto). */
  LOGIN_LOCKOUT_MINUTES: 15,
  /** HU-02: longitud máxima de contraseña (evita hashes de cuerpos enormes). */
  PASSWORD_MAX_LENGTH: 128,
  /** HU-02: nombre completo, solo letras (con tildes/ñ) y espacios. */
  FULL_NAME_MAX_LENGTH: 120,
  /** HU-02 (supuesto): username de 3 a 30 caracteres: letras, números, punto y guion bajo. */
  USERNAME_MIN_LENGTH: 3,
  USERNAME_MAX_LENGTH: 30,
  /** HU-05 paso 2 → 3: vida del resetToken de un solo uso emitido al verificar el OTP. */
  PASSWORD_RESET_TOKEN_TTL_MINUTES: 10,
  /**
   * HU-05: "si el correo no corresponde a ninguna cuenta, el sistema informa que no existe".
   * Lo pide el cliente, pero permite enumerar cuentas (riesgo documentado en
   * docs/frontend/fase-01-identidad.md). En `false`, la API responde igual exista o no la cuenta.
   * (revealUnknownEmailOnReset)
   */
  REVEAL_UNKNOWN_EMAIL_ON_RESET: true,
  /**
   * Límites de peticiones por IP (además del global). `ttlSeconds` es la ventana.
   * Se aplican con @Throttle en los endpoints de auth.
   */
  AUTH_THROTTLE: {
    REGISTER: { limit: 10, ttlSeconds: 3600 },
    LOGIN: { limit: 10, ttlSeconds: 60 },
    OTP_VERIFY: { limit: 10, ttlSeconds: 60 },
    OTP_SEND: { limit: 5, ttlSeconds: 60 },
    PASSWORD_RESET: { limit: 10, ttlSeconds: 60 },
    REFRESH: { limit: 30, ttlSeconds: 60 },
    AVAILABILITY: { limit: 60, ttlSeconds: 60 },
  },

  // ---------------------------------------------------------------------------
  // Portal del participante (Fase 03)
  // ---------------------------------------------------------------------------
  /** HU-12: "Entrar a sesión" se habilita 10 minutos antes del inicio. */
  SESSION_JOIN_WINDOW_MINUTES_BEFORE: 10,
  /** HU-18 / HU-30 (Anexo A): ventana por defecto para registrar asistencia tras la sesión. */
  ATTENDANCE_WINDOW_HOURS: 24,
  /** HU-18: comentario opcional de asistencia, máximo 500 caracteres. */
  ATTENDANCE_COMMENT_MAX_LENGTH: 500,
  /** HU-30 (Anexo A): umbral de asistencia solo como alerta visual. */
  ATTENDANCE_ALERT_THRESHOLD_PERCENT: 80,
  /** HU-06 (Anexo A): aviso de cuota próxima desde N días antes del cobro. */
  INSTALLMENT_UPCOMING_NOTICE_DAYS: 7,
  /** HU-06: máximo de tarjetas de "Mi formación" en el Dashboard ("Ver toda mi formación"). */
  DASHBOARD_FORMATIONS_LIMIT: 3,
  /** HU-06: widget de Calendario — próximos eventos (cantidad y horizonte en días). */
  DASHBOARD_UPCOMING_EVENTS_LIMIT: 5,
  DASHBOARD_UPCOMING_EVENTS_DAYS: 30,
  /** HU-06: widget de Biblioteca — material recomendado (cantidad). */
  DASHBOARD_RECOMMENDED_RESOURCES_LIMIT: 4,
  /** HU-10: rango máximo de una consulta del calendario (un mes con semanas de relleno ≈ 42 días). */
  CALENDAR_MAX_RANGE_DAYS: 62,
  /** HU-09: longitud máxima del texto del buscador de la biblioteca. */
  LIBRARY_SEARCH_MAX_LENGTH: 100,
  /**
   * HU-13 / HU-18: cada cuánto corre el job que avisa "registro de asistencia abierto" y "grupo de
   * WhatsApp disponible" (expresión cron, hora del servidor). Solo con SCHEDULER_ENABLED=true.
   */
  PORTAL_NOTIFICATIONS_CRON: '*/5 * * * *',
  /** URL firmada de descarga de materiales privados (HU-08: "el enlace expira; genera uno nuevo"). */
  PRIVATE_FILE_URL_TTL_SECONDS: 10 * 60,
  /** HU-17: URL firmada para subir el proyecto final (PUT directo a storage). */
  FINAL_PROJECT_UPLOAD_URL_TTL_SECONDS: 15 * 60,

  // ---------------------------------------------------------------------------
  // Postulaciones y becas (Fase 04)
  // ---------------------------------------------------------------------------
  /** HU-19 (Anexo A): carta de intención como texto de 800 a 4000 caracteres. */
  SCHOLARSHIP_LETTER_MIN_LENGTH: 800,
  SCHOLARSHIP_LETTER_MAX_LENGTH: 4000,
  /**
   * Becas parametrizables: los tipos de beca (nombre, rango de %, si requiere entrevista, activo)
   * viven en la tabla `scholarship_types` y los administra un SUPER_ADMIN
   * (`/admin/scholarship-types`); cada oferta habilita los suyos y puede ajustar el rango
   * (`offer_scholarship_types`). Aquí solo quedan los límites absolutos de cualquier porcentaje y
   * de los textos del tipo. Los 5 tipos iniciales están en `scholarship-types.defaults.ts`.
   */
  SCHOLARSHIP_TYPE_PERCENT_FLOOR: 1,
  SCHOLARSHIP_TYPE_PERCENT_CEILING: 100,
  SCHOLARSHIP_TYPE_KEY_MAX_LENGTH: 40,
  SCHOLARSHIP_TYPE_NAME_MAX_LENGTH: 80,
  SCHOLARSHIP_TYPE_DESCRIPTION_MAX_LENGTH: 500,
  /** Máximo de tipos de beca habilitados en una oferta (límite de la petición del asistente). */
  SCHOLARSHIP_TYPES_PER_OFFER_MAX: 20,
  /** Caché HTTP del catálogo público de tipos de beca (igual que las cifras del sitio). */
  SCHOLARSHIP_TYPES_CACHE_SECONDS: 300,
  /** HU-20: respuestas abiertas de convocatoria, 300 a 2000 caracteres. */
  OPEN_CALL_ANSWER_MIN_LENGTH: 300,
  OPEN_CALL_ANSWER_MAX_LENGTH: 2000,
  /** HU-21 / HU-23 (Anexo A): días naturales para pagar el saldo tras aprobar la beca. */
  PAYMENT_DEADLINE_AFTER_APPROVAL_DAYS: 7,
  /** HU-21 (Anexo A): días para "Confirmar mi participación" en convocatorias sin costo. */
  OPEN_CALL_CONFIRMATION_DEADLINE_DAYS: 7,
  /** HU-32: se destacan los plazos que vencen en N días o menos. */
  DEADLINE_ALERT_DAYS: 2,
  /** HU-13 (Anexo A): recordatorio N horas antes de vencer el saldo. */
  BALANCE_REMINDER_HOURS_BEFORE: 48,
  /** HU-13 / HU-21: recordatorio de la entrevista por Zoom N horas antes. */
  INTERVIEW_REMINDER_HOURS_BEFORE: 24,
  /** HU-21: el enlace de Zoom de la entrevista se habilita N minutos antes (igual que las sesiones). */
  INTERVIEW_JOIN_WINDOW_MINUTES_BEFORE: 10,
  /** HU-19: hasta 5 enlaces de evidencia (YouTube, Drive, redes). */
  EVIDENCE_MAX_LINKS: 5,
  /** HU-19: edad entera declarada en el formulario (rango de validación). */
  APPLICANT_MIN_AGE: 15,
  APPLICANT_MAX_AGE: 100,
  /** HU-19: código de iniciativa aliada (opcional; no aplica descuento, Anexo A). */
  PARTNER_CODE_MAX_LENGTH: 40,
  /** HU-20: organización y rol. */
  ORGANIZATION_MAX_LENGTH: 150,
  ORGANIZATION_ROLE_MAX_LENGTH: 120,
  /** HU-19/20: URL firmada para subir una evidencia (PUT directo a storage). */
  EVIDENCE_UPLOAD_URL_TTL_SECONDS: 30 * 60,
  /**
   * HU-21 / HU-13: cada cuánto corre el job de postulaciones (vencimientos, recordatorio de saldo y
   * de entrevista). Solo con SCHEDULER_ENABLED=true.
   */
  APPLICATION_JOBS_CRON: '*/5 * * * *',

  // ---------------------------------------------------------------------------
  // Pagos (Fase 05)
  // ---------------------------------------------------------------------------
  /** HU-24 (Anexo A): plan de 2 a 4 cuotas mensuales iguales (centavos de ajuste en la última). */
  INSTALLMENTS_MIN: 2,
  INSTALLMENTS_MAX: 4,
  /** HU-24: una cuota por mes (la 1.ª se cobra al confirmar; la última antes del fin de la oferta). */
  INSTALLMENT_INTERVAL_MONTHS: 1,
  /**
   * HU-24: "Stripe reintenta hasta 3 veces en 7 días". El plan es propio (PaymentIntents
   * off-session), así que los reintentos los programa el job repartidos en la ventana.
   */
  INSTALLMENT_RETRY_ATTEMPTS: 3,
  INSTALLMENT_RETRY_WINDOW_DAYS: 7,
  /** HU-24 (Anexo A): plan "En mora" a los 15 días de un cobro fallido sin regularizar. */
  DELINQUENCY_AFTER_DAYS: 15,
  /**
   * HU-24 / HU-33 (Anexo A: "confirmar si la suspensión debe ser automática"). `true`: al pasar a
   * "En mora" el sistema suspende el acceso (inscripción SUSPENDED) y lo restablece solo al
   * regularizar. `false`: solo avisa y el equipo suspende manualmente desde el panel (Fase 06).
   */
  SUSPEND_ACCESS_ON_DELINQUENCY: true,
  /** Reglas del cliente: precios fijos en MXN y USD (sin conversión); México paga en MXN. */
  SUPPORTED_CURRENCIES: ['MXN', 'USD'],
  MXN_COUNTRY_CODE: 'MX',
  /**
   * HU-22: vigencia de la sesión de Stripe Checkout (mínimo de Stripe: 30 min). Mientras está
   * abierta, la reserva PENDING_PAYMENT retiene el cupo (ofertas con cupo limitado).
   */
  CHECKOUT_SESSION_TTL_MINUTES: 30,
  /**
   * HU-22 "Procesando pago…": al consultar un pago con checkout abierto, si el webhook no ha llegado
   * tras N segundos se concilia consultando la sesión en Stripe (tolerancia a webhooks tardíos).
   */
  CHECKOUT_RECONCILE_AFTER_SECONDS: 5,
  /** Una cuota "en cobro" sin respuesta tras N minutos se reintenta con la misma clave idempotente. */
  INSTALLMENT_PROCESSING_STALE_MINUTES: 30,
  /** HU-23: URL firmada para subir el comprobante de transferencia (PUT directo a storage). */
  TRANSFER_RECEIPT_UPLOAD_URL_TTL_SECONDS: 15 * 60,
  /** HU-23: clave de rastreo SPEI (hasta 30 caracteres alfanuméricos). */
  TRANSFER_TRACKING_KEY_MAX_LENGTH: 30,
  /**
   * HU-22/23/24/13: cada cuánto corre el job de pagos (cobro de cuotas, reintentos, mora, aviso de
   * cuota próxima y conciliación de checkouts vencidos). Solo con SCHEDULER_ENABLED=true.
   */
  PAYMENT_JOBS_CRON: '*/10 * * * *',

  // ---------------------------------------------------------------------------
  // Acceso Moodle (Fase 05, HU-25)
  // ---------------------------------------------------------------------------
  /** HU-25: código XXXX-XXXX (sin caracteres ambiguos 0/O, 1/I/L). */
  MOODLE_ACCESS_CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  MOODLE_ACCESS_CODE_GROUP_LENGTH: 4,
  /** HU-25: intentos de canje de código por IP (evita adivinar códigos). */
  MOODLE_ACCESS_CODE_THROTTLE: { limit: 10, ttlSeconds: 600 },

  // ---------------------------------------------------------------------------
  // Reuniones generadas desde el panel (Zoom / Google Meet; apoyo a HU-29 y HU-31)
  // ---------------------------------------------------------------------------
  /** Título de la reunión ("topic" en Zoom, "summary" del evento en Google Calendar). */
  MEETING_TOPIC_MIN_LENGTH: 3,
  MEETING_TOPIC_MAX_LENGTH: 200,
  /** Duración permitida al generar la reunión: de 15 min a 8 h (una sesión o una entrevista). */
  MEETING_DURATION_MIN_MINUTES: 15,
  MEETING_DURATION_MAX_MINUTES: 480,
  /** Tiempo máximo de espera por cada llamada HTTP a Zoom / Google. */
  MEETING_PROVIDER_TIMEOUT_SECONDS: 15,
  /** El token OAuth en caché se renueva cuando le quedan menos de N segundos de vida. */
  MEETING_TOKEN_REFRESH_MARGIN_SECONDS: 60,
  /**
   * Google crea la sala de Meet de forma asíncrona (a veces `createRequest.status = pending`): se
   * vuelve a leer el evento hasta N veces, esperando el intervalo indicado entre intentos.
   */
  MEETING_GOOGLE_CONFERENCE_POLL_ATTEMPTS: 3,
  MEETING_GOOGLE_CONFERENCE_POLL_INTERVAL_MS: 1000,

  // ---------------------------------------------------------------------------
  // Archivos (límites de carga)
  // ---------------------------------------------------------------------------
  FILE_LIMITS: {
    /** Límite general (ver UPLOAD_MAX_BYTES); los de abajo lo usan salvo que admitan más. */
    UPLOAD_MAX_BYTES,
    /** HU-17: entrega de proyecto final — PDF, DOCX, PPTX o ZIP, máx. 20 MB. */
    FINAL_PROJECT: {
      maxBytes: 20 * MB,
      mimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/zip',
      ],
    },
    /** HU-19: evidencias — imágenes JPG/PNG/HEIC ≤ 15 MB (límite general; antes 10 MB). */
    EVIDENCE_IMAGE: {
      maxBytes: UPLOAD_MAX_BYTES,
      mimeTypes: ['image/jpeg', 'image/png', 'image/heic'],
    },
    /** HU-19: evidencias — video MP4/MOV ≤ 100 MB. */
    EVIDENCE_VIDEO: { maxBytes: 100 * MB, mimeTypes: ['video/mp4', 'video/quicktime'] },
    /** HU-19: mínimo 1 y máximo 10 archivos de evidencia. */
    EVIDENCE_MIN_FILES: 1,
    EVIDENCE_MAX_FILES: 10,
    /** HU-23: comprobante de transferencia — PDF/JPG/PNG ≤ 15 MB (límite general). */
    TRANSFER_RECEIPT: {
      maxBytes: UPLOAD_MAX_BYTES,
      mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    },
    /** HU-27: portada, carrusel y foto de docente — JPG/PNG/WebP ≤ 15 MB (límite general). */
    OFFER_COVER: {
      maxBytes: UPLOAD_MAX_BYTES,
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
    /** HU-28: recursos del módulo — PDF/PPTX (presentación) o PDF/DOCX/EPUB (lecturas) ≤ 50 MB. */
    MODULE_RESOURCE: {
      maxBytes: 50 * MB,
      mimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/epub+zip',
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Oferta formativa (Fase 02 / 06)
  // ---------------------------------------------------------------------------
  /** HU-27 (Anexo A): los diplomados suman exactamente 60 h (confirmar si se admiten variaciones). */
  DIPLOMA_TOTAL_HOURS: 60,
  /** Reglas del cliente: un curso dura como máximo 9 h. */
  COURSE_MAX_HOURS: 9,
  /** HU-27: ventana de asistencia configurable por oferta entre 1 y 72 h (default ATTENDANCE_WINDOW_HOURS). */
  ATTENDANCE_WINDOW_MIN_HOURS: 1,
  ATTENDANCE_WINDOW_MAX_HOURS: 72,
  /** HU-15: el buscador del catálogo exige al menos 3 caracteres. */
  OFFER_SEARCH_MIN_LENGTH: 3,
  /** HU-16 / HU-27: resumen corto de la tarjeta del catálogo. */
  OFFER_SUMMARY_MAX_LENGTH: 300,
  /**
   * Imágenes públicas (portadas, carrusel, fotos de docentes) cuando no hay STORAGE_PUBLIC_BASE_URL:
   * URL firmada de larga duración (máximo de SigV4: 7 días).
   */
  PUBLIC_IMAGE_SIGNED_URL_TTL_SECONDS: 7 * 24 * 3600,

  // ---------------------------------------------------------------------------
  // Panel administrativo (Fase 06)
  // ---------------------------------------------------------------------------
  /**
   * Primer SUPER_ADMIN en producción (BOOTSTRAP_ADMIN_PASSWORD / `pnpm admin:create`): contraseña más
   * exigente que la del registro (es la llave de todo el panel).
   */
  BOOTSTRAP_ADMIN_PASSWORD_MIN_LENGTH: 12,

  // ---------------------------------------------------------------------------
  // Contacto (HU-38)
  // ---------------------------------------------------------------------------
  CONTACT_MESSAGE_MIN_LENGTH: 10,
  CONTACT_MESSAGE_MAX_LENGTH: 2000,
  /** HU-38: nombre del remitente, mínimo 3 caracteres. */
  CONTACT_NAME_MIN_LENGTH: 3,
  /** HU-38: máximo 5 envíos por IP por hora. */
  CONTACT_THROTTLE: { limit: 5, ttlSeconds: 3600 },
  /** Bandeja del panel: nota interna del equipo sobre un mensaje (columna VARCHAR(2000)). */
  CONTACT_INTERNAL_NOTE_MAX_LENGTH: 2000,

  // ---------------------------------------------------------------------------
  // Paginación (convención de la API)
  // ---------------------------------------------------------------------------
  PAGINATION_DEFAULT_PAGE_SIZE: 20,
  PAGINATION_MAX_PAGE_SIZE: 100,
} as const;

export type BusinessRules = typeof BUSINESS_RULES;
