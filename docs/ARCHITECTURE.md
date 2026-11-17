# Arquitectura y convenciones

Este documento es la referencia para cualquier persona (o agente) que agregue código. Si una decisión cambia, se actualiza aquí.

## Stack

| Área | Elección | Motivo |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript 6 estricto | LTS, tipado |
| Framework | NestJS 11 (adaptador Express) | Módulos por dominio, DI, OpenAPI integrado; fácil de mantener |
| ORM | Prisma 7 + PostgreSQL (driver adapter `@prisma/adapter-pg`) | Migraciones versionadas, tipos generados, portable (Supabase / Neon / Railway) |
| Validación | class-validator + class-transformer (DTOs) | Se integra con @nestjs/swagger: un DTO = validación + documentación |
| Config | `@nestjs/config` + validación con zod al arrancar | Falla rápido si falta una variable |
| Docs API | `@nestjs/swagger` (OpenAPI 3.1) + Scalar UI | `/docs` (UI) y `/docs/openapi.json` (JSON), fuera del prefijo `/api/v1`. Export versionado en `openapi/openapi.json` |
| Auth | JWT de acceso (corto, `@nestjs/jwt` 11, HS256) + refresh token opaco rotativo guardado con hash en BD | Sin dependencia de proveedor externo. `@nestjs/jwt` 12 es solo-ESM y Jest no lo carga: se fija la 11 |
| Hash | argon2 | Recomendado para contraseñas |
| Logs | nestjs-pino | JSON estructurado con requestId |
| Seguridad | helmet, CORS por lista blanca, @nestjs/throttler | Rate limit en login/OTP/contacto |
| Permisos del panel | Matriz rol → permisos en código + `@RequirePermissions` (roles leídos de la BD) + auditoría | Fase 06 |
| Correo | `MailService` con driver `console`/`smtp` en dev (Mailpit) y `resend` en prod | Intercambiable |
| Archivos | `StorageService` sobre API S3 (MinIO en dev; Supabase Storage S3 o Cloudflare R2 en prod) | URLs firmadas temporales |
| Pagos | Stripe (SDK `stripe` 23.0.0 exacto): Checkout Sessions (`payment` y `setup`), PaymentIntents off-session para cuotas, webhooks firmados. Puerto `PaymentGateway` (fake en e2e) | Fase 05 |
| Tareas programadas | `@nestjs/schedule` (cron en proceso; una sola instancia en Railway) | Cierre de asistencia, vencimientos, recordatorios |
| Fechas | Luxon | Zonas IANA; hora oficial `America/Mexico_City` |
| Pruebas | Jest + supertest; e2e contra Postgres de Docker | |
| Paquetes | pnpm | |
| Deploy | Railway (Dockerfile + `railway.json`); el entrypoint de la imagen aplica `prisma migrate deploy` y el seed seguro antes de arrancar | Ver docs/DEPLOY.md |

## Estructura de carpetas

```
src/
  main.ts                 # bootstrap: logger pino, listen
  app.setup.ts            # configureApp(): helmet, CORS, prefijo, pipes, filtro, /docs (main + e2e)
  app.module.ts
  config/                 # env.schema.ts (zod), business-rules.ts (reglas configurables),
                          # openapi.ts (config OpenAPI reutilizable), logger.config.ts (pino + requestId)
  common/                 # transversal, sin lógica de negocio
    errors/               # AppException + catálogo de códigos de error (error-codes.ts)
    filters/              # filtro global de excepciones -> formato de error único
    guards/ decorators/   # JwtAuthGuard, RolesGuard, @Public(), @CurrentUser(), @Roles(), @ThrottleRule()
    swagger/              # @ApiErrorResponses(...codes), @ApiPaginatedResponse(Item)
    dto/                  # PaginationQueryDto, PaginatedResponseDto, ErrorResponseDto
    utils/                # time (CDMX <-> UTC), money, slug, etc.
  infra/                  # adaptadores a servicios externos
    prisma/  mail/  storage/  captcha/ (Turnstile)  stripe/ (puerto PaymentGateway + Stripe)
    meetings/ (puerto MeetingGateway + Zoom S2S OAuth + Google Meet vía Calendar API)
  modules/                # un módulo por dominio
    <dominio>/
      <dominio>.module.ts
      <dominio>.controller.ts        # solo HTTP: valida DTO, llama al servicio, mapea respuesta
      <dominio>.service.ts           # casos de uso y reglas de negocio
      <dominio>.policy.ts (opcional) # reglas puras (fácil de probar sin BD)
      dto/                           # *.request.dto.ts / *.response.dto.ts
      <dominio>.service.spec.ts
  generated/prisma/       # cliente Prisma generado (no versionado; `prisma generate`)
prisma/
  schema.prisma  migrations/  seed.ts
prisma.config.ts          # config del CLI de Prisma 7 (URL de migraciones, seed)
scripts/                  # export-openapi.ts
test/                     # e2e (*.e2e-spec.ts) + helpers (utils/create-test-app.ts)
openapi/openapi.json      # export versionado del contrato
docs/frontend/            # guía de integración por fase
```

Reglas:
- Los controladores no tienen lógica de negocio. Las reglas puras van en funciones/policies probables sin BD.
- Un módulo no importa la BD de otro dominio a escondidas: si necesita algo, usa el servicio exportado del otro módulo.
- Rutas de admin en controladores separados (`admin-<dominio>.controller.ts`) bajo `/admin/...`.

## Convenciones REST

- Prefijo global: `/api/v1`.
- Recursos en plural y kebab-case: `/offers`, `/offers/{slug}`, `/me/enrollments`, `/admin/offers/{id}/sessions`.
- Recursos del usuario autenticado bajo `/me/...`.
- Panel bajo `/admin/...` (requiere roles).
- Verbos: GET leer, POST crear/acciones (`/sessions/{id}/attendance`), PATCH actualización parcial, PUT reemplazo, DELETE borrar.
- Acciones que no son CRUD: sub-recurso con verbo POST (`/auth/otp/resend`, `/admin/transfers/{id}/validate`).
- Códigos: 200 OK, 201 creado, 204 sin contenido, 400 validación, 401 sin sesión, 403 sin permiso, 404, 409 conflicto (duplicado/estado inválido), 422 regla de negocio, 429 rate limit.
- JSON en camelCase. BD en snake_case (`@map`/`@@map` en Prisma).
- IDs: UUID.
- Fechas: ISO 8601 en UTC (`2026-11-07T16:00:00.000Z`). El frontend convierte a la zona del usuario. Cuando sea útil, la respuesta incluye además `timezone` de referencia (`America/Mexico_City`).
- Dinero: enteros en centavos + moneda: `{ "amountCents": 1020000, "currency": "MXN" }`. Nunca floats. MXN y USD nunca se suman.
- Enums en la API: `SCREAMING_SNAKE_CASE` en inglés (`PENDING_PAYMENT`). El frontend traduce a los textos del documento (la guía de cada fase incluye la tabla enum → texto en español).

### Listas y paginación

`GET /offers?page=1&pageSize=20&type=DIPLOMA` →
```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } }
```
Un recurso individual se devuelve como objeto plano (sin envoltorio). Los catálogos pequeños sin
paginar (p. ej. `/locations/countries`) responden `{ "data": [ ... ] }` sin `meta`.

### Formato de error (único en toda la API)

```json
{
  "statusCode": 409,
  "code": "AUTH_EMAIL_ALREADY_REGISTERED",
  "message": "El correo ya está registrado.",
  "details": [{ "field": "email", "code": "ALREADY_EXISTS", "message": "..." }],
  "meta": { "lockedUntil": "2026-11-07T16:15:00.000Z" },
  "requestId": "b1f..."
}
```
- `code` es estable y es lo que el frontend debe usar para decidir qué mostrar. `message` está en español y es legible.
- Los códigos viven en `src/common/errors/error-codes.ts` y se listan en `docs/frontend/errores.md`.
- Errores de validación de DTO → `400` con `code: "VALIDATION_ERROR"` y `details` por campo.
- `details` es opcional: se omite cuando no hay errores por campo. `requestId` siempre está (también en el header `X-Request-Id`).
- `meta` es opcional (desde Fase 01): datos para la UI según el `code` (`lockedUntil`, `resendAvailableAt`, `attemptsRemaining`...). Se pasa con `new AppException(code, { meta })`. Nunca datos sensibles.
- Códigos genéricos del catálogo: `VALIDATION_ERROR`, `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND` (también rutas inexistentes), `CONFLICT`, `PAYLOAD_TOO_LARGE`, `BUSINESS_RULE_VIOLATION` (422), `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`. Los de dominio llevan prefijo (`AUTH_*`, `OFFER_*`...).
- Lanzar errores con `new AppException('<CODE>', { message?, details? })`. El filtro global también traduce errores de Prisma (P2002 → 409 `CONFLICT` con `details[].code = ALREADY_EXISTS`, P2025 → 404, P2003 → 409) y del throttler (429).

## Autenticación y roles

- `POST /auth/login` → `{ accessToken, tokenType, expiresIn, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, user }`. Acceso por header `Authorization: Bearer <token>`.
- Access token: JWT con `{ sub, email, roles, sid }` (`sid` = sesión = familia de refresh tokens). Lo valida `JwtAuthGuard` (APP_GUARD) y deja `request.user: AuthUser` (`@CurrentUser()`).
- `POST /auth/refresh` rota el refresh token (el anterior queda invalidado). Reusar uno ya rotado revoca la familia completa. `rememberMe` alarga la vida del refresh (`JWT_REFRESH_REMEMBER_TTL_DAYS`).
- Rutas protegidas por defecto (guards globales en `app.module.ts`: Throttler → JwtAuthGuard → RolesGuard); las públicas se marcan con `@Public()`.
- Auth **opcional** (Fase 02): `@OptionalAuth()` hace la ruta pública pero, si llega un Bearer válido, deja `request.user` (`@CurrentUser()` puede ser `undefined`). Token ausente/vencido/inválido → se atiende como anónimo (nunca 401). OpenAPI: `security: [{ bearer: [] }, {}]`. Úsalo en páginas públicas que se personalizan con sesión (catálogo y ficha).
- Roles (enum Prisma `Role`, ya declarado completo en Fase 01): `PARTICIPANT`, `SUPER_ADMIN`, `ACADEMIC_COORDINATOR`, `REVIEW_COMMITTEE`, `REVIEW_DECIDER`, `FOLLOW_UP`, `FINANCE`. Un usuario puede tener varios (`roles Role[]`). `@Roles(Role.X, ...)` exige al menos uno (403 si no). El panel (Fase 06) los usa; Fase 01 solo usa `PARTICIPANT` (y `SUPER_ADMIN` en el seed).
- Límites estrictos por IP con `@ThrottleRule(BUSINESS_RULES.AUTH_THROTTLE.X)` (`common/decorators/throttle-rule.decorator.ts`). El almacenamiento del throttler es en memoria (una instancia).
- Contraseñas: argon2id (`PasswordService` en `UsersModule`). OTP y refresh/reset tokens solo se guardan con hash.
- Nunca revelar si un recurso ajeno existe: acceso a recursos de otro usuario → `404` o `403` según la HU.

## Documentación para el frontend

- Cada endpoint: `@ApiTags`, `@ApiOperation({ summary, description })` (la descripción menciona la HU, p. ej. "HU-04"), respuestas documentadas incluyendo errores con sus `code`, ejemplos en los DTOs (`@ApiProperty({ example })`).
- `pnpm openapi:export` genera `openapi/openapi.json` sin levantar BD.
- `docs/frontend/README.md`: índice, cómo autenticarse, formato de errores, paginación, fechas y dinero.
- `docs/frontend/fase-XX-*.md`: por HU → endpoints, flujo paso a paso, estados de UI ↔ respuestas/códigos de error, tablas de enums con sus textos en español.

## Base de datos

- Desarrollo y pruebas: Postgres en `docker-compose.yml` (puerto host `5434`; BDs `eia_dev` y `eia_test`).
- Prisma 7: la URL NO va en `schema.prisma`. Las transacciones interactivas usan `maxWait` 10 s y
  `timeout` 15 s (`PrismaService`). El CLI la toma de `prisma.config.ts` (`DIRECT_URL` si existe, si no `DATABASE_URL`); la app usa `DATABASE_URL` con el driver adapter de `pg` en `PrismaService`. Importa tipos/enums de Prisma desde `src/generated/prisma/client`.
- Producción: Postgres administrado (recomendado Supabase; alternativa Neon o Railway Postgres). Solo se usa `DATABASE_URL` (+ `DIRECT_URL` para migraciones si hay pooler).
- Cada fase crea su migración con nombre descriptivo (`pnpm db:migrate --name fase01_identity`).
- `prisma/seed.ts` es idempotente: catálogos de referencia (siempre), usuarios demo (nunca con `NODE_ENV=production`), ofertas demo de Fase 02 y contenido demo del portal de Fase 03 (biblioteca, recursos, eventos; `SEED_DEMO_DATA`, por defecto solo fuera de producción) e inscripciones/asistencias/notificaciones del usuario demo (nunca en producción), y postulaciones demo
del usuario demo (Fase 04; nunca en producción, solo se crean si no existen). En producción corre compilado (`pnpm build:seed` → `dist/seed/prisma/seed.js`) desde `scripts/docker-entrypoint.sh` en cada arranque; cualquier seeder nuevo debe ser seguro de repetir en producción.

## Oferta formativa (Fase 02)

Módulo `src/modules/offers/`. Reglas puras en `policies/` (con pruebas unitarias):
`offer-status` (estado derivado), `viewer-currency` (moneda), `schedule-rule` (regla de horario JSON
validada con zod), `session-generation` (generación de sesiones HU-29 + festivos de México + reglas de
horas), `important-dates`, `scholarship` (tipos de beca de la oferta y montos), `offer-actions` (CTA de la ficha),
`catalog` (filtros/orden) y `public-topics` (temáticas HU-34).

Decisiones de modelo (`prisma/schema.prisma`):

- **Una fila `Offer` = una edición/cohorte** (fechas, precios, cupo propios). Una nueva generación se
  crea duplicando la oferta (HU-27 "Duplicar"). Enrollment/Application/Payment (Fases 03–05) apuntan a
  `Offer` (y la asistencia a `OfferSession`).
- **Estado público derivado, nunca guardado**: `publicationStatus` (DRAFT/PUBLISHED/ARCHIVED) es lo
  único persistido; "Inscripciones abiertas / Próximamente / cerradas / Finalizado" se calcula con
  `deriveOfferAvailability(fechas, now)`. Para `OPEN_CALL`, `enrollmentOpensAt/ClosesAt` es la
  ventana de **postulación**; la de becas es `scholarshipOpensAt/ClosesAt` (si es null, la de
  inscripción).
- Precios fijos por moneda en centavos (`priceMxnCents`, `priceUsdCents`; enum `Currency` para fases
  futuras). `isFree` para gratuitas. Moodle no muestra precio.
- Regla de horario en `Offer.scheduleRule` (JSON: `weekdays` ISO, `startTime`/`endTime` en hora CDMX,
  `excludedDates`, `excludeMexicanHolidays`); duración total en `totalMinutes`.
- **Sesiones vs. calendario**: `OfferSession` son las clases (generadas desde la regla o editadas una a
  una; `joinUrl` de participante, `hostUrl` solo panel, `recordingUrl`, `status` SCHEDULED/CANCELLED,
  `changeReason`, `originalStartsAt`, override de ventana de asistencia; única por `(offerId,
  startsAt)`). `CalendarEvent` son eventos manuales (webinars, comunidad) y fechas importantes
  automáticas (`kind`), con `audience` (ALL_REGISTERED / OFFER_ENROLLED). El calendario de Fase 03
  une ambas fuentes filtrando por inscripción y audiencia. La grabación vive en la sesión (HU-08/28).
- `OfferModule` y `ModuleResource` (PRESENTATION / PRE_READING / ACTIVITY) con `visibility`
  HIDDEN/PUBLISHED + `publishAt` (publicación programada): visible si PUBLISHED y `publishAt` es null o
  pasado. La ficha pública solo lista títulos/descripciones de módulos visibles; los recursos son de
  inscritos (Fase 03).
- Campos **privados** de la oferta (nunca en endpoints públicos): `whatsappGroupUrl`,
  `whatsappVisibleFrom`, `attendanceWindowHours`, y de las sesiones `joinUrl`/`hostUrl`/`recordingUrl`.
  El servicio público usa una lista blanca de columnas (`PUBLIC_OFFER_SELECT`).
- Catálogo: se cargan las ofertas publicadas y se filtran/ordenan/paginan en memoria (decenas de
  ofertas; el estado depende de `now` y la búsqueda ignora acentos). Si el volumen crece, mover el
  estado a SQL (`CASE` sobre fechas) y la búsqueda a `unaccent`/`pg_trgm`.
- Badge "Inscrito" y cupo: interfaz `OfferEnrollmentLookup` (token `OFFER_ENROLLMENT_LOOKUP`),
  implementada desde Fase 03 por `EnrollmentLookupService` (`useExisting` en `OffersModule`).
- Imágenes públicas (portada, carrusel, foto de docente): se guarda la key de storage (o una URL https
  absoluta). `StorageService.getPublicUrl` devuelve `${STORAGE_PUBLIC_BASE_URL}/${key}` si existe esa
  variable (bucket público/CDN, recomendado en prod) o una URL firmada de 7 días.

## Portal del participante (Fase 03)

Módulos (`src/modules/`): `notifications` (HU-13), `enrollments` (HU-07 + inscripción gratuita +
autorización del portal), `live-sessions` (HU-12/18 + jobs), `classroom` (HU-08/17 + proyecto final),
`calendar` (HU-10), `library` (HU-09) y `dashboard` (HU-06). Dependencias en un solo sentido:
`notifications` ← `enrollments` ← (`offers`, `live-sessions`, `calendar`, `library`) ← `classroom`,
`dashboard`. Reglas puras con pruebas en `*/policies/*.policy.ts` y `*.policy.ts`.

- **Enrollment** (única por `(userId, offerId)`): `status` PENDING_PAYMENT / ACTIVE / COMPLETED /
  SUSPENDED / CANCELLED, `origin` NAS/MOODLE, `source` (FREE_SIGNUP, PAYMENT, INSTALLMENTS, SCHOLARSHIP,
  OPEN_CALL, MOODLE_LIST, MOODLE_ACCESS_CODE, MANUAL) y `applicationId` (FK en Fase 04). Acceso al
  Aula = ACTIVE o COMPLETED (`CLASSROOM_ACCESS_STATUSES`); ocupan cupo ACTIVE, COMPLETED, SUSPENDED
  (`SEAT_HOLDING_STATUSES`). "Activa/Completada" en Mi formación se deriva también de `offer.endsAt`
  (sin cron). La inscripción gratuita bloquea la fila de la oferta (`SELECT … FOR UPDATE`) para el cupo.
- **Autorización** (`EnrollmentAccessService.requireClassroomAccess`): oferta inexistente o no publicada
  sin inscripción → 404; publicada sin acceso → 403 `ENROLLMENT_REQUIRED` (`meta.offerSlug`);
  suspendida → 403 `ENROLLMENT_SUSPENDED`. Recursos ocultos/ajenos → 404. Ids de ruta no UUID → 404
  (`uuidOr404`).
- **Sesión vista por el participante** (`live-sessions/session-view.ts`): selección sin `hostUrl`;
  `join_url` solo con `join.state = OPEN` (desde `SESSION_JOIN_WINDOW_MINUTES_BEFORE` antes del inicio
  hasta el fin); grabación solo para inscritos. Ventana de asistencia = `session.attendanceWindowHours
  ?? offer.attendanceWindowHours`, abre al terminar la sesión. Estado Pendiente/Registrada/No
  registrada **derivado** (no hay cron que cierre). `SessionAttendance` única por `(sessionId, userId)`.
- **Contenido visible**: `visibility = PUBLISHED` y `publishAt` null o pasado (módulo Y recurso). Archivos
  privados con `StorageService.getDownloadUrl` (URL firmada ~10 min), nunca `getPublicUrl`. Un recurso
  de módulo puede enlazar uno de la Biblioteca (`libraryResourceId`).
- **Calendario**: sesiones de ofertas con acceso + `CalendarEvent` (ALL_REGISTERED de ofertas publicadas o
  generales, OFFER_ENROLLED de mis ofertas) + actividades con `activityDueAt` (Fecha importante). Las
  canceladas se devuelven con `status = CANCELLED` y sin enlace (HU-10 §5.1). Rango máx. 62 días.
- **Proyecto final**: `Offer.finalProjectSubmissionEnabled` (carga opcional, Anexo A); flujo
  upload-url → PUT a storage → confirmación con `head()` (tipo y tamaño reales); key bajo
  `final-projects/{offerId}/{userId}/`; reemplazable hasta `finalProjectDueAt`.
- **Notificaciones**: `NotificationsService.notify({ userIds, type, title, body, action, data,
  priority?, email?, dedupeKey? })` crea la notificación in-app (omite duplicados por
  `(userId, dedupeKey)`) y envía el correo con `MailService` (fallo de correo → `emailStatus = FAILED`,
  nunca rompe el flujo). `email: false` = solo portal ("En revisión"). Prioridad alta (cobro fallido,
  mora) → `pinned` hasta `resolve()`. Rutas del frontend en `notifications/portal-links.ts`.
- **Jobs** (`@nestjs/schedule` 6.x — la 12 es solo-ESM; `PortalJobsService`, cada 5 min, solo con
  `SCHEDULER_ENABLED=true`): aviso "registro de asistencia abierto" al terminar cada sesión y "grupo de
  WhatsApp disponible" al llegar `whatsappVisibleFrom`. Idempotentes: claim atómico
  (`attendanceNotifiedAt` / `whatsappNotifiedAt`) + `dedupeKey`.
- **Dashboard**: compone bloques en paralelo; un bloque que falla llega `null` y en `failedBlocks`.

## Postulaciones (Fase 04)

Módulo `src/modules/applications/` (HU-19, 20, 21). Dependencias: `applications` → (`enrollments`,
`notifications`, `locations`); `offers`, `calendar` y `dashboard` importan `applications` (nunca al revés).
Reglas puras con pruebas en `applications/policies/`: `application-status` (máquina de estados, acción
contextual, línea de tiempo), `application-rules` (tipo, ventana, elegibilidad, validación de envío,
evidencias, folio, % asignado, saldo y plazos) y `application-messages` (textos de notificación).

- **Application** (única por `(userId, offerId)` = una por cohorte). El tipo se deriva de la oferta:
  diplomado NAS con beca → `SCHOLARSHIP`; convocatoria NAS → `OPEN_CALL`. Folio legible derivado de un
  consecutivo (`BEC-000123` / `CONV-000123`). Datos de contacto: foto del perfil (se refresca al guardar y
  al enviar); al enviar se guardan `currency` (país del perfil) y `originalAmountCents`.
- **Estados** (`ApplicationStatus`): `DRAFT → SUBMITTED → IN_REVIEW → INTERVIEW_SCHEDULED →
  APPROVED_PENDING_PAYMENT | APPROVED_PENDING_CONFIRMATION | NOT_SELECTED`; aprobadas → `ENROLLED` o
  `EXPIRED`; `EXPIRED → APPROVED_*` (extender plazo, HU-32). Cada transición declara qué actor la puede
  hacer (`PARTICIPANT`, `STAFF`, `SYSTEM`); `ApplicationWorkflowService.transition()` la aplica con
  update condicionado al estado previo + `ApplicationStatusEvent` (historial con actor y nota interna)
  + efectos (inscripción) en una transacción, y notifica después del commit
  (`dedupeKey = app-status:{id}:{estado}:{eventId}`; "En revisión" con `email: false`).
- **Inscripción**: al aprobar con saldo se crea/reutiliza la `Enrollment` en `PENDING_PAYMENT`
  (`source` SCHOLARSHIP/OPEN_CALL, `applicationId` con FK); `markEnrolled()` (Fase 05) la activa. Sin
  costo, la persona confirma (`POST /me/applications/{id}/confirm`) y queda `ACTIVE`. Al vencer se
  cancela la reserva. Si ya tenía una inscripción vigente por otra vía no se toca.
- **Plazo** (`responseDueAt`): `PAYMENT_DEADLINE_AFTER_APPROVAL_DAYS` (o
  `OPEN_CALL_CONFIRMATION_DEADLINE_DAYS`) desde la decisión, sin superar el inicio de la oferta.
  `pendingTransferSince` (lo administra la Fase 05 con `setPendingTransfer`) impide el vencimiento.
- **Entrevistas** (`ApplicationInterview`): la vigente es la más reciente no cancelada; reprogramar
  cancela la anterior. `join` con las reglas de HU-12 (`INTERVIEW_JOIN_WINDOW_MINUTES_BEFORE`). Aparecen
  en el calendario como fecha importante (`source = APPLICATION`).
- **Evidencias** (`ApplicationDocument`): upload-url → PUT → confirmación con `head()` (tipo/tamaño
  reales), key bajo `applications/{applicationId}/evidence/`; editable solo en borrador.
- **Jobs** (`ApplicationJobsService`, `APPLICATION_JOBS_CRON`, `SCHEDULER_ENABLED`): vencimientos
  (`expireIfDue`, condición atómica), recordatorio de saldo (claim `dueReminderSentAt`) y de entrevista
  (claim `reminderSentAt`). Idempotentes.
- **Ficha** (HU-16): `OfferApplicationLookup` (token `OFFER_APPLICATION_LOOKUP`, implementado por
  `ApplicationLookupService`) → `viewer.application` y acciones `VIEW_APPLICATION` / `PAY_BALANCE`.
- `ApplicationWorkflowService`: `startReview`, `scheduleInterview`, `completeInterview`,
  `cancelInterview`, `approve`, `reject`, `extendDeadline` (los usa el panel desde la Fase 06).

## Pagos y acceso Moodle (Fase 05)

Módulos: `payments` (HU-22, 23, 24, 26 + "Mis pagos" de HU-14) y `moodle` (HU-25); adaptador
`infra/stripe`. Dependencias: `payments` → (`applications`, `enrollments`, `notifications`) + puerto
`PAYMENT_GATEWAY` (`StripeModule`, global); `dashboard` importa `payments`; `auth` importa `moodle`
(vinculación al verificar el correo); `moodle` → (`enrollments`, `notifications`). Reglas puras con
pruebas en `payments/policies/` (`payment-amounts`, `installment-collection`, `payment-status`,
`checkout`, `transfer`, `payment-messages`) y `moodle/policies/moodle-code`.

- **Puerto `PaymentGateway`** (`infra/stripe/payment-gateway.ts`): el dominio no importa el SDK.
  `StripePaymentGateway` lo implementa; las e2e usan `test/utils/fake-payment-gateway.ts`, que firma
  payloads reales con `stripe.webhooks.generateTestHeaderString`. Sin `STRIPE_SECRET_KEY` la app
  arranca y los checkouts responden `503 PAYMENTS_NOT_CONFIGURED` (la transferencia sigue).
- **Payment** = un cobro o comprobante con folio `PAG-000123` (`concept` FULL_PRICE / BALANCE /
  INSTALLMENT, `method` CARD / BANK_TRANSFER). Montos SIEMPRE calculados por el servidor: precio fijo
  por moneda del perfil (`offerPriceFor`) o `Application.balanceCents` en la moneda de la postulación.
- **Stripe Checkout** (`mode=payment`, `allowed_payment_method_types: ['card']`, sesión de 30 min,
  clave idempotente `checkout:{paymentId}`). Regreso a `PORTAL_URL/pagos/resultado`. La
  consulta `GET /me/payments/{id}` concilia con Stripe si el webhook tarda.
- **Webhook** `POST /api/v1/webhooks/stripe`: `app.setup.ts` monta `express.raw()` SOLO en esa ruta
  (el parser JSON de Nest la omite porque el cuerpo ya se leyó); firma con `constructEvent`;
  idempotencia con la tabla `stripe_events` (`processedAt`; error → 500 y Stripe reintenta); todas las
  transiciones son updates condicionados al estado previo (`payment-status.policy`), así los eventos
  repetidos o fuera de orden no retroceden un pago (`expired` tras `completed`, `payment_intent.*`
  antes de `checkout.session.completed`, intento viejo fallido tras uno nuevo).
- **Confirmación** (`PaymentLedgerService.markPaid`): sin postulación → inscripción ACTIVE con
  `source` PAYMENT / INSTALLMENTS; con postulación → `ApplicationWorkflowService.markEnrolled`
  (conserva `source` SCHOLARSHIP / OPEN_CALL para el embudo). `EXPIRED → ENROLLED` está permitido al
  SISTEMA (pago abierto antes del vencimiento y confirmado después). Notificación PAYMENT_CONFIRMED.
- **Cuotas = plan PROPIO** (`InstallmentPlan` + `Installment`), no Subscriptions/Subscription
  Schedules: los montos no salen de un Price fijo (saldo tras beca, ajuste en la última cuota), las
  fechas dependen del fin de la oferta y los estados son de negocio (Al día / Cobro fallido / En mora
  / suspensión). La 1.ª cuota se cobra en Checkout con `setup_future_usage=off_session` (guarda la
  tarjeta, 3-D Secure); las demás las cobra el job con PaymentIntents off-session
  (`installment:{id}:attempt:{n}` idempotente). Reintentos: `INSTALLMENT_RETRY_ATTEMPTS` repartidos en
  `INSTALLMENT_RETRY_WINDOW_DAYS` (días 3, 5, 7). Mora: `DELINQUENCY_AFTER_DAYS` desde el primer fallo →
  DELINQUENT + PLAN_DELINQUENT y, con `SUSPEND_ACCESS_ON_DELINQUENCY`, inscripción SUSPENDED
  (`plan.accessSuspendedAt`). Regularizar (reintento, [Pagar ahora] o tarjeta nueva con Checkout
  `setup`) → CURRENT, `notifications.resolve` por prefijo (`plan-failed:{planId}:`,
  `plan-delinquent:{planId}:`) y reactivación. Avisos fijados: INSTALLMENT_FAILED (uno por cuota),
  PLAN_DELINQUENT.
- **Cupo** (`seatHoldingWhere`): ocupan cupo ACTIVE/COMPLETED/SUSPENDED y las reservas
  PENDING_PAYMENT con `seatHoldExpiresAt` null o futura. Checkout → hold hasta que vence la sesión
  (webhook `checkout.session.expired` o el job lo cancelan); saldo tras beca → `null` (retiene hasta
  que la postulación vence o se paga; con comprobante pendiente no vence).
- **Transferencia** (solo México, saldo en MXN, una exhibición): datos bancarios por variables de
  entorno (`BANK_TRANSFER_*`); comprobante con URL firmada + `head()` (PDF/JPG/PNG ≤ 15 MB, key bajo
  `payments/transfers/{applicationId}/`); "Pendiente de validación" con `setPendingTransfer`
  (reemplazable); `TransfersService.approveTransfer` / `rejectTransfer` listos para la Fase 06 (monto
  recibido ≥ esperado; rechazo con motivo → `markTransferRejected`).
- **Recibo**: PDF propio (`common/utils/simple-pdf.ts`, sin dependencias, WinAnsi) con folio, fecha,
  concepto, monto, moneda y método; sirve para tarjeta y transferencia (el `receipt_url` de Stripe se
  expone además como `stripeReceiptUrl`). No es CFDI.
- **Moodle** (sin API): `MoodleRosterEntry` (lista por oferta, correo normalizado) y
  `MoodleAccessCode` (XXXX-XXXX, un solo uso, solo hash, vence con la cohorte). Vincular =
  inscripción ACTIVE origin MOODLE (`source` MOODLE_LIST / MOODLE_ACCESS_CODE) + notificación
  MOODLE_ENROLLMENT_LINKED; ocurre al verificar el correo, al cargar la lista
  (`MoodleAccessService.importRoster`, Fase 06) o con `POST /me/moodle-access/link|redeem`.
- **Jobs** (`PaymentJobsService`, `PAYMENT_JOBS_CRON`, `SCHEDULER_ENABLED`): cobro de cuotas vencidas
  y reintentos (claim atómico de la cuota), mora, aviso de cuota próxima (claim
  `upcomingNotifiedAt`) y conciliación de checkouts vencidos.
- **Acciones**: ficha (`CONTINUE_PAYMENT`, `PAYMENT_IN_VALIDATION`, `REGULARIZE_PAYMENT`, vía
  `OfferEnrollmentLookup.enrollmentStatesForUser`) y postulación (`CONTINUE_PAYMENT`,
  `UPLOAD_TRANSFER_PROOF`, `PAYMENT_IN_VALIDATION`, desde `paymentStartedAt` / `pendingTransferSince` /
  `transferRejectedAt`).
- `TransfersService.approveTransfer/rejectTransfer`, `InstallmentCollectionService.chargeInstallment`
  (reintentar), `PaymentLedgerService.markDelinquent`, `EnrollmentsService.suspendForDelinquency/
  restoreAccess` y `MoodleAccessService.importRoster/generateCodes` los usa el panel (Fase 06).

## Panel administrativo (Fase 06)

HU-27 a HU-33 bajo `/api/v1/admin/...`. Los controladores admin viven DENTRO de cada dominio
(`src/modules/<dominio>/admin/admin-*.controller.ts` + `admin-*.service.ts` + `dto/admin-*.dto.ts` +
`policies/`), así reutilizan sus servicios sin dependencias nuevas entre módulos. DTOs de admin
separados de los públicos/portal (pueden exponer `hostUrl`, notas internas, evaluaciones, etc.).

- **Permisos**: matriz rol → permisos en `src/config/permissions.ts` (único lugar). Los endpoints
  declaran `@RequirePermissions(Permission.X)`; el `PermissionsGuard` global (después de JwtAuthGuard y
  RolesGuard) lee los roles y el estado ACTUALES de la BD (un rol retirado o una cuenta deshabilitada
  pierden el acceso en la siguiente petición, sin esperar al vencimiento del JWT), exige TODOS los
  permisos (403 `FORBIDDEN` + `meta.missingPermissions`) y deja en `request.user` un `AdminUser`
  (roles frescos + `permissions`). OpenAPI: `x-required-permissions`. `GET /admin/me` da al frontend
  roles y permisos.
- **Equipo** (`users/admin`): no hay alta desde el panel; la persona se registra (HU-02/03) y un
  SUPER_ADMIN asigna roles (`PUT /admin/users/{id}/roles`) o deshabilita la cuenta (revoca sus
  refresh tokens). Reglas puras: nadie se quita su SUPER_ADMIN ni se deshabilita; siempre queda ≥ 1
  SUPER_ADMIN activo (lock advisory en la transacción).
- **Primer SUPER_ADMIN**: `prisma/bootstrap-admin.ts` (lo llama el seed con `BOOTSTRAP_ADMIN_*` solo si
  no hay ningún SUPER_ADMIN activo; si el correo existe lo promueve sin tocar su contraseña) y el CLI
  `pnpm admin:create` (`prisma/create-admin.ts`, compilado a `dist/seed/prisma/create-admin.js`).
- **Auditoría**: `AuditModule` global; `AuditService.record({ actor, action, entityType, entityId,
  summary, before, after }, tx?)` en TODA acción de escritura del panel (dentro de la transacción
  cuando la hay). Tabla `admin_audit_logs`; `changes` guarda solo los campos cambiados
  (`audit.policy.summarizeChanges`: recorta textos/arreglos, nunca hashes/tokens/`hostUrl`). Acciones
  estables `dominio.verbo` (`offer.publish`, `transfer.validate`…). `GET /admin/audit-logs`.
- **Archivos del panel**: imágenes de difusión con keys `public/...` (si existe `STORAGE_PUBLIC_BUCKET`
  van a ese bucket; `StorageService.bucketFor`), materiales privados con cualquier otra key. Mismo
  flujo upload-url → PUT → confirmación con `head()`.
- **Exportaciones**: CSV compatible con Excel (`common/utils/csv.ts`: BOM UTF-8, CRLF, celdas que
  empiezan con `= + - @` neutralizadas).
- **Ofertas (HU-27/28, `offers/admin`, `moodle/admin`)**: asistente de 7 pasos con un `PATCH
  /admin/offers/{id}/steps/<paso>` por paso (autoguardado: datos incompletos permitidos, solo formato
  → 400); validación pura por paso (`offer-wizard.policy`) en `wizard.steps[].issues`; publicar exige
  pasos 1–4 (422 `OFFER_INCOMPLETE`). Tipo/modalidad/origen bloqueados con inscritos o postulaciones.
  Duplicar = nueva cohorte (contenido, docentes, módulos y recursos ocultos; sin fechas ni sesiones).
  Contenido del aula: al quedar visible un módulo/recurso con `notifyEnrollees` se notifica una vez
  (claim de `publishedNotifiedAt` + `dedupeKey material:*`); la publicación programada la avisa
  `AdminContentJobsService` (cron, `SCHEDULER_ENABLED`). Moodle: lista por CSV/JSON → `importRoster`.
- **Sesiones y asistencia (HU-29/30, `live-sessions/admin`, `calendar/admin`)**: vista previa y
  "Crear sesiones" con `generateSessions` + `validateOfferHours` (bloquean conflictos, 0 sesiones y
  curso > 9 h; diplomado ≠ 60 h es advertencia), todo en una transacción junto con las fechas
  importantes (`buildImportantDates`, una por tipo). Reprogramar/cancelar con motivo notifica con la
  hora de cada zona (`dedupeKey session-*`); la grabación notifica una vez (`recording:{id}`).
  Asistencia manual = `SessionAttendance` `MANUAL` con `recordedById`/`manualReason`; % = asistidas ÷
  sesiones ya realizadas no canceladas; exportación CSV.
- **Postulaciones (HU-31/32, `applications/admin`)**: todas las transiciones pasan por
  `ApplicationWorkflowService` (abrir el detalle hace `startReview`); evaluaciones por integrante
  (`ApplicationEvaluation`), notas de seguimiento (`ApplicationFollowUpNote`, recordatorio máx. 1/24 h y
  WhatsApp wa.me generan nota automática); `participantMessage` agrega un párrafo editable al aviso de
  la decisión; `NotificationsService.retryEmail` reintenta un correo `FAILED`. Embudo puro
  (`computeFunnel`) sobre `submittedAt`/estado/`paymentStartedAt`/`enrolledAt`.
- **Pagos (HU-33, `payments/admin`)**: lectura para todo el staff, acciones con `payments.manage`.
  Reutiliza `TransfersService`, `payNow`, `markDelinquent`, `suspendForDelinquency`/`restoreAccess`.
  Suspensión manual marca `plan.accessSuspendedAt` (se restablece sola al regularizar). Reembolsos:
  `PaymentRefund` + `PaymentGateway.refundPayment` (Stripe, clave idempotente `refund:{id}`) o registro
  de reembolso de transferencia; el webhook `charge.refunded` concilia los pendientes.
  `SUSPEND_ACCESS_ON_DELINQUENCY` sigue en `true` (automática) aunque HU-33/Anexo A dicen manual: pendiente
  de decisión del cliente (ver la guía).

## Tipos de beca parametrizables

Módulo `src/modules/scholarship-types/` (catálogo público `GET /scholarship-types` + CRUD
`/admin/scholarship-types`, permiso `scholarship_types.write` solo SUPER_ADMIN; lectura con
`offers.read`). Reemplaza al antiguo enum `ScholarshipLevel` (migración `20261023120000_scholarship_types`,
que creó los 5 tipos iniciales con las mismas keys y migró ofertas, postulaciones y evaluaciones).

- `ScholarshipType`: `key` estable e inmutable (MAYÚSCULAS_CON_GUION_BAJO), `name`, `description`,
  `minPercent`/`maxPercent` (1 ≤ min ≤ max ≤ 100, CHECK en BD; fijo si son iguales), `requiresInterview`,
  `active`, `sortOrder`. Solo se borra si nada lo usa (FKs `RESTRICT` → 409 `SCHOLARSHIP_TYPE_IN_USE`);
  desactivar = no se ofrece en ofertas/postulaciones nuevas, lo asignado se conserva.
- `OfferScholarshipType` (puente, PK `(offerId, scholarshipTypeId)`, `CASCADE` desde la oferta):
  `minPercent`/`maxPercent` opcionales sobrescriben el rango SOLO en esa oferta; rango efectivo =
  override ?? tipo (`scholarship-type.policy.effectiveRange`). La ficha y el formulario solo muestran los
  tipos activos (`scholarshipOptions`); una oferta sin tipos activos no ofrece beca (`offersScholarship`).
- `Application.requestedScholarshipTypeId` / `assignedScholarshipTypeId` (+ snapshot
  `assignedScholarshipTypeName` al aprobar) y `ApplicationEvaluation.suggestedScholarshipTypeId`.
  `assignedPercent` es el % final del comité, validado contra el rango efectivo
  (`application-rules.policy.resolveScholarshipAssignment`).
- Entrevista: convocatorias siempre; becas según `requiresInterview` del tipo asignado o, sin decisión,
  del solicitado (`interviewRequired`, `applicationRequiresInterview`).
- Respuestas: todo `scholarshipTypeId` va acompañado de un resumen `{ id, key, name, minPercent,
  maxPercent, requiresInterview }` con el rango de la oferta (`summaryInOffer` / `assignedSummary`).
- **Cupo** (`scholarship-quota.policy` + `scholarship-quota.ts`): `ScholarshipType.maxRecipients` (global)
  y `OfferScholarshipType.maxRecipients` (tope por oferta), null = sin límite, CHECK ≥ 1. Cupo usado =
  postulaciones con `assignedScholarshipTypeId` en `SCHOLARSHIP_SEAT_STATUSES` (APPROVED_PENDING_PAYMENT,
  APPROVED_PENDING_CONFIRMATION, ENROLLED); se calcula, nunca se guarda (vencer/no seleccionar libera solo).
  Aprobar y reactivar una vencida verifican el cupo dentro de la transacción de la transición
  (`lockAndAssertScholarshipQuota`: `SELECT … FOR NO KEY UPDATE` sobre el tipo y la fila puente; NO KEY
  porque la FK de la postulación ya tomó KEY SHARE y `FOR UPDATE` provocaría deadlock) → 409
  `SCHOLARSHIP_TYPE_FULL`. `EXPIRED → ENROLLED` por pago tardío (SISTEMA) no se bloquea.
- El seed crea los tipos por defecto solo si el catálogo está vacío (`seedScholarshipTypes`; un tipo borrado desde el panel no reaparece).

## Reuniones generadas: Zoom / Google Meet

Apoyo a HU-29 (sesiones en vivo) y HU-31 (entrevistas): el panel puede **generar** la reunión con el
botón "Generar enlace" en lugar de pegar el enlace a mano. Endpoints `/admin/meetings` (módulo
`src/modules/meetings/`, permiso `meetings.create`: SUPER_ADMIN, ACADEMIC_COORDINATOR, REVIEW_COMMITTEE,
REVIEW_DECIDER). Guía frontend: `docs/frontend/fase-07-reuniones.md`.

- **Sin estado propio**: no hay tabla nueva. `POST /admin/meetings` crea la reunión en el proveedor y
  devuelve `{ provider, externalId, joinUrl, hostUrl, password, startAt, durationMinutes }`; el panel
  copia los enlaces al formulario y los envía con los endpoints de siempre (sesiones / entrevistas, sin
  cambios). Si el usuario descarta, `DELETE /admin/meetings/{provider}/{externalId}` (idempotente).
  Alta y cancelación quedan en la auditoría (`meeting.create` / `meeting.cancel`, `entityType =
  Meeting`, `entityId = PROVIDER:externalId`; `hostUrl` nunca se audita).
- **Puerto `MeetingGateway`** (`infra/meetings/meeting-gateway.ts`, token `MEETING_GATEWAY`,
  `MeetingsInfraModule` global): `ProviderMeetingGateway` compone `ZoomMeetingProvider` y
  `GoogleMeetProvider`; cada uno se habilita solo si TODAS sus variables están presentes (`env.schema`
  rechaza un proveedor a medias). Sin variables la app arranca igual: `GET /admin/meetings/providers`
  los marca `enabled: false` y las llamadas responden 503 `MEETING_PROVIDER_NOT_CONFIGURED`. Las e2e
  usan `test/utils/fake-meeting-gateway.ts`.
- **Sin SDKs**: `fetch` nativo con `AbortSignal.timeout` (`MEETING_PROVIDER_TIMEOUT_SECONDS`); los
  tokens OAuth se cachean en memoria (`OAuthTokenCache`, renovación `MEETING_TOKEN_REFRESH_MARGIN_SECONDS`
  antes de vencer; un 401 invalida el token y reintenta una vez). Fallos de red, timeouts y respuestas
  inesperadas → 502 `MEETING_PROVIDER_ERROR` (`meta.provider`). Los logs solo llevan método/ruta,
  status y el mensaje del proveedor: nunca tokens, secretos, cuerpos ni la llave.
- **Zoom** (Server-to-Server OAuth): token `POST https://zoom.us/oauth/token?grant_type=account_credentials`
  (Basic auth); `POST /v2/users/{ZOOM_HOST_USER|me}/meetings` (tipo 2, sala de espera, sin entrar antes
  que el anfitrión). `start_url` (`hostUrl`) **caduca** (≈2 h): `GET
  /admin/meetings/ZOOM/{id}/host-url` hace `GET /v2/meetings/{id}` y devuelve uno nuevo. Cancelar =
  `DELETE /v2/meetings/{id}` (404 = ya no existe).
- **Google Meet** (Calendar API + cuenta de servicio con delegación de dominio): aserción JWT RS256
  firmada con `node:crypto` (`google-jwt.ts`), intercambio en `https://oauth2.googleapis.com/token`
  con scope `calendar.events`; evento con `conferenceDataVersion=1` y `conferenceData.createRequest`
  (`hangoutsMeet`). `joinUrl` = `hostUrl` = `hangoutLink` (si la sala queda "pending" se relee el
  evento; si falla, se borra el evento y 502). Cancelar = borrar el evento (404/410 = OK).
- Los enlaces generados se validan con `isZoomUrl` / `isMeetingUrl` (`common/utils/urls.ts`). Las
  entrevistas (HU-31) solo aceptan zoom.us: `providers[].usableForInterviews` lo indica a la UI.

## Reglas de negocio configurables

`src/config/business-rules.ts` centraliza valores del Anexo A (zona oficial `America/Mexico_City`, OTP 6 dígitos y su expiración, cooldown de reenvío, intentos máximos y bloqueo, ventana de asistencia por defecto 24 h, plazo de pago tras beca 7 días, mora 15 días, cuotas 2–4, límites de archivos, etc.). Los **tipos de beca** NO están aquí: son datos administrables (ver "Tipos de beca parametrizables").

## Pruebas

- Unitarias para reglas puras (cálculo de saldo, generación de sesiones, % de progreso, transiciones de estado).
- e2e: para leer correos (OTP) sobrescribe el driver: `createTestApp({ customize: (b) => b.overrideProvider(MAIL_DRIVER).useValue(new MailCapture()) })` (`test/utils/mail-capture.ts`). Helpers de identidad en `test/utils/identity.ts` (`createVerifiedUser`, `login`, `randomIp` para aislar el throttler con `X-Forwarded-For`). El global-setup aplica migraciones **y el seed** a `eia_test`.
- e2e por endpoint principal con supertest contra BD de prueba (`.env.test` → `eia_test`; `test/setup/global-setup.ts` aplica `prisma migrate deploy`; se resetea con `prisma migrate reset --force` o truncado). Usa `createTestApp()` (`test/utils/create-test-app.ts`), que aplica la misma configuración HTTP que producción.
- `pnpm test:e2e` corre Jest con `--experimental-vm-modules` (Prisma 7 carga su query compiler con `import()` dinámico).
- `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build` deben pasar antes de cerrar una fase.
- Fase 06: `test/utils/admin.ts` (`createStaffUser(app, mail, roles)`). `E2E_DATABASE_URL` (una BD
  `*_test`) permite correr suites en paralelo en BDs distintas.
