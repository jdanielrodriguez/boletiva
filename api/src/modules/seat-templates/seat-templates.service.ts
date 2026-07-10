import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SeatTemplate } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateSeatTemplateDto, UpdateSeatTemplateDto } from './dto/seat-templates.dto';

/**
 * Plantillas de disposición de asientos (v3.5). Registra los presets del editor
 * (built-in, sembrados) y las plantillas que el admin cree a mano. El promotor las
 * consume (lectura) para el desplegable del editor; el admin las gestiona.
 */
@Injectable()
export class SeatTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.seatTemplate.findMany({
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
    await this.prisma.seatTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }
}
