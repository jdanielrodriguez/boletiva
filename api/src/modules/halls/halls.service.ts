import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Hall } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateHallDto, UpdateHallDto } from './dto/halls.dto';

/**
 * Salones/venues reutilizables (v3.5/v3.7). El admin los gestiona (estados
 * draft/published); cualquier promotor lista los PUBLICADOS para elegirlos al
 * crear/editar un evento (prefija dirección/coordenadas y un layout base).
 */
@Injectable()
export class HallsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista completa (admin): salones en cualquier estado. */
  list() {
    return this.prisma.hall.findMany({ orderBy: { name: 'asc' } });
  }

  /** Lista para el selector del promotor: solo salones publicados. */
  listPublished() {
    return this.prisma.hall.findMany({
      where: { status: ContentStatus.published },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string): Promise<Hall> {
    const hall = await this.prisma.hall.findUnique({ where: { id } });
    if (!hall) throw new NotFoundException('Salón no encontrado');
    return hall;
  }

  /** Valida que la plantilla de asientos referida exista (si se indicó). */
  private async assertSeatTemplate(seatTemplateId?: string): Promise<void> {
    if (!seatTemplateId) return;
    const tpl = await this.prisma.seatTemplate.findUnique({ where: { id: seatTemplateId } });
    if (!tpl) throw new BadRequestException('La plantilla de asientos indicada no existe');
  }

  async create(dto: CreateHallDto) {
    await this.assertSeatTemplate(dto.seatTemplateId);
    return this.prisma.hall.create({
      data: {
        name: dto.name,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        city: dto.city,
        notes: dto.notes,
        seatTemplateId: dto.seatTemplateId,
        status: dto.status,
      },
    });
  }

  async update(id: string, dto: UpdateHallDto) {
    await this.get(id);
    await this.assertSeatTemplate(dto.seatTemplateId);
    return this.prisma.hall.update({
      where: { id },
      data: {
        name: dto.name,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        city: dto.city,
        notes: dto.notes,
        seatTemplateId: dto.seatTemplateId,
        status: dto.status,
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    // Desvincula los eventos que apuntan a este salón (onDelete: SetNull en el FK).
    await this.prisma.hall.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Cambia el estado de publicación (draft/published). */
  async setStatus(id: string, status: ContentStatus) {
    await this.get(id);
    return this.prisma.hall.update({ where: { id }, data: { status } });
  }
}
