import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { slugify } from '../../common/utils/slug';
import { EventsService } from '../events/events.service';
import { PresignUploadDto, RegisterMediaDto } from './dto/media.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
  ) {}

  /** Devuelve una URL firmada de subida directa navegador→storage. */
  async presignUpload(eventId: string, dto: PresignUploadDto, user: AuthUser) {
    await this.events.getManaged(eventId, user);
    const safeName = slugify(dto.filename.replace(/\.[^.]+$/, ''));
    const ext = dto.filename.split('.').pop() ?? 'bin';
    const key = `events/${eventId}/${randomUUID()}-${safeName}.${ext}`;
    const uploadUrl = await this.storage.signedPutUrl(key, dto.contentType);
    return { key, uploadUrl };
  }

  async register(eventId: string, dto: RegisterMediaDto, user: AuthUser) {
    await this.events.getManaged(eventId, user);
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
    await this.events.getManaged(media.eventId, user);
    await this.prisma.eventMedia.delete({ where: { id: mediaId } });
  }
}
