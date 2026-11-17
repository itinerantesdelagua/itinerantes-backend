import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app.exception';
import { isHttpsUrl } from '../../../common/utils/urls';
import { BUSINESS_RULES, formatMegabytes } from '../../../config/business-rules';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { StorageService } from '../../../infra/storage/storage.service';
import type { ImageUploadUrlDto, ImageUploadUrlRequestDto } from './dto/admin-offers.dto';
import {
  type ImagePurpose,
  isValidPublicImage,
  keyMatchesPrefix,
  publicImagePrefix,
} from './policies/admin-content.policy';

const LIMIT = BUSINESS_RULES.FILE_LIMITS.OFFER_COVER;

/**
 * Imágenes de difusión del panel (HU-27): portada, carrusel y foto de docente. Flujo: URL firmada
 * (PUT directo del navegador, key bajo `public/…`) → se guarda la key en el paso del asistente o en el
 * docente → aquí se verifica con `head()` (tipo y tamaño REALES). Se sirven con `getPublicUrl`
 * (STORAGE_PUBLIC_BASE_URL si existe; si no, URL firmada de 7 días).
 */
@Injectable()
export class AdminImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async uploadUrl(dto: ImageUploadUrlRequestDto): Promise<ImageUploadUrlDto> {
    if (dto.purpose !== 'TEACHER_PHOTO') {
      const offer = await this.prisma.offer.findUnique({
        where: { id: dto.offerId! },
        select: { id: true },
      });
      if (!offer) throw AppException.notFound('La oferta no existe.');
    }
    if (!isValidPublicImage({ mimeType: dto.contentType, sizeBytes: dto.sizeBytes })) {
      throw invalidFile();
    }
    const key = StorageService.buildKey(publicImagePrefix(dto.purpose, dto.offerId), dto.fileName);
    const signed = await this.storage.getUploadUrl(key, { contentType: dto.contentType });
    return {
      uploadUrl: signed.url,
      method: 'PUT',
      headers: { 'Content-Type': dto.contentType },
      key,
      expiresAt: signed.expiresAt,
    };
  }

  /**
   * Verifica una imagen enviada por el cliente: URL https absoluta (CDN externo) o key subida bajo el
   * prefijo de su propósito con tipo/tamaño válidos. `field` se usa en el error.
   */
  async verify(keyOrUrl: string, purpose: ImagePurpose, offerId?: string): Promise<void> {
    if (/^https?:\/\//i.test(keyOrUrl)) {
      if (!isHttpsUrl(keyOrUrl)) throw invalidFile();
      return;
    }
    if (!keyMatchesPrefix(keyOrUrl, publicImagePrefix(purpose, offerId))) {
      throw new AppException('ADMIN_UPLOAD_NOT_FOUND');
    }
    const head = await this.storage.head(keyOrUrl);
    if (!head) throw new AppException('ADMIN_UPLOAD_NOT_FOUND');
    if (
      !isValidPublicImage({ mimeType: head.contentType ?? '', sizeBytes: head.contentLength ?? 0 })
    ) {
      throw invalidFile();
    }
  }

  url(keyOrUrl: string): Promise<string> {
    return this.storage.getPublicUrl(keyOrUrl, BUSINESS_RULES.PUBLIC_IMAGE_SIGNED_URL_TTL_SECONDS);
  }
}

function invalidFile(): AppException {
  return new AppException('ADMIN_UPLOAD_INVALID_FILE', {
    message: `La imagen debe ser JPG, PNG o WebP de máximo ${formatMegabytes(LIMIT.maxBytes)}.`,
    meta: { allowedTypes: LIMIT.mimeTypes, maxBytes: LIMIT.maxBytes },
  });
}
