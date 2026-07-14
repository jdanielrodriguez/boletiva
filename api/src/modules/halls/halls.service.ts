import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContentStatus, Hall, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateHallDto, UpdateHallDto } from './dto/halls.dto';
import { ScopeDashboardService } from '../analytics/scope-dashboard.service';
import { ScopeDashboardDto } from '../analytics/dto/scope-dashboard.dto';

/**
 * Salones/venues reutilizables (v3.5/v3.7/v3.10). El admin los gestiona con los
 * mismos estados que las plantillas de asientos (draft/published + hidden +
 * disabled); cualquier promotor lista los PUBLICADOS y visibles para elegirlos al
 * crear/editar un evento (prefija dirección/coordenadas y un layout base).
 */
@Injectable()
export class HallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeDashboardService,
  ) {}

  /** Dashboard del salón: métricas agregadas sobre TODOS sus eventos (admin). */
  async dashboard(id: string): Promise<ScopeDashboardDto> {
    const hall = await this.prisma.hall.findUnique({
      where: { id },
      select: { id: true, name: true, events: { select: { id: true, name: true, status: true } } },
    });
    if (!hall) throw new NotFoundException('Salón no encontrado');
    return this.scope.aggregate('hall', hall.id, hall.name, hall.events);
  }

  /** Lista completa (admin): salones en cualquier estado. */
  list() {
    return this.prisma.hall.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Lista para el selector del promotor: solo salones publicados, no ocultos y
   * no deshabilitados. Los draft/hidden/disabled nunca salen al promotor.
   */
  listPublished() {
    return this.prisma.hall.findMany({
      where: { status: ContentStatus.published, hidden: false, disabled: false },
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
    const hall = await this.get(id);
    // Regla v3.10 (espejo de plantillas): solo se edita en borrador o
    // deshabilitado. Un salón PUBLICADO se despublica/oculta/deshabilita primero.
    if (hall.status === ContentStatus.published && !hall.disabled) {
      throw new ConflictException(
        'Un salón publicado no se puede editar; despublícalo o deshabilítalo primero',
      );
    }
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
    const hall = await this.get(id);
    // Regla v3.10: solo se puede ELIMINAR un salón deshabilitado (espejo de las
    // plantillas). Si sigue habilitado → 409 (primero hay que deshabilitarlo).
    if (!hall.disabled) {
      throw new ConflictException(
        'Solo se puede eliminar un salón deshabilitado; deshabilítalo primero',
      );
    }
    // Desvincula los eventos que apuntan a este salón (onDelete: SetNull en el FK).
    await this.prisma.hall.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Cambia el estado de publicación (draft/published). */
  setStatus(id: string, status: ContentStatus) {
    return this.transition(id, { status });
  }

  /** Oculta/muestra sin eliminar (reversible). */
  setHidden(id: string, hidden: boolean) {
    return this.transition(id, { hidden });
  }

  /** Deshabilita/habilita (deshabilitar es prerequisito para eliminar). */
  setDisabled(id: string, disabled: boolean) {
    return this.transition(id, { disabled });
  }

  private async transition(id: string, data: Prisma.HallUpdateInput) {
    await this.get(id); // 404 si no existe
    return this.prisma.hall.update({ where: { id }, data });
  }
}
