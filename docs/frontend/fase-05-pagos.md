# Fase 05 — Pagos: Stripe, saldo tras beca, transferencias, cuotas, Moodle y Mis pagos

Guía para implementar en el frontend **HU-22** (inscripción y pago completo con Stripe), **HU-23**
(pago del saldo tras beca: tarjeta o transferencia México), **HU-24** (plan de cuotas con cobro
automático), **HU-25** (acceso de inscritos por Moodle), **HU-26** (Mis pagos y comprobantes) y la
pestaña "Mis pagos" de **HU-14**, más lo que cambia en la ficha (HU-16), Mis postulaciones (HU-21),
el Dashboard (HU-06), el Aula (HU-08/17) y las notificaciones (HU-13).

- Convenciones generales (errores, fechas, dinero, paginación): [`README.md`](README.md)
- Códigos de error: [`errores.md`](errores.md#fase-05--pagos-y-acceso-moodle)
- Contrato exacto: [`openapi/openapi.json`](../../openapi/openapi.json) o `http://localhost:3000/docs`
  (tags **Pagos**, **Acceso Moodle**, **Webhooks**)

Todas las rutas llevan el prefijo `/api/v1` y **requieren sesión** (`Authorization: Bearer`).
Dinero SIEMPRE en centavos + moneda (`{ amountCents, currency }`). **El frontend nunca envía montos a
cobrar**: el backend los calcula (precio fijo por moneda o saldo de la postulación). El portal nunca
ve datos de tarjeta: el pago ocurre en **Stripe Checkout** (página hospedada por Stripe).

## Resumen de endpoints

| Método y ruta | HU | Uso |
|---|---|---|
| `GET /me/payments/quote?offerId=` | 22, 24 | Pantalla "Resumen" de [Inscribirme y pagar] / [Pagar en cuotas] |
| `GET /me/payments/quote?applicationId=` | 23, 24 | Pantalla "Pagar saldo" de una beca aprobada |
| `POST /me/payments/checkout` | 22, 23, 24 | [Pagar con tarjeta] → `checkoutUrl` de Stripe |
| `GET /me/payments/{id}` | 22, 26 | Estado al volver de Stripe ("Procesando pago…") y detalle |
| `POST /me/payments/{id}/cancel` | 22 | "Pago cancelado": cierra el checkout y libera el cupo |
| `POST /me/payments/transfers/upload-url` | 23 | Comprobante paso 1: URL firmada |
| `PUT {uploadUrl}` (storage) | 23 | Comprobante paso 2: subir el archivo |
| `POST /me/payments/transfers` | 23 | Comprobante paso 3: enviar (monto, fecha, clave de rastreo) |
| `GET /me/payments/{id}/transfer-proof` | 26 | Ver el comprobante enviado |
| `GET /me/payments` | 26 | Historial (paginado, más reciente primero) |
| `GET /me/payments/summary` | 26 | Plan vigente + avisos destacados (arriba de "Mis pagos") |
| `GET /me/payments/plans` · `GET /me/payments/plans/{planId}` | 24, 26 | Planes de cuotas con calendario |
| `POST /me/payments/plans/{planId}/card-update` | 24, 26 | [Actualizar tarjeta] → Stripe (modo `setup`) |
| `POST /me/payments/plans/{planId}/pay-now` | 24, 26 | [Pagar ahora] cuotas fallidas |
| `GET /me/payments/{id}/receipt` | 26 | [Descargar comprobante] (PDF) |
| `POST /me/moodle-access/link` | 25 | "¿No ves tu formación?" (buscar por mi correo) |
| `POST /me/moodle-access/redeem { code }` | 25 | Activar acceso con código XXXX-XXXX |
| `POST /webhooks/stripe` | — | Solo Stripe (no lo llama el frontend) |

Rutas sugeridas del frontend (las usan notificaciones y correos; ver
`src/modules/notifications/portal-links.ts`):

| Ruta | Pantalla |
|---|---|
| `/pagar/{offerSlug}` | Resumen y pago de una oferta (HU-22/24) |
| `/postulaciones/{applicationId}/pago` | Pagar saldo (HU-23) |
| `/pagos/resultado?paymentId=…&result=success\|cancel` | Regreso de Stripe Checkout |
| `/perfil/pagos` | Perfil › Mis pagos (HU-14/26) |
| `/perfil/pagos/{paymentId}` | Detalle de un pago (opcional; puede ser modal) |

## Mapa de criterios de aceptación → API

| HU | Criterio | Endpoint / regla |
|---|---|---|
| 22 | Precio en mi moneda ($10,200 MXN si México; $585 USD en otro caso) | `quote.amount` (país del perfil); ficha `pricing` (Fase 02) |
| 22 | Sin sesión → login/registro y regreso al resumen | Ficha `actions[].requiresLogin`; tras login, `/pagar/{slug}` |
| 22 | Stripe confirma → inscripción activa, comprobante por correo, aparece en Mi formación | Webhook → `PAID`, inscripción `ACTIVE` (`source = PAYMENT`), notificación `PAYMENT_CONFIRMED` (portal + correo con folio y monto) |
| 22 | Cancelo o vuelvo sin confirmación → "Pago cancelado" / "Procesando pago…"; solo la confirmación activa | `result=cancel` → `POST …/cancel`; `result=success` → polling `GET /me/payments/{id}` |
| 22 | Ya inscrito o cupo agotado → "Ya estás inscrito · Ir a mi aula" / "Cupo agotado", sin cobro | `quote.blocker` / `409 ENROLLMENT_ALREADY_EXISTS` / `409 OFFER_SOLD_OUT` |
| 23 | Monto original, tipo de beca y %, saldo en mi moneda y fecha límite | `quote.application` + `quote.amount` |
| 23 | Tarjeta (única o cuotas) → "Inscrita" y acceso al Aula | `POST /checkout { applicationId }` → `markEnrolled` |
| 23 | México → "Transferencia bancaria" con datos, MXN y referencia única; otros países no | `quote.methods[1]` (`NOT_MEXICO` → ocultar), `quote.bankTransfer` |
| 23 | Comprobante antes de la fecha límite → "Pendiente de validación", no vence, se activa al validar | `POST /me/payments/transfers` → `PENDING_VALIDATION`; postulación con `transferPendingValidation` |
| 23 | Rechazada → motivo y subir otro | `TRANSFER_REJECTED` (notificación), `transfer.rejectionReason`, acción `UPLOAD_TRANSFER_PROOF` |
| 24 | Elijo 2–4 cuotas según el máximo y veo el calendario | `quote.installments.options[]` (`schedule`) |
| 24 | Autorizo + tarjeta → 1.ª cuota cobrada, inscripción activa, plan "Al día" | `POST /checkout { installmentCount, autoDebitAuthorized: true }` → plan `CURRENT` |
| 24 | 7 días antes de una cuota → aviso en Dashboard y recordatorio | `dashboard.payments.upcomingInstallments`, notificación `INSTALLMENT_UPCOMING` |
| 24 | Falla una cuota → "Cobro fallido", aviso con [Actualizar tarjeta], 3 reintentos en 7 días | Plan `PAST_DUE`, `INSTALLMENT_FAILED` (prioridad alta, fijada), `installments[].nextRetryAt` |
| 24 | 15 días sin regularizar → "En mora"; acceso suspendido | Plan `DELINQUENT`, `PLAN_DELINQUENT`, Aula `403 ENROLLMENT_SUSPENDED` (ver "Decisiones") |
| 25 | Correo en la lista → aparece en Mi formación sin pago y se notifica | Se vincula al verificar el correo (HU-03) o con `POST /me/moodle-access/link`; `MOODLE_ENROLLMENT_LINKED` |
| 25 | Oferta Moodle: sin inscripción/pago/beca; ficha con [Ya estoy inscrito: activar mi acceso] | Ficha `ACTIVATE_MOODLE_ACCESS` (Fase 02); checkout → `422 PAYMENT_NOT_ALLOWED` (`reason: MOODLE`) |
| 25 | Correo sin lista → "No encontramos una inscripción…" con código o contacto | `link` → `found: false` |
| 25 | Código válido → vincula y queda usado; inválido/usado/vencido → error específico | `redeem` → `MOODLE_CODE_INVALID` / `MOODLE_CODE_USED` / `MOODLE_CODE_EXPIRED` |
| 25 | Sin lista, Aula por URL → acceso negado | `403 ENROLLMENT_REQUIRED` (Fase 03) |
| 26 | Plan vigente arriba (pagadas/total, próximo cobro, tarjeta) e historial | `GET /me/payments/summary` + `GET /me/payments` |
| 26 | "Pagado"/"Validada" → PDF con folio, fecha, concepto, monto, moneda y método | `GET /me/payments/{id}/receipt` (`receiptAvailable`) |
| 26 | Transferencia rechazada → comprobante, motivo y subir otro | `GET /me/payments/{id}` (`transfer`), `…/transfer-proof` |
| 26 | Cuota fallida / mora → aviso con monto pendiente y [Actualizar tarjeta] / [Pagar ahora] | `summary.alerts[]` + `plan.canUpdateCard` / `plan.canPayNow` |
| 26 | Pago o comprobante ajeno por URL → acceso negado | `404 NOT_FOUND` |
| 14 | Cambio de país → pagos nuevos en la nueva moneda, sin tocar pagos/planes vigentes | `quote` usa el país actual; los planes guardan su moneda |

---

## HU-22 / HU-24 — Pagar una oferta con Stripe Checkout

### Flujo completo

```
Ficha [Inscribirme y pagar] / [Pagar en cuotas]   (sin sesión → login → /pagar/{slug})
  │
  ▼  GET /me/payments/quote?offerId={offer.id}
Resumen (paso 1): oferta, fechas (hora CDMX + local), precio con moneda, chips de cuotas,
                  casilla de términos (+ autorización de débito si eligió cuotas)
  │  blocker ≠ null → botón deshabilitado con el motivo (tabla abajo)
  │  openCheckout ≠ null → [Continuar pago] (redirigir a openCheckout.checkout.url)
  ▼  POST /me/payments/checkout { offerId, termsAccepted: true, installmentCount?, autoDebitAuthorized? }
"Redirigiendo a Stripe…"  →  window.location.assign(checkoutUrl)      (paso 2, en stripe.com)
  │
  ├─ paga → Stripe redirige a /pagos/resultado?paymentId={id}&result=success&session_id=cs_…
  │          "Procesando pago…": GET /me/payments/{paymentId} cada 2–3 s (máx. ~60 s)
  │            PAID      → Confirmación (paso 3): folio, monto, [Ir a mi aula], [Ver comprobante],
  │                         aviso "el grupo de WhatsApp está en el Aula"
  │            PENDING   → seguir esperando; al agotar el tiempo: "Estamos confirmando tu pago, te
  │                         avisaremos por correo" (el webhook lo confirmará y llega la notificación)
  │            CANCELLED / FAILED → "El pago no se completó" + [Reintentar]
  │
  └─ vuelve/cancela → /pagos/resultado?paymentId={id}&result=cancel
             POST /me/payments/{paymentId}/cancel (204) → "Pago cancelado: no se realizó ningún cargo"
```

- `checkoutUrl` se usa **una vez** con redirección completa (no iframe). La sesión dura 30 min.
- Repetir `POST /checkout` con los mismos datos devuelve la misma sesión (`reused: true`): úsalo para
  [Continuar pago]. Si cambia la opción (p. ej. de pago único a 3 cuotas), el backend cierra la sesión
  anterior y crea otra.
- **Cupo**: en ofertas con cupo, el checkout retiene el lugar mientras la sesión está abierta. Otra
  persona verá "Cupo agotado" hasta que se pague o venza/cancele.
- El backend concilia con Stripe al consultar `GET /me/payments/{id}` si el webhook se retrasa: el
  polling basta, no hace falta otra llamada.
- No uses `session_id` para nada más que depurar: la fuente de verdad es `paymentId`.

```ts
// Paso 1 → 2
const { data, error } = await api.POST('/api/v1/me/payments/checkout', {
  body: { offerId, termsAccepted: true, ...(cuotas ? { installmentCount: cuotas, autoDebitAuthorized: true } : {}) },
});
if (error) return showCheckoutError(error); // ver tabla de errores
window.location.assign(data.checkoutUrl);

// Regreso (success)
async function waitForPayment(paymentId: string) {
  for (let i = 0; i < 25; i++) {
    const { data } = await api.GET('/api/v1/me/payments/{id}', { params: { path: { id: paymentId } } });
    if (data && data.status !== 'PENDING') return data;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null; // "Estamos confirmando tu pago…"
}
```

### `quote` (pantalla de resumen)

```json
{
  "concept": "FULL_PRICE",
  "offer": { "id": "…", "slug": "diplomado-en-ecotecnologias-del-agua", "name": "Diplomado en Ecotecnologías del Agua",
             "type": "DIPLOMA", "cohortLabel": "Generación 2026–2027", "startsAt": "…", "endsAt": "…" },
  "application": null,
  "amount": { "amountCents": 1020000, "currency": "MXN" },
  "methods": [ { "method": "CARD", "available": true, "reason": null },
               { "method": "BANK_TRANSFER", "available": false, "reason": "NOT_A_BALANCE" } ],
  "installments": { "max": 3, "options": [
      { "count": 2, "available": true, "reason": null, "perInstallment": { "amountCents": 510000, "currency": "MXN" },
        "schedule": [ { "sequence": 1, "amount": { … }, "dueAt": "…" }, { "sequence": 2, … } ] },
      { "count": 3, "available": true, … } ] },
  "bankTransfer": null,
  "blocker": null,
  "openCheckout": null,
  "latestTransfer": null
}
```

- Chips de cuotas (HU-24): `installments.options[]`; `available = false` con
  `reason = LAST_INSTALLMENT_AFTER_END` → chip deshabilitado ("La última cuota caería después del fin
  de la oferta"). Calendario: `schedule[]` (la 1.ª "Se cobra al confirmar"); muestra el total.
- `installments = null` → la oferta no tiene cuotas (no muestres [Pagar en cuotas]).
- Nota fija: "El pago se procesa en Stripe; la Escuela no guarda tu tarjeta".

| `blocker.code` | `meta` | UI |
|---|---|---|
| `ENROLLMENT_ALREADY_EXISTS` | `enrollmentStatus` | "Ya estás inscrito · Ir a mi aula" (SUSPENDED → "Regulariza tu pago" → Mis pagos) |
| `OFFER_SOLD_OUT` | — | "Cupo agotado" |
| `ENROLLMENT_CLOSED` | `reason`, `availableFrom` | Textos de la ficha (`ENROLLMENT_NOT_OPEN_YET` "Abre el …", `ENROLLMENT_CLOSED`, `OFFER_FINISHED`) |
| `PAYMENT_NOT_ALLOWED` | `reason`, `requiredAction` | `MOODLE` → [Activar mi acceso]; `OPEN_CALL` → [Postular]; `FREE` → [Inscribirme]; `PAY_BALANCE` → ir a "Pagar saldo"; `PRICE_NOT_AVAILABLE` → "Precio no disponible" |
| `PAYMENT_BALANCE_NOT_DUE` / `APPLICATION_DEADLINE_PASSED` / `PAYMENT_TRANSFER_PENDING` | — | Saldo: ver HU-23 |

### Errores de `POST /me/payments/checkout`

| Error | HTTP | UI |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `termsAccepted` sin marcar (`EQUALS`), `autoDebitAuthorized` (`MUST_ACCEPT`), o `offerId`+`applicationId` juntos |
| `PAYMENT_INSTALLMENTS_NOT_AVAILABLE` | 422 | `meta.allowed` = cuotas válidas |
| `ENROLLMENT_ALREADY_EXISTS` / `OFFER_SOLD_OUT` / `ENROLLMENT_CLOSED` / `PAYMENT_NOT_ALLOWED` | 409/422 | Igual que `blocker` |
| `PAYMENTS_NOT_CONFIGURED` | 503 | "El pago con tarjeta no está disponible en este momento" (la transferencia sí funciona) |
| `PAYMENT_PROVIDER_ERROR` | 502 | "No pudimos comunicarnos con el procesador de pagos" + [Reintentar] |

---

## HU-23 — Pagar el saldo tras beca

Entrada: acción `PAY_BALANCE` (o `CONTINUE_PAYMENT` / `UPLOAD_TRANSFER_PROOF`) de Mis postulaciones o
de la ficha → `/postulaciones/{applicationId}/pago`.

`GET /me/payments/quote?applicationId={id}` → `concept = BALANCE`:

```json
{
  "application": { "id": "…", "folio": "BEC-000123", "kind": "SCHOLARSHIP", "status": "APPROVED_PENDING_PAYMENT",
                   "assignedScholarshipTypeId": "…",
                   "assignedScholarshipType": { "id": "…", "key": "AGUAS_LIBRES", "name": "Aguas Libres",
                                                "minPercent": 50, "maxPercent": 50, "requiresInterview": false },
                   "assignedPercent": 50,
                   "originalAmount": { "amountCents": 1020000, "currency": "MXN" }, "dueAt": "2026-11-14T05:59:00.000Z" },
  "amount": { "amountCents": 510000, "currency": "MXN" },
  "methods": [ { "method": "CARD", "available": true, "reason": null },
               { "method": "BANK_TRANSFER", "available": true, "reason": null } ],
  "bankTransfer": { "accountHolder": "…", "bankName": "…", "clabe": "012180001234567891",
                    "reference": "EIA BEC-000123", "amount": { "amountCents": 510000, "currency": "MXN" } },
  "latestTransfer": null, "blocker": null, …
}
```

- Indicadores: monto original, beca (`assignedScholarshipType.name` y `assignedPercent`; antes
  `assignedLevel`), **saldo** destacado y cuenta regresiva a
  `application.dueAt`.
- Tarjeta: mismo flujo de Stripe con `{ applicationId, termsAccepted: true }` (± cuotas si la oferta
  las tiene). Al confirmarse, la postulación pasa a **Inscrita** y aparece en Mi formación.
- **Transferencia** solo si `methods[1].available` (etiqueta "Solo México"). Si `reason =
  NOT_MEXICO`, no muestres la opción; `NOT_CONFIGURED` → "Disponible pronto".
  - Datos bancarios con botón [Copiar] (titular, banco, CLABE, referencia, monto en MXN).
  - Pasos: 1) transfiere, 2) sube el comprobante, 3) el equipo valida en 1–2 días hábiles.

### Comprobante (URL firmada, como en Fases 03/04)

```ts
const { data: u } = await api.POST('/api/v1/me/payments/transfers/upload-url', {
  body: { applicationId, fileName: file.name, contentType: file.type, sizeBytes: file.size },
});
await fetch(u.uploadUrl, { method: 'PUT', headers: u.headers, body: file });
const { data: payment } = await api.POST('/api/v1/me/payments/transfers', {
  body: { applicationId, key: u.key, fileName: file.name,
          declaredAmountCents: 510000, paidOn: '2026-11-03', trackingKey: 'MBAN01002611030012345678' },
});
// payment.status === 'PENDING_VALIDATION'
```

- PDF/JPG/PNG ≤ 15 MB (el backend verifica tipo y tamaño REALES al confirmar).
- `declaredAmountCents` es lo que la persona declara (informativo); el saldo esperado lo calcula el
  servidor y el equipo captura el monto recibido al validar.
- Mientras esté "Pendiente de validación", enviar otro comprobante **reemplaza** el anterior (mismo
  `id`). La postulación **no vence** y su acción es `PAYMENT_IN_VALIDATION` ("Pago en validación",
  deshabilitada). Pagar con tarjeta en ese estado → `409 PAYMENT_TRANSFER_PENDING`.
- "Rechazada": notificación `TRANSFER_REJECTED` con el motivo; la acción pasa a
  `UPLOAD_TRANSFER_PROOF` ([Subir comprobante]); el siguiente envío crea un comprobante nuevo.
- "Validada": la postulación pasa a Inscrita (notificación `TRANSFER_VALIDATED`) y el recibo queda
  disponible.

| Error | HTTP | UI |
|---|---|---|
| `PAYMENT_TRANSFER_INVALID_FILE` | 422 | "El comprobante debe ser PDF, JPG o PNG de máximo 15 MB" |
| `PAYMENT_TRANSFER_UPLOAD_NOT_FOUND` | 422 | El PUT no llegó: reintentar la subida |
| `PAYMENT_TRANSFER_NOT_AVAILABLE` | 422 | `meta.reason` (`NOT_MEXICO`, `CURRENCY_NOT_MXN`, `NOT_A_BALANCE`, `NOT_CONFIGURED`) |
| `PAYMENT_BALANCE_NOT_DUE` | 409 | La postulación ya no espera pago (`meta.status`): recarga |
| `APPLICATION_DEADLINE_PASSED` | 422 | "Vencida: contacta al equipo" (puede extender el plazo, HU-32) |
| `VALIDATION_ERROR` | 400 | `paidOn` futura o mal formada, `trackingKey` no alfanumérica (≤ 30) |

---

## HU-24 — Plan de cuotas

- Se crea con `POST /me/payments/checkout { …, installmentCount: 2..4, autoDebitAuthorized: true }`.
  Texto de la casilla: "Autorizo a la Escuela a cobrar automáticamente en mi tarjeta las cuotas".
- La 1.ª cuota se cobra en Stripe Checkout (3-D Secure incluido) y la tarjeta queda guardada en Stripe.
  Las siguientes se cobran solas en su fecha (sin la persona presente).
- Cobro fallido: hasta **3 reintentos en 7 días** (días 3, 5 y 7 tras el primer fallo); a los **15
  días** sin regularizar el plan pasa a "En mora".

### `PaymentPlanDto`

```json
{
  "id": "…", "status": "PAST_DUE", "concept": "FULL_PRICE", "offer": { … },
  "total": { "amountCents": 58500, "currency": "USD" }, "installmentCount": 3, "paidCount": 1,
  "paidAmount": { … }, "pendingAmount": { … },
  "nextCharge": { "sequence": 2, "amount": { "amountCents": 19500, "currency": "USD" }, "dueAt": "…",
                  "status": "FAILED", "attempts": 1, "nextRetryAt": "…", "failureMessage": "Tu tarjeta no tiene fondos suficientes." },
  "card": { "brand": "visa", "last4": "4242" },
  "failedSince": "…", "delinquencyAt": "…", "daysSinceFailure": 2, "accessSuspended": false,
  "canPayNow": true, "canUpdateCard": true,
  "installments": [ … ], "activatedAt": "…"
}
```

- Tarjeta del plan: "Cuota 1 de 3 pagada · próximo cobro {fecha} · VISA •••• 4242".
- Banner de cobro fallido (Dashboard, Aula y Mis pagos): monto pendiente, días desde el fallo
  (`daysSinceFailure`), cuándo pasa a mora (`delinquencyAt`) y botones:
  - [Actualizar tarjeta] → `POST …/card-update` → redirigir a `checkoutUrl` (Stripe pide la tarjeta
    nueva). Al volver (`/perfil/pagos?planId=…&cardUpdate=success|cancel`) recarga el plan: el
    backend guarda la tarjeta y **cobra de inmediato** las cuotas fallidas.
  - [Pagar ahora] (`canPayNow`) → `POST …/pay-now` → `200` con el plan "Al día" o `422
    PAYMENT_CHARGE_FAILED` (`meta.failureMessage`) → ofrecer [Actualizar tarjeta].
- Al regularizar: el plan vuelve a "Al día", los avisos fijados se desfijan y, si el acceso estaba
  suspendido por mora, se restablece.

---

## HU-25 — Acceso de inscritos por Moodle

- El equipo carga la lista de correos de la oferta Moodle (Fase 06). Si el correo de la persona está en
  la lista, la formación se vincula **sola al verificar el correo** (HU-03) o cuando el equipo carga la
  lista; llega la notificación `MOODLE_ENROLLMENT_LINKED` (muestra el banner de éxito descartable).
- Panel "¿No ves tu formación?" en Mi formación:
  - [Buscar con mi correo] → `POST /me/moodle-access/link` → `{ found, linked[] }`. `found = false` →
    "No encontramos una inscripción asociada a tu correo" + campo de código + contacto (correo y
    WhatsApp de la Escuela, contenido estático del frontend).
  - [Activar con código] → `POST /me/moodle-access/redeem { code }` (acepta minúsculas, espacios y sin
    guion). `linked[0]` es la tarjeta de Mi formación (`origin = MOODLE` → badge "Vía Moodle").
- Ficha de una oferta Moodle: acción `ACTIVATE_MOODLE_ACCESS` → este panel. "La inscripción se
  gestiona fuera de la plataforma"; nunca precio, pago ni beca.

| Error | HTTP | UI |
|---|---|---|
| `MOODLE_CODE_INVALID` | 422 | "El código no es válido" |
| `MOODLE_CODE_USED` | 409 | "Este código ya fue usado" |
| `MOODLE_CODE_EXPIRED` | 422 | "Este código venció" |
| `ENROLLMENT_ALREADY_EXISTS` | 409 | Ya inscrito (el código no se consume) |
| `RATE_LIMITED` | 429 | 10 intentos / 10 min por IP |

---

## HU-26 / HU-14 — Mis pagos

Pestaña "Mis pagos" del perfil (siempre visible, aunque esté vacía):

1. `GET /me/payments/summary` → arriba: `alerts[]` (destacados) y `activePlans[]` (tarjeta del plan).
2. `GET /me/payments?page=1` → tabla (mobile: tarjetas apiladas) del más reciente al más antiguo:
   fecha (`paidAt ?? createdAt`), concepto (`conceptLabel`), monto + moneda, método y estado.
3. Nota fija al pie: "Los comprobantes son recibos de pago, no facturas fiscales".

Vacío: `hasPayments = false` → "Aún no tienes pagos"; si `moodleOnly = true` → "Tus formaciones de
Moodle se pagaron fuera de la plataforma".

- Detalle (modal): `GET /me/payments/{id}`. Transferencias: `transfer` (referencia, monto declarado,
  fecha, clave de rastreo, comprobante → `GET …/transfer-proof`, motivo de rechazo).
- [Descargar comprobante] (solo `receiptAvailable`): `GET /me/payments/{id}/receipt` devuelve
  `application/pdf` con folio, fecha, concepto, monto, moneda y método. Descárgalo con `fetch`
  (lleva Bearer) → `blob` → `URL.createObjectURL`. `stripeReceiptUrl` (si existe) es el recibo de
  Stripe, opcional.

```ts
const res = await fetch(`${API}/api/v1/me/payments/${id}/receipt`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) return showError(await res.json());
const url = URL.createObjectURL(await res.blob());
Object.assign(document.createElement('a'), { href: url, download: `recibo-${folio}.pdf` }).click();
```

### Avisos (`alerts[]` / `dashboard.payments`)

| `type` | Texto | Acción |
|---|---|---|
| `INSTALLMENT_FAILED` | "No pudimos cobrar tu cuota" + monto pendiente | [Actualizar tarjeta] / [Pagar ahora] (`planId`) |
| `PLAN_DELINQUENT` | "Tu plan está en mora" (acceso suspendido si `accessSuspended`) | [Pagar ahora] |
| `TRANSFER_REJECTED` | "Tu comprobante fue rechazado" | [Subir comprobante] → `/postulaciones/{applicationId}/pago` |
| `TRANSFER_PENDING` | "Transferencia en validación (1–2 días hábiles)" | Ver detalle |
| `INSTALLMENT_UPCOMING` | "El {date} cobraremos {amount} a VISA •••• 4242" (informativo) | — |

---

## Integraciones con otras pantallas

### Ficha (HU-16): nuevas acciones (`actions[]`)

| `type` | Cuándo | UI |
|---|---|---|
| `ENROLL_AND_PAY` / `PAY_IN_INSTALLMENTS` | Igual que Fase 02 | → `/pagar/{slug}` (preselecciona cuotas en la 2.ª) |
| `CONTINUE_PAYMENT` | Tengo un checkout abierto en esa oferta | [Continuar pago] → `POST /me/payments/checkout` (misma sesión) o `quote.openCheckout` |
| `PAY_BALANCE` | Beca aprobada con saldo | [Pagar saldo] → `/postulaciones/{applicationId}/pago` |
| `PAYMENT_IN_VALIDATION` | Comprobante en revisión (`enabled = false`, `reason = TRANSFER_PENDING_VALIDATION`) | "Pago en validación" |
| `REGULARIZE_PAYMENT` | Acceso suspendido por mora | [Regularizar pago] → Mis pagos |
| `GO_TO_CLASSROOM` | Inscrito | [Ir a mi aula] |

### Mis postulaciones (HU-21): acción contextual en "Aprobada – pendiente de pago"

| `action.type` | Botón |
|---|---|
| `PAY_BALANCE` | [Pagar saldo] |
| `CONTINUE_PAYMENT` | [Continuar pago] (ya abrió Stripe; misma pantalla de pago) |
| `UPLOAD_TRANSFER_PROOF` | [Subir comprobante] (rechazada) |
| `PAYMENT_IN_VALIDATION` | "Pago en validación" (deshabilitado, `reason = TRANSFER_PENDING_VALIDATION`) |

`response` agrega `transferRejected` y `paymentStarted`.

### Dashboard (HU-06)

`GET /me/dashboard` agrega el bloque `payments` (si falla: `null` y `failedBlocks` incluye
`payments`; reintento con `GET /me/payments/summary`):

```json
"payments": {
  "upcomingInstallments": [ { "type": "INSTALLMENT_UPCOMING", "offer": { … }, "amount": { … }, "date": "…", "planId": "…", "card": { "brand": "visa", "last4": "4242" } } ],
  "alerts": [ { "type": "INSTALLMENT_FAILED", … } ]
}
```

### Aula (HU-08/17)

Acceso suspendido por mora → `403 ENROLLMENT_SUSPENDED` (Fase 03): "Tu acceso está suspendido.
Regulariza tu pago" → Mis pagos.

### Notificaciones (HU-13) — categoría `PAYMENTS` (salvo Moodle: `TRAINING`)

| `type` | Cuándo | Prioridad | `action.path` |
|---|---|---|---|
| `PAYMENT_CONFIRMED` | Pago completo / saldo / 1.ª cuota confirmados (folio, monto) | normal | `/aula/{offerId}` |
| `INSTALLMENT_PAID` | Cuota 2..N cobrada | normal | `/perfil/pagos` |
| `INSTALLMENT_UPCOMING` | 7 días antes del cobro (monto, fecha, tarjeta) | normal | `/perfil/pagos` |
| `INSTALLMENT_FAILED` | Cobro rechazado (próximo reintento) | **alta, fijada** hasta regularizar | `/perfil/pagos` |
| `PLAN_DELINQUENT` | Plan en mora (y acceso suspendido) | **alta, fijada** | `/perfil/pagos` |
| `TRANSFER_VALIDATED` | Transferencia validada (Inscrita) | normal | `/aula/{offerId}` |
| `TRANSFER_REJECTED` | Transferencia rechazada (motivo) | normal | `/postulaciones/{id}/pago` |
| `MOODLE_ENROLLMENT_LINKED` | Formación Moodle vinculada | normal | `/aula/{offerId}` |

`data` trae `paymentId`, `planId`, `offerId`, `applicationId` según el caso.

---

## Tablas enum → texto

### `PaymentStatus`

| Valor | Tarjeta | Transferencia | Color |
|---|---|---|---|
| `PENDING` | Procesando pago | — | azul |
| `PAID` | Pagado | — | verde |
| `FAILED` | Fallido | — | rojo |
| `REFUNDED` | Reembolsado | Reembolsado | gris |
| `PENDING_VALIDATION` | — | Pendiente de validación | ámbar |
| `VALIDATED` | — | Validada | verde |
| `REJECTED` | — | Rechazada | rojo |
| `CANCELLED` | Cancelado (no aparece en el historial) | — | gris |

### `PaymentConcept` / `PaymentMethod`

| Valor | Texto |
|---|---|
| `FULL_PRICE` | Pago completo |
| `BALANCE` | Saldo tras beca (convocatoria: "Pago de convocatoria") |
| `INSTALLMENT` | Cuota n de N (`installment.sequence` / `installment.count`) |
| `CARD` | Tarjeta |
| `BANK_TRANSFER` | Transferencia bancaria |

`conceptLabel` ya trae el texto redactado.

### `InstallmentPlanStatus` / `InstallmentStatus`

| Plan | Texto | | Cuota | Texto |
|---|---|---|---|---|
| `CURRENT` | Al día | | `SCHEDULED` | Programada ("Se cobra al confirmar" si es la 1.ª) |
| `PAST_DUE` | Cobro fallido | | `PROCESSING` | En cobro |
| `DELINQUENT` | En mora | | `PAID` | Pagada |
| `COMPLETED` | Completado | | `FAILED` | Fallida |
| `CANCELLED` | Cancelado | | `CANCELLED` | Cancelada |

### `TransferRejectionReason`

| Valor | Texto |
|---|---|
| `ILLEGIBLE` | Comprobante ilegible |
| `AMOUNT_MISMATCH` | El monto no coincide |
| `NOT_FOUND` | No encontramos la transferencia |
| `OTHER` | Otro motivo (ver `rejectionNote`) |

## Decisiones que afectan a la UI

- **Cuotas = plan propio** (no Subscriptions de Stripe): el backend cobra cada cuota con la tarjeta
  guardada; por eso "Actualizar tarjeta" es una página de Stripe en modo `setup` (no el Customer
  Portal).
- **Mora**: con la configuración actual (`SUSPEND_ACCESS_ON_DELINQUENCY = true`) el acceso al Aula se
  suspende automáticamente al pasar a "En mora" y se restablece solo al regularizar. Si el cliente
  confirma que debe ser manual (Anexo A), se cambia esa regla y la suspensión la hará el equipo (Fase 06).
- **Recibo**: PDF propio (sirve también para transferencias); no es CFDI.
- **Moneda**: la del país del perfil al pagar. Un plan conserva su moneda aunque cambie el país (HU-14).

## Datos demo (seed, fuera de producción)

`participante@example.com` / `Demo12345`:

| Dato | Qué probar |
|---|---|
| Plan de 3 cuotas "Al día" del Diplomado en Ecotecnologías del Agua (1.ª pagada, 2.ª en 5 días) | Mis pagos, aviso de cuota próxima del Dashboard |
| Pago completo "Pagado" del Curso de Humedales construidos | Historial y [Descargar comprobante] |
| Beca aprobada (Fase 04) del Diplomado en Gestión Comunitaria del Agua | [Pagar saldo] (tarjeta y transferencia, si hay datos bancarios configurados) |
| Curso de Captación (Moodle) vinculado por lista | Badge "Vía Moodle" |

Además: registra `moodle.demo@example.com` para ver la vinculación automática al verificar el correo,
o usa el código de un solo uso **`AGUA-2345`** con otra cuenta. En local sin llaves de Stripe el
checkout responde `503 PAYMENTS_NOT_CONFIGURED`; con llaves de prueba usa la tarjeta `4242 4242 4242
4242` (y `4000 0000 0000 0341` para simular cobros de cuotas rechazados). Ver `docs/DEPLOY.md`.
