# Catálogo de códigos de error

Fuente: `src/common/errors/error-codes.ts`. **Cada fase que agregue códigos debe actualizar esta tabla.**
Formato de la respuesta de error: ver [`README.md`](README.md#formato-de-error-único-en-toda-la-api).

Usa `code` para decidir la UI; `message` (español) sirve como texto por defecto. Los códigos no se
renombran una vez publicados.

## Genéricos (Fase 00)

| `code` | HTTP | Mensaje por defecto | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Los datos enviados no son válidos. | Cuerpo/query inválido. Pinta `details[]` por campo. |
| `BAD_REQUEST` | 400 | La solicitud no es válida. | Petición mal formada (p. ej. JSON inválido). Error de integración. |
| `UNAUTHORIZED` | 401 | Necesitas iniciar sesión para continuar. | Sin token o token vencido → refresh o login. |
| `FORBIDDEN` | 403 | No tienes permiso para realizar esta acción. | Falta rol/permiso. |
| `NOT_FOUND` | 404 | El recurso solicitado no existe. | Recurso inexistente o ajeno; también ruta inexistente ("La ruta solicitada no existe."). |
| `CONFLICT` | 409 | La operación entra en conflicto con el estado actual del recurso. | Duplicado (`details[].code = ALREADY_EXISTS`) o estado inválido. |
| `PAYLOAD_TOO_LARGE` | 413 | El contenido enviado excede el tamaño permitido. | Archivo/cuerpo demasiado grande. |
| `BUSINESS_RULE_VIOLATION` | 422 | La operación no cumple una regla de negocio. | Regla de negocio genérica; las fases definen códigos más específicos. |
| `RATE_LIMITED` | 429 | Demasiadas solicitudes. Intenta de nuevo en unos momentos. | Límite de peticiones; espera y reintenta. |
| `INTERNAL_ERROR` | 500 | Ocurrió un error inesperado. Intenta de nuevo más tarde. | Error del servidor. Muestra `requestId` como código de soporte. |
| `SERVICE_UNAVAILABLE` | 503 | El servicio no está disponible temporalmente. | Dependencia caída (p. ej. BD en `/health/ready`). |

## Códigos de campo (`details[].code`)

| `code` | Significado |
|---|---|
| `REQUIRED` | Campo obligatorio ausente o vacío. |
| `UNKNOWN_FIELD` | Se envió un campo que el endpoint no acepta. |
| `ALREADY_EXISTS` | El valor ya está registrado (único). |
| `INVALID` | Valor inválido (genérico). |
| `PASSWORD_MISMATCH` | La confirmación no coincide con la nueva contraseña (Fase 01). |
| `PASSWORD_HAS_LETTER`, `PASSWORD_HAS_DIGIT` | La contraseña no incluye una letra / un número (Fase 01). |
| `IS_IANA_TIMEZONE` | Zona horaria IANA no válida (Fase 01). |
| `INVALID_LOCATION` | País / estado / municipio inexistente o que no corresponde al nivel superior (Fase 01). |
| `INVALID_PHONE` | Longitud del teléfono no válida para el indicativo (Fase 01). |
| `COURSE_MAX_HOURS_EXCEEDED`, `DIPLOMA_HOURS_MISMATCH` | Panel (Fase 06): curso de más de 9 h / diplomado que no suma 60 h (asistente de ofertas y vista previa de sesiones). |
| `MUST_BE_FUTURE` | Reuniones generadas (`POST /admin/meetings`): `startAt` en el pasado. |
| `INVALID_MEETING_URL` | Panel (Fase 06): enlace de sesión que no es `https://…zoom.us` ni `https://meet.google.com`. |
| `NOT_APPLICABLE`, `SCHOLARSHIP_TYPE_NOT_ENABLED`, `MIN_FILES`, `MUST_ACCEPT` | Formulario de postulación (Fase 04): campo de otro tipo, tipo de beca no habilitado o desactivado en la oferta (antes `LEVEL_NOT_ENABLED`; también al asignar/sugerir en el panel), faltan evidencias, casilla obligatoria sin marcar. |
| `SCHOLARSHIP_TYPE_FULL` | Tipo de beca sin cupo: al solicitarlo en el formulario (`422 BUSINESS_RULE_VIOLATION` al guardar, o pendiente de `422 APPLICATION_INCOMPLETE` al enviar) → elegir otro tipo. |
| `SCHOLARSHIP_TYPE_NOT_FOUND`, `SCHOLARSHIP_TYPE_INACTIVE` | Panel (asistente de ofertas, paso 4): tipo de beca inexistente / desactivado (no se puede agregar a la oferta). |
| `IS_EMAIL`, `IS_STRING`, `IS_INT`, `IS_ENUM`, `IS_UUID`, `IS_DATE_STRING`, `MIN_LENGTH`, `MAX_LENGTH`, `MIN`, `MAX`, `MATCHES`, ... | Restricción de validación incumplida (nombre de la regla en `SCREAMING_SNAKE_CASE`). |

## Por fase

<!-- Cada fase agrega su sección con sus códigos. -->

### Fase 01 — Identidad y Contacto

Guía de pantallas: [`fase-01-identidad.md`](fase-01-identidad.md). Algunos errores traen `meta` (datos
para la UI, p. ej. la hora de desbloqueo); ver la columna `meta`.

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `AUTH_EMAIL_ALREADY_REGISTERED` | 409 | Ya existe una cuenta con este correo. | — | Registro (HU-02). Error bajo `email` (`details`); ofrecer ir al login. |
| `AUTH_USERNAME_TAKEN` | 409 | Ese nombre de usuario ya está en uso. | — | Registro (HU-02). Error bajo `username`. |
| `AUTH_INVALID_CREDENTIALS` | 401 | Correo o contraseña incorrectos. | — | Login (HU-04). Mensaje genérico; limpiar contraseña. |
| `AUTH_EMAIL_NOT_VERIFIED` | 403 | Debes verificar tu correo antes de iniciar sesión. | `email`, `maskedEmail`, `otpSent`, `codeLength`, `expiresAt`, `resendAvailableAt`, `lockedUntil` | Login con contraseña correcta y cuenta sin verificar → redirigir a HU-03. |
| `AUTH_ACCOUNT_DISABLED` | 403 | Tu cuenta está deshabilitada. Contacta al equipo de la Escuela. | — | Login, verificación o recuperación de una cuenta deshabilitada. |
| `AUTH_LOGIN_LOCKED` | 429 | Demasiados intentos fallidos. Intenta de nuevo más tarde. | `lockedUntil` | 5 fallos de login consecutivos → bloqueo temporal (HU-04). |
| `AUTH_ACCOUNT_NOT_FOUND` | 404 | No existe una cuenta con ese correo. | — | Recuperación (HU-05) o reenvío de OTP con un correo sin cuenta. Configurable (riesgo de enumeración). |
| `AUTH_ALREADY_VERIFIED` | 409 | Tu correo ya está verificado. Inicia sesión. | — | Verificar/reenviar OTP de una cuenta ya activa → login. |
| `AUTH_OTP_INVALID` | 400 | El código es incorrecto. | `attemptsRemaining` | Código OTP incorrecto (HU-03/HU-05). |
| `AUTH_OTP_EXPIRED` | 400 | El código expiró o ya no es válido. Solicita uno nuevo. | `resendAvailableAt` | Código vencido, ya usado o reemplazado → ofrecer reenvío. |
| `AUTH_OTP_LOCKED` | 429 | Demasiados intentos con el código. Espera antes de intentarlo de nuevo. | `lockedUntil` | 5 fallos de OTP consecutivos: no se puede verificar ni reenviar hasta `lockedUntil`. |
| `AUTH_OTP_COOLDOWN` | 429 | Espera un momento antes de solicitar un nuevo código. | `resendAvailableAt` | Reenvío antes de que termine la cuenta regresiva. |
| `AUTH_REFRESH_INVALID` | 401 | Tu sesión expiró. Inicia sesión de nuevo. | — | Refresh vencido, revocado o reutilizado → borrar tokens e ir al login. |
| `AUTH_RESET_TOKEN_INVALID` | 400 | El enlace de recuperación expiró o ya se usó. Solicita un nuevo código. | — | Paso 3 de HU-05 con `resetToken` vencido/usado → volver al paso 1. |
| `AUTH_CURRENT_PASSWORD_INVALID` | 400 | La contraseña actual es incorrecta. | — | Cambio de contraseña (HU-14). Error bajo `currentPassword`. |
| `CONTACT_CAPTCHA_FAILED` | 400 | No pudimos verificar que no eres un robot. Intenta de nuevo más tarde. | — | Contacto (HU-38) con captcha activo y token inválido/ausente. |

### Fase 02 — Oferta formativa

Guía de pantallas: [`fase-02-oferta.md`](fase-02-oferta.md).

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `OFFER_NOT_AVAILABLE` | 404 | Esta oferta ya no está disponible. | — | Ficha (HU-16) de una oferta inexistente, en borrador o archivada → "Esta oferta ya no está disponible" + enlace al catálogo. |

Validación del catálogo (`400 VALIDATION_ERROR`): `q` con menos de 3 caracteres
(`details[].field = "q"`, `code = "MIN_LENGTH"`); `type`, `status`, `modality`, `topic` o `topics`
fuera del enum (`IS_ENUM` / `IS_IN`).

### Fase 03 — Portal del participante

Guía de pantallas: [`fase-03-portal.md`](fase-03-portal.md).

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `ENROLLMENT_REQUIRED` | 403 | No estás inscrito en esta formación. | `offerSlug`, `enrollmentStatus` | Aula, materiales, sesiones, asistencia o proyecto final sin inscripción con acceso (HU-07/08/12/17/18) → "No autorizado" + enlace a la ficha. Sin enlaces expuestos. |
| `ENROLLMENT_SUSPENDED` | 403 | Tu acceso a esta formación está suspendido. Regulariza tu pago para recuperarlo. | `offerSlug` | Inscripción suspendida por mora (HU-08/24) → aviso para regularizar. |
| `ENROLLMENT_ALREADY_EXISTS` | 409 | Ya estás inscrito en esta formación. | `enrollmentStatus` | `POST /me/enrollments` repetido → "Ya estás inscrito · Ir a mi aula". |
| `ENROLLMENT_NOT_FREE` | 422 | Esta oferta no admite inscripción directa gratuita. | `requiredAction` | Oferta de pago / convocatoria / Moodle → usar `ENROLL_AND_PAY`, `APPLY_OPEN_CALL` o `ACTIVATE_MOODLE_ACCESS`. |
| `ENROLLMENT_CLOSED` | 422 | Las inscripciones para esta oferta no están abiertas. | `reason`, `availableFrom` | `reason` = `ENROLLMENT_NOT_OPEN_YET` / `ENROLLMENT_CLOSED` / `OFFER_FINISHED` (mismos textos que la ficha). |
| `OFFER_SOLD_OUT` | 409 | Cupo agotado. | — | Inscripción gratuita sin cupo. |
| `SESSION_CANCELLED` | 422 | Esta sesión fue cancelada. | `opensAt`, `closesAt`, `registeredAt` | Registrar asistencia de una sesión cancelada. |
| `ATTENDANCE_NOT_OPEN_YET` | 422 | El registro de asistencia se abre al terminar la sesión. | `opensAt`, `closesAt`, `registeredAt` | HU-18 antes del fin de la sesión. |
| `ATTENDANCE_WINDOW_CLOSED` | 422 | El registro de asistencia para esta sesión está cerrado. | `opensAt`, `closesAt`, `registeredAt` | HU-18 con la ventana vencida → "No registrada"; pedir corrección al equipo. |
| `ATTENDANCE_ALREADY_REGISTERED` | 409 | Tu asistencia a esta sesión ya está registrada. | `opensAt`, `closesAt`, `registeredAt` | Doble envío o marcada por el equipo → "Asistencia registrada el …". |
| `RESOURCE_FILE_UNAVAILABLE` | 404 | El archivo no está disponible. Intenta de nuevo más tarde. | — | Recurso sin archivo ni enlace (HU-08/09). |
| `FINAL_PROJECT_NOT_AVAILABLE` | 422 | Esta formación no recibe entregas de proyecto final. | — | Curso/taller o diplomado sin carga habilitada. |
| `FINAL_PROJECT_DEADLINE_PASSED` | 422 | La fecha límite de entrega del proyecto final ya pasó. | `dueAt` | Carga después de la fecha límite (solo lectura). |
| `FINAL_PROJECT_INVALID_FILE` | 422 | El archivo debe ser PDF, DOCX, PPTX o ZIP de máximo 20 MB. | — | Tipo o tamaño no permitido (declarado o real). |
| `FINAL_PROJECT_UPLOAD_NOT_FOUND` | 422 | No encontramos el archivo subido. Vuelve a subirlo. | — | Se confirmó una `key` que no existe en storage o no es de la persona. |

Validación (`400 VALIDATION_ERROR`): asistencia sin `attended: true` (`details[].code = "EQUALS"`) o
comentario > 500 (`MAX_LENGTH`); calendario con rango inválido (`INVALID_RANGE`) o > 62 días
(`RANGE_TOO_LARGE`); filtros fuera del enum (`IS_ENUM` / `IS_IN`). Un id de ruta que no es UUID
responde `404 NOT_FOUND`.

### Fase 04 — Postulaciones

Guía de pantallas: [`fase-04-postulaciones.md`](fase-04-postulaciones.md).

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `APPLICATION_NOT_ALLOWED` | 422 | Esta oferta no recibe postulaciones. | `offerType`, `origin` | Postular a un curso, taller, evento, diplomado sin beca u oferta Moodle (HU-19) → mostrar el motivo, sin botón. |
| `APPLICATION_WINDOW_CLOSED` | 422 | La convocatoria no está abierta. | `reason`, `availableFrom`, `closesAt` | Crear, editar, subir o enviar fuera de la ventana. `reason` = `SCHOLARSHIP_NOT_OPEN_YET` / `SCHOLARSHIP_CLOSED` / `ENROLLMENT_NOT_OPEN_YET` / `ENROLLMENT_CLOSED` / `OFFER_FINISHED` → "Convocatoria cerrada" (borrador en solo lectura) o "Abre el …". |
| `APPLICATION_ALREADY_EXISTS` | 409 | Ya tienes una postulación para esta oferta. | `applicationId`, `status`, `folio` | Una postulación por cohorte (HU-19/20) → ir a `/postulaciones/{applicationId}`. |
| `APPLICATION_NOT_EDITABLE` | 409 | Tu postulación ya fue enviada y no se puede modificar. | `status` | Editar, adjuntar, descartar o reenviar una postulación ya enviada → recargar el detalle. |
| `APPLICATION_INCOMPLETE` | 422 | Completa los campos obligatorios para enviar tu postulación. | — | Enviar con pendientes: `details[]` por campo (`REQUIRED`, `MIN_LENGTH`, `MAX_LENGTH`, `MIN_FILES`, `MUST_ACCEPT`, `SCHOLARSHIP_TYPE_NOT_ENABLED`). |
| `APPLICATION_NOT_ELIGIBLE` | 422 | No cumples con la elegibilidad de esta convocatoria. | `reasons`, `eligibilityText` | `COUNTRY_NOT_ELIGIBLE` (país del perfil) / `TRAVEL_REQUIRED` ("No" a viajar) (HU-20) → mostrar el motivo; no se puede enviar. |
| `APPLICATION_INVALID_FILE` | 422 | El archivo debe ser JPG, PNG o HEIC de máximo 15 MB, o MP4/MOV de máximo 100 MB. | — | Tipo o tamaño no permitido (declarado o real) de una evidencia. |
| `APPLICATION_TOO_MANY_FILES` | 422 | Puedes adjuntar como máximo 10 archivos. | `max` | Límite de evidencias. |
| `APPLICATION_UPLOAD_NOT_FOUND` | 422 | No encontramos el archivo subido. Vuelve a subirlo. | — | Se confirmó una `key` que no existe en storage o no es de esa postulación. |
| `APPLICATION_INVALID_TRANSITION` | 409 | Tu postulación no está en un estado que permita esta acción. | `status`, `to` | Confirmar participación cuando la postulación no lo espera (o acción concurrente) → recargar. |
| `APPLICATION_DEADLINE_PASSED` | 422 | El plazo para responder ya venció. | `dueAt` | Confirmar participación después de la fecha límite (HU-21) → "Vencida, contacta al equipo". |
| `APPLICATION_INTERVIEW_REQUIRED` | 422 | Esta postulación requiere entrevista por Zoom. | — | Panel (Fase 06, HU-31): aprobar una beca cuyo tipo tiene `requiresInterview` (p. ej. Beca especial) o una convocatoria sin entrevista "Realizada". |

Validación (`400 VALIDATION_ERROR`) del formulario: `details[].code` = `NOT_APPLICABLE` (campo del otro
tipo de postulación), `SCHOLARSHIP_TYPE_NOT_ENABLED` (tipo de beca no habilitado o desactivado), `INVALID_PHONE`, `MAX_LENGTH`,
`IS_URL` / `ARRAY_MAX_SIZE` (enlaces de evidencia), `IS_INT` / `MIN` / `MAX` (edad). Ids de ruta que no
son UUID y postulaciones ajenas → `404 NOT_FOUND`.

### Fase 05 — Pagos y acceso Moodle

Guía de pantallas: [`fase-05-pagos.md`](fase-05-pagos.md). Pagos o planes ajenos e ids mal formados →
`404 NOT_FOUND`.

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `PAYMENTS_NOT_CONFIGURED` | 503 | El pago con tarjeta no está disponible en este momento. Intenta más tarde. | — | El servidor no tiene llaves de Stripe: checkout, [Actualizar tarjeta] y [Pagar ahora]. La transferencia y el resto siguen funcionando. |
| `PAYMENT_PROVIDER_ERROR` | 502 | No pudimos comunicarnos con el procesador de pagos. Intenta de nuevo. | — | Stripe no respondió: [Reintentar]. No se cobró nada. |
| `PAYMENT_NOT_ALLOWED` | 422 | Esta oferta no se paga en la plataforma. | `reason`, `requiredAction` | `reason` = `MOODLE` (→ activar acceso), `OPEN_CALL` (→ postular), `FREE` (→ inscribirme), `PAY_BALANCE` (→ pagar el saldo de la beca), `PRICE_NOT_AVAILABLE`. |
| `PAYMENT_BALANCE_NOT_DUE` | 409 | Esta postulación no tiene un saldo pendiente de pago. | `status` | Pagar el saldo de una postulación que ya no está "Aprobada – pendiente de pago" → recargar. |
| `PAYMENT_INSTALLMENTS_NOT_AVAILABLE` | 422 | El número de cuotas elegido no está disponible para esta oferta. | `allowed` | Cuotas fuera de 2–4, del máximo de la oferta o con la última después del fin. |
| `PAYMENT_TRANSFER_NOT_AVAILABLE` | 422 | La transferencia bancaria no está disponible para este pago. | `reason` | `NOT_MEXICO`, `CURRENCY_NOT_MXN`, `NOT_A_BALANCE`, `NOT_CONFIGURED`. |
| `PAYMENT_TRANSFER_PENDING` | 409 | Tienes un comprobante de transferencia en validación. | — | Pagar con tarjeta mientras hay un comprobante "Pendiente de validación". |
| `PAYMENT_TRANSFER_INVALID_FILE` | 422 | El comprobante debe ser PDF, JPG o PNG de máximo 15 MB. | — | Tipo o tamaño no permitido (declarado o real). |
| `PAYMENT_TRANSFER_UPLOAD_NOT_FOUND` | 422 | No encontramos el comprobante subido. Vuelve a subirlo. | — | Se confirmó una `key` que no existe o no es de esa postulación. |
| `PAYMENT_TRANSFER_AMOUNT_MISMATCH` | 422 | El monto recibido es menor al saldo esperado: solo se puede rechazar. | `differenceCents`, `expectedCents` | Panel (Fase 06, HU-33) al validar una transferencia. |
| `PAYMENT_INVALID_STATE` | 409 | El pago no está en un estado que permita esta acción. | `status` | Cancelar un checkout ya cerrado, [Pagar ahora] sin cuotas fallidas, [Actualizar tarjeta] de un plan no vigente → recargar. |
| `PAYMENT_CHARGE_FAILED` | 422 | El cobro fue rechazado. Actualiza tu tarjeta o intenta con otra. | `failureMessage` | [Pagar ahora] rechazado → ofrecer [Actualizar tarjeta]. |
| `PAYMENT_RECEIPT_NOT_AVAILABLE` | 422 | El comprobante solo está disponible para pagos pagados o transferencias validadas. | — | [Descargar comprobante] de un pago pendiente/fallido/rechazado. |
| `PAYMENT_WEBHOOK_SIGNATURE_INVALID` | 400 | Firma del webhook inválida. | — | Solo el webhook de Stripe (no aplica al frontend). |
| `MOODLE_CODE_INVALID` | 422 | El código de acceso no es válido. | — | HU-25: código con formato incorrecto o inexistente. |
| `MOODLE_CODE_USED` | 409 | Este código de acceso ya fue usado. | — | HU-25: código de un solo uso ya canjeado. |
| `MOODLE_CODE_EXPIRED` | 422 | Este código de acceso venció. | — | HU-25: después del fin de la cohorte. |

Se reutilizan de fases anteriores: `ENROLLMENT_ALREADY_EXISTS` (409, `meta.enrollmentStatus`),
`OFFER_SOLD_OUT` (409), `ENROLLMENT_CLOSED` (422, `meta.reason`/`availableFrom`),
`OFFER_NOT_AVAILABLE` (404), `APPLICATION_DEADLINE_PASSED` (422, `meta.dueAt`),
`ENROLLMENT_SUSPENDED` (403, Aula con plan en mora).

Validación (`400 VALIDATION_ERROR`): `termsAccepted` distinto de `true` (`details[].code = "EQUALS"`),
`autoDebitAuthorized` sin marcar con cuotas (`MUST_ACCEPT`), `offerId` y `applicationId` juntos o
ninguno (`INVALID`), `installmentCount` fuera de 2–4 (`MIN`/`MAX`), `paidOn` futura (`INVALID`),
`trackingKey` no alfanumérica (`MATCHES`), y cualquier campo extra como un monto (`UNKNOWN_FIELD`:
el monto nunca lo envía el cliente).

### Fase 06 — Panel administrativo

Guía: [`fase-06-admin.md`](fase-06-admin.md). Todo `/admin/...` responde `403 FORBIDDEN` con
`meta.missingPermissions` (p. ej. `["payments.manage"]`) cuando el rol no tiene el permiso; ids que no
son UUID o inexistentes → `404 NOT_FOUND`.

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `FORBIDDEN` | 403 | No tienes permiso para realizar esta acción. | `missingPermissions` | Rol sin el permiso del endpoint (o cuenta del panel deshabilitada) → ocultar/deshabilitar la acción; en `GET /admin/me`, redirigir al portal. |
| `OFFER_NAME_TAKEN` | 409 | Ya existe una oferta con ese nombre. | — | HU-27: nombre único (crear, paso 1, duplicar). Error bajo `name`. |
| `OFFER_INCOMPLETE` | 422 | Faltan datos obligatorios o la oferta no cumple las reglas de su tipo. | `steps` | HU-27 "Publicar": `details[].field = <paso>.<campo>` (p. ej. `schedule.totalHours`); llevar al paso con problemas. |
| `OFFER_HAS_ENROLLMENTS` | 409 | La oferta ya tiene inscritos o postulaciones: no se puede cambiar su tipo, modalidad u origen, ni borrarla. | — | HU-27: campos bloqueados con inscritos; borrar una oferta con actividad. |
| `OFFER_INVALID_STATE` | 409 | La oferta no está en un estado que permita esta acción. | `publicationStatus` | Publicar/archivar/despublicar/borrar desde un estado inválido; cerrar inscripciones ya cerradas (HU-32). Recargar. |
| `OFFER_NOT_MOODLE` | 422 | Esta acción solo aplica a ofertas de origen Moodle. | — | Lista de correos / códigos Moodle en una oferta NAS. |
| `TEACHER_IN_USE` | 409 | El docente está asignado a ofertas o módulos: quítalo de ellos antes de borrarlo. | — | Borrar docente. |
| `ADMIN_UPLOAD_INVALID_FILE` | 422 | El archivo no tiene un formato o tamaño permitido. | — | Imagen (JPG/PNG/WebP ≤ 15 MB) o material (PDF/PPTX/DOCX/EPUB ≤ 50 MB) no permitido (declarado o real). Error en ese ítem, reintentar. |
| `ADMIN_UPLOAD_NOT_FOUND` | 422 | No encontramos el archivo subido. Vuelve a subirlo. | — | Se confirmó una `key` que no existe en storage o no corresponde. |
| `SESSION_GENERATION_BLOCKED` | 422 | No se pueden crear las sesiones: revisa los conflictos y las reglas de duración. | `conflictCount`, `violations` | HU-29 "Crear sesiones" con conflictos, 0 sesiones o curso > 9 h (la vista previa ya lo anticipa con `canConfirm=false`). |
| `SESSION_CONFLICT` | 409 | Ya existe una sesión de esta oferta que se traslapa con ese horario. | — | Sesión manual o reprogramación sobre otra sesión. |
| `SESSION_HAS_ATTENDANCE` | 409 | La sesión ya tiene registros de asistencia: cancélala en lugar de borrarla. | — | Borrar una sesión con asistencias. |
| `ATTENDANCE_NOT_ENROLLED` | 422 | Alguna persona no tiene una inscripción vigente en esta oferta. | `userIds` | HU-30 marcar asistencia manual. |
| `APPLICATION_INVALID_STATE` | 409 | La postulación no está en un estado que permita esta acción. | `status`, `to` | HU-31/32: evaluar, decidir, entrevista, recordatorio o extensión fuera de estado (o acción concurrente). Recargar. |
| `NOTIFICATION_EMAIL_NOT_FAILED` | 409 | No hay un correo fallido que reenviar. | — | "Reintentar envío" sin correo fallido. |
| `FOLLOW_UP_REMINDER_TOO_SOON` | 409 | Ya se envió un recordatorio en las últimas 24 horas. | `availableAt` | HU-32: botón deshabilitado hasta `availableAt`. |
| `FOLLOW_UP_PHONE_INVALID` | 422 | La persona no tiene un teléfono válido con indicativo para WhatsApp. | — | HU-32: botón WhatsApp deshabilitado. |
| `PAYMENT_PLAN_INVALID_STATE` | 409 | El plan de cuotas no está en un estado que permita esta acción. | `status` | HU-33: reintentar, mora, suspender (solo En mora), restablecer o cancelar desde un estado inválido. |
| `PAYMENT_REFUND_INVALID` | 422 | El monto a reembolsar debe ser mayor a 0 y no superar lo pagado. | `refundableCents` | HU-33 reembolso. |
| `SCHOLARSHIP_TYPE_KEY_TAKEN` | 409 | Ya existe un tipo de beca con esa clave. | — | Crear tipo de beca: `details[].field = key` (`ALREADY_EXISTS`). |
| `SCHOLARSHIP_TYPE_IN_USE` | 409 | El tipo de beca ya está en ofertas, postulaciones o evaluaciones: desactívalo en lugar de borrarlo. | `usage` | Borrar un tipo en uso → ofrecer "Desactivar". |
| `SCHOLARSHIP_TYPE_INVALID_RANGE` | 422 | El rango de porcentaje no es válido (1 ≤ mínimo ≤ máximo ≤ 100). | — | Crear/editar tipo o rango propio en el paso 4 de la oferta: `details[].field` (`minPercent` / `maxPercent` / `scholarshipTypes.N.maxPercent`). |
| `SCHOLARSHIP_TYPE_FULL` | 409 | Ya no hay cupo para este tipo de beca. | `scholarshipTypeId`, `maxRecipients`, `used`, `scope` (`TYPE` / `OFFER`) | Aprobar (o reactivar con [Extender plazo]) sin cupo del tipo (global) o de la oferta. Elegir otro tipo o subir el cupo. |
| `SCHOLARSHIP_TYPE_NOT_AVAILABLE` | 422 | Algún tipo de beca no existe o está desactivado. | — | Paso 4 de la oferta: `details[]` por `scholarshipTypes.N.scholarshipTypeId` con `SCHOLARSHIP_TYPE_NOT_FOUND` / `SCHOLARSHIP_TYPE_INACTIVE`. |
| `ADMIN_LAST_SUPER_ADMIN` | 409 | Debe quedar al menos una cuenta SUPER_ADMIN activa. | — | Quitar el rol o deshabilitar al último SUPER_ADMIN. |
| `ADMIN_SELF_ACTION` | 409 | No puedes quitarte el rol SUPER_ADMIN ni deshabilitar tu propia cuenta. | — | Gestión del equipo sobre la propia cuenta. |

Se reutilizan de fases anteriores: `APPLICATION_INTERVIEW_REQUIRED` (422, decidir sin entrevista
"Realizada"), `PAYMENT_TRANSFER_AMOUNT_MISMATCH` (422, `meta.differenceCents`/`expectedCents`),
`PAYMENT_INVALID_STATE` (409), `PAYMENT_CHARGE_FAILED` (422), `PAYMENTS_NOT_CONFIGURED` (503),
`PAYMENT_PROVIDER_ERROR` (502), `SESSION_CANCELLED` (422, cancelar o marcar asistencia en una sesión ya
cancelada) y `CONFLICT` (409 genérico: evento ya cancelado, correo Moodle ya vinculado).

### Reuniones generadas — Zoom / Google Meet (apoyo a HU-29 y HU-31)

Guía: [`fase-07-reuniones.md`](./fase-07-reuniones.md).

| `code` | HTTP | Mensaje por defecto | `meta` | Cuándo ocurre / qué hacer en la UI |
|---|---|---|---|---|
| `MEETING_PROVIDER_NOT_CONFIGURED` | 503 | La generación de reuniones con este proveedor no está configurada. | `provider` | El proveedor elegido no tiene credenciales en el servidor. Oculta el botón "Generar enlace" para los proveedores que no aparecen en `GET /admin/meetings/providers`; el usuario puede seguir pegando el enlace a mano. |
| `MEETING_PROVIDER_ERROR` | 502 | No pudimos comunicarnos con el proveedor de videollamadas. Intenta de nuevo. | `provider` | Zoom / Google respondió con error, tardó demasiado o rechazó las credenciales → "Reintentar" o pegar el enlace a mano. |

Además: `VALIDATION_ERROR` (400; `details[]` por `provider`, `topic`, `startAt` —p. ej. fecha en el
pasado—, `durationMinutes`, `timezone`) y `NOT_FOUND` (404; la reunión ya no existe en el proveedor al
pedir un enlace de anfitrión nuevo).
