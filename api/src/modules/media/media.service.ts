import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { slugify } from '../../common/utils/slug';
import { EventsService } from '../events/events.service';
import { PresignUploadDto, RegisterMediaDto } from './dto/media.dto';

/** Tope de archivos de media por evento (anti-abuso de storage, H6). */
const MAX_MEDIA_PER_EVENT = 30;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
  ) {}

  /** Devuelve una URL firmada de subida directa navegador→storage. */
  async presignUpload(eventId: string, dto: PresignUploadDto, user: AuthUser) {
    await this.events.getManagedMutable(eventId, user); // ownership + evento NO concluido
    // El tipo (image/* | video/*) ya lo valida el DTO; aquí la `key` va SIEMPRE bajo
    // el prefijo del evento para que `register` pueda validarla (6.3).
    const safeName = slugify(dto.filename.replace(/\.[^.]+$/, ''));
    const ext = dto.filename.split('.').pop() ?? 'bin';
    // La `key` va SIEMPRE bajo el prefijo del evento → register puede validarla.
    const key = `events/${eventId}/${randomUUID()}-${safeName}.${ext}`;
    const uploadUrl = await this.storage.signedPutUrl(key, dto.contentType);
    return { key, uploadUrl };
  }

  async register(eventId: string, dto: RegisterMediaDto, user: AuthUser) {
    await this.events.getManagedMutable(eventId, user); // ownership + evento NO concluido
    // 6.3: la key debe pertenecer al prefijo del evento (la que devolvió presignUpload).
    // Impide registrar objetos arbitrarios del bucket o de OTRO evento.
    if (!dto.key.startsWith(`events/${eventId}/`)) {
      throw new BadRequestException('La key de la media no corresponde a este evento');
    }
    // H6: tope de media por evento (evita crecimiento ilimitado de objetos/filas).
    const count = await this.prisma.eventMedia.count({ where: { eventId } });
    if (count >= MAX_MEDIA_PER_EVENT) {
      throw new BadRequestException(`Máximo ${MAX_MEDIA_PER_EVENT} archivos de media por evento`);
    }
    return this.prisma.eventMedia.create({
      data: {
        eventId,
        key: dto.key,
        kind: dto.kind ?? 'gallery',
        position: dto.position ?? 0,
      },
    });
  }

  /** Media pública del evento con URLs firmadas de descarga (expiración corta). */
  async listPublic(eventId: string) {
    // Endpoint PÚBLICO: solo expone media de eventos PUBLICADOS. Antes filtraba solo por
    // eventId → la media de un evento en BORRADOR quedaba accesible por id (QA promotores-H7).
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true },
    });
    if (!event || event.status !== 'published') return [];
    const media = await this.prisma.eventMedia.findMany({
      where: { eventId },
      orderBy: [{ kind: 'asc' }, { position: 'asc' }],
    });
    return Promise.all(
      media.map(async (m) => ({
        id: m.id,
        kind: m.kind,
        position: m.position,
        url: await this.storage.signedGetUrl(m.key, 900),
      })),
    );
  }

  async remove(mediaId: string, user: AuthUser) {
    const media = await this.prisma.eventMedia.findUnique({ where: { id: mediaId } });
    if (!media) throw new NotFoundException('Media no encontrada');
    await this.events.getManagedMutable(media.eventId, user); // ownership + evento NO concluido
    await this.prisma.eventMedia.delete({ where: { id: mediaId } });
  }
}
