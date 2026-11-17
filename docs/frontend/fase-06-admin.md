# Fase 06 — Panel administrativo

Guía para implementar en el frontend el **panel del equipo de la Escuela** (Fase 3 del documento de
HUs): **HU-27** (crear y editar ofertas con el asistente de 7 pasos), **HU-28** (módulos y recursos del
aula), **HU-29** (generación automática de sesiones y calendario), **HU-30** (control de asistencia),
**HU-31** (revisión de postulaciones en equipo), **HU-32** (embudo y seguimiento de postulación a
inscripción) y **HU-33** (pagos, cuotas, transferencias y reembolsos), más el acceso por roles, la
gestión de roles del equipo y la auditoría.

- Convenciones generales (errores, fechas, dinero, paginación): [`README.md`](README.md)
- Códigos de error: [`errores.md`](errores.md#fase-06--panel-administrativo)
- Contrato exacto: [`openapi/openapi.json`](../../openapi/openapi.json) o `http://localhost:3000/docs`
  (tags **Admin – …**). Cada operación trae `x-required-permissions` con el permiso que exige.

Todas las rutas llevan el prefijo `/api/v1/admin` y **requieren sesión** (`Authorization: Bearer`, el
mismo login del portal) **y permiso** (403 `FORBIDDEN` con `meta.missingPermissions`). Los listados
usan `{ data, meta }` con `page`/`pageSize`, filtros y `sort`. Los DTOs del panel son distintos a los del
portal: incluyen datos internos (enlace de anfitrión, notas, evaluaciones, contacto) que el portal nunca
recibe.

## Índice

1. [Acceso al panel, roles y permisos](#acceso-al-panel-roles-y-permisos) (matriz, equipo, auditoría)
2. [HU-27 / HU-28 — Ofertas, asistente de 7 pasos, docentes, imágenes, contenido del aula y Moodle](#hu-27--hu-28--ofertas-docentes-imágenes-contenido-del-aula-y-moodle)
3. [HU-29 / HU-30 — Sesiones, calendario y asistencia](#hu-29--sesiones-y-calendario-del-panel--hu-30--asistencia)
4. [HU-31 / HU-32 — Revisión de postulaciones y seguimiento](#hu-31--revisión-de-postulaciones-en-equipo)
   - [Tipos de beca (parametrizables)](#tipos-de-beca-parametrizables)
5. [HU-33 — Pagos, cuotas, transferencias y reembolsos](#hu-33--gestión-de-pagos-cuotas-y-transferencias-admin--pagos)
6. [HU-38 — Bandeja de Contacto](#hu-38--bandeja-de-contacto)
7. [Datos demo](#datos-demo)

## Acceso al panel, roles y permisos

### Cómo entra el equipo

1. La persona inicia sesión con el login normal (`POST /auth/login`, HU-04). No hay un login aparte.
2. Al entrar a `/panel` el frontend llama `GET /admin/me`:
   - `403 FORBIDDEN` → no es del equipo: redirige al portal (HU-27: "el sistema le niega el acceso").
   - `200` → `{ user, roles, permissions }`: arma el menú y los botones con `permissions`.
3. Cada endpoint del panel vuelve a validar el permiso (403 `FORBIDDEN` con
   `meta.missingPermissions: ['payments.manage']`). Ocultar botones es solo UX.
4. Los roles se leen de la BD en cada petición del panel: si un SUPER_ADMIN cambia el rol de alguien o
   deshabilita su cuenta, el cambio aplica en la siguiente petición (sin esperar al refresh).

En OpenAPI cada operación del panel trae `x-required-permissions: ["…"]`.

### Matriz rol → permisos

Fuente única: `src/config/permissions.ts` (`GET /admin/roles` la devuelve con textos).

| Permiso | Qué habilita (HU) | SUPER_ADMIN | ACADEMIC_COORDINATOR | REVIEW_COMMITTEE | REVIEW_DECIDER | FOLLOW_UP | FINANCE |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin.access` | Entrar al panel (`GET /admin/me`, `/admin/roles`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `offers.read` | Ver ofertas, docentes, módulos, sesiones y calendario del panel (27–29) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `offers.write` | Asistente de ofertas, docentes, imágenes, módulos/recursos, sesiones, eventos, lista Moodle (27–29) | ✔ | ✔ | | | | |
| `offers.publish` | Publicar, despublicar, archivar, duplicar, borrar borrador (27) | ✔ | ✔ | | | | |
| `attendance.read` | Asistencia por sesión / por participante y exportar (30) | ✔ | ✔ | | | | |
| `attendance.write` | Marcar/desmarcar manual, "Recordar a pendientes" (30) | ✔ | ✔ | | | | |
| `applications.read` | Bandeja y detalle de postulaciones, exportar (31) | ✔ | ✔ | ✔ | ✔ | ✔ | |
| `applications.evaluate` | Mi evaluación (31) | ✔ | ✔ | ✔ | ✔ | | |
| `applications.interview` | Agendar / "Realizada" / cancelar entrevista (31) | ✔ | ✔ | ✔ | ✔ | | |
| `applications.decide` | "Registrar decisión" y "Reintentar envío" (31) | ✔ | ✔ | | ✔ | | |
| `followup.read` | Embudo, aprobados sin pagar, vencidas, contacto (32) | ✔ | ✔ | | | ✔ | |
| `followup.manage` | Recordatorio, WhatsApp, notas, extender plazo, cerrar inscripciones (32) | ✔ | ✔ | | | ✔ | |
| `payments.read` | Pagos, transferencias, planes y reembolsos en solo lectura (33) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `payments.manage` | Validar/rechazar, reintentar, mora, suspender/restablecer, cancelar plan, reembolsar (33) | ✔ | | | | | ✔ |
| `users.manage` | Roles y estado de las cuentas del equipo | ✔ | | | | | |
| `audit.read` | Registro de auditoría | ✔ | | | | | |
| `site.write` | Cifras de la landing (`/admin/site/metrics`) | ✔ | | | | | |
| `scholarship_types.write` | Crear, editar, desactivar y borrar tipos de beca (`/admin/scholarship-types`). La lectura usa `offers.read` | ✔ | | | | | |
| `contact.read` | Bandeja de mensajes de Contacto y contadores (38) | ✔ | ✔ | | | ✔ | |
| `contact.manage` | Cambiar estado / nota interna de un mensaje (38) | ✔ | ✔ | | | ✔ | |
| `meetings.create` | "Generar enlace" de Zoom / Google Meet para sesiones y entrevistas (`/admin/meetings`, ver [fase-07-reuniones.md](./fase-07-reuniones.md)) (29, 31) | ✔ | ✔ | ✔ | ✔ | | |

Reglas de las HU que resuelve la matriz:
- HU-31: "integrante sin permiso de decisión… puede evaluar y comentar, pero no ve Registrar decisión"
  → REVIEW_COMMITTEE no tiene `applications.decide`.
- HU-32: "sin permiso de seguimiento… se le niega el acceso y no ve datos de contacto" → sin
  `followup.read` todo `/admin/funnel/...` y los datos de seguimiento responden 403.
- HU-33: "sin el rol de Administración y finanzas… solo puede consultar" → todo el equipo tiene
  `payments.read`; solo FINANCE (y SUPER_ADMIN) tiene `payments.manage`.
- Anexo A HU-31 ("la decisión la registra un rol con permiso, p. ej. Coordinación") → COORDINATOR y
  REVIEW_DECIDER deciden. Si el cliente quiere otro reparto se cambia solo la matriz.

Textos de los roles (`Role`):

| Valor | Texto |
|---|---|
| `PARTICIPANT` | Participante |
| `SUPER_ADMIN` | Superadministración |
| `ACADEMIC_COORDINATOR` | Coordinación académica |
| `REVIEW_COMMITTEE` | Comité de revisión |
| `REVIEW_DECIDER` | Comité de revisión (con decisión) |
| `FOLLOW_UP` | Seguimiento de inscripciones |
| `FINANCE` | Administración y finanzas |

### Equipo: asignar roles y deshabilitar cuentas (SUPER_ADMIN)

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /admin/me` | `admin.access` | Mi usuario, roles y permisos |
| `GET /admin/roles` | `admin.access` | Catálogo de roles con sus permisos y textos |
| `GET /admin/users?q=&role=&status=&staffOnly=&sort=` | `users.manage` | Buscar cuentas (paginado) |
| `PUT /admin/users/{id}/roles { roles: [...] }` | `users.manage` | Reemplaza los roles del equipo (`PARTICIPANT` se conserva) |
| `POST /admin/users/{id}/disable { reason? }` | `users.manage` | Deshabilita la cuenta y cierra sus sesiones |
| `POST /admin/users/{id}/enable { reason? }` | `users.manage` | La vuelve a habilitar |
| `POST /admin/users/{id}/verify-email { reason? }` | `users.manage` | Marca el correo como verificado sin OTP (`PENDING_VERIFICATION` → `ACTIVE`; ya verificada → `409 AUTH_ALREADY_VERIFIED`) |

- `AdminUserDto.emailVerifiedAt` (`null` = nunca verificó): muestra la etiqueta "Correo sin verificar"
  y el botón [Marcar correo como verificado] (auditoría `user.verify-email`).
- Si todavía nadie puede entrar al panel (ninguna cuenta verificada), en el servidor:
  `pnpm users:verify --domain <dominio> --staff-only [--dry-run]` o `--email <correo>` (en producción:
  `node dist/seed/prisma/verify-users.js ...`).

- **Alta del equipo**: no hay "invitar" desde el panel. La persona se registra en el portal (HU-02/03)
  y el SUPER_ADMIN la busca (`GET /admin/users?q=correo`) y le asigna roles. El primer SUPER_ADMIN de
  producción se crea con `BOOTSTRAP_ADMIN_*` o `pnpm admin:create` (docs/DEPLOY.md, sección 8).
- `409 ADMIN_SELF_ACTION`: intentar quitarte tu propio SUPER_ADMIN o deshabilitar tu cuenta.
- `409 ADMIN_LAST_SUPER_ADMIN`: dejaría el panel sin ningún SUPER_ADMIN activo.
- Una cuenta deshabilitada no puede iniciar sesión (`403 AUTH_ACCOUNT_DISABLED`) y pierde el panel al
  instante.

### Auditoría

Toda acción de escritura del panel deja un registro: actor, acción, entidad y antes/después resumido
(solo campos cambiados; nunca contraseñas, hashes, tokens ni el `hostUrl`).

`GET /admin/audit-logs?entityType=&entityId=&actorId=&action=&from=&to=` (permiso `audit.read`,
paginado, más reciente primero). `action` acepta prefijo (`offer.` = todas las de ofertas). Úsalo, por
ejemplo, para un "Historial de cambios" en la ficha de una oferta (`entityType=Offer&entityId=…`).

## HU-27 / HU-28 — Ofertas, docentes, imágenes, contenido del aula y Moodle

Tags OpenAPI: **Admin – Ofertas**, **Admin – Docentes**, **Admin – Contenido del aula**, **Admin – Moodle**.

### Endpoints

| Método y ruta | HU | Permiso | Uso |
|---|---|---|---|
| `GET /admin/offers` | 27 | `offers.read` | Listado (filtros `q`, `type`, `modality`, `origin`, `status`, `sort`) |
| `POST /admin/offers` | 27 | `offers.write` | "+ Nueva oferta": `{ type, modality, name }` → borrador |
| `GET /admin/offers/{id}` | 27 | `offers.read` | Detalle agrupado por paso + `wizard` |
| `PATCH /admin/offers/{id}/steps/general` | 27 | `offers.write` | Paso 1 — Datos e imágenes |
| `PATCH /admin/offers/{id}/steps/content` | 27 | `offers.write` | Paso 2 — Contenido |
| `PATCH /admin/offers/{id}/steps/schedule` | 27 | `offers.write` | Paso 3 — Horarios |
| `PATCH /admin/offers/{id}/steps/origin-pricing` | 27 | `offers.write` | Paso 4 — Origen y precio |
| (paso 5 — Recursos) | 28 | — | Se gestiona con los endpoints de "Contenido del aula" |
| `PATCH /admin/offers/{id}/steps/attendance` | 27/30 | `offers.write` | Paso 6 — Asistencia |
| `PATCH /admin/offers/{id}/steps/whatsapp` | 27 | `offers.write` | Paso 7 — WhatsApp |
| `POST /admin/offers/{id}/publish` | 27 | `offers.publish` | Publicar (valida pasos 1–4, 6, 7) |
| `POST /admin/offers/{id}/unpublish` | 27 | `offers.publish` | Publicado/Archivado → Borrador |
| `POST /admin/offers/{id}/archive` | 27 | `offers.publish` | Borrador/Publicado → Archivado |
| `POST /admin/offers/{id}/duplicate` | 27 | `offers.publish` | "Duplicar" (nueva cohorte) |
| `DELETE /admin/offers/{id}` | 27 | `offers.publish` | Borrar un borrador sin inscripciones/postulaciones/pagos |
| `POST /admin/uploads/images` | 27 | `offers.write` | URL firmada para portada / carrusel / foto de docente |
| `GET /admin/teachers` · `POST` · `PATCH /{id}` · `DELETE /{id}` | 27 | read: `offers.read`; resto `offers.write` | Docentes |
| `GET /admin/offers/{id}/modules` | 28 | `offers.read` | Módulos con 4 secciones (Presentación, Lecturas, Actividades, Grabación) |
| `POST /admin/offers/{id}/modules` | 28 | `offers.write` | Agregar módulo (al final, oculto) |
| `PUT /admin/offers/{id}/modules/order` | 28 | `offers.write` | Reordenar (`moduleIds` completos) |
| `PATCH /admin/modules/{moduleId}` · `DELETE` | 28 | `offers.write` | Editar / publicar / ocultar / programar · borrar |
| `POST /admin/modules/{moduleId}/resources/upload-url` | 28 | `offers.write` | URL firmada del archivo del recurso |
| `POST /admin/modules/{moduleId}/resources` | 28 | `offers.write` | Agregar recurso |
| `PUT /admin/modules/{moduleId}/resources/order` | 28 | `offers.write` | Reordenar recursos |
| `PATCH /admin/resources/{resourceId}` · `DELETE` | 28 | `offers.write` | Editar / publicar / ocultar · borrar |
| `GET /admin/offers/{id}/moodle/roster` | 25/27 | `offers.read` | Lista de correos (filtros `q`, `linked`) |
| `POST /admin/offers/{id}/moodle/roster` | 25/27 | `offers.write` | Importar CSV (`csv`) o arreglo (`emails`) |
| `DELETE /admin/offers/{id}/moodle/roster/{entryId}` | 25 | `offers.write` | Quitar un correo no vinculado |
| `GET /admin/offers/{id}/moodle/codes` | 25 | `offers.read` | Códigos (pista, vencimiento, quién lo canjeó) |
| `POST /admin/offers/{id}/moodle/codes` | 25/27 | `offers.write` | Generar 1–200 códigos (en claro UNA vez) |

Grabaciones (sección "Grabación"): se leen aquí, pero el enlace se edita en `PATCH /admin/sessions/{id}`
(`recordingUrl`, ver la sección de Sesiones).

### Mapa de criterios de aceptación → API

| Criterio | API |
|---|---|
| HU-27: pasos 1–4 válidos + "Publicar" → "Publicado", en el catálogo y abre la vista previa de sesiones | `POST /publish` → `publicationStatus: PUBLISHED`; si `sessionPreview.available` abre la vista previa (HU-29) |
| HU-27: curso > 9 h, o diplomado sin 60 h o sin fecha de proyecto final → el asistente lo impide | `wizard.steps[2].issues` (`COURSE_MAX_HOURS_EXCEEDED`, `DIPLOMA_HOURS_MISMATCH`, `finalProjectDueAt: REQUIRED`); publicar → 422 `OFFER_INCOMPLETE` |
| HU-27: origen Moodle → se ocultan precio, cuotas y beca; cargar lista y generar códigos | `PATCH …/steps/origin-pricing { origin: MOODLE }` limpia esos campos; `/admin/offers/{id}/moodle/roster|codes` |
| HU-27: programa por convocatoria con fechas, lugar, cupo, elegibilidad y costo → "Postular" | Pasos 1 (lugar, cupo), 2 (elegibilidad), 3 (ventana de convocatoria obligatoria), 4 (costo) → publicar |
| HU-27: usuario sin rol administrativo → acceso negado | 403 `FORBIDDEN` (`meta.missingPermissions`) |
| HU-28: agregar módulo → al final, número siguiente, Oculto, 4 secciones vacías | `POST /admin/offers/{id}/modules` |
| HU-28: publicar recurso con "Notificar a inscritos" → lo ven y reciben aviso (portal + correo) | `notifyEnrollees` (true por defecto) → `MATERIAL_PUBLISHED`; respuesta `notifiedCount` |
| HU-28: pegar y publicar la grabación de una sesión realizada | `PATCH /admin/sessions/{id} { recordingUrl }` (área Sesiones); aquí `sections.recordings[].pending` |
| HU-28: módulo/recurso Oculto → el inscrito no lo ve | `visibility: HIDDEN` (el portal ya filtra por `visibleNow`) |
| HU-28: archivo no permitido o > 50 MB → error en ese ítem, no se guarda | 422 `ADMIN_UPLOAD_INVALID_FILE` (`meta.allowedTypes`, `meta.maxBytes`) en `upload-url` y al confirmar |

### Flujo del asistente (7 pasos)

1. **"+ Nueva oferta"** → `POST /admin/offers { type, modality, name }`. Nombre único (sin distinguir
   mayúsculas) → si no, 409 `OFFER_NAME_TAKEN` (`details[0].field = "name"`). Responde el detalle.
2. Cada paso tiene su formulario y su `PATCH …/steps/{slug}` (**autoguardado**): manda solo los campos del
   paso (los omitidos no cambian; `null` borra los opcionales). Se aceptan datos incompletos; solo un
   formato inválido responde 400 `VALIDATION_ERROR`. La respuesta es el detalle completo; inicializa cada
   formulario con su bloque (`general`, `content`, `schedule`, `originPricing`, `attendance`, `whatsapp`).
3. **Validación por paso**: `wizard.steps[n] = { step, key, slug, label, requiredToPublish, complete,
   issues[] }`. Si `issues` no está vacío, deshabilita "Siguiente" y pinta cada `issues[].message` bajo
   `issues[].field`.
4. **Publicar**: habilitado con `wizard.canPublish`. Si falta algo → 422 `OFFER_INCOMPLETE` con
   `details[]` (`field` = `<slug del paso>.<campo>`, p. ej. `schedule.totalHours`) y `meta.steps`
   (números de paso con problemas) para llevar al paso.
5. Tras publicar: "Oferta publicada" con enlace a la ficha (`publicPath`) y, si
   `sessionPreview.available`, a la vista previa de sesiones (HU-29).

| Paso | `slug` | Campos | Reglas (issues) |
|---|---|---|---|
| 1 Datos e imágenes | `general` | `name`, `type`, `modality`, `cohortLabel`, `summary` (≤ 300), `coverImageKey`, `carouselImageKeys[]`, `publicTopic`, `teacherIds[]` (orden), `venueName/Address/City/MapsUrl`, `capacity` | Nombre ≥ 3; resumen y portada obligatorios; presencial → lugar y ciudad |
| 2 Contenido | `content` | `description`, `learningOutcomes[]`, `requirements`, `eligibilityText`, `eligibleCountryCodes[]`, `requiresTravel`, `classroomWelcome`, `finalProjectSubmissionEnabled`, `finalProjectGuidelines` | Descripción obligatoria; convocatoria → elegibilidad; proyecto final por archivo solo diplomados |
| 3 Horarios | `schedule` | `enrollmentOpensAt/ClosesAt`, `startsAt`, `endsAt`, `finalProjectDueAt`, `totalHours`, `scheduleRule`, `calendarCategory` | Inicio/fin obligatorios y fin > inicio; ventana coherente y ≤ fin; convocatoria → ventana obligatoria; diplomado → 60 h exactas + proyecto final; curso ≤ 9 h; diplomado/curso en línea → regla de horario |
| 4 Origen y precio | `origin-pricing` | `origin`, `isFree`, `priceMxnCents`, `priceUsdCents`, `installmentsEnabled`, `installmentsMax` (2–4), `moodleCourseUrl`, `scholarshipEnabled`, `scholarshipTypes[]` (antes `scholarshipLevels[]`: `[{ scholarshipTypeId, minPercent?, maxPercent?, sortOrder? }]`, ver [Tipos de beca](#tipos-de-beca-parametrizables)), `scholarshipOpensAt/ClosesAt` | NAS de pago → MXN y USD > 0; cuotas 2–4; beca solo diplomados con ≥ 1 tipo activo. Tipo inexistente/desactivado → `422 SCHOLARSHIP_TYPE_NOT_AVAILABLE`; rango propio inválido → `422 SCHOLARSHIP_TYPE_INVALID_RANGE`. MOODLE limpia precio/cuotas/beca |
| 5 Recursos | — | (Contenido del aula) | Nunca bloquea; `resources` resume módulos/recursos |
| 6 Asistencia | `attendance` | `attendanceWindowHours` (1–72) | — |
| 7 WhatsApp | `whatsapp` | `whatsappGroupUrl` (https://chat.whatsapp.com/…), `whatsappVisibleFrom` | URL inválida → 400 |

- `totalHours` viaja en horas (60) y se guarda en minutos. `scheduleRule` en hora CDMX: horario por día
  con `slots: [{ weekday 1–7, startTime "HH:mm", endTime "HH:mm" }]` (p. ej. lun 10–12 y jue 16–18) o la
  forma clásica `weekdays` + `startTime`/`endTime` (mismo horario todos los días); más `excludedDates[]`,
  `excludeMexicanHolidays`. La API la devuelve normalizada (siempre con `slots`). Errores de la regla →
  400 con `details[].field = "scheduleRule.endTime"`, `"scheduleRule.slots.1.endTime"`, etc.
- **Tipo, modalidad y origen** quedan bloqueados si hay inscripciones que ocupan cupo o postulaciones
  enviadas (`hasEnrollments: true`; intentar cambiarlos → 409 `OFFER_HAS_ENROLLMENTS`).
- El `slug` (URL pública) se recalcula al renombrar SOLO si la oferta nunca se publicó.

Códigos de `wizard.steps[].issues[].code` / `details[].code`: `REQUIRED`, `MIN_LENGTH`, `MAX_LENGTH`,
`INVALID`, `NOT_APPLICABLE`, `COURSE_MAX_HOURS_EXCEEDED` ("Los cursos tienen una duración máxima de 9
horas"), `DIPLOMA_HOURS_MISMATCH` ("Los diplomados deben sumar 60 horas").

### Imágenes (portada, carrusel, foto de docente)

1. `POST /admin/uploads/images { purpose: OFFER_COVER | OFFER_CAROUSEL | TEACHER_PHOTO, offerId?, fileName,
   contentType, sizeBytes }` → `{ uploadUrl, method: "PUT", headers, key, expiresAt }`. JPG/PNG/WebP ≤ 15 MB
   (si no → 422 `ADMIN_UPLOAD_INVALID_FILE`).
2. `PUT {uploadUrl}` con el `Content-Type` indicado.
3. Envía la `key` en el paso 1 (`coverImageKey`, `carouselImageKeys[]`) o en el docente (`photoKey`). El
   backend verifica que exista (si no → 422 `ADMIN_UPLOAD_NOT_FOUND`) y su tipo/tamaño REAL. También se
   acepta una URL https absoluta (CDN externo). La respuesta trae `{ key, url }` para mostrarla.

Las keys van bajo `public/` (bucket público si `STORAGE_PUBLIC_BUCKET`; URL con
`STORAGE_PUBLIC_BASE_URL`, o firmada de 7 días si no existe).

### Estados del listado (`adminStatus`)

| Valor | Texto |
|---|---|
| `DRAFT` | Borrador |
| `PUBLISHED` | Publicado (incluye "Próximamente" en el sitio: `availability = UPCOMING`) |
| `ENROLLMENT_CLOSED` | Inscripciones cerradas |
| `FINISHED` | Finalizado |
| `ARCHIVED` | Archivado |

Transiciones: Borrador → Publicado (`publish`); Publicado/Archivado → Borrador (`unpublish`);
Borrador/Publicado → Archivado (`archive`); otra combinación → 409 `OFFER_INVALID_STATE`
(`meta.publicationStatus`). Despublicar no quita el acceso a los inscritos.

**Duplicar** (nueva cohorte): copia contenido, precio, beca, regla de horario (sin fechas excluidas),
docentes, módulos y recursos (todos **ocultos** y sin fechas de actividad). Limpia fechas, sesiones,
WhatsApp, inscripciones y Moodle. Nombre por defecto "<nombre> (copia)". Queda en Borrador.

**Borrar**: solo borradores sin inscripciones, postulaciones ni pagos (si no → 409). Archivar es la opción
para ofertas con historia.

### Contenido del aula (HU-28)

- `GET /admin/offers/{id}/modules` → `{ modules[], unassignedRecordings[], activeEnrollees }`. Cada módulo:
  `number` ("Módulo N"), `visibility`, `publishAt`, `visibleNow`, `notifyEnrollees`, `notifiedAt` y
  `sections { presentation, preReadings[], activities[], recordings[] }`. Recurso: `source` (FILE / URL /
  LIBRARY), `file.downloadUrl` (firmada ~10 min), `url`, `library`, `activityDueAt`, `visibleNow`.
  Grabación: una fila por sesión del módulo con `state` (AVAILABLE / AFTER_SESSION / PENDING /
  NOT_APPLICABLE) y `pending: true` = "Grabación pendiente" (resáltala).
- Agregar módulo: queda al final, oculto. Reordenar: `PUT …/modules/order { moduleIds }` con TODOS los
  módulos (si no → 400).
- Recursos: archivo (`upload-url` → PUT → `fileKey`), enlace https (`url`) o recurso de la Biblioteca
  (`libraryResourceId`, solo lecturas). Exactamente una fuente (si no → 400). **Presentación: una por
  módulo**; crear otra reemplaza la anterior (`replacedResourceId`). Actividades: `activityDueAt` dentro
  del periodo de la oferta. Tipos de archivo: Presentación PDF/PPTX; Lecturas PDF/DOCX/EPUB;
  Actividades cualquiera de esos; ≤ 50 MB.
- **Visibilidad y notificación**: oculto por defecto. Para publicar: `visibility: PUBLISHED` (inmediato)
  o con `publishAt` futuro (programado; en pasado → 400). "Notificar a inscritos" (`notifyEnrollees`,
  marcada por defecto): cuando el elemento queda visible (y su módulo también) se avisa UNA vez a los
  inscritos activos (`MATERIAL_PUBLISHED`, portal + correo). Al publicar un módulo se manda UN solo aviso
  que incluye sus materiales visibles pendientes. La respuesta trae `notifiedCount` → "Cambios publicados ·
  Se notificó a [n] inscritos". Lo programado se avisa al llegar la fecha (job cada 5 min). Ocultar y
  volver a publicar no repite el aviso.
- "Ver como participante": usa los endpoints del portal (`/me/classrooms/{offerId}`) con una cuenta
  inscrita; solo se ve lo `visibleNow`.

### Moodle (paso 4 con origen MOODLE)

- `POST /admin/offers/{id}/moodle/roster { csv }` (contenido del archivo; columna `email`/`correo` o la
  primera celda con @ de cada fila; también un correo por línea) o `{ emails: [...] }` → `{ added,
  duplicates, invalid[], linkedUsers }`. Idempotente. Quien ya tiene cuenta verificada queda inscrito "Vía
  Moodle" al momento (aviso `MOODLE_ENROLLMENT_LINKED`); los demás, al verificar su correo.
- `POST /admin/offers/{id}/moodle/codes { count }` → `{ codes[], expiresAt }`: **se muestran una sola vez**
  (ofrece copiar/descargar). Vencen al fin de la cohorte. La lista muestra solo la pista (`hint`).
- Oferta que no es Moodle → 422 `OFFER_NOT_MOODLE`. Quitar un correo ya vinculado → 409 `CONFLICT`.

### Estados de UI ↔ respuestas

| Estado (HU) | Respuesta |
|---|---|
| Empty listado: "Aún no hay ofertas formativas. Crea la primera." | `GET /admin/offers` → `meta.total = 0` |
| Disabled "Publicar" | `wizard.canPublish = false` (`publishBlockers[]`) |
| Success "Oferta publicada" | 200 de `publish` (enlace `publicPath` + vista previa de sesiones) |
| Error en línea por campo | 400 `VALIDATION_ERROR` (`details[]`) o `wizard.steps[].issues[]`; 422 `OFFER_INCOMPLETE` |
| Empty módulos: "Esta oferta aún no tiene módulos. Agrega el primero." | `modules = []` |
| Pending "Grabación pendiente" | `sections.recordings[].pending = true` |
| Success "Cambios publicados · Se notificó a [n] inscritos" | `notifiedCount` |
| Error archivo rechazado (reintento por ítem) | 422 `ADMIN_UPLOAD_INVALID_FILE` / `ADMIN_UPLOAD_NOT_FOUND` |

### Códigos de error (área)

`OFFER_NAME_TAKEN` (409), `OFFER_INCOMPLETE` (422, `details[]`, `meta.steps`), `OFFER_HAS_ENROLLMENTS`
(409, `meta.enrollments/applications`), `OFFER_INVALID_STATE` (409, `meta.publicationStatus`),
`OFFER_NOT_MOODLE` (422), `TEACHER_IN_USE` (409, `meta.offers/modules`),
`SCHOLARSHIP_TYPE_NOT_AVAILABLE` (422, `details[].field = scholarshipTypes.N.scholarshipTypeId`,
`code` `SCHOLARSHIP_TYPE_NOT_FOUND` / `SCHOLARSHIP_TYPE_INACTIVE`), `SCHOLARSHIP_TYPE_INVALID_RANGE` (422,
`details[].field = scholarshipTypes.N.minPercent|maxPercent`), `ADMIN_UPLOAD_INVALID_FILE`
(422, `meta.allowedTypes/maxBytes`), `ADMIN_UPLOAD_NOT_FOUND` (422), y genéricos `VALIDATION_ERROR`,
`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`.

### Auditoría (acciones)

`offer.create`, `offer.update-step`, `offer.publish`, `offer.unpublish`, `offer.archive`,
`offer.duplicate`, `offer.delete`, `teacher.create|update|delete`, `module.create|update|reorder|delete`,
`resource.create|update|reorder|delete`, `moodle.import-roster`, `moodle.remove-roster-entry`,
`moodle.generate-codes`.

### Decisiones / pendientes para el cliente

- Diplomado = **60 h exactas** (Anexo A: confirmar si se admiten 58–64 h; se cambia en `BUSINESS_RULES`).
- Cuotas permitidas en cualquier oferta NAS de pago (Anexo A HU-27: confirmar si solo diplomados).
- Las imágenes reemplazadas no se borran de storage (una oferta duplicada comparte las keys); los archivos
  de recursos sí se borran cuando ningún recurso los usa.
- Las docentes no tienen acceso propio al panel (Anexo A HU-28): solo el equipo carga materiales.
- Borrar una oferta (borrador) no borra los archivos de storage de sus recursos.

## HU-29 — Sesiones y calendario del panel · HU-30 — Asistencia

Tags OpenAPI: **Admin – Sesiones**, **Admin – Calendario**, **Admin – Asistencia**. Todas las rutas bajo
`/api/v1`, con `Authorization: Bearer`. Sin el permiso → `403 FORBIDDEN` con `meta.missingPermissions`.

### Endpoints

| Método y ruta | HU | Permiso | Uso |
|---|---|---|---|
| `GET /admin/offers/{id}/sessions` | 29 | offers.read | Lista de sesiones (con `hostUrl`, grabación, banderas, conteo de asistencia) |
| `POST /admin/offers/{id}/sessions/preview` | 29 | offers.write | "Generar sesiones" → Vista previa (no guarda) |
| `POST /admin/offers/{id}/sessions/generate` | 29 | offers.write | "Crear sesiones" (todo o nada) + fechas importantes |
| `POST /admin/offers/{id}/sessions` | 29 | offers.write | Sesión manual suelta |
| `GET /admin/sessions/{id}` | 29 | offers.read | Detalle de una sesión |
| `PATCH /admin/sessions/{id}` | 28, 29 | offers.write | Enlaces por sesión, módulo, color, ventana de asistencia, **grabación** |
| `POST /admin/sessions/{id}/reschedule` | 29 | offers.write | Reprogramar con motivo (avisa) |
| `POST /admin/sessions/{id}/cancel` | 29 | offers.write | Cancelar con motivo (avisa) |
| `DELETE /admin/sessions/{id}` | 29 | offers.write | Borrar sesión sin asistencias (para regenerar) |
| `GET /admin/calendar?from&to&offerId&category` | 29 | offers.read | Vista mensual / lista del panel |
| `GET /admin/calendar-events` | 29 | offers.read | Eventos manuales y fechas importantes (paginado) |
| `POST /admin/calendar-events` | 29 | offers.write | "+ Evento manual" |
| `PATCH /admin/calendar-events/{id}` · `POST …/{id}/cancel` · `DELETE …/{id}` | 29 | offers.write | Editar / cancelar / borrar evento |
| `GET /admin/offers/{id}/attendance/sessions` | 30 | attendance.read | Chips de sesiones con su estado |
| `GET /admin/sessions/{id}/attendance?status&countryCode&q` | 30 | attendance.read | Pestaña "Por sesión" |
| `GET /admin/offers/{id}/attendance/participants?q&countryCode&belowThreshold` | 30 | attendance.read | Pestaña "Por participante" (% de asistencia) |
| `GET /admin/sessions/{id}/attendance/export` · `GET /admin/offers/{id}/attendance/export` | 30 | attendance.read | Exportar CSV (respeta filtros) |
| `POST /admin/sessions/{id}/attendance/mark` | 30 | attendance.write | Marcar manual / "Pasar lista en sitio" |
| `POST /admin/sessions/{id}/attendance/unmark` | 30 | attendance.write | Quitar un registro (corrección) |
| `POST /admin/sessions/{id}/attendance/remind` | 30 | attendance.write | "Recordar a pendientes" |

Roles con `offers.write` / `attendance.*`: ACADEMIC_COORDINATOR y SUPER_ADMIN. `offers.read`: todo el staff.

### Mapa de criterios de aceptación → API

| Criterio | Cómo |
|---|---|
| HU-29 "sáb y dom 10:00–13:00 del 07/11/2026 al 31/01/2027 → vista previa con excluidas y '20 sesiones · 60 h'" | `POST …/sessions/preview` → `items[]` (NEW/EXCLUDED/CONFLICT) y `summary.label` |
| HU-29 "Crear sesiones sin conflictos → se crean con color y enlace, en el calendario de inscritos, cada una con su registro" | `POST …/sessions/generate` (una transacción; categoría de la oferta; enlace recurrente). El portal (HU-10/12/18) las ve de inmediato |
| HU-29 "curso > 9 h → 'Crear sesiones' deshabilitado con 'Los cursos tienen una duración máxima de 9 horas'" | `preview.canConfirm = false`, `violations = ['COURSE_MAX_HOURS_EXCEEDED']`, `blockedReason`; `generate` → 422 `SESSION_GENERATION_BLOCKED` |
| HU-29 "reprogramo o cancelo con motivo → solo esa sesión; inscritos notificados con la nueva hora en su zona" | `POST /admin/sessions/{id}/reschedule` / `cancel` → `notifiedCount`; aviso SESSION_RESCHEDULED / SESSION_CANCELLED con "dd/MM/yyyy a las HH:mm (tu hora) · HH:mm hora CDMX" |
| HU-29 "+ Evento manual → color Eventos, solo lo ve la audiencia elegida" | `POST /admin/calendar-events` (categoría por defecto `EVENTS`; `audience` + `offerId`) |
| HU-28 "pego y publico el link de grabación → 'Ver grabación' y desaparece 'Grabación pendiente'" | `PATCH /admin/sessions/{id} { recordingUrl }` (+ aviso RECORDING_PUBLISHED una vez) |
| HU-30 "termina la sesión → 'Registro abierto' 24 h" / "vence → 'Cerrada', pendientes 'No registrada'" | Estado derivado (`state` del chip y `rows[].status`), sin cron |
| HU-30 "'Por sesión' → cada inscrito con estado y comentario y '18 de 25 (72%)'" | `GET /admin/sessions/{id}/attendance` → `summary.label`, `rows[]` |
| HU-30 "marco manual con motivo / 'Pasar lista en sitio' → 'Registrada', origen Manual, quién y cuándo; % recalculado" | `POST …/attendance/mark` → `rows[].source = MANUAL`, `recordedBy`, `manualReason`, `registeredAt` |
| HU-30 "sesión cancelada → sin registro y no cuenta para el %" | Chip `CANCELLED`, filas `NOT_APPLICABLE`, mark → 422 `SESSION_CANCELLED`; el % solo cuenta sesiones realizadas no canceladas |

### Flujo "Generar sesiones" (3 pasos)

1. **Regla**: precarga con `GET /admin/offers/{id}` (`scheduleRule`, guardada en el paso 3 del asistente).
   Días ISO (1 = lunes … 7 = domingo) y horas **CDMX**.
2. **Excepciones**: `excludedDates` (recesos, `YYYY-MM-DD`) y `excludeMexicanHolidays` (festivos oficiales
   precargados). Las fechas excluidas se **omiten sin recorrerse** (Anexo A).
3. **Vista previa**: `POST /admin/offers/{id}/sessions/preview` con

```json
{
  "rule": { "weekdays": [6, 7], "startTime": "10:00", "endTime": "13:00",
            "excludedDates": ["2026-12-26"], "excludeMexicanHolidays": true },
  "startDate": "2026-11-07", "endDate": "2027-01-31",
  "joinUrl": "https://us02web.zoom.us/j/123?pwd=x", "hostUrl": "https://us02web.zoom.us/s/123",
  "assignModules": true,
  "importantDates": ["ENROLLMENT_CLOSES", "OFFER_STARTS", "SCHOLARSHIP_DEADLINE", "FINAL_PROJECT"]
}
```

   Todo es opcional: sin `rule` usa la de la oferta; sin fechas usa inicio/fin de la oferta (el rango debe
   quedar dentro del periodo de la oferta). Respuesta: `items[]` (fecha, `startsAt/endsAt` UTC,
   `status` NEW/EXCLUDED/CONFLICT, `exclusionReason` MANUAL/MX_HOLIDAY, `module`), `summary`
   (`sessionCount`, `newHours`, `existingHours`, `totalHours`, `excludedCount`, `conflictCount`,
   `label` "20 sesiones · 60 h · 6 excluidas"), `violations`, `warnings`, `canConfirm`, `blockedReason`
   e `importantDates[]` (`exists` = ya existe y se actualizará).
4. **Crear sesiones** (botón habilitado solo con `canConfirm`): `POST …/sessions/generate` con el MISMO
   cuerpo → `{ createdSessions, importantDates, message: "Se crearon 20 sesiones y 4 fechas importantes",
   sessions[] }`. Si se envió `rule`, se guarda en la oferta. Nunca se crea parcialmente (Error: reintentar).

Bloquean la confirmación: conflictos (traslape con sesiones existentes, **también canceladas** — bórralas
con `DELETE` si quieres regenerar ese horario), cero sesiones nuevas o curso > 9 h (sumando las horas ya
existentes). Diplomado ≠ 60 h es solo **advertencia** (`warnings: ['DIPLOMA_HOURS_MISMATCH']`): la regla
de 60 h ya la exige el asistente de HU-27 al publicar.

Enlaces (`joinUrl`, `hostUrl`): solo ofertas en línea y solo `https://…zoom.us` o
`https://meet.google.com/…` → si no, 400 con `details[].code` `INVALID_MEETING_URL` (o `NOT_APPLICABLE`
en presenciales). El participante NUNCA recibe `hostUrl` (HU-12).

### Edición de una sesión

- `PATCH /admin/sessions/{id}`: `moduleId`, `category`, `joinUrl`/`hostUrl` (enlace "por sesión"),
  `attendanceWindowHours` (1–72; `null` = la de la oferta) y `recordingUrl` (https; `null` quita).
  Publicar/cambiar la grabación avisa RECORDING_PUBLISHED a los inscritos (una sola vez por sesión;
  `notifyRecording: false` para no avisar). Respuesta `{ session, notifiedCount }`.
- Reprogramar: `{ startsAt, endsAt, reason }` (motivo obligatorio). Guarda `originalStartsAt` y
  `changeReason` (ícono "editada" = `flags.edited`). El aviso de "registro de asistencia abierto" se
  reenviará al nuevo fin. Traslape → 409 `SESSION_CONFLICT`.
- Cancelar: `{ reason }`. Sigue visible como "Cancelada" (portal y panel), sin enlace ni registro.
- Mensaje de éxito: "Sesión reprogramada · se notificó a {notifiedCount} inscritos".

Banderas (`flags`) para los íconos: `edited`, `cancelled`, `missingLink` (en línea sin enlace),
`recordingPending` (en línea, ya terminó, sin grabación → "Grabación pendiente").

### Calendario del panel

`GET /admin/calendar?from&to` (máx. 62 días; 400 `VALIDATION_ERROR` con `INVALID_RANGE` /
`RANGE_TOO_LARGE`) devuelve `data[]` con `source` SESSION | EVENT, `kind` (SESSION, MANUAL o el tipo de
fecha importante), `category`, `status`, `offer`, `audience` (eventos), `edited`, `missingLink`.
Filtros `offerId` y `category`. Incluye todas las audiencias y las canceladas.

"+ Evento manual": `POST /admin/calendar-events { title, description?, category? (default EVENTS),
audience: ALL_REGISTERED | OFFER_ENROLLED, offerId? (obligatorio con OFFER_ENROLLED), startsAt, endsAt?,
allDay?, location?, joinUrl? (https) }`. No envía notificaciones. Cancelar → sigue visible como
"Cancelado"; ya cancelado → 409 `CONFLICT`.

### HU-30 — Pantalla de asistencia

- **Chips** (`GET /admin/offers/{id}/attendance/sessions`): `state` + `opensAt` / `closesAt` +
  `registered`/`total`/`percent`.
- **Por sesión** (`GET /admin/sessions/{id}/attendance`): `summary` (sin filtros: "18 de 25 registraron
  asistencia (72%)") y `rows[]` filtradas. Inscritos = inscripciones ACTIVE, COMPLETED o SUSPENDED (NAS y
  Moodle; `origin` para la etiqueta "Vía Moodle"). Sin paginar.
- **Por participante** (`GET /admin/offers/{id}/attendance/participants`): `attended`, `heldSessions`,
  `percent` (= asistidas ÷ sesiones YA realizadas no canceladas; `null` si aún no hay), `belowThreshold`
  (alerta visual < 80%; no es requisito de certificación, Anexo A).
- **Marcar** (`POST /admin/sessions/{id}/attendance/mark { userIds: [..], reason }`): 1–200 personas
  (selección múltiple o "Pasar lista en sitio" en talleres). Permitido aunque la ventana esté cerrada.
  Resultado `{ marked, alreadyRegistered }`.
- **Desmarcar** (`POST …/unmark { userIds, reason }`): borra el registro (de la persona o manual); lo
  borrado queda en la auditoría.
- **Recordar a pendientes** (`POST …/remind`): solo con "Registro abierto"; aviso ATTENDANCE_OPEN (portal +
  correo) a quienes no registraron; máx. 1 por persona por día (`notified: 0` si ya se envió hoy).
- **Exportar** (CSV UTF-8 con BOM, abre en Excel): descarga con `fetch` (Bearer) → `blob`. Respeta los
  filtros de la pestaña. "Copiar enlace" = enlace del portal `/asistencia/{sessionId}` (frontend).

### Estados de UI ↔ respuestas

| UI | Respuesta |
|---|---|
| Empty (oferta sin sesiones) | `GET …/sessions` → `data: []` → invitar a "Generar sesiones" |
| Disabled "Crear sesiones" | `preview.canConfirm = false` + `blockedReason` |
| Success | `generate` 201 → `message` |
| Error al crear | 422 `SESSION_GENERATION_BLOCKED` (meta) / 409 `SESSION_CONFLICT` / 5xx (reintentar: nada se creó) |
| Pending (registro no abierto) | chip `SCHEDULED` + `opensAt` |
| Enabled (registro abierto) | chip `REGISTRATION_OPEN` |
| Disabled (cerrado/cancelada) | chip `CLOSED` / `CANCELLED`; solo cambios manuales con motivo (en canceladas ni eso) |

### Códigos de error

| `code` | HTTP | Cuándo |
|---|---|---|
| `SESSION_GENERATION_BLOCKED` | 422 | `generate` con conflictos, 0 sesiones o curso > 9 h (`meta.conflictCount`, `meta.violations`, `meta.blockedReason`) |
| `SESSION_CONFLICT` | 409 | Sesión manual o reprogramación que se traslapa con otra programada (`meta.sessionId`, `meta.startsAt`) |
| `SESSION_HAS_ATTENDANCE` | 409 | Borrar una sesión con registros de asistencia (cancélala) |
| `ATTENDANCE_NOT_ENROLLED` | 422 | Marcar a personas sin inscripción vigente (`meta.userIds`) |
| `SESSION_CANCELLED` | 422 | Reprogramar/cancelar una cancelada, marcar o recordar en una cancelada |
| `ATTENDANCE_NOT_OPEN_YET` / `ATTENDANCE_WINDOW_CLOSED` | 422 | "Recordar a pendientes" fuera de la ventana (`meta.opensAt` / `meta.closesAt`) |
| `CONFLICT` | 409 | Cancelar un evento ya cancelado |

`details[].code` nuevos (400 `VALIDATION_ERROR`): `INVALID_MEETING_URL` (enlace que no es zoom.us /
meet.google.com), `NOT_APPLICABLE` (enlace en sesión presencial). Además `rule.<campo>` `INVALID` (regla mal
formada), `startDate`/`endDate` `REQUIRED`/`INVALID` (fuera del periodo), `endsAt` `INVALID`, `IS_URL`.

### Tablas enum → texto

`AdminSessionState` (chips): `SCHEDULED` Programada · `REGISTRATION_OPEN` Registro abierto · `CLOSED`
Cerrada · `CANCELLED` Cancelada.

Vista previa `status`: `NEW` Nueva · `EXCLUDED` Excluida · `CONFLICT` Conflicto. `exclusionReason`:
`MANUAL` Receso · `MX_HOLIDAY` Festivo.

`AttendanceStatus` (filas): `REGISTERED` Registrada · `PENDING` Pendiente · `NOT_REGISTERED` No
registrada · `NOT_APPLICABLE` Sin registro (cancelada). `AttendanceSource`: `PARTICIPANT` Participante ·
`MANUAL` Manual.

`CalendarCategory`: `TRAINING` Formación (azul) · `TERRITORY` Territorio (verde) · `COMMUNITY` Comunidad
(naranja) · `EVENTS` Eventos (morado) · `IMPORTANT_DATES` Fechas importantes (rojo).

`CalendarEventKind`: `MANUAL` Evento manual · `ENROLLMENT_OPENS` Apertura de inscripciones ·
`ENROLLMENT_CLOSES` Cierre de inscripciones/convocatoria · `OFFER_STARTS` Inicio · `SCHOLARSHIP_DEADLINE`
Límite de beca · `FINAL_PROJECT` Proyecto final.

### Notificaciones que emite el panel (categoría TRAINING)

| Tipo | Cuándo | `dedupeKey` |
|---|---|---|
| `SESSION_RESCHEDULED` | Reprogramar | `session-rescheduled:{sessionId}:{nuevoInicioMs}` |
| `SESSION_CANCELLED` | Cancelar | `session-cancelled:{sessionId}` |
| `RECORDING_PUBLISHED` | Publicar grabación | `recording:{sessionId}` |
| `ATTENDANCE_OPEN` | "Recordar a pendientes" | `attendance-remind:{sessionId}:{fecha CDMX}` |

Destinatarios: inscritos con acceso al Aula (ACTIVE, COMPLETED). Texto con la hora en la zona del perfil de
cada persona + hora CDMX.

### Decisiones / por confirmar con el cliente

- Diplomado ≠ 60 h en la vista previa es advertencia, no bloqueo (el bloqueo de 60 h está en publicar, HU-27).
- Las sesiones canceladas ocupan su horario para la generación (aparecen como conflicto): bórralas si se
  quiere regenerar ese horario. Alternativa si el cliente prefiere: ignorarlas.
- "Marcar manual" se permite con la ventana cerrada (la HU dice "solo cambios manuales con motivo").
- Inscritos de la tabla de asistencia incluyen suspendidos (SUSPENDED); los avisos solo van a inscritos con acceso.
- "Recordar a pendientes": un recordatorio por persona y día.

## HU-31 — Revisión de postulaciones en equipo

Tag OpenAPI **Admin – Postulaciones**. Todas bajo `/api/v1`, con Bearer. Postulación inexistente, en
borrador o id mal formado → `404 NOT_FOUND`. Los borradores nunca aparecen en el panel.

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /admin/applications` | `applications.read` | Bandeja (paginada) con filtros e insignias |
| `GET /admin/applications/export` | `applications.read` | "Exportar a Excel" (CSV con los mismos filtros, máx. 5000) |
| `GET /admin/applications/{id}` | `applications.read` | Detalle (**pasa a "En revisión" al abrir**, ver abajo) |
| `PUT /admin/applications/{id}/evaluations/me` | `applications.evaluate` | Mi evaluación (crear o editar) |
| `POST /admin/applications/{id}/interview` | `applications.interview` | Agendar / reprogramar entrevista por Zoom |
| `POST /admin/applications/{id}/interview/complete` | `applications.interview` | "Realizada" (`outcome: COMPLETED`) o "No asistió" (`NO_SHOW`) |
| `POST /admin/applications/{id}/interview/cancel` | `applications.interview` | Cancelar sin reprogramar (vuelve a "En revisión") |
| `GET /admin/applications/{id}/decision-preview` | `applications.decide` | Vista previa de la decisión y del correo |
| `POST /admin/applications/{id}/approve` | `applications.decide` | Registrar decisión: Aprobada |
| `POST /admin/applications/{id}/reject` | `applications.decide` | Registrar decisión: No seleccionada |
| `POST /admin/applications/{id}/retry-email` | `applications.decide` | [Reintentar envío] de un correo fallido |

### Mapa de criterios de aceptación → API

| Criterio HU-31 | API |
|---|---|
| Ver datos, evidencias, resumen de evaluaciones y comentarios | `GET /admin/applications/{id}` → `contact`, `answers`, `documents[]` (URL firmada ~10 min), `evaluations[]`, `evaluationSummary.label` ("2 aprobar · 1 con dudas · tipo más sugerido: Aguas Libres 50%") |
| Tipo de beca con `requiresInterview` (p. ej. Beca especial) o convocatoria sin entrevista "Realizada" → botón deshabilitado | `decision.blockedReason = "APPLICATION_INTERVIEW_REQUIRED"` (detalle y vista previa); el POST responde `422 APPLICATION_INTERVIEW_REQUIRED` |
| Aguas Libres 50% sobre 10,200 MXN → saldo 5,100 MXN con link a 7 días; "Aprobada – pendiente de pago" | `decision-preview` → `balance {510000, MXN}`, `responseDueAt`; `approve` → `status = APPROVED_PENDING_PAYMENT` (la persona recibe correo + aviso con [Pagar saldo]) |
| Integrante sin permiso de decisión: evalúa pero no ve "Registrar decisión" | `decision.canDecide = false` (y `GET /admin/me` → permisos); los POST de decisión dan 403 |
| Decisión guardada pero correo fallido → "Correo no enviado" + "Reintentar envío" | `decision.emailStatus = FAILED` / `emails[].emailStatus`; `POST …/retry-email` |

### Bandeja (`GET /admin/applications`)

Query: `kind` (`SCHOLARSHIP` = pestaña Becas, `OPEN_CALL` = Convocatorias), `offerId`, `status`
(separados por coma; por defecto todos menos `DRAFT`), `scholarshipTypeId` (tipo de beca solicitado;
antes `level`), `countryCode`,
`requiresInterview=true|false`, `withoutMyEvaluation=true`, `q` (nombre, correo o folio
`BEC-000123`/`CONV-000123`), `sort` = `SUBMITTED_ASC` (por defecto) | `SUBMITTED_DESC` | `DUE_ASC`.

Columnas de beca: `requestedScholarshipTypeId` + `requestedScholarshipType`, `assignedScholarshipTypeId`
+ `assignedScholarshipType` (resumen `{ id, key, name, minPercent, maxPercent, requiresInterview }` con el
rango de la oferta; antes `requestedLevel` / `assignedLevel`) y `assignedPercent`.

Insignias de cada fila: `requiresInterview` ("Requiere entrevista": convocatorias siempre; becas cuyo
tipo asignado —o, si aún no hay decisión, el solicitado— tiene `requiresInterview`), `evaluationCount`,
`myEvaluation` (`null` = "Sin mi evaluación"), `interview` (vigente).

### Detalle y "En revisión"

`GET /admin/applications/{id}`. **Efecto:** si la postulación está "Enviada" y quien la abre tiene
`applications.evaluate` o `applications.decide`, pasa a "En revisión" (aviso solo en el portal) y la
respuesta trae `reviewStarted: true`. Un rol de solo lectura (p. ej. Seguimiento) puede abrirla sin
cambiarla. `prevId` / `nextId` → [Anterior] / [Siguiente] (misma pestaña, orden de envío).

Bloque `decision`: `canDecide` (permiso + estado Enviada / En revisión / Entrevista agendada),
`interviewRequired`, `hasCompletedInterview`, `blockedReason`, `price` (moneda del postulante: MXN
México, USD resto), `scholarshipTypes[]` (antes `levels[]`: tipos habilitados en la oferta, incluidos
los desactivados con `active: false`, cada uno con `scholarshipTypeId`, `scholarshipType` —rango efectivo
de la oferta y `requiresInterview`—, `quota` (mismo formato que en el paso 4; `quota.isFull` →
deshabilita ese tipo en "Registrar decisión") y `balanceAtMaxPercent`), y, ya decidida:
`assignedScholarshipTypeId` + `assignedScholarshipType` (antes `assignedLevel`; `name` es el nombre
guardado al aprobar), `assignedPercent`, `balance`, `responseDueAt`, `decidedBy`,
`decisionNote` (interna) y `emailStatus` del correo de la decisión.

### Evaluación (`PUT …/evaluations/me`)

`{ recommendation: APPROVE | NOT_SELECT | UNSURE, suggestedScholarshipTypeId?, comment? (≤ 2000) }`
(antes `suggestedLevel`). Una por integrante, editable; nunca visible al postulante.
`suggestedScholarshipTypeId` solo en becas y habilitado en la oferta (`400`, `details[].code` =
`NOT_APPLICABLE` / `SCHOLARSHIP_TYPE_NOT_ENABLED`). Cada evaluación devuelve
`suggestedScholarshipTypeId` + `suggestedScholarshipType`; `evaluationSummary` trae
`mostSuggestedScholarshipTypeId` + `mostSuggestedScholarshipType` (antes `mostSuggestedLevel`). Solo mientras está en
revisión → si no, `409 APPLICATION_INVALID_STATE`. Responde el detalle actualizado.

### Entrevista

`POST …/interview { startsAt, endsAt, joinUrl }`: el enlace debe ser `https://…zoom.us/…` (`400`,
`details[].field = joinUrl`). Pasa a "Entrevista agendada" y notifica con la hora en la zona del
postulante + CDMX; si ya estaba agendada, reprograma. Luego `…/interview/complete` (default
`COMPLETED` = "Realizada") o `…/interview/cancel { note? }`.

### Decisión (flujo con vista previa)

1. `GET …/decision-preview?decision=APPROVE&assignedScholarshipTypeId={id}[&assignedPercent=75][&message=…]`
   → `{ status, assignedScholarshipTypeId, assignedScholarshipType, assignedPercent, balance,
   responseDueAt, interviewRequired, blockedReason, email: { subject, body } }`. No guarda nada.
   `assignedPercent` es el % FINAL: entero dentro del rango efectivo del tipo en la oferta
   (`decision.scholarshipTypes[].scholarshipType.minPercent–maxPercent`; fuera → `400 INVALID`). Si el
   rango es fijo (min = max) puedes omitirlo y se toma solo. El tipo debe estar habilitado en la oferta
   (`400 SCHOLARSHIP_TYPE_NOT_ENABLED`); un tipo ya desactivado pero habilitado en la oferta sí se puede
   asignar.
2. La persona revisa el correo (el `message` opcional es el párrafo editable que se agrega al final).
3. `POST …/approve { assignedScholarshipTypeId?, assignedPercent?, note? (interna), message?, emailPreviewConfirmed:
   true }` o `POST …/reject { note?, message?, emailPreviewConfirmed: true }`. Sin
   `emailPreviewConfirmed: true` → `400` (`details[].code = EQUALS`).
4. Resultado: con saldo → `APPROVED_PENDING_PAYMENT` (+ inscripción reservada `PENDING_PAYMENT`); sin
   costo (convocatoria gratuita) → `APPROVED_PENDING_CONFIRMATION`. Estado ya decidido → `409
   APPLICATION_INVALID_STATE`.
5. Si `decision.emailStatus = FAILED`: "Correo no enviado" + [Reintentar envío] →
   `POST …/retry-email` (opcional `notificationId`; por defecto el último fallido) → `{ emailStatus:
   SENT | FAILED }`. Sin correos fallidos → `409 NOTIFICATION_EMAIL_NOT_FAILED`. La decisión nunca se
   pierde ni se repite.

| UI | Respuesta |
|---|---|
| "Decisión registrada y correo enviado a [postulante]" | `200`, `decision.emailStatus = SENT` |
| "Decisión guardada pero correo no enviado" | `200`, `decision.emailStatus = FAILED` |
| Botón deshabilitado "Esta postulación requiere entrevista por Zoom" | `decision.blockedReason` / `422 APPLICATION_INTERVIEW_REQUIRED` |
| Tipo o % inválido | `400 VALIDATION_ERROR` (`assignedScholarshipTypeId` / `assignedPercent`) |
| "Ya no hay cupo para esta beca" | `409 SCHOLARSHIP_TYPE_FULL` (`meta.scope`: `TYPE` cupo global / `OFFER` tope de la oferta); vista previa con `blockedReason = SCHOLARSHIP_TYPE_FULL` |

### Exportar

`GET /admin/applications/export?…filtros` → `text/csv` (UTF-8 con BOM, abre bien en Excel).
Columnas: Folio, Tipo, Estado (texto HU-21), Nombre, Correo, Teléfono, País, Estado/Provincia,
Municipio/Ciudad, Oferta, Beca solicitada, Beca asignada, % asignado, Saldo (centavos), Moneda,
Enviada (CDMX), Plazo (CDMX), Evaluaciones, Requiere entrevista, Entrevista. Descarga con `fetch`
(Bearer) → `blob`.

## Tipos de beca (parametrizables)

Los tipos de beca ya **no son una lista fija** (antes enum `ScholarshipLevel`): un SUPER_ADMIN los crea,
edita, desactiva o borra; cada oferta habilita los suyos en el paso 4 y puede ajustar el rango de % solo
para esa oferta; el comité asigna el % final al aprobar.

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /scholarship-types` | público | Tipos **activos** ordenados (`{ data: [{ id, key, name, description, minPercent, maxPercent, requiresInterview, sortOrder, availableRecipients, isFull }] }`; caché 5 min) |
| `GET /admin/scholarship-types` | `offers.read` | Todos (incluye inactivos) con `active`, `maxRecipients`, `usedRecipients`, `availableRecipients`, `isFull`, `usage { offers, applications, evaluations }`, `createdAt`, `updatedAt` |
| `POST /admin/scholarship-types` | `scholarship_types.write` | Crear `{ key, name, description?, minPercent, maxPercent, requiresInterview?, maxRecipients?, active?, sortOrder? }` → `201` |
| `PATCH /admin/scholarship-types/{id}` | `scholarship_types.write` | Editar `{ name?, description?, minPercent?, maxPercent?, requiresInterview?, maxRecipients?, active?, sortOrder? }` |
| `DELETE /admin/scholarship-types/{id}` | `scholarship_types.write` | Borrar (solo si nada lo usa) → `204` |

Reglas:
- `key`: MAYÚSCULAS_CON_GUION_BAJO (p. ej. `AGUAS_LIBRES`), única (`409 SCHOLARSHIP_TYPE_KEY_TAKEN`) e
  **inmutable**: enviarla en el `PATCH` → `400` (`UNKNOWN_FIELD`). Sugiérela a partir del nombre.
- Rango: enteros `1 ≤ minPercent ≤ maxPercent ≤ 100`; `min = max` = porcentaje fijo. Fuera de 1–100 →
  `400`; `min > max` (también combinando con lo guardado en un `PATCH`) → `422
  SCHOLARSHIP_TYPE_INVALID_RANGE` (`details[].field`).
- `requiresInterview: true` → toda postulación con ese tipo (solicitado o asignado) exige entrevista por
  Zoom "Realizada" antes de aprobar (reemplaza la regla fija "> 70%").
- **Desactivar** (`active: false`): deja de aparecer en `GET /scholarship-types`, en la ficha y en el
  formulario de postulación, y no se puede agregar a otras ofertas (`422 SCHOLARSHIP_TYPE_NOT_AVAILABLE`
  con `SCHOLARSHIP_TYPE_INACTIVE`). Lo ya asignado se conserva; una oferta que ya lo tenía puede
  conservarlo al guardar el paso 4, y el comité aún puede asignarlo. Una oferta sin tipos activos deja de
  ofrecer beca.
- **Borrar**: solo si `usage` está en 0; si alguna oferta, postulación o evaluación lo usa → `409
  SCHOLARSHIP_TYPE_IN_USE` (`meta.usage`): desactívalo en su lugar.
- Editar el rango del tipo afecta a las ofertas que no lo sobrescriben (y a las postulaciones aún no
  decididas). Renombrar no cambia lo ya aprobado: la postulación guarda el nombre al aprobar
  (`assignedScholarshipType.name`).
- **Cupo máximo** (`maxRecipients`, entero ≥ 1; `null` = sin límite; `0` → `400`): cuántas personas
  pueden tener asignada esta beca sumando TODAS las ofertas (p. ej. "15%, 200 cupos"). Además, cada oferta
  puede poner un tope propio (`scholarshipTypes[].maxRecipients` en el paso 4); si existen ambos, aplican
  los dos. **Cupo usado** (`usedRecipients`) = postulaciones con ese tipo ASIGNADO en "Aprobada – pendiente
  de pago", "Aprobada – confirma tu participación" o "Inscrita". No cuentan borradores, enviadas, en
  revisión, entrevista agendada, no seleccionadas ni vencidas: si una aprobada vence, el cupo se libera
  solo. `availableRecipients` = `max − used` (nunca negativo; `null` = sin límite) e `isFull`.
- Aprobar (o reactivar una "Vencida" con [Extender plazo]) sin cupo → `409 SCHOLARSHIP_TYPE_FULL` con
  `meta { scholarshipTypeId, maxRecipients, used, scope: TYPE | OFFER }` (`TYPE` = cupo global, `OFFER` =
  tope de la oferta). La verificación es atómica (bloqueo de fila): dos aprobaciones simultáneas por el
  último lugar → solo una pasa. La vista previa lo anticipa con `blockedReason = SCHOLARSHIP_TYPE_FULL`
  y `decision.scholarshipTypes[].quota.isFull`.
- Bajar `maxRecipients` por debajo de lo ya asignado está permitido: no quita becas, solo bloquea nuevas
  (la respuesta muestra `usedRecipients` > `maxRecipients` y `availableRecipients = 0`).
- Público: un tipo agotado sigue visible en la ficha ("Agotado") pero no se puede solicitar en una
  postulación nueva (`422`, `details[].code = SCHOLARSHIP_TYPE_FULL`). Lo ya enviado no se toca.
- Auditoría: `scholarship_type.create`, `scholarship_type.update` (incluye `maxRecipients` en los
  cambios), `scholarship_type.delete`.

En la oferta (paso 4, `PATCH /admin/offers/{id}/steps/origin-pricing`):

```json
{ "scholarshipEnabled": true,
  "scholarshipTypes": [
    { "scholarshipTypeId": "…AGUAS_LIBRES…" },
    { "scholarshipTypeId": "…SPECIAL…", "minPercent": 75, "maxPercent": 80, "maxRecipients": 10 } ] }
```

- La lista **reemplaza** la anterior. `minPercent`/`maxPercent` opcionales sobrescriben el rango del tipo
  SOLO en esa oferta (null = el del tipo); el rango efectivo debe cumplir 1 ≤ min ≤ max ≤ 100.
  `sortOrder` opcional ordena dentro de la oferta. `maxRecipients` opcional (≥ 1) = tope de becas de
  ese tipo SOLO en esta oferta (además del cupo global).
- Respuesta: `originPricing.scholarshipTypes[]` = `{ scholarshipTypeId, minPercent, maxPercent (overrides),
  sortOrder, maxRecipients (tope de la oferta), active, scholarshipType (rango efectivo), quota }` con
  `quota = { typeMaxRecipients, typeUsedRecipients, offerMaxRecipients, offerUsedRecipients,
  availableRecipients, isFull }`. Duplicar la oferta copia los tipos y overrides.

Pantalla sugerida "Tipos de beca" (solo SUPER_ADMIN; los demás roles la ven en solo lectura): tabla con
nombre, clave, rango, entrevista, estado (Activo/Inactivo) y uso; acciones Editar, Desactivar/Activar y
Borrar (deshabilitado si `usage` > 0).

## HU-32 — Seguimiento de postulación a inscripción (embudo)

Tag **Admin – Seguimiento**. Sin `followup.read` → `403` (no se exponen datos de contacto).

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /admin/funnel/offers?q=` | `followup.read` | Selector: ofertas con postulaciones o inscripciones |
| `GET /admin/funnel/offers/{offerId}` | `followup.read` | Embudo de 4 etapas + tarjetas de resumen |
| `GET /admin/funnel/offers/{offerId}/follow-ups?tab=PENDING\|EXPIRED&paymentStarted=` | `followup.read` | "Aprobados sin pagar" / "Vencidas" |
| `POST /admin/funnel/offers/{offerId}/close-enrollment` | `followup.manage` | "Cerrar inscripciones" |
| `GET /admin/applications/{id}/follow-up` | `followup.read` | Panel lateral: contacto + línea de tiempo |
| `GET /admin/applications/{id}/notes` | `followup.read` | Notas (más reciente primero) |
| `POST /admin/applications/{id}/notes` | `followup.manage` | Nota + resultado |
| `POST /admin/applications/{id}/reminders` | `followup.manage` | Recordatorio por correo (máx. 1 / 24 h) |
| `POST /admin/applications/{id}/whatsapp` | `followup.manage` | Enlace wa.me prellenado + nota automática |
| `POST /admin/applications/{id}/extend-deadline` | `followup.manage` | Extender plazo (reactiva una "Vencida") |

### Mapa de criterios de aceptación → API

| Criterio HU-32 | API |
|---|---|
| Embudo con conteos y % (40 → 30 → 24 → 20 = 50%) | `GET /admin/funnel/offers/{id}` → `stages[]` (`count`, `percentOfApplied`, `percentOfPrevious`), `conversionPercent` |
| "Aprobados sin pagar" por vencimiento, saldo MXN/USD, último contacto; al pagar salen | `…/follow-ups?tab=PENDING` (orden por `responseDueAt`; `dueSoon` = ≤ 2 días; solo estados "Aprobada – pendiente de …") |
| A los 7 días sin pago ni comprobante → "Vencida" (pérdida) | Job de la Fase 04; aparecen en `tab=EXPIRED` y en `expired` del embudo |
| Recordatorio / WhatsApp registran nota; deshabilitado si ya hubo uno en 24 h o sin teléfono | `canRemind`/`remindAvailableAt`, `409 FOLLOW_UP_REMINDER_TOO_SOON`; `phone.whatsappUrl = null`, `422 FOLLOW_UP_PHONE_INVALID` |
| Sin permiso de seguimiento → acceso denegado y sin datos de contacto | `403 FORBIDDEN` (`meta.missingPermissions`) |

### Embudo

`stages[]` en orden: `APPLIED` (Postulados = enviadas), `APPROVED` (Aprobados = alguna vez aprobada:
pendiente de pago/confirmación, inscrita o vencida), `PAYMENT_STARTED` (Con pago iniciado = abrió
Stripe, subió comprobante o creó plan; una inscrita cuenta como iniciada), `ENROLLED` (Inscritos).
Tarjetas: `inReview`, `pendingPayment`, `pendingConfirmation`, `expired`, `notSelected`, `dueSoon`,
`directEnrollments` (inscripciones sin postulación: pago directo, Moodle, gratuitas; no entran al
embudo). Clic en una etapa: usa `tab` y `paymentStarted=true|false` para filtrar la tabla.

### Tabla de seguimiento (`FollowUpItemDto`)

`folio`, `name`, `email`, `phone { countryCode, number, whatsappUrl }`, `countryCode`,
`assignedScholarshipTypeId` + `assignedScholarshipType` (antes `assignedLevel`), `assignedPercent`,
`balance`, `responseDueAt`, `remainingDays` (negativo = vencida), `dueSoon`
(destacar arriba), `pendingTransfer` (comprobante en validación: no vence), `paymentStarted`,
`lastContactAt`, `lastOutcome`, `canRemind`, `remindAvailableAt`.

### Acciones

- **Recordatorio** `POST …/reminders` → correo + notificación (saldo, fecha límite y [Pagar saldo];
  o [Confirmar mi participación]) y nota automática `REMINDER_SENT`. Respuesta `{ sentAt,
  nextAvailableAt, emailStatus, note }`. Otra vez antes de 24 h → `409 FOLLOW_UP_REMINDER_TOO_SOON`
  (`meta.availableAt`). Fuera de "Aprobada – pendiente de …" → `409 APPLICATION_INVALID_STATE`.
- **WhatsApp** `POST …/whatsapp { template? }` → `{ url, text, note }`. El frontend abre `url` en otra
  pestaña (la plataforma no envía WhatsApp). Variables de la plantilla: `{nombre}` (primer nombre),
  `{saldo}` (`$5,100.00 MXN`), `{link_pago}` (`PORTAL_URL/postulaciones/{id}/pago`, o el
  detalle de la postulación si no hay saldo). Omitir `template` = texto por defecto.
- **Notas** `POST …/notes { body (≤ 1000), outcome? }`.
- **Extender plazo** `POST …/extend-deadline { responseDueAt, reason }` → nueva fecha futura y ≤ inicio
  de clases (si no, `400`, `details[].field = responseDueAt`); motivo obligatorio. Una "Vencida" vuelve
  a "Aprobada – pendiente de …" y se reserva de nuevo la inscripción. Queda una nota automática.
- **Cerrar inscripciones** `POST /admin/funnel/offers/{id}/close-enrollment { reason? }` → fija
  `enrollmentClosesAt = ahora` (la ficha pasa a "Inscripciones cerradas"). Ya cerrada o no publicada →
  `409 OFFER_INVALID_STATE`.

Las acciones del seguimiento solo aplican a postulaciones ya aprobadas (pendientes, inscritas o
vencidas); otras → `409 APPLICATION_INVALID_STATE`.

### Línea de tiempo (`timeline[]`, más reciente primero)

| `kind` | Texto |
|---|---|
| `STATUS_CHANGE` | Cambio de estado (título = estado HU-21; `detail` = nota interna) |
| `NOTE` | Nota (incluye "Plazo extendido al …") |
| `REMINDER_SENT` | Recordatorio enviado |
| `WHATSAPP_CONTACT` | Contacto por WhatsApp |
| `PAYMENT` | Pago con tarjeta / por transferencia (monto) |

### Tablas enum → texto (HU-31/32)

#### `EvaluationRecommendation`
| Valor | Texto |
|---|---|
| `APPROVE` | Aprobar |
| `NOT_SELECT` | No seleccionar |
| `UNSURE` | Tengo dudas |

#### `FollowUpOutcome`
| Valor | Texto |
|---|---|
| `NO_RESPONSE` | Sin respuesta |
| `WILL_PAY_SOON` | Pagará pronto |
| `REQUESTS_INSTALLMENTS` | Solicita cuotas |
| `WITHDRAWS` | Desiste |

#### `FollowUpNoteKind`
| Valor | Texto |
|---|---|
| `NOTE` | Nota |
| `REMINDER_SENT` | Recordatorio enviado |
| `WHATSAPP_CONTACT` | Contacto por WhatsApp |

#### Etapas del embudo (`stages[].key`)
| Valor | Texto |
|---|---|
| `APPLIED` | Postulados |
| `APPROVED` | Aprobados |
| `PAYMENT_STARTED` | Con pago iniciado |
| `ENROLLED` | Inscritos |

#### `NotificationEmailStatus` (correos)
| Valor | Texto |
|---|---|
| `SENT` | Correo enviado |
| `FAILED` | Correo no enviado (Reintentar envío) |
| `PENDING` | Enviando… |
| `NOT_REQUESTED` | Solo portal |

### Códigos de error (HU-31/32)

| `code` | HTTP | Cuándo |
|---|---|---|
| `APPLICATION_INVALID_STATE` | 409 | Evaluar fuera de revisión, decidir una ya decidida, cancelar entrevista sin agendar, seguimiento de una no aprobada. `meta.status`. |
| `APPLICATION_INTERVIEW_REQUIRED` | 422 | (Fase 04) Aprobar convocatoria o beca cuyo tipo tiene `requiresInterview` sin entrevista "Realizada". |
| `NOTIFICATION_EMAIL_NOT_FAILED` | 409 | [Reintentar envío] sin correos fallidos. |
| `FOLLOW_UP_REMINDER_TOO_SOON` | 409 | Recordatorio antes de 24 h del anterior. `meta.availableAt`. |
| `FOLLOW_UP_PHONE_INVALID` | 422 | WhatsApp sin teléfono válido con indicativo. |
| `OFFER_INVALID_STATE` | 409 | Cerrar inscripciones ya cerradas o de una oferta no publicada. |

Validación (`400`): `joinUrl` no Zoom (`INVALID`), `emailPreviewConfirmed` ≠ true (`EQUALS`),
`assignedScholarshipTypeId` faltante (`REQUIRED`) o no habilitado (`SCHOLARSHIP_TYPE_NOT_ENABLED`),
`assignedPercent` fuera del rango efectivo (`INVALID`), `suggestedScholarshipTypeId` (`NOT_APPLICABLE` /
`SCHOLARSHIP_TYPE_NOT_ENABLED`), nota > 1000 (`MAX_LENGTH`), `responseDueAt` inválida
(`INVALID`).

### Decisiones y puntos para el cliente (HU-31/32)

- Abrir el detalle (GET) cambia "Enviada" → "En revisión" solo si quien abre puede evaluar o decidir
  (HU-31 literal). Seguimiento/Coordinación de solo lectura no la mueven.
- La decisión la registra cualquier rol con `applications.decide` (REVIEW_DECIDER, ACADEMIC_COORDINATOR,
  SUPER_ADMIN), sin mínimo de evaluaciones (Anexo A HU-31: confirmar si se requieren al menos dos).
- "Plantilla editable" del correo = párrafo libre (`message`) que se agrega al texto estándar de HU-21;
  el resto del texto (estado, tipo de beca y %, saldo, plazo) lo genera el sistema para no contradecir los datos.
- "Con pago iniciado" = `paymentStartedAt` (Anexo A HU-32, por confirmar); las inscritas cuentan como
  iniciadas para que el embudo sea monótono (convocatorias sin costo solo confirman).
- El embudo solo cuenta postulaciones; las inscripciones directas se muestran aparte
  (`directEnrollments`).
- Los recordatorios del panel son independientes del recordatorio automático de 48 h (Fase 04).
- WhatsApp: solo enlace `wa.me` (sin API), como dice el Anexo A.

## HU-33 — Gestión de pagos, cuotas y transferencias (`Admin – Pagos`)

Pantalla con pestañas **Pagos**, **Transferencias por conciliar** (con contador), **Planes de cuotas** y
**Reembolsos**, más un resumen separado por MXN y USD. Todo el equipo puede **consultar**
(`payments.read`); solo **Administración y finanzas** (`FINANCE`) y `SUPER_ADMIN` pueden actuar
(`payments.manage`). Un rol sin finanzas que intenta una acción recibe `403 FORBIDDEN` con
`meta.missingPermissions: ["payments.manage"]` → muestra la pantalla en **solo lectura, sin botones**
(HU-33 "Unauthorized"). Para decidir los botones usa `GET /admin/me` (`permissions`) y, en el detalle,
`actions.canRefund` / `actions.canReview` y `availableActions` de los planes.

### Endpoints

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /admin/payments` | payments.read | Pestaña "Pagos" (paginado; filtros `status` (lista `A,B`), `method`, `concept`, `currency`, `offerId`, `userId`, `q` = folio `PAG-000123` / nombre / correo / oferta, `from`/`to`, `sort` = `CREATED_DESC`·`CREATED_ASC`·`PAID_DESC`·`AMOUNT_DESC`). Por defecto excluye `CANCELLED` (checkouts abandonados). |
| `GET /admin/payments/summary?offerId&from&to` | payments.read | Tarjetas de resumen: `currencies[]` (MXN y USD SIEMPRE por separado: cobrado, reembolsado, neto), `pendingTransfers {count, amount}`, `plans {pastDue, delinquent, accessSuspended}`, `pendingRefunds`. |
| `GET /admin/payments/{id}` | payments.read | Detalle: IDs de Stripe, transferencia (saldo esperado vs. declarado), reembolsos, `actions`. |
| `GET /admin/payments/{id}/proof` | payments.read | Visor del comprobante: URL firmada (~10 min). |
| `GET /admin/transfers?status=PENDING_VALIDATION` | payments.read | "Transferencias por conciliar" (por defecto pendientes, la más antigua primero; contador = `meta.total`). También `VALIDATED`, `REJECTED`, `REFUNDED`. |
| `POST /admin/transfers/{id}/validate` | payments.manage | "Validar y activar inscripción" `{ receivedAmountCents, receivedOn: 'YYYY-MM-DD' }`. |
| `POST /admin/transfers/{id}/reject` | payments.manage | "Rechazar" `{ reason, note? }` (`note` obligatoria con `OTHER`). |
| `GET /admin/payment-plans` · `GET /admin/payment-plans/{id}` | payments.read | "Planes de cuotas" (filtros `status`, `offerId`, `q`; `sort` `FAILED_SINCE_ASC` (default: más días con fallo primero) · `CREATED_DESC`; por defecto excluye `PENDING_ACTIVATION`). |
| `POST /admin/payment-plans/{id}/retry` | payments.manage | [Reintentar cobro] (Cobro fallido / En mora). |
| `POST /admin/payment-plans/{id}/mark-delinquent` | payments.manage | Marcar "En mora" sin esperar al job (solo Cobro fallido). |
| `POST /admin/payment-plans/{id}/suspend-access` | payments.manage | [Suspender acceso] `{ reason }` (solo En mora). |
| `POST /admin/payment-plans/{id}/restore-access` | payments.manage | [Restablecer acceso] `{ reason }`. |
| `POST /admin/payment-plans/{id}/cancel` | payments.manage | [Cancelar plan] `{ reason }`. |
| `POST /admin/payments/{id}/refund` | payments.manage | [Reembolsar] `{ amountCents, reason }`. |
| `GET /admin/refunds` | payments.read | Pestaña "Reembolsos" (filtros `status`, `method`, `offerId`). |

### Mapa de criterios de aceptación → API

| Criterio (HU-33) | API |
|---|---|
| Pago con Stripe aparece "Pagado" con concepto, moneda e ID de Stripe sin intervención | El webhook ya lo registra (Fase 05). `GET /admin/payments`: `status: PAID`, `conceptLabel`, `amount.currency`, `stripe.paymentIntentId`/`chargeId`/`receiptUrl`. |
| Comprobante con monto y fecha que coinciden → "Validada", inscripción activa, aviso | `POST /admin/transfers/{id}/validate` → `status: VALIDATED`; la postulación pasa a "Inscrita" (`ENROLLED`), la inscripción a `ACTIVE` y la persona recibe `TRANSFER_VALIDATED` (portal + correo). |
| Monto recibido menor → no se puede validar; solo rechazar con "Monto no coincide" indicando la diferencia | `422 PAYMENT_TRANSFER_AMOUNT_MISMATCH` con `meta.differenceCents` y `meta.expectedCents` → abre el modal de rechazo con `reason: AMOUNT_MISMATCH` precargado y la diferencia en la nota. |
| Cobro de cuota fallido → "Cobro fallido" (3 reintentos en 7 días); a los 15 días "En mora" y se habilita "Suspender acceso" (manual) | Lo hace el job (Fase 05). En el panel: `status` `PAST_DUE`/`DELINQUENT`, `daysSinceFailure`, `delinquencyAt`, `availableActions` incluye `SUSPEND_ACCESS` solo en `DELINQUENT` con inscripción activa. Ver "Discrepancia" abajo. |
| Sin rol de finanzas → solo consulta | GET con `payments.read` (todo el staff); acciones → `403 FORBIDDEN` (`meta.missingPermissions`). |

### Flujo: conciliar una transferencia

1. `GET /admin/transfers` → lista "Pendiente de validación" (contador `meta.total`). Cada item trae
   `transfer.expectedAmount` (saldo en MXN) junto a lo declarado (`declaredAmount`, `declaredPaidOn`,
   `trackingKey`) y la referencia (`EIA BEC-000123`).
2. Vista dividida: `GET /admin/payments/{id}/proof` → `url` firmada (PDF/JPG/PNG; pide otra al vencer).
3. [Validar y activar inscripción] → modal con monto recibido (centavos) y fecha (≤ hoy) →
   `POST /admin/transfers/{id}/validate`.
   - `200` → "Transferencia validada e inscripción activada".
   - `422 PAYMENT_TRANSFER_AMOUNT_MISMATCH` → "El monto recibido es menor por $X" → solo [Rechazar].
   - `409 PAYMENT_INVALID_STATE` → ya la resolvió otra persona: recarga.
4. [Rechazar] → motivo `ILLEGIBLE` / `AMOUNT_MISMATCH` / `NOT_FOUND` / `OTHER` (+ nota, obligatoria con
   `OTHER`; la ve la persona) → `POST /admin/transfers/{id}/reject` → "Rechazada"; la postulación vuelve a
   correr su plazo y la persona ve [Subir comprobante].

### Flujo: planes de cuotas

Cada plan (`AdminPaymentPlanDto` = el `PaymentPlanDto` de "Mis pagos" + `payer` con correo y teléfono
para [Contactar], `enrollmentStatus`, `accessSuspendedAt`, `delinquentAt`, `cancelledAt`/`cancelReason` y
`availableActions`) trae la mini línea de cuotas (`installments[]`) y `daysSinceFailure`.

| `availableActions` | Botón | Cuándo |
|---|---|---|
| `RETRY` | Reintentar cobro | Cobro fallido o En mora con cuotas fallidas |
| `MARK_DELINQUENT` | Marcar en mora | Cobro fallido |
| `SUSPEND_ACCESS` | Suspender acceso | Solo En mora y con la inscripción activa |
| `RESTORE_ACCESS` | Restablecer acceso | Inscripción suspendida |
| `CANCEL` | Cancelar plan | Plan no completado ni cancelado |

Todas piden **confirmación con su efecto** (HU-33). Respuestas:
- Reintentar: `200` (plan "Al día"; si el acceso estaba suspendido, se restablece solo) · `422
  PAYMENT_CHARGE_FAILED` (`meta.failureMessage`, p. ej. fondos insuficientes) · `503
  PAYMENTS_NOT_CONFIGURED` · `502 PAYMENT_PROVIDER_ERROR`.
- Suspender: la inscripción pasa a `SUSPENDED` (el Aula responde `403 ENROLLMENT_SUSPENDED`) y la
  persona recibe un aviso fijado ("Tu acceso fue suspendido…"). Si luego regulariza el pago (reintento,
  [Pagar ahora] o tarjeta nueva) el acceso se restablece solo y el aviso se desfija.
- Restablecer: `SUSPENDED → ACTIVE` aunque el plan siga en mora (p. ej. acuerdo de pago); aviso
  "Tu acceso fue restablecido".
- Cancelar: plan "Cancelado", cuotas programadas/fallidas canceladas (no se cobran más). **La
  inscripción no cambia**: si además debe perder el acceso, suspéndelo antes.
- Estado que no permite la acción → `409 PAYMENT_PLAN_INVALID_STATE` (`meta.status`, `meta.statusLabel`,
  `meta.enrollmentStatus`): recarga.

### Flujo: reembolso

1. En el detalle (`actions.canRefund`, `refundable` = pagado − reembolsado − en proceso), [Reembolsar] →
   monto (≤ `refundable`) y motivo obligatorio → `POST /admin/payments/{id}/refund`.
2. Tarjeta: se procesa en Stripe. El reembolso queda `SUCCEEDED`, o `PENDING` ("Reembolso en proceso en
   Stripe": se confirma solo al llegar el webhook `charge.refunded`), o `FAILED` (`failureMessage`).
   Transferencia: se **registra** el reembolso hecho fuera de la plataforma (`SUCCEEDED` al instante).
3. Reembolso total → el pago pasa a "Reembolsado" (`REFUNDED`). Parcial → conserva su estado y
   `refunded` muestra lo devuelto. La **inscripción no cambia** (la baja es una decisión aparte).
4. Errores: `422 PAYMENT_REFUND_INVALID` (`meta.refundableCents`), `409 PAYMENT_INVALID_STATE` (pago no
   pagado/validado), `503 PAYMENTS_NOT_CONFIGURED`, `502 PAYMENT_PROVIDER_ERROR` (Stripe no respondió: el
   intento queda `FAILED`; reintenta).

### Estados de UI ↔ respuestas

| Estado (HU-33) | Cómo se detecta |
|---|---|
| Pending | Transferencia `PENDING_VALIDATION` o reembolso `PENDING` |
| Success | `200/201` de validar, reembolsar o reintentar |
| Error | `502 PAYMENT_PROVIDER_ERROR`, `422 PAYMENT_CHARGE_FAILED`, fallo al cargar el comprobante → [Reintentar] |
| Unauthorized | `403 FORBIDDEN` en acciones (`meta.missingPermissions`) o `GET /admin/me` sin `payments.manage` → solo lectura |

### Tablas enum → texto

`RefundStatus`: `PENDING` "En proceso" · `SUCCEEDED` "Reembolsado" · `FAILED` "Fallido".
`PlanAction`: ver tabla de botones arriba.
Se reutilizan `PaymentStatus`, `PaymentConcept`/`PaymentMethod`, `InstallmentPlanStatus`
("Al día", "Cobro fallido", "En mora", "Completado", "Cancelado") y `TransferRejectionReason`
("Ilegible", "Monto no coincide", "No encontrado", "Otro") de [`fase-05-pagos.md`](fase-05-pagos.md).

### Decisiones y puntos para el cliente

- **Discrepancia — suspensión automática vs. manual.** HU-33 ("Suspender solo en En mora… suspensión
  siempre manual") y el Anexo A (HU-24: "la suspensión la decide el equipo; confirmar si debe ser
  automática") piden suspensión **manual**. Hoy `BUSINESS_RULES.SUSPEND_ACCESS_ON_DELINQUENCY = true`:
  al pasar a "En mora" (job o [Marcar en mora]) el sistema **suspende automáticamente**. No se cambió la
  regla; el panel expone de todas formas [Suspender acceso] / [Restablecer acceso]. Opciones:
  (a) dejar `true` (automática; el equipo solo restablece cuando hay acuerdo) o (b) cambiarla a `false`
  (manual, como dice la HU: el plan pasa a "En mora", se avisa a la persona y el equipo decide con
  [Suspender acceso]). Es un cambio de una línea en `src/config/business-rules.ts`.
- **Reembolsos**: no hay política definida (Anexo A HU-33): solo se valida monto ≤ pagado y motivo. No
  cambia la inscripción ni se notifica a la persona (no existe un tipo de aviso de reembolso; Stripe
  envía su propio correo de reembolso si está activado en la cuenta).
- **Cancelar plan** no da de baja ni suspende la inscripción (confirmar si debe hacerlo).
- Reembolsos hechos directamente en el dashboard de Stripe también se reflejan (webhook
  `charge.refunded` → `refunded`), aunque no aparecen como registros en la pestaña "Reembolsos".
- Contactar: el panel no envía WhatsApp; usa `payer.email` / `payer.phone` (mailto / wa.me).

## HU-38 — Bandeja de Contacto

Los mensajes del formulario de Contacto y de la landing (`POST /contact-messages`, Fase 01) se ven en el
panel. La respuesta al visitante se sigue haciendo por correo (el aviso al buzón del equipo trae
`replyTo`); aquí solo se consulta y se marca el estado.

| Método y ruta | Permiso | Uso |
|---|---|---|
| `GET /admin/contact-messages?q=&status=&subject=&origin=&from=&to=&sort=&page=&pageSize=` | `contact.read` | Bandeja paginada (más reciente primero; `sort=CREATED_ASC` invierte). `q` busca en nombre, correo, organización y texto |
| `GET /admin/contact-messages/summary` | `contact.read` | `{ unread, byStatus: [{ status, label, count }] }` para el contador del menú y las pestañas |
| `GET /admin/contact-messages/{id}` | `contact.read` | Detalle (abrirlo NO cambia el estado) |
| `PATCH /admin/contact-messages/{id} { status?, internalNote? }` | `contact.manage` | Cambia estado y/o nota interna (al menos uno; `internalNote: null` la borra). Guarda `handledBy`/`handledAt`. Auditoría `contact.update` |

Cada mensaje trae `subjectLabel`, `originLabel` y `statusLabel` en español, `phone` (o `null`), y para
`DESIGN_CONSULTING` también `projectType`, `projectLocation` y `service`.

| `ContactStatus` | Texto | Sugerencia de UI |
|---|---|---|
| `NEW` | Nuevo | Negrita / punto; cuenta en `summary.unread` |
| `IN_PROGRESS` | En atención | Alguien lo está atendiendo (`handledBy`) |
| `ANSWERED` | Respondido | Cerrado con respuesta |
| `ARCHIVED` | Archivado | Spam o sin acción; oculto por defecto |

Cualquier transición está permitida. Flujo sugerido: abrir → [Responder por correo] (`mailto:` con el
correo del visitante) → marcar `ANSWERED`.

## Datos demo

Fuera de producción el seed crea `admin@example.com` / `Admin12345` (`SUPER_ADMIN`, todos los
permisos) y las ofertas demo, que se pueden editar desde el panel (el seed las vuelve a sobrescribir en
cada arranque mientras `SEED_DEMO_DATA` esté activo). Para probar otros roles, asígnalos desde
`PUT /admin/users/{id}/roles` a una cuenta registrada (p. ej. `participante@example.com`). En
producción no hay usuarios demo: el primer SUPER_ADMIN se crea con `BOOTSTRAP_ADMIN_*` o
`pnpm admin:create` (ver `docs/DEPLOY.md`, sección 8).
