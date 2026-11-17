# Fase 04 — Postulaciones: becas y convocatorias

Guía para implementar en el frontend **HU-19** (Postulación a beca de diplomado), **HU-20**
(Postulación a convocatoria de programa presencial) y **HU-21** (Seguimiento de mis postulaciones),
más lo que esta fase agrega a la ficha (HU-16), al Dashboard (HU-06), al Calendario (HU-10) y a las
notificaciones (HU-13).

- Convenciones generales (errores, fechas, dinero, paginación): [`README.md`](README.md)
- Códigos de error: [`errores.md`](errores.md#fase-04--postulaciones)
- Contrato exacto: [`openapi/openapi.json`](../../openapi/openapi.json) o `http://localhost:3000/docs`
  (tag **Postulaciones**)

Todas las rutas llevan el prefijo `/api/v1` y **requieren sesión** (`Authorization: Bearer`).
Fechas en **UTC ISO 8601**; dinero en centavos + moneda (MXN si el país del perfil es México; USD en
otro caso).

## Resumen de endpoints

| Método y ruta | HU | Uso |
|---|---|---|
| `GET /me/applications/opportunities?kind=SCHOLARSHIP\|OPEN_CALL` | 19, 20 | Pestañas "Becas disponibles" / "Convocatorias abiertas" |
| `GET /me/applications?kind=&status=` | 21 | Pestaña "Mis postulaciones" (Becas o Convocatorias) |
| `POST /me/applications { offerId, …campos }` | 19, 20 | [Postular a beca] / [Postular]: crea el **borrador** |
| `GET /me/applications/{id}` | 19, 20, 21 | Formulario del borrador y "Ver mi postulación" |
| `PATCH /me/applications/{id} { …campos }` | 19, 20 | Autoguardado ("Borrador guardado · hh:mm") |
| `DELETE /me/applications/{id}` | — | Descartar borrador |
| `POST /me/applications/{id}/documents/upload-url` | 19, 20 | Evidencia paso 1: pedir URL de carga |
| `PUT {uploadUrl}` (storage) | 19, 20 | Evidencia paso 2: subir el archivo |
| `POST /me/applications/{id}/documents { key, fileName }` | 19, 20 | Evidencia paso 3: confirmar |
| `DELETE /me/applications/{id}/documents/{documentId}` | 19, 20 | Quitar archivo del borrador |
| `GET /me/applications/{id}/documents/{documentId}/download` | 21 | Ver/descargar un archivo propio |
| `POST /me/applications/{id}/submit` | 19, 20 | [Enviar postulación] → folio y "Enviada" |
| `POST /me/applications/{id}/confirm` | 21 | [Confirmar mi participación] (sin costo) |

`{id}` es el `id` de la postulación. Ruta sugerida del frontend: `/postulaciones/{id}` (es la
que usan las notificaciones; ver `notifications/portal-links.ts`).

## Mapa de criterios de aceptación → API

| HU | Criterio | Endpoint / regla |
|---|---|---|
| 19 | Envío válido → folio, "Enviada", correo y notificación, visible al equipo | `POST …/submit` → `folio`, `status = SUBMITTED`; notificación `APPLICATION_SUBMITTED` (portal + correo) |
| 19 | Tipo de beca → monto estimado en mi moneda; tipo con entrevista → aviso | `form.scholarshipTypes[]` (`estimatedScholarship`, `estimatedBalance`, `scholarshipType.requiresInterview`), `form.interviewNotice` |
| 19 | Curso/taller/evento, sin beca o convocatoria cerrada → no se postula y veo el motivo | `opportunities` (`window.reason`, `canApply`), ficha `actions[]`; `POST` → `APPLICATION_NOT_ALLOWED` / `APPLICATION_WINDOW_CLOSED` |
| 19 | Ya postulé a esa cohorte → voy a la existente | `POST` → `409 APPLICATION_ALREADY_EXISTS` (`meta.applicationId`); `myApplication` / `VIEW_APPLICATION` |
| 19 | Carta 800–4000, ≥ 1 evidencia, términos → validaciones en línea y "Enviar" deshabilitado | `missingRequirements[]` en cada `GET`/`PATCH`; `submit` → `422 APPLICATION_INCOMPLETE` con `details[]` |
| 20 | Convocatorias abiertas: lugar, fechas, cierre en mi zona, elegibilidad, por cierre más próximo | `GET …/opportunities?kind=OPEN_CALL` (ya ordenadas) |
| 20 | Envío → folio, aviso de entrevista por Zoom, correo/notificación, "Enviada" | Igual que 19; el cuerpo de la notificación incluye el aviso de entrevista |
| 20 | País no elegible o "No" a viajar → motivo y no puedo enviar | `form.eligibility` (`eligible`, `reasons`); `submit` → `422 APPLICATION_NOT_ELIGIBLE` |
| 20 | Ya postulé o cerró → mi postulación o "Cerrada" sin botón | `myApplication`, `window.state = CLOSED`; ficha `VIEW_APPLICATION` |
| 20 | Obligatorios vacíos o fuera de rango → validaciones sin perder lo escrito | `missingRequirements[]`, `PATCH` guarda parcial |
| 21 | Solo mis postulaciones del tipo, con estado, línea de tiempo y notificación por cambio | `GET /me/applications?kind=` (`timeline[]`); cada cambio emite notificación |
| 21 | Entrevista: hora en mi zona + CDMX y Zoom habilitado 10 min antes | `interview.startsAt` + `interview.join` (`url` solo con `state = OPEN`) |
| 21 | Aprobada: tipo de beca y % asignados, saldo y [Pagar saldo]; sin costo [Confirmar mi participación]; al completar "Inscrita" | `scholarshipResult`, `response`, `action`; `POST …/confirm` |
| 21 | 7 días sin pago ni comprobante → "Vencida"; con comprobante pendiente no vence | Job de vencimientos (`EXPIRED`, notificación `APPLICATION_EXPIRED`); `response.transferPendingValidation` |
| 21 | Postulación ajena por URL → acceso negado | `404 NOT_FOUND` (no se revela que existe) |

---

## Pestañas "Becas disponibles" / "Convocatorias abiertas"

`GET /me/applications/opportunities?kind=SCHOLARSHIP` (o `OPEN_CALL`) → `{ data: Opportunity[] }`
(sin paginar; pocas ofertas).

```json
{
  "kind": "OPEN_CALL",
  "offer": { "id": "…", "slug": "aprendices-del-agua-2027", "name": "Aprendices del Agua 2027", "type": "OPEN_CALL",
             "modality": "IN_PERSON", "cohortLabel": "Convocatoria 2027", "coverImageUrl": "…",
             "startsAt": "2027-02-15T15:00:00.000Z", "endsAt": "…", "venue": { "name": "Ecoaldea Río Vivo", "city": "…" } },
  "window": { "state": "OPEN", "opensAt": "…", "closesAt": "2026-12-01T05:59:00.000Z", "reason": null },
  "price": null,
  "scholarshipTypes": [],
  "eligibility": { "text": "Jóvenes de 18 a 30 años de México y Centroamérica…", "countries": [{ "code": "MX", "name": "México" }],
                   "requiresTravel": true, "eligible": true, "reasons": [] },
  "myApplication": null,
  "canApply": true,
  "enrolled": false
}
```

- Incluye ventanas **abiertas** (primero, por cierre más próximo) y **próximas** (`window.state =
  UPCOMING`, `reason = SCHOLARSHIP_NOT_OPEN_YET` / `ENROLLMENT_NOT_OPEN_YET`, abre en `opensAt`).
- Tarjeta: etiqueta "Presencial" (`offer.modality`), lugar (`offer.venue`), costo (`price`; `null` =
  "Gratuito"), cuenta regresiva "Cierra en 5 días" con `window.closesAt` en la zona del usuario.
- Becas: `scholarshipTypes[]` (antes `levels[]`, incluye `availableRecipients` / `isFull` del cupo): por tipo activo, `scholarshipType` (`name`, rango
  `minPercent`–`maxPercent` efectivo en la oferta, `requiresInterview`) y monto estimado en la moneda
  del perfil. Mismo formato que `scholarshipDetails.scholarshipTypes[]` de la ficha (Fase 02).
- Botón: `canApply` → [Postular] / [Postular a beca]; `myApplication` → [Ver mi postulación] (una por
  cohorte); `enrolled` → "Ya estás inscrito".
- Elegibilidad destacada al inicio: `eligibility.text` + `eligible`/`reasons` (ver tabla abajo).
- Vacío → "Por ahora no hay convocatorias abiertas. Te avisaremos cuando abra una."
- Llamar con `kind=OPEN_CALL` marca las convocatorias como **vistas** (resetea `newCount` del widget
  del Dashboard).

## Flujo del formulario (HU-19 / HU-20)

```
[Postular] ──POST /me/applications {offerId}──▶ borrador (201)
     │              409 APPLICATION_ALREADY_EXISTS → ir a /postulaciones/{meta.applicationId}
     ▼
Formulario  ◀── GET /me/applications/{id} (form, answers, applicant, documents, missingRequirements)
  autoguardado: PATCH /me/applications/{id} {campo…}  (debounce ~1 s; "Borrador guardado · {updatedAt}")
  evidencias:   upload-url → PUT → POST …/documents
     ▼
[Enviar postulación] (habilitado si missingRequirements = [] y eligibility.eligible)
  POST /me/applications/{id}/submit → status SUBMITTED + folio → pantalla de confirmación
```

### Campos

Todos se envían en `POST` (opcional) o `PATCH`; `null` borra; los obligatorios se exigen al enviar.
Enviar un campo del otro tipo → `400` con `details[].code = NOT_APPLICABLE`.

| Campo | Beca (HU-19) | Convocatoria (HU-20) | Validación |
|---|---|---|---|
| `phone { countryCode, number }` | WhatsApp (precargado) | igual | Formato del perfil; longitud por país (`INVALID_PHONE`) |
| `age` | **Obligatorio** | — | Entero 15–100 |
| `partnerCode` | Opcional (código de iniciativa aliada) | Opcional | ≤ 40 |
| `requestedScholarshipTypeId` (antes `requestedLevel`) | **Obligatorio** | — | Un `scholarshipTypeId` de `form.scholarshipTypes` (otro o desactivado → `400 SCHOLARSHIP_TYPE_NOT_ENABLED`; agotado, `isFull` → `422 BUSINESS_RULE_VIOLATION` con `details[].code = SCHOLARSHIP_TYPE_FULL`) |
| `intentLetter` | **Obligatorio** | — | 800–4000 caracteres (contador) |
| `eligibilityConfirmed` | — | **Debe ser `true`** | Casilla "Cumplo con la elegibilidad" |
| `organization`, `organizationRole` | Opcionales | **Obligatorios** | ≤ 150 / ≤ 120 |
| `experience`, `motivation` | — | **Obligatorios** | 300–2000 caracteres cada uno |
| `canTravel` | — | **Obligatorio si `form.eligibility.requiresTravel`**; `false` bloquea el envío | Sí/No |
| `evidenceLinks[]` | Opcional | Opcional | Máx. 5 URLs `https://…` (reemplaza la lista) |
| `termsAccepted` | **Debe ser `true`** | **Debe ser `true`** (incluye aceptar la entrevista por Zoom) | |
| Archivos (`documents`) | **Mín. 1**, máx. 10 | Opcionales, máx. 10 | JPG/PNG/HEIC ≤ 15 MB; MP4/MOV ≤ 100 MB |

Datos de contacto (`applicant`: nombre, correo **no editable**, país, estado, municipio, moneda) vienen
del perfil (HU-14). Para cambiarlos, la persona edita su perfil; el backend vuelve a tomarlos al guardar
y al enviar.

### Validaciones en línea (`missingRequirements`)

Cada `GET`/`PATCH` del borrador devuelve la lista de pendientes. Mientras no esté vacía, "Enviar
postulación" va deshabilitado. Pinta cada `message` bajo su `field` (`documents` = sección de
evidencias):

```json
[
  { "field": "intentLetter", "code": "MIN_LENGTH", "message": "La carta de intención debe tener al menos 800 caracteres (llevas 120)." },
  { "field": "documents", "code": "MIN_FILES", "message": "Adjunta al menos una foto o video de tu experiencia territorial." },
  { "field": "termsAccepted", "code": "MUST_ACCEPT", "message": "Acepta los términos para enviar." }
]
```

`code`: `REQUIRED`, `MIN_LENGTH`, `MAX_LENGTH`, `MIN_FILES`, `MUST_ACCEPT`,
`SCHOLARSHIP_TYPE_NOT_ENABLED` (antes `LEVEL_NOT_ENABLED`: el tipo ya no está disponible, p. ej. se
desactivó después de guardar el borrador → pide elegir otro), `SCHOLARSHIP_TYPE_FULL` (el tipo se
agotó después de guardar el borrador → pide elegir otro). Los
mismos llegan en `details[]` de `422 APPLICATION_INCOMPLETE` si se intenta enviar.

### Bloque `form`

| Campo | Uso |
|---|---|
| `window` | `OPEN` editable; `CLOSED` → "Convocatoria cerrada": solo lectura (`editable = false`) |
| `scholarshipTypes[]` | Tarjetas de tipo de beca con % y monto estimado ("el tipo final lo asigna el equipo"); antes `levels[]`. `isFull` → tarjeta "Agotado" deshabilitada; `availableRecipients` = lugares que quedan (`null` = sin límite) |
| `price` | Resumen lateral: costo en tu moneda (`null` = gratuito) |
| `eligibility` | Bloque destacado; `eligible = false` bloquea el envío (ver motivos) |
| `interviewNotice` | Mostrar "Incluye entrevista por Zoom" (convocatorias siempre; becas si el tipo solicitado tiene `requiresInterview`). En el formulario usa también `scholarshipTypes[].scholarshipType.requiresInterview` del tipo elegido antes de guardar |
| `limits` | Contadores, límites de archivos y tipos aceptados (`accept` del input) |

Motivos de elegibilidad (`eligibility.reasons[]`, también en `meta.reasons` del error):

| Valor | Texto |
|---|---|
| `COUNTRY_NOT_ELIGIBLE` | "Esta convocatoria está {eligibility.text}" (p. ej. "dirigida a mujeres lideresas de Centroamérica y México") |
| `TRAVEL_REQUIRED` | "Debes poder asistir de forma presencial durante todo el programa" |

### Evidencias (URL firmada)

```ts
// 1) Pedir URL (valida tipo y tamaño declarados)
const { data } = await api.POST('/api/v1/me/applications/{id}/documents/upload-url', {
  params: { path: { id } },
  body: { fileName: file.name, contentType: file.type, sizeBytes: file.size },
});
// 2) Subir directo a storage (usa XHR para la barra de progreso)
await fetch(data.uploadUrl, { method: 'PUT', headers: data.headers, body: file });
// 3) Confirmar (el backend verifica tipo y tamaño REALES)
const { data: doc } = await api.POST('/api/v1/me/applications/{id}/documents', {
  params: { path: { id } }, body: { key: data.key, fileName: file.name },
});
```

| Error | UI |
|---|---|
| `APPLICATION_INVALID_FILE` (422) | "El archivo debe ser JPG, PNG o HEIC de máximo 15 MB, o MP4/MOV de máximo 100 MB" (sin perder lo capturado) |
| `APPLICATION_TOO_MANY_FILES` (422, `meta.max`) | "Máximo 10 archivos" |
| `APPLICATION_UPLOAD_NOT_FOUND` (422) | El PUT no llegó o falló: reintentar la subida |

Quitar: `DELETE …/documents/{documentId}` (204). Ver: `GET …/documents/{documentId}/download` (URL
firmada ~10 min; pide otra si vence).

### Enviar

`POST /me/applications/{id}/submit` → `200` con el detalle (`status = SUBMITTED`, `folio`). Pantalla de
éxito: "Postulación enviada · Folio BEC-000123" (+ en convocatorias: "Te contactaremos para una
entrevista por Zoom") y botón a "Mis postulaciones".

| Error | HTTP | UI |
|---|---|---|
| `APPLICATION_INCOMPLETE` | 422 | Pinta `details[]` por campo |
| `APPLICATION_NOT_ELIGIBLE` | 422 | Motivo (`meta.reasons`, `meta.eligibilityText`) |
| `APPLICATION_WINDOW_CLOSED` | 422 | "La convocatoria cerró" → solo lectura |
| `APPLICATION_NOT_EDITABLE` | 409 | Ya se envió (doble clic): recarga el detalle |

Deshabilita el botón mientras envías ("Enviando…").

---

## HU-21 — Mis postulaciones y "Ver mi postulación"

`GET /me/applications?kind=SCHOLARSHIP` (pestaña de Becas) o `kind=OPEN_CALL` (Convocatorias), paginado.
Orden: las que **requieren acción** (`requiresAction`: entrevista, pago o confirmación) arriba por fecha
más próxima (`action.dueAt`), luego por último cambio.

```json
{
  "id": "…", "folio": "BEC-000123", "kind": "SCHOLARSHIP", "status": "APPROVED_PENDING_PAYMENT",
  "statusChangedAt": "…", "submittedAt": "…", "updatedAt": "…",
  "offer": { "id": "…", "slug": "…", "name": "Diplomado en Gestión Comunitaria del Agua", "cohortLabel": "Generación 2027", … },
  "requiresAction": true,
  "action": { "type": "PAY_BALANCE", "enabled": true, "reason": null, "dueAt": "2026-11-14T05:59:00.000Z" },
  "timeline": [ { "key": "SUBMITTED", "state": "DONE", "at": "…" }, { "key": "IN_REVIEW", "state": "DONE", "at": "…" },
                { "key": "RESULT", "state": "DONE", "at": "…" }, { "key": "PAYMENT", "state": "CURRENT", "at": null },
                { "key": "ENROLLED", "state": "UPCOMING", "at": null } ],
  "interview": null,
  "scholarshipResult": { "requestedScholarshipTypeId": "…", "requestedScholarshipType": { "id": "…", "key": "AGUAS_LIBRES", "name": "Aguas Libres", "minPercent": 50, "maxPercent": 50, "requiresInterview": false },
                         "assignedScholarshipTypeId": "…", "assignedScholarshipType": { "id": "…", "key": "AGUAS_LIBRES", "name": "Aguas Libres", "minPercent": 50, "maxPercent": 50, "requiresInterview": false },
                         "assignedPercent": 50,
                         "originalAmount": { "amountCents": 1020000, "currency": "MXN" },
                         "balance": { "amountCents": 510000, "currency": "MXN" }, "dueAt": "…" },
  "response": { "kind": "PAYMENT", "dueAt": "…", "amount": { "amountCents": 510000, "currency": "MXN" },
                "transferPendingValidation": false }
}
```

`GET /me/applications/{id}` agrega `answers`, `documents`, `applicant`, `history[]` (estados con fecha y
hora), `form`, `missingRequirements` y `editable`. `answers.requestedScholarshipTypeId` + `answers.requestedScholarshipType`
(resumen con el rango de la oferta) reemplazan a `answers.requestedLevel`. Una postulación ya enviada
no se ve afectada si su tipo se agota después (el cupo solo cuenta becas asignadas). Postulación ajena o id inválido → `404`.

### Línea de tiempo (`timeline[]`)

Enviada → En revisión → Entrevista (si aplica) → Resultado → Pago o confirmación → Inscrita. Vertical en
mobile.

| `key` | Texto | | `state` | UI |
|---|---|---|---|---|
| `SUBMITTED` | Enviada | | `DONE` | ✓ con fecha (`at`, puede ser null) |
| `IN_REVIEW` | En revisión | | `CURRENT` | Etapa actual (resaltada) |
| `INTERVIEW` | Entrevista | | `UPCOMING` | Pendiente (gris) |
| `RESULT` | Resultado | | `SKIPPED` | No aplicó (oculta o tachada) |
| `PAYMENT` / `CONFIRMATION` | Pago del saldo / Confirmación | | `FAILED` | "No seleccionada" (Resultado) o "Vencida" (Pago/Confirmación) |
| `ENROLLED` | Inscrita | | | |

En convocatorias sin costo (`CONFIRMATION`) no muestres bloques de beca ni de pago.

### Acción contextual (`action`)

| `type` | Botón | Nota |
|---|---|---|
| `CONTINUE_DRAFT` | [Continuar] | `enabled = false`, `reason = WINDOW_CLOSED` → "Convocatoria cerrada" (solo lectura) |
| `JOIN_INTERVIEW` | [Entrar a la entrevista] | Abre `interview.join.url`. `reason`: `INTERVIEW_NOT_OPEN_YET` ("Disponible 10 min antes", cuenta regresiva a `interview.join.opensAt`; al llegar vuelve a pedir el detalle), `INTERVIEW_LINK_PENDING`, `INTERVIEW_ENDED` ("En espera de resultado") |
| `PAY_BALANCE` | [Pagar saldo] | Fase 05 (HU-23): `/postulaciones/{id}/pago`. Cuenta regresiva a `dueAt` |
| `CONFIRM_PARTICIPATION` | [Confirmar mi participación] | `POST /me/applications/{id}/confirm`. Cuenta regresiva a `dueAt` |
| `GO_TO_CLASSROOM` | [Ir a mi aula] | `/aula/{offer.id}` |
| `VIEW` | [Ver mi postulación] | Solo lectura |

### Entrevista (`interview`, solo en "Entrevista agendada")

`startsAt`/`endsAt` en UTC: muestra "11:00 tu hora · 10:00 hora CDMX" (HU-11). `join` sigue las mismas
reglas que las sesiones (HU-12): `url` **solo** con `state = OPEN` (10 minutos antes y hasta el fin).
También aparece en el Calendario (ver abajo) y llega un recordatorio 24 h antes.

### Resultado y respuesta

- `scholarshipResult` (solo becas aprobadas): tipo solicitado y asignado (`assignedScholarshipType.name` es
  el nombre que tenía al aprobar: no cambia si el tipo se renombra), `assignedPercent` (el % final),
  monto original, **saldo** en
  tu moneda y fecha límite (7 días naturales, sin superar el inicio del diplomado).
- `response` (solo en "Aprobada – …"): `kind` `PAYMENT` (con `amount`) o `CONFIRMATION`, `dueAt` y
  `transferPendingValidation` (Fase 05: comprobante "Pendiente de validación" → no vence).
- [Confirmar mi participación] → `POST …/confirm` → `200` con `status = ENROLLED` y acceso al Aula
  (aparece en Mi formación). Errores: `APPLICATION_DEADLINE_PASSED` (422, `meta.dueAt`),
  `APPLICATION_INVALID_TRANSITION` (409, `meta.status`: ya no espera confirmación).
- Vencida (`EXPIRED`): desaparece [Pagar saldo]; "El plazo venció. Contacta al equipo" (el equipo puede
  extender el plazo, HU-32).

---

## Integraciones con otras pantallas

### Ficha de la oferta (HU-16)

Con sesión, `viewer.application` trae mi postulación (`{ id, kind, status, folio }`) y `actions[]`
cambia (campos nuevos en cada acción: `applicationId`, `applicationStatus`):

| Situación | `actions[]` |
|---|---|
| Diplomado con beca, sin postulación | […, `APPLY_SCHOLARSHIP`] (igual que la Fase 02) |
| Diplomado con postulación en curso | [`ENROLL_AND_PAY`, (`PAY_IN_INSTALLMENTS`), `VIEW_APPLICATION`] |
| Postulación "Aprobada – pendiente de pago" ("Pendiente de pago") | [`PAY_BALANCE` (principal), `VIEW_APPLICATION`] |
| Convocatoria sin postulación | [`APPLY_OPEN_CALL`] |
| Convocatoria con postulación | [`VIEW_APPLICATION`] |
| Inscrito | [`GO_TO_CLASSROOM`] |

`APPLY_SCHOLARSHIP` / `APPLY_OPEN_CALL` → `POST /me/applications { offerId }` (o al formulario).
`VIEW_APPLICATION` / `PAY_BALANCE` → `/postulaciones/{applicationId}` (`…/pago`).

### Dashboard (HU-06)

`GET /me/dashboard` agrega dos bloques (independientes; si fallan llegan `null` y en `failedBlocks`
como `scholarships` / `openCalls`):

```json
"scholarships": { "latest": { /* ApplicationCard */ }, "actionRequired": 1, "openCount": 2, "newCount": 0 },
"openCalls":    { "latest": null, "actionRequired": 0, "openCount": 2, "newCount": 1 }
```

- **Widget Becas** (siempre visible): estado de `latest` (mismos textos que Mis postulaciones) → enlace a
  Mis postulaciones; `latest = null` → "Postula a una beca" (`openCount` disponibles).
- **Widget Convocatorias**: `newCount` "N nuevas" (desde tu última visita a Convocatorias abiertas) y
  estado de mi postulación.

### Calendario (HU-10)

Las entrevistas aparecen como "Fecha importante": `source = APPLICATION`, `kind = INTERVIEW`,
`category = IMPORTANT_DATES`, `join` (Zoom 10 min antes) y
`link = { kind: "APPLICATION", applicationId, offerId, slug }` → `/postulaciones/{applicationId}`.

### Notificaciones (HU-13)

Todas en la categoría `APPLICATIONS` (salvo el recordatorio de saldo, `PAYMENTS`) y por correo, salvo
"En revisión" (solo portal). Usan el mismo nombre de estado que Mis postulaciones; `data` trae
`applicationId`, `offerId`, `status`, `folio`.

| `type` | Cuándo | Acción (`action.path`) |
|---|---|---|
| `APPLICATION_SUBMITTED` | Al enviar (folio; en convocatorias, aviso de entrevista) | Ver mi postulación → `/postulaciones/{id}` |
| `APPLICATION_STATUS_CHANGED` | En revisión (**solo portal**), Aprobada – confirma tu participación, Aprobada (convocatoria con costo), Inscrita, No seleccionada | Ver / Confirmar / Ir a mi aula |
| `INTERVIEW_SCHEDULED` | Entrevista agendada o reprogramada (hora local + CDMX) | Ver mi entrevista |
| `INTERVIEW_REMINDER` | 24 h antes de la entrevista | Ver mi entrevista |
| `SCHOLARSHIP_APPROVED` | Beca aprobada: tipo de beca y %, saldo, fecha límite | Pagar saldo → `/postulaciones/{id}/pago` |
| `BALANCE_DUE_REMINDER` | 48 h antes de vencer el saldo | Pagar saldo |
| `APPLICATION_EXPIRED` | Venció sin pago/confirmación | Ver mi postulación |

---

## Tablas enum → texto

### `ApplicationStatus` (HU-21)

| Valor | Texto | Color sugerido |
|---|---|---|
| `DRAFT` | Borrador | gris |
| `SUBMITTED` | Enviada | azul |
| `IN_REVIEW` | En revisión | azul |
| `INTERVIEW_SCHEDULED` | Entrevista agendada | morado |
| `APPROVED_PENDING_PAYMENT` | Aprobada – pendiente de pago | ámbar |
| `APPROVED_PENDING_CONFIRMATION` | Aprobada – confirma tu participación | ámbar |
| `ENROLLED` | Inscrita | verde |
| `NOT_SELECTED` | No seleccionada | gris |
| `EXPIRED` | Vencida | rojo |

### `ApplicationKind`

| Valor | Texto |
|---|---|
| `SCHOLARSHIP` | Beca |
| `OPEN_CALL` | Convocatoria |

### Tipos de beca (antes enum `ScholarshipLevel`)

Ya no hay enum: muestra `scholarshipType.name` y los % que llegan en la respuesta. Ver
[Fase 02 — Tipos de beca](fase-02-oferta.md#tipos-de-beca-antes-enum-scholarshiplevel).

### `InterviewStatus`

| Valor | Texto |
|---|---|
| `SCHEDULED` | Agendada |
| `COMPLETED` | Realizada |
| `CANCELLED` | Cancelada |
| `NO_SHOW` | No asistió |

### Ventana (`window.reason`) — mismos textos que la ficha

| Valor | Texto |
|---|---|
| `SCHOLARSHIP_NOT_OPEN_YET` / `ENROLLMENT_NOT_OPEN_YET` | "La convocatoria abre el {opensAt}" |
| `SCHOLARSHIP_CLOSED` / `ENROLLMENT_CLOSED` | "Convocatoria cerrada" |
| `OFFER_FINISHED` | "Esta oferta finalizó" |

## Datos demo (seed, fuera de producción)

`participante@example.com` / `Demo12345` tiene:

| Oferta | Postulación |
|---|---|
| Diplomado en Gestión Comunitaria del Agua (nueva oferta demo con becas abiertas) | Beca Aguas Libres 50% **Aprobada – pendiente de pago**: saldo $5,100 MXN (ficha con [Pagar saldo]) |
| Aprendices del Agua 2027 | Convocatoria con **Entrevista agendada** el 12/11/2026 10:00 hora CDMX (en el calendario) |
| Siembra de Agua 2027 | **Borrador** a medias ([Continuar]) |

Para probar [Postular a beca] desde cero, usa otra cuenta (el demo ya está inscrito en el Diplomado en
Ecotecnologías del Agua). El seed no pisa los cambios que hagas desde el portal.
