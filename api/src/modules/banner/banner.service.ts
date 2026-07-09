import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { randomToken } from '../../common/utils/crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BANNER_PROVIDER, BannerProvider, BannerTemplate } from './banner.provider';

/** Opciones de generación (prompt/plantilla/imágenes de ejemplo). */
export interface BannerOptions {
  prompt?: string;
  template?: BannerTemplate;
  sampleImages?: string[];
}

/** URL firmada del banner (holgada para sobrevivir al cache del edge). */
const BANNER_URL_TTL = 3600;

/**
 * Generación de banner con IA para un evento (F4). Sólo el dueño (promotor) o un
 * admin. Compone el prompt con el nombre/categoría/descripción, genera la imagen
 * por el proveedor (stub por defecto; Gemini detrás del mismo puerto), la sube al
 * storage y la registra como media `cover` del evento.
 */
@Injectable()
export class BannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(BANNER_PROVIDER) private readonly provider: BannerProvider,
  ) {}

  async generateForEvent(eventId: string, user: AuthUser, options?: BannerOptions) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { category: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    const isOwner = event.promoterId === user.userId;
    if (!user.roles.includes(Role.admin) && !isOwner) {
      throw new ForbiddenException('No es tu evento');
    }

    const image = await this.provider.generate({
      eventName: event.name,
      categoryName: event.category?.name ?? null,
      description: event.description,
      prompt: options?.prompt ?? null,
      template: options?.template ?? null,
      sampleImages: options?.sampleImages ?? null,
    });
    const key = `events/${eventId}/banner-${randomToken(8)}.${image.ext}`;
    await this.storage.putObject(key, image.body, image.contentType);

    const media = await this.prisma.eventMedia.create({
      data: { eventId, key, kind: 'cover', position: 0 },
    });
    return {
      id: media.id,
      eventId,
      key,
      kind: media.kind,
      url: await this.storage.signedGetUrl(key, BANNER_URL_TTL),
      provider: this.provider.name,
    };
  }
}
