import { HttpStatus } from '@nestjs/common';
import { BUSINESS_RULES, formatMegabytes } from '../../config/business-rules';

const FILES = BUSINESS_RULES.FILE_LIMITS;

/**
 * Catálogo de códigos de error de la API.
 *
 * - `code` es ESTABLE: el frontend decide qué mostrar con él. No renombres un código existente.
 * - `message` es el texto por defecto en español (se puede sobreescribir al lanzar).
 * - Convención: códigos genéricos sin prefijo; los de dominio con prefijo del módulo
 *   (`AUTH_EMAIL_ALREADY_REGISTERED`, `OFFER_SOLD_OUT`, `PAYMENT_...`).
 * - Al agregar códigos, actualiza también `docs/frontend/errores.md`.
 */
export interface ErrorDefinition {
  status: HttpStatus;
  message: string;
}

export const ERROR_CODES = {
  // --- Genéricos (Fase 00) ---
  VALIDATION_ERROR: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Los datos enviados no son válidos.',
  },
  BAD_REQUEST: {
    status: HttpStatus.BAD_REQUEST,
    message: 'La solicitud no es válida.',
  },
  UNAUTHORIZED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Necesitas iniciar sesión para continuar.',
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'No tienes permiso para realizar esta acción.',
  },
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'El recurso solicitado no existe.',
  },
  CONFLICT: {
    status: HttpStatus.CONFLICT,
    message: 'La operación entra en conflicto con el estado actual del recurso.',
  },
  PAYLOAD_TOO_LARGE: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'El contenido enviado excede el tamaño permitido.',
  },
  BUSINESS_RULE_VIOLATION: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'La operación no cumple una regla de negocio.',
  },
  RATE_LIMITED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Demasiadas solicitudes. Intenta de nuevo en unos momentos.',
  },
  INTERNAL_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Ocurrió un error inesperado. Intenta de nuevo más tarde.',
  },
  SERVICE_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'El servicio no está disponible temporalmente.',
  },

  // --- Fase 01: Identidad (HU-02, 03, 04, 05, 14) ---
  AUTH_EMAIL_ALREADY_REGISTERED: {
    status: HttpStatus.CONFLICT,
    message: 'Ya existe una cuenta con este correo.',
  },
  AUTH_USERNAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Ese nombre de usuario ya está en uso.',
  },
  AUTH_INVALID_CREDENTIALS: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Correo o contraseña incorrectos.',
  },
  AUTH_EMAIL_NOT_VERIFIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Debes verificar tu correo antes de iniciar sesión.',
  },
  AUTH_ACCOUNT_DISABLED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Tu cuenta está deshabilitada. Contacta al equipo de la Escuela.',
  },
  AUTH_LOGIN_LOCKED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Demasiados intentos fallidos. Intenta de nuevo más tarde.',
  },
  AUTH_ACCOUNT_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'No existe una cuenta con ese correo.',
  },
  AUTH_ALREADY_VERIFIED: {
    status: HttpStatus.CONFLICT,
    message: 'Tu correo ya está verificado. Inicia sesión.',
  },
  AUTH_OTP_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'El código es incorrecto.',
  },
  AUTH_OTP_EXPIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'El código expiró o ya no es válido. Solicita uno nuevo.',
  },
  AUTH_OTP_LOCKED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Demasiados intentos con el código. Espera antes de intentarlo de nuevo.',
  },
  AUTH_OTP_COOLDOWN: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Espera un momento antes de solicitar un nuevo código.',
  },
  AUTH_REFRESH_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Tu sesión expiró. Inicia sesión de nuevo.',
  },
  AUTH_RESET_TOKEN_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'El enlace de recuperación expiró o ya se usó. Solicita un nuevo código.',
  },
  AUTH_CURRENT_PASSWORD_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'La contraseña actual es incorrecta.',
  },

  // --- Fase 01: Contacto (HU-38) ---
  CONTACT_CAPTCHA_FAILED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'No pudimos verificar que no eres un robot. Intenta de nuevo más tarde.',
  },

  // --- Fase 02: Oferta formativa (HU-15, 16, 34) ---
  OFFER_NOT_AVAILABLE: {
    status: HttpStatus.NOT_FOUND,
    message: 'Esta oferta ya no está disponible.',
  },

  // --- Fase 03: Portal del participante (HU-06–10, 12, 13, 17, 18) ---
  ENROLLMENT_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'No estás inscrito en esta formación.',
  },
  ENROLLMENT_SUSPENDED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Tu acceso a esta formación está suspendido. Regulariza tu pago para recuperarlo.',
  },
  ENROLLMENT_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: 'Ya estás inscrito en esta formación.',
  },
  ENROLLMENT_NOT_FREE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta oferta no admite inscripción directa gratuita.',
  },
  ENROLLMENT_CLOSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Las inscripciones para esta oferta no están abiertas.',
  },
  OFFER_SOLD_OUT: {
    status: HttpStatus.CONFLICT,
    message: 'Cupo agotado.',
  },
  SESSION_CANCELLED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta sesión fue cancelada.',
  },
  ATTENDANCE_NOT_OPEN_YET: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El registro de asistencia se abre al terminar la sesión.',
  },
  ATTENDANCE_WINDOW_CLOSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El registro de asistencia para esta sesión está cerrado.',
  },
  ATTENDANCE_ALREADY_REGISTERED: {
    status: HttpStatus.CONFLICT,
    message: 'Tu asistencia a esta sesión ya está registrada.',
  },
  RESOURCE_FILE_UNAVAILABLE: {
    status: HttpStatus.NOT_FOUND,
    message: 'El archivo no está disponible. Intenta de nuevo más tarde.',
  },
  FINAL_PROJECT_NOT_AVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta formación no recibe entregas de proyecto final.',
  },
  FINAL_PROJECT_DEADLINE_PASSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'La fecha límite de entrega del proyecto final ya pasó.',
  },
  FINAL_PROJECT_INVALID_FILE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: `El archivo debe ser PDF, DOCX, PPTX o ZIP de máximo ${formatMegabytes(FILES.FINAL_PROJECT.maxBytes)}.`,
  },
  FINAL_PROJECT_UPLOAD_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'No encontramos el archivo subido. Vuelve a subirlo.',
  },

  // --- Fase 04: Postulaciones (HU-19, 20, 21) ---
  APPLICATION_NOT_ALLOWED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta oferta no recibe postulaciones.',
  },
  APPLICATION_WINDOW_CLOSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'La convocatoria no está abierta.',
  },
  APPLICATION_ALREADY_EXISTS: {
    status: HttpStatus.CONFLICT,
    message: 'Ya tienes una postulación para esta oferta.',
  },
  APPLICATION_NOT_EDITABLE: {
    status: HttpStatus.CONFLICT,
    message: 'Tu postulación ya fue enviada y no se puede modificar.',
  },
  APPLICATION_INCOMPLETE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Completa los campos obligatorios para enviar tu postulación.',
  },
  APPLICATION_NOT_ELIGIBLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'No cumples con la elegibilidad de esta convocatoria.',
  },
  APPLICATION_INVALID_FILE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: `El archivo debe ser JPG, PNG o HEIC de máximo ${formatMegabytes(FILES.EVIDENCE_IMAGE.maxBytes)}, o MP4/MOV de máximo ${formatMegabytes(FILES.EVIDENCE_VIDEO.maxBytes)}.`,
  },
  APPLICATION_TOO_MANY_FILES: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Puedes adjuntar como máximo 10 archivos.',
  },
  APPLICATION_UPLOAD_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'No encontramos el archivo subido. Vuelve a subirlo.',
  },
  APPLICATION_INVALID_TRANSITION: {
    status: HttpStatus.CONFLICT,
    message: 'Tu postulación no está en un estado que permita esta acción.',
  },
  APPLICATION_DEADLINE_PASSED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El plazo para responder ya venció.',
  },
  APPLICATION_INTERVIEW_REQUIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta postulación requiere entrevista por Zoom.',
  },

  // --- Fase 05: Pagos (HU-22, 23, 24, 26) y acceso Moodle (HU-25) ---
  PAYMENTS_NOT_CONFIGURED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'El pago con tarjeta no está disponible en este momento. Intenta más tarde.',
  },
  PAYMENT_PROVIDER_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'No pudimos comunicarnos con el procesador de pagos. Intenta de nuevo.',
  },
  PAYMENT_NOT_ALLOWED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta oferta no se paga en la plataforma.',
  },
  PAYMENT_BALANCE_NOT_DUE: {
    status: HttpStatus.CONFLICT,
    message: 'Esta postulación no tiene un saldo pendiente de pago.',
  },
  PAYMENT_INSTALLMENTS_NOT_AVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El número de cuotas elegido no está disponible para esta oferta.',
  },
  PAYMENT_TRANSFER_NOT_AVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'La transferencia bancaria no está disponible para este pago.',
  },
  PAYMENT_TRANSFER_PENDING: {
    status: HttpStatus.CONFLICT,
    message: 'Tienes un comprobante de transferencia en validación.',
  },
  PAYMENT_TRANSFER_INVALID_FILE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: `El comprobante debe ser PDF, JPG o PNG de máximo ${formatMegabytes(FILES.TRANSFER_RECEIPT.maxBytes)}.`,
  },
  PAYMENT_TRANSFER_UPLOAD_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'No encontramos el comprobante subido. Vuelve a subirlo.',
  },
  PAYMENT_TRANSFER_AMOUNT_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El monto recibido es menor al saldo esperado: solo se puede rechazar.',
  },
  PAYMENT_INVALID_STATE: {
    status: HttpStatus.CONFLICT,
    message: 'El pago no está en un estado que permita esta acción.',
  },
  PAYMENT_CHARGE_FAILED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El cobro fue rechazado. Actualiza tu tarjeta o intenta con otra.',
  },
  PAYMENT_RECEIPT_NOT_AVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El comprobante solo está disponible para pagos pagados o transferencias validadas.',
  },
  PAYMENT_WEBHOOK_SIGNATURE_INVALID: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Firma del webhook inválida.',
  },
  MOODLE_CODE_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El código de acceso no es válido.',
  },
  MOODLE_CODE_USED: {
    status: HttpStatus.CONFLICT,
    message: 'Este código de acceso ya fue usado.',
  },
  MOODLE_CODE_EXPIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Este código de acceso venció.',
  },

  // --- Fase 06: Panel administrativo (HU-27 a HU-33) ---
  // Ofertas y contenido (HU-27, 28)
  OFFER_NAME_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Ya existe una oferta con ese nombre.',
  },
  OFFER_INCOMPLETE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Faltan datos obligatorios o la oferta no cumple las reglas de su tipo.',
  },
  OFFER_HAS_ENROLLMENTS: {
    status: HttpStatus.CONFLICT,
    message:
      'La oferta ya tiene inscritos o postulaciones: no se puede cambiar su tipo, modalidad u origen, ni borrarla.',
  },
  OFFER_INVALID_STATE: {
    status: HttpStatus.CONFLICT,
    message: 'La oferta no está en un estado que permita esta acción.',
  },
  OFFER_NOT_MOODLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Esta acción solo aplica a ofertas de origen Moodle.',
  },
  TEACHER_IN_USE: {
    status: HttpStatus.CONFLICT,
    message: 'El docente está asignado a ofertas o módulos: quítalo de ellos antes de borrarlo.',
  },
  ADMIN_UPLOAD_INVALID_FILE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El archivo no tiene un formato o tamaño permitido.',
  },
  ADMIN_UPLOAD_NOT_FOUND: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'No encontramos el archivo subido. Vuelve a subirlo.',
  },
  // Sesiones y asistencia (HU-29, 30)
  SESSION_GENERATION_BLOCKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'No se pueden crear las sesiones: revisa los conflictos y las reglas de duración.',
  },
  SESSION_CONFLICT: {
    status: HttpStatus.CONFLICT,
    message: 'Ya existe una sesión de esta oferta que se traslapa con ese horario.',
  },
  SESSION_HAS_ATTENDANCE: {
    status: HttpStatus.CONFLICT,
    message: 'La sesión ya tiene registros de asistencia: cancélala en lugar de borrarla.',
  },
  ATTENDANCE_NOT_ENROLLED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Alguna persona no tiene una inscripción vigente en esta oferta.',
  },
  // Postulaciones y seguimiento (HU-31, 32)
  APPLICATION_INVALID_STATE: {
    status: HttpStatus.CONFLICT,
    message: 'La postulación no está en un estado que permita esta acción.',
  },
  NOTIFICATION_EMAIL_NOT_FAILED: {
    status: HttpStatus.CONFLICT,
    message: 'No hay un correo fallido que reenviar.',
  },
  FOLLOW_UP_REMINDER_TOO_SOON: {
    status: HttpStatus.CONFLICT,
    message: 'Ya se envió un recordatorio en las últimas 24 horas.',
  },
  FOLLOW_UP_PHONE_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'La persona no tiene un teléfono válido con indicativo para WhatsApp.',
  },
  // Pagos (HU-33)
  PAYMENT_PLAN_INVALID_STATE: {
    status: HttpStatus.CONFLICT,
    message: 'El plan de cuotas no está en un estado que permita esta acción.',
  },
  PAYMENT_REFUND_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El monto a reembolsar debe ser mayor a 0 y no superar lo pagado.',
  },
  // Tipos de beca parametrizables
  SCHOLARSHIP_TYPE_KEY_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'Ya existe un tipo de beca con esa clave.',
  },
  SCHOLARSHIP_TYPE_IN_USE: {
    status: HttpStatus.CONFLICT,
    message:
      'El tipo de beca ya está en ofertas, postulaciones o evaluaciones: desactívalo en lugar de borrarlo.',
  },
  SCHOLARSHIP_TYPE_INVALID_RANGE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'El rango de porcentaje no es válido (1 ≤ mínimo ≤ máximo ≤ 100).',
  },
  SCHOLARSHIP_TYPE_FULL: {
    status: HttpStatus.CONFLICT,
    message: 'Ya no hay cupo para este tipo de beca.',
  },
  SCHOLARSHIP_TYPE_NOT_AVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Algún tipo de beca no existe o está desactivado.',
  },
  // Equipo y roles
  ADMIN_LAST_SUPER_ADMIN: {
    status: HttpStatus.CONFLICT,
    message: 'Debe quedar al menos una cuenta SUPER_ADMIN activa.',
  },
  ADMIN_SELF_ACTION: {
    status: HttpStatus.CONFLICT,
    message: 'No puedes quitarte el rol SUPER_ADMIN ni deshabilitar tu propia cuenta.',
  },
  // Reuniones generadas (Zoom / Google Meet; apoyo a HU-29 y HU-31)
  MEETING_PROVIDER_NOT_CONFIGURED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'La generación de reuniones con este proveedor no está configurada.',
  },
  MEETING_PROVIDER_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'No pudimos comunicarnos con el proveedor de videollamadas. Intenta de nuevo.',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Códigos de `details[].code` (errores por campo). Se derivan de las restricciones de
 * class-validator (`isEmail` → `IS_EMAIL`) o se definen a mano (`ALREADY_EXISTS`).
 */
export const FIELD_ERROR_CODES = {
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  INVALID: 'INVALID',
  REQUIRED: 'REQUIRED',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  /** La confirmación no coincide con la nueva contraseña. */
  PASSWORD_MISMATCH: 'PASSWORD_MISMATCH',
  /** País / estado / municipio que no existe o no corresponde al nivel superior. */
  INVALID_LOCATION: 'INVALID_LOCATION',
  /** Longitud del teléfono no válida para el indicativo. */
  INVALID_PHONE: 'INVALID_PHONE',
  /** Fase 04: faltan archivos de evidencia (mínimo 1 en becas). */
  MIN_FILES: 'MIN_FILES',
  /** Fase 04: casilla obligatoria sin marcar (términos, elegibilidad). */
  MUST_ACCEPT: 'MUST_ACCEPT',
  /** Tipo de beca no habilitado (o desactivado) en la oferta. Antes `LEVEL_NOT_ENABLED`. */
  SCHOLARSHIP_TYPE_NOT_ENABLED: 'SCHOLARSHIP_TYPE_NOT_ENABLED',
  /** Tipo de beca sin cupo disponible (global o de la oferta). */
  SCHOLARSHIP_TYPE_FULL: 'SCHOLARSHIP_TYPE_FULL',
  /** Tipo de beca inexistente. */
  SCHOLARSHIP_TYPE_NOT_FOUND: 'SCHOLARSHIP_TYPE_NOT_FOUND',
  /** Tipo de beca desactivado: ya no se puede agregar a una oferta. */
  SCHOLARSHIP_TYPE_INACTIVE: 'SCHOLARSHIP_TYPE_INACTIVE',
  /** Fase 04: campo que no corresponde al tipo de postulación (beca / convocatoria). */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  /** Reuniones generadas: la fecha de inicio debe ser futura. */
  MUST_BE_FUTURE: 'MUST_BE_FUTURE',
} as const;

export function getErrorDefinition(code: ErrorCode): ErrorDefinition {
  return ERROR_CODES[code];
}
