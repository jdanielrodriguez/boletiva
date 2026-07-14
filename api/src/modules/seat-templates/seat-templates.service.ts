import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma, SeatTemplate } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateSeatTemplateDto, UpdateSeatTemplateDto } from './dto/seat-templates.dto';
import { ScopeDashboardService, ScopeEvent } from '../analytics/scope-dashboard.service';
import { ScopeDashboardDto } from '../analytics/dto/scope-dashboard.dto';

/**
 * Plantillas de disposición de asientos (v3.5/v3.7). Registra los presets del editor
 * (built-in, sembrados) y las plantillas que el admin cree a mano. El promotor las
 * consume (lectura) para el desplegable del editor; el admin las gestiona con estados
 * draft/published + ocultar/deshabilitar.
 */
@Injectable()
export class SeatTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeDashboardService,
  ) {}

  /**
   * Dashboard de la plantilla: métricas agregadas de los eventos que la usan (admin).
   * La plantilla no enlaza eventos directo: se llega vía sus salones → eventos.
   */
  async dashboard(id: string): Promise<ScopeDashboardDto> {
    const tpl = await this.prisma.seatTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        halls: { select: { events: { select: { id: true, name: true, status: true } } } },
      },
    });
    if (!tpl) throw new NotFoundException('Plantilla no encontrada');
    // Un evento pertenece a un solo salón, pero deduplicamos por seguridad.
    const events = [
      ...new Map(
        tpl.halls.flatMap((h) => h.events).map((e): [string, ScopeEvent] => [e.id, e]),
      ).values(),
    ];
    return this.scope.aggregate('template', tpl.id, tpl.name, events);
  }

  /** Lista completa (admin): todas las plantillas en cualquier estado. */
  list() {
    return this.prisma.seatTemplate.findMany({
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Lista para el desplegable del editor (promotor): solo publicadas, no ocultas
   * y no deshabilitadas. Las draft/hidden/disabled nunca salen al promotor.
   */
  listPublished() {
    return this.prisma.seatTemplate.findMany({
      where: { status: ContentStatus.published, hidden: false, disabled: false },
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    });
  }

  async get(id: string): Promise<SeatTemplate> {
    const tpl = await this.prisma.seatTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException('Plantilla no encontrada');
    return tpl;
  }

  create(dto: CreateSeatTemplateDto) {
    return this.prisma.seatTemplate.create({
      data: {
        name: dto.name,
        kind: dto.kind ?? 'custom',
        layoutJson: (dto.layoutJson ?? {}) as Prisma.InputJsonValue,
        params: (dto.params ?? undefined) as Prisma.InputJsonValue | undefined,
        isBuiltIn: false, // el admin nunca crea built-ins (solo el seed)
      },
    });
  }

  async update(id: string, dto: UpdateSeatTemplateDto) {
    const tpl = await this.get(id);
    if (tpl.isBuiltIn) {
      throw new ConflictException('Las plantillas del sistema no se pueden editar');
    }
    return this.prisma.seatTemplate.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        layoutJson: (dto.layoutJson ?? undefined) as Prisma.InputJsonValue | undefined,
        params: (dto.params ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async remove(id: string) {
    const tpl = await this.get(id);
    if (tpl.isBuiltIn) {
      throw new ConflictException('Las plantillas del sistema no se pueden eliminar');
    }
    // Regla v3.7: solo se puede ELIMINAR una plantilla deshabilitada. Si está
    // oculta pero no deshabilitada → 409 (primero hay que deshabilitarla).
    if (!tpl.disabled) {
      throw new ConflictException(
        'Solo se puede eliminar una plantilla deshabilitada; deshabilítala primero',
      );
    }
    await this.prisma.seatTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Cambia el estado de publicación (draft/published). Built-in permitido. */
  setStatus(id: string, status: ContentStatus) {
    return this.transition(id, { status });
  }

  /** Oculta/muestra sin eliminar (reversible). Built-in permitido. */
  setHidden(id: string, hidden: boolean) {
    return this.transition(id, { hidden });
  }

  /** Deshabilita/habilita (deshabilitar es prerequisito para eliminar). Built-in permitido. */
  setDisabled(id: string, disabled: boolean) {
    return this.transition(id, { disabled });
  }

  private async transition(id: string, data: Prisma.SeatTemplateUpdateInput) {
    await this.get(id); // 404 si no existe (built-in SÍ puede cambiar de estado)
    return this.prisma.seatTemplate.update({ where: { id }, data });
  }
}
