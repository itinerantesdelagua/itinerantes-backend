import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { PaginatedResponseDto } from '../../../common/dto/pagination.dto';
import type { AdminUser } from '../../../common/guards/permissions.guard';
import { uuidOr404 } from '../../../common/pipes/uuid-or-404.pipe';
import { ApiErrorResponses } from '../../../common/swagger/api-error-responses.decorator';
import { ApiPaginatedResponse } from '../../../common/swagger/api-paginated-response.decorator';
import { BUSINESS_RULES, formatMegabytes } from '../../../config/business-rules';
import { BEARER_AUTH_NAME } from '../../../config/openapi';
import { Permission } from '../../../config/permissions';
import { AdminImagesService } from './admin-images.service';
import { AdminOffersService } from './admin-offers.service';
import {
  AdminOfferDetailDto,
  AdminOfferListItemDto,
  CreateOfferRequestDto,
  DuplicateOfferRequestDto,
  ImageUploadUrlDto,
  ImageUploadUrlRequestDto,
  ListAdminOffersQueryDto,
  UpdateAttendanceStepDto,
  UpdateContentStepDto,
  UpdateGeneralStepDto,
  UpdateOriginPricingStepDto,
  UpdateScheduleStepDto,
  UpdateWhatsappStepDto,
} from './dto/admin-offers.dto';

const OFFER_ID = uuidOr404('La oferta no existe.');
/** Tamaño máximo de las imágenes de difusión, para la documentación ("15 MB"). */
const IMAGE_MAX = formatMegabytes(BUSINESS_RULES.FILE_LIMITS.OFFER_COVER.maxBytes);
const STEP =
  'Guarda SOLO los campos del paso como borrador (autoguardado: se aceptan datos incompletos; ' +
  'solo se rechaza un formato inválido con 400). Devuelve el detalle con `wizard` recalculado: ' +
  'si `wizard.steps[n].issues` no está vacío, deshabilita "Siguiente" y muestra los mensajes.';

@ApiTags('Admin – Ofertas')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('admin/offers')
export class AdminOffersController {
  constructor(private readonly offers: AdminOffersService) {}

  @Get()
  @RequirePermissions(Permission.OFFERS_READ)
  @ApiOperation({
    summary: 'Listado de ofertas del panel',
    description:
      'HU-27: "Oferta formativa" con estado (Borrador / Publicado / Inscripciones cerradas / ' +
      'Finalizado / Archivado), conteos y ruta de la ficha pública (Vista previa). Permiso `offers.read`.',
  })
  @ApiPaginatedResponse(AdminOfferListItemDto)
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN')
  list(
    @Query() query: ListAdminOffersQueryDto,
  ): Promise<PaginatedResponseDto<AdminOfferListItemDto>> {
    return this.offers.list(query);
  }

  @Post()
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: '"+ Nueva oferta" (borrador)',
    description:
      'HU-27: crea un borrador con tipo, modalidad y nombre (único). Continúa con los pasos del ' +
      'asistente (`PATCH /admin/offers/{id}/steps/...`). Permiso `offers.write`.',
  })
  @ApiCreatedResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'OFFER_NAME_TAKEN')
  create(
    @Body() dto: CreateOfferRequestDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions(Permission.OFFERS_READ)
  @ApiOperation({
    summary: 'Detalle de la oferta (asistente)',
    description:
      'HU-27: todos los campos agrupados por paso (incluye los privados: WhatsApp, asistencia, ' +
      'aula), imágenes con URL, estado del asistente (`wizard`: problemas por paso, `canPublish`) y ' +
      '`hasEnrollments` (tipo, modalidad y origen bloqueados). Permiso `offers.read`.',
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  detail(@Param('id', OFFER_ID) id: string): Promise<AdminOfferDetailDto> {
    return this.offers.detail(id);
  }

  @Patch(':id/steps/general')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'Paso 1 — Datos e imágenes',
    description:
      `HU-27. ${STEP} Imágenes: primero \`POST /admin/uploads/images\`, PUT del archivo y luego ` +
      'envía aquí la `key` (se verifica tipo y tamaño reales). `teacherIds` reemplaza la lista en ' +
      'orden. Tipo/modalidad con inscritos → 409 `OFFER_HAS_ENROLLMENTS`. Permiso `offers.write`.',
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'OFFER_NAME_TAKEN',
    'OFFER_HAS_ENROLLMENTS',
    'ADMIN_UPLOAD_NOT_FOUND',
    'ADMIN_UPLOAD_INVALID_FILE',
  )
  general(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: UpdateGeneralStepDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.updateGeneral(id, dto, user);
  }

  @Patch(':id/steps/content')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'Paso 2 — Contenido',
    description: `HU-27: descripción, "¿Qué aprenderás?", requisitos, elegibilidad (convocatorias), bienvenida del aula y proyecto final. ${STEP} Permiso \`offers.write\`.`,
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  content(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: UpdateContentStepDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.updateContent(id, dto, user);
  }

  @Patch(':id/steps/schedule')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'Paso 3 — Horarios',
    description:
      'HU-27: fechas, duración total (`totalHours`), regla de horario en hora CDMX ' +
      '(`scheduleRule`, genera las sesiones de HU-29) y color. Reglas: curso ≤ 9 h; diplomado 60 h ' +
      `+ fecha de proyecto final (aparecen en \`wizard\`). ${STEP} Permiso \`offers.write\`.`,
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  schedule(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: UpdateScheduleStepDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.updateSchedule(id, dto, user);
  }

  @Patch(':id/steps/origin-pricing')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'Paso 4 — Origen y precio',
    description:
      'HU-27: origen NAS/MOODLE, precio MXN y USD, cuotas (2–4), beca (solo diplomados NAS). Con ' +
      'origen MOODLE se limpian precio, cuotas y beca; la lista de correos y los códigos se cargan en ' +
      `\`/admin/offers/{id}/moodle/...\`. ${STEP} Origen con inscritos → 409. Permiso \`offers.write\`.`,
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'OFFER_HAS_ENROLLMENTS',
  )
  originPricing(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: UpdateOriginPricingStepDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.updateOriginPricing(id, dto, user);
  }

  @Patch(':id/steps/attendance')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'Paso 6 — Asistencia',
    description: `HU-27/HU-30: ventana de registro de asistencia (1–72 h, 24 por defecto). El paso 5 (Recursos) se gestiona en "Contenido del aula". Permiso \`offers.write\`.`,
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  attendance(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: UpdateAttendanceStepDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.updateAttendance(id, dto, user);
  }

  @Patch(':id/steps/whatsapp')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'Paso 7 — WhatsApp',
    description:
      'HU-27: enlace del grupo (https://chat.whatsapp.com/…, solo visible para inscritos) y desde ' +
      'cuándo se muestra. Permiso `offers.write`.',
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND')
  whatsapp(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: UpdateWhatsappStepDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.updateWhatsapp(id, dto, user);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions(Permission.OFFERS_PUBLISH)
  @ApiOperation({
    summary: 'Publicar',
    description:
      'HU-27: valida los pasos 1–4 (y 6–7) completos. Si falta algo → 422 `OFFER_INCOMPLETE` con ' +
      '`details[]` (`field` = `<paso>.<campo>`, p. ej. `schedule.totalHours`) y `meta.steps`. OK → ' +
      '"Publicado", aparece en el catálogo; si `sessionPreview.available`, abre la vista previa de ' +
      'sesiones (HU-29). Ya publicada/archivada → 409 `OFFER_INVALID_STATE`. Permiso `offers.publish`.',
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses(
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'OFFER_INCOMPLETE',
    'OFFER_INVALID_STATE',
  )
  publish(
    @Param('id', OFFER_ID) id: string,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.changePublication(id, 'PUBLISH', user);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermissions(Permission.OFFERS_PUBLISH)
  @ApiOperation({
    summary: 'Despublicar (volver a borrador)',
    description:
      'HU-27: Publicado o Archivado → Borrador (sale del catálogo; los inscritos conservan su aula). ' +
      'Permiso `offers.publish`.',
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'OFFER_INVALID_STATE')
  unpublish(
    @Param('id', OFFER_ID) id: string,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.changePublication(id, 'UNPUBLISH', user);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.OFFERS_PUBLISH)
  @ApiOperation({
    summary: 'Archivar',
    description:
      'HU-27: Borrador o Publicado → Archivado (fuera del catálogo y de la ficha). Permiso `offers.publish`.',
  })
  @ApiOkResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses('UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'OFFER_INVALID_STATE')
  archive(
    @Param('id', OFFER_ID) id: string,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.changePublication(id, 'ARCHIVE', user);
  }

  @Post(':id/duplicate')
  @RequirePermissions(Permission.OFFERS_PUBLISH)
  @ApiOperation({
    summary: 'Duplicar (nueva cohorte)',
    description:
      'HU-27 "Duplicar": copia contenido, precio, beca, regla de horario (sin fechas excluidas), ' +
      'docentes, módulos y recursos (ocultos). Limpia fechas, sesiones, WhatsApp e inscripciones. ' +
      'Nombre por defecto "<nombre> (copia)". Queda en Borrador. Permiso `offers.publish`.',
  })
  @ApiCreatedResponse({ type: AdminOfferDetailDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'OFFER_NAME_TAKEN',
  )
  duplicate(
    @Param('id', OFFER_ID) id: string,
    @Body() dto: DuplicateOfferRequestDto,
    @CurrentUser() user: AdminUser,
  ): Promise<AdminOfferDetailDto> {
    return this.offers.duplicate(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.OFFERS_PUBLISH)
  @ApiOperation({
    summary: 'Borrar un borrador',
    description:
      'Solo borradores sin inscripciones, postulaciones ni pagos (si no → 409 ' +
      '`OFFER_HAS_ENROLLMENTS` / `OFFER_INVALID_STATE`; archívala en su lugar). Permiso `offers.publish`.',
  })
  @ApiNoContentResponse()
  @ApiErrorResponses(
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'OFFER_INVALID_STATE',
    'OFFER_HAS_ENROLLMENTS',
  )
  async remove(@Param('id', OFFER_ID) id: string, @CurrentUser() user: AdminUser): Promise<void> {
    await this.offers.remove(id, user);
  }
}

@ApiTags('Admin – Ofertas')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('admin/uploads')
export class AdminUploadsController {
  constructor(private readonly images: AdminImagesService) {}

  @Post('images')
  @RequirePermissions(Permission.OFFERS_WRITE)
  @ApiOperation({
    summary: 'URL firmada para subir una imagen de difusión',
    description:
      'HU-27: portada (`OFFER_COVER`), carrusel (`OFFER_CAROUSEL`) o foto de docente ' +
      `(\`TEACHER_PHOTO\`). JPG/PNG/WebP ≤ ${IMAGE_MAX} (si no → 422 \`ADMIN_UPLOAD_INVALID_FILE\`). ` +
      'Flujo: ' +
      'pide la URL → `PUT {uploadUrl}` con el `Content-Type` indicado → guarda la `key` en el paso 1 ' +
      'o en el docente. Las imágenes van bajo `public/` (bucket público si existe ' +
      '`STORAGE_PUBLIC_BUCKET`, servidas con `STORAGE_PUBLIC_BASE_URL`). Permiso `offers.write`.',
  })
  @ApiCreatedResponse({ type: ImageUploadUrlDto })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'ADMIN_UPLOAD_INVALID_FILE',
  )
  imageUploadUrl(@Body() dto: ImageUploadUrlRequestDto): Promise<ImageUploadUrlDto> {
    return this.images.uploadUrl(dto);
  }
}
