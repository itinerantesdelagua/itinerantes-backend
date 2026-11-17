import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import type { PaginatedResponseDto } from '../../common/dto/pagination.dto';
import { uuidOr404 } from '../../common/pipes/uuid-or-404.pipe';
import { ApiErrorResponses } from '../../common/swagger/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../common/swagger/api-paginated-response.decorator';
import { BUSINESS_RULES, formatMegabytes } from '../../config/business-rules';
import { BEARER_AUTH_NAME } from '../../config/openapi';
import { AccessUrlDto } from '../enrollments/dto/portal-shared.dto';
import { ApplicationsService } from './applications.service';
import {
  ConfirmDocumentRequestDto,
  CreateApplicationRequestDto,
  EvidenceUploadRequestDto,
  ListApplicationsQueryDto,
  OpportunitiesQueryDto,
  UpdateApplicationRequestDto,
} from './dto/applications.request.dto';
import {
  ApplicationCardDto,
  ApplicationDetailDto,
  ApplicationDocumentDto,
  ApplicationOpportunitiesDto,
  ApplicationUploadUrlDto,
} from './dto/applications.response.dto';

const APPLICATION_ID = uuidOr404('La postulación no existe.');
const DOCUMENT_ID = uuidOr404('El archivo no existe.');
const { EVIDENCE_IMAGE, EVIDENCE_VIDEO } = BUSINESS_RULES.FILE_LIMITS;
/** Límites de evidencias para la documentación ("JPG/PNG/HEIC ≤ 15 MB; MP4/MOV ≤ 100 MB"). */
const EVIDENCE_LIMITS =
  `JPG/PNG/HEIC ≤ ${formatMegabytes(EVIDENCE_IMAGE.maxBytes)}; ` +
  `MP4/MOV ≤ ${formatMegabytes(EVIDENCE_VIDEO.maxBytes)}`;
const OWN_NOTE =
  ' Postulación ajena, inexistente o id mal formado → 404 `NOT_FOUND` (nunca se revela que existe).';
const EDIT_NOTE =
  ' Solo en borrador (`APPLICATION_NOT_EDITABLE` 409 si ya se envió) y con la convocatoria abierta ' +
  '(`APPLICATION_WINDOW_CLOSED` 422: el borrador queda en solo lectura).';
const EDIT_ERRORS = [
  'UNAUTHORIZED',
  'NOT_FOUND',
  'APPLICATION_NOT_EDITABLE',
  'APPLICATION_WINDOW_CLOSED',
  'RATE_LIMITED',
] as const;

@ApiTags('Postulaciones')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('me/applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get('opportunities')
  @ApiOperation({
    summary: 'Becas disponibles / Convocatorias abiertas',
    description:
      'HU-19 / HU-20: pestaña "Becas disponibles" (`kind=SCHOLARSHIP`: diplomados NAS con beca y ' +
      'convocatoria de becas abierta o próxima) o "Convocatorias abiertas" (`kind=OPEN_CALL`). ' +
      'Tarjetas con lugar, fechas, costo o "Gratuito", cierre (`window.closesAt`, muéstralo en tu zona ' +
      'con cuenta regresiva), elegibilidad (`eligibility.eligible` / `reasons` según tu perfil), ' +
      'tipos de beca (con cupo disponible) y monto estimado en tu moneda y `myApplication` (una postulación por cohorte: ' +
      '[Ver mi postulación] en lugar de [Postular]). Orden: abiertas por cierre más próximo, luego ' +
      'próximas. `kind=OPEN_CALL` marca las convocatorias como vistas (widget "nuevas" del Dashboard). ' +
      'Lista vacía → mensaje orientador ("Te avisaremos cuando abra una convocatoria").',
  })
  @ApiOkResponse({ type: ApplicationOpportunitiesDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'RATE_LIMITED')
  async opportunities(
    @CurrentUser() user: AuthUser,
    @Query() query: OpportunitiesQueryDto,
  ): Promise<ApplicationOpportunitiesDto> {
    return { data: await this.applications.opportunities(user.id, query.kind) };
  }

  @Get()
  @ApiOperation({
    summary: 'Mis postulaciones',
    description:
      'HU-21: solo mis postulaciones, filtradas por pestaña (`kind`: Becas o Convocatorias) y ' +
      'opcionalmente por `status`. Cada tarjeta trae oferta, cohorte, folio, fecha de envío, estado, ' +
      'línea de tiempo, entrevista, resultado de la beca y la acción contextual. Orden: las que ' +
      'requieren acción (entrevista, pago o confirmación) arriba por fecha más próxima; luego por ' +
      'último cambio. Lista vacía → acceso a becas disponibles / convocatorias abiertas.',
  })
  @ApiPaginatedResponse(ApplicationCardDto, 'Postulaciones paginadas.')
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'RATE_LIMITED')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<PaginatedResponseDto<ApplicationCardDto>> {
    return this.applications.listMine(user.id, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Iniciar postulación (borrador)',
    description:
      'HU-19 / HU-20 ([Postular a beca] / [Postular] de la ficha o de las pestañas): crea el BORRADOR ' +
      '(una postulación por persona y cohorte) con los datos de contacto precargados del perfil y los ' +
      'campos enviados (todos opcionales aquí). El tipo se deduce de la oferta: diplomado con beca → ' +
      'beca; convocatoria → convocatoria. Después: autoguardado con `PATCH`, evidencias y ' +
      '`POST …/submit`. Errores: `APPLICATION_ALREADY_EXISTS` (409, `meta.applicationId`/`status`/' +
      '`folio`: ve a la existente), `APPLICATION_NOT_ALLOWED` (422: curso, taller, evento, diplomado ' +
      'sin beca u oferta Moodle), `APPLICATION_WINDOW_CLOSED` (422, `meta.reason` = ' +
      'SCHOLARSHIP_NOT_OPEN_YET / SCHOLARSHIP_CLOSED / ENROLLMENT_NOT_OPEN_YET / ENROLLMENT_CLOSED / ' +
      'OFFER_FINISHED, `meta.availableFrom`, `meta.closesAt`), `ENROLLMENT_ALREADY_EXISTS` (409: ya ' +
      'inscrito), `OFFER_NOT_AVAILABLE` (404).',
  })
  @ApiCreatedResponse({ type: ApplicationDetailDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'OFFER_NOT_AVAILABLE',
    'APPLICATION_NOT_ALLOWED',
    'APPLICATION_WINDOW_CLOSED',
    'APPLICATION_ALREADY_EXISTS',
    'ENROLLMENT_ALREADY_EXISTS',
    'BUSINESS_RULE_VIOLATION',
    'RATE_LIMITED',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApplicationRequestDto,
  ): Promise<ApplicationDetailDto> {
    return this.applications.create(user.id, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Ver mi postulación',
    description:
      'HU-21 (y formulario del borrador de HU-19/20): tarjeta + respuestas, archivos, historial de ' +
      'estados con fecha y hora, datos precargados del perfil, `form` (ventana, tipos de beca con monto ' +
      'estimado, costo, elegibilidad, aviso de entrevista, límites) y `missingRequirements` ' +
      '(validaciones en línea: mientras no esté vacío, "Enviar postulación" sigue deshabilitado). ' +
      'Entrevista: hora local + CDMX y `interview.join.url` solo 10 minutos antes.' +
      OWN_NOTE,
  })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
  ): Promise<ApplicationDetailDto> {
    return this.applications.getMine(user.id, id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Guardar borrador (autoguardado)',
    description:
      'HU-19/20 "Borrador guardado · hh:mm" (usa `updatedAt`): guarda solo los campos enviados (`null` ' +
      'borra; `evidenceLinks` reemplaza la lista). Valida formato y máximos; los mínimos y ' +
      'obligatorios se reportan en `missingRequirements` y se exigen al enviar. `400 VALIDATION_ERROR` ' +
      'con `details[].code` = `NOT_APPLICABLE` (campo del otro tipo), `LEVEL_NOT_ENABLED`, ' +
      '`INVALID_PHONE`, `MAX_LENGTH`, `IS_URL`, `ARRAY_MAX_SIZE`… Conserva lo capturado si falla.' +
      EDIT_NOTE +
      OWN_NOTE,
  })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'BUSINESS_RULE_VIOLATION', ...EDIT_ERRORS)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
    @Body() dto: UpdateApplicationRequestDto,
  ): Promise<ApplicationDetailDto> {
    return this.applications.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Descartar borrador',
    description:
      'Borra el borrador y sus archivos (permite volver a postular a esa cohorte). Una postulación ' +
      'enviada no se borra (`APPLICATION_NOT_EDITABLE`).' +
      OWN_NOTE,
  })
  @ApiNoContentResponse({ description: 'Borrador eliminado.' })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'APPLICATION_NOT_EDITABLE', 'RATE_LIMITED')
  remove(@CurrentUser() user: AuthUser, @Param('id', APPLICATION_ID) id: string): Promise<void> {
    return this.applications.remove(user.id, id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Enviar postulación',
    description:
      'HU-19 / HU-20: valida y envía el borrador → estado `SUBMITTED` "Enviada" con folio ' +
      '(BEC-… / CONV-…), notificación + correo (en convocatorias, con aviso de entrevista por Zoom) y ' +
      'aparece en la revisión del equipo (HU-31). Guarda la moneda (país del perfil) y el costo ' +
      'original. Errores: `APPLICATION_INCOMPLETE` (422, `details[]` por campo: `REQUIRED`, ' +
      '`MIN_LENGTH`, `MAX_LENGTH`, `MIN_FILES` en `documents`, `MUST_ACCEPT` en `termsAccepted` / ' +
      '`eligibilityConfirmed`, `LEVEL_NOT_ENABLED`), `APPLICATION_NOT_ELIGIBLE` (422, `meta.reasons` = ' +
      'COUNTRY_NOT_ELIGIBLE / TRAVEL_REQUIRED, `meta.eligibilityText`).' +
      EDIT_NOTE +
      OWN_NOTE,
  })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiErrorResponses(
    ...EDIT_ERRORS,
    'APPLICATION_INCOMPLETE',
    'APPLICATION_NOT_ELIGIBLE',
    'APPLICATION_INVALID_TRANSITION',
  )
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
  ): Promise<ApplicationDetailDto> {
    return this.applications.submit(user.id, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Confirmar mi participación',
    description:
      'HU-21 (convocatoria sin costo, Anexo A): en `APPROVED_PENDING_CONFIRMATION` y antes de ' +
      '`response.dueAt` → `ENROLLED` "Inscrita", inscripción activa (source OPEN_CALL) y notificación ' +
      '"Ir a mi aula". Las aprobadas con saldo se completan pagando (Fase 05, [Pagar saldo]). ' +
      'Errores: `APPLICATION_INVALID_TRANSITION` (409, `meta.status`: no está esperando ' +
      'confirmación), `APPLICATION_DEADLINE_PASSED` (422, `meta.dueAt`).' +
      OWN_NOTE,
  })
  @ApiOkResponse({ type: ApplicationDetailDto })
  @ApiErrorResponses(
    'UNAUTHORIZED',
    'NOT_FOUND',
    'APPLICATION_INVALID_TRANSITION',
    'APPLICATION_DEADLINE_PASSED',
    'RATE_LIMITED',
  )
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
  ): Promise<ApplicationDetailDto> {
    return this.applications.confirm(user.id, id);
  }

  @Post(':id/documents/upload-url')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Evidencia: pedir URL de carga',
    description:
      `HU-19/20 paso 1/3: valida tipo y tamaño declarados (${EVIDENCE_LIMITS}; ` +
      'máx. 10 archivos) y devuelve una URL firmada para `PUT` directo a storage con el header ' +
      '`Content-Type` indicado (muestra progreso con XHR). Paso 2: `PUT uploadUrl`. Paso 3: ' +
      '`POST …/documents { key }`. Errores: `APPLICATION_INVALID_FILE`, `APPLICATION_TOO_MANY_FILES` ' +
      '(`meta.max`).' +
      EDIT_NOTE +
      OWN_NOTE,
  })
  @ApiOkResponse({ type: ApplicationUploadUrlDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    ...EDIT_ERRORS,
    'APPLICATION_INVALID_FILE',
    'APPLICATION_TOO_MANY_FILES',
  )
  uploadUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
    @Body() dto: EvidenceUploadRequestDto,
  ): Promise<ApplicationUploadUrlDto> {
    return this.applications.evidenceUploadUrl(user.id, id, dto);
  }

  @Post(':id/documents')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Evidencia: confirmar archivo subido',
    description:
      'HU-19/20 paso 3/3: el backend verifica en storage que el archivo exista y su tipo y tamaño ' +
      'REALES; si no cumplen lo borra (`APPLICATION_INVALID_FILE`). `APPLICATION_UPLOAD_NOT_FOUND` → ' +
      'el PUT no llegó: vuelve a subirlo. Idempotente por `key`.' +
      EDIT_NOTE +
      OWN_NOTE,
  })
  @ApiCreatedResponse({ type: ApplicationDocumentDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    ...EDIT_ERRORS,
    'APPLICATION_INVALID_FILE',
    'APPLICATION_TOO_MANY_FILES',
    'APPLICATION_UPLOAD_NOT_FOUND',
  )
  confirmDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
    @Body() dto: ConfirmDocumentRequestDto,
  ): Promise<ApplicationDocumentDto> {
    return this.applications.confirmDocument(user.id, id, dto);
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Evidencia: quitar archivo',
    description: 'Quita un archivo del borrador (y lo borra del storage).' + EDIT_NOTE + OWN_NOTE,
  })
  @ApiNoContentResponse({ description: 'Archivo eliminado.' })
  @ApiErrorResponses(...EDIT_ERRORS)
  deleteDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
    @Param('documentId', DOCUMENT_ID) documentId: string,
  ): Promise<void> {
    return this.applications.deleteDocument(user.id, id, documentId);
  }

  @Get(':id/documents/:documentId/download')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'documentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Evidencia: descargar / ver archivo',
    description:
      'HU-21 "Ver mi postulación": URL firmada temporal (~10 min) de un archivo propio. Al vencer, ' +
      'pide otra.' +
      OWN_NOTE,
  })
  @ApiOkResponse({ type: AccessUrlDto })
  @ApiErrorResponses('UNAUTHORIZED', 'NOT_FOUND', 'RATE_LIMITED')
  download(
    @CurrentUser() user: AuthUser,
    @Param('id', APPLICATION_ID) id: string,
    @Param('documentId', DOCUMENT_ID) documentId: string,
  ): Promise<AccessUrlDto> {
    return this.applications.documentDownload(user.id, id, documentId);
  }
}
