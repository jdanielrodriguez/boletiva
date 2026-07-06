import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { slugify, slugWithSuffix } from '../../common/utils/slug';
import { EventsService } from '../events/events.service';
import {
  BulkSeatsDto,
  CreateLocalityDto,
  CreateSeatMapDto,
  DeleteSeatsDto,
  GenerateSeatsDto,
  UpdateLocalityDto,
} from './dto/venues.dto';

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  // ---- Localidades --------------------------------------------------------

  async listLocalities(eventId: string, user: AuthUser) {
    await this.events.getManaged(eventId, user);
    return this.prisma.locality.findMany({
      where: { eventId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { seats: true } } },
    });
  }

  async addLocality(eventId: string, dto: CreateLocalityDto, user: AuthUser) {
    await this.events.getManaged(eventId, user);
    const base = slugify(dto.name);
    const exists = await this.prisma.locality.findFirst({ where: { eventId, slug: base } });
    return this.prisma.locality.create({
      data: {
        eventId,
        name: dto.name,
        slug: exists ? slugWithSuffix(dto.name, Date.now().toString(36).slice(-4)) : base,
        kind: dto.kind ?? 'general',
        capacity: dto.capacity ?? 0,
        desiredNet: dto.desiredNet,
      },
    });
  }

  private async getLocalityManaged(localityId: string, user: AuthUser) {
    const locality = await this.prisma.locality.findUnique({ where: { id: localityId } });
    if (!locality) throw new NotFoundException('Localidad no encontrada');
    await this.events.getManaged(locality.eventId, user);
    return locality;
  }

  async updateLocality(localityId: string, dto: UpdateLocalityDto, user: AuthUser) {
    await this.getLocalityManaged(localityId, user);
    return this.prisma.locality.update({
      where: { id: localityId },
      data: {
        name: dto.name,
        kind: dto.kind,
        capacity: dto.capacity,
        desiredNet: dto.desiredNet,
      },
    });
  }

  async removeLocality(localityId: string, user: AuthUser) {
    await this.getLocalityManaged(localityId, user);
    await this.prisma.locality.delete({ where: { id: localityId } });
  }

  // ---- Asientos -----------------------------------------------------------

  async listSeats(localityId: string, user: AuthUser) {
    await this.getLocalityManaged(localityId, user);
    return this.prisma.seat.findMany({
      where: { localityId },
      orderBy: [{ section: 'asc' }, { label: 'asc' }],
    });
  }

  private async syncCapacity(localityId: string) {
    const count = await this.prisma.seat.count({ where: { localityId } });
    await this.prisma.locality.update({ where: { id: localityId }, data: { capacity: count } });
    return count;
  }

  async bulkCreateSeats(localityId: string, dto: BulkSeatsDto, user: AuthUser) {
    await this.getLocalityManaged(localityId, user);
    const result = await this.prisma.seat.createMany({
      data: dto.seats.map((s) => ({ localityId, ...s })),
      skipDuplicates: true,
    });
    const capacity = await this.syncCapacity(localityId);
    return { created: result.count, capacity };
  }

  async generateSeats(localityId: string, dto: GenerateSeatsDto, user: AuthUser) {
    await this.getLocalityManaged(localityId, user);
    const prefix = dto.labelPrefix ?? '';
    const data = Array.from({ length: dto.count }, (_, i) => ({
      localityId,
      label: `${prefix}${i + 1}`,
      section: dto.section,
    }));
    const result = await this.prisma.seat.createMany({ data, skipDuplicates: true });
    const capacity = await this.syncCapacity(localityId);
    return { created: result.count, capacity };
  }

  async deleteSeats(localityId: string, dto: DeleteSeatsDto, user: AuthUser) {
    await this.getLocalityManaged(localityId, user);
    const result = await this.prisma.seat.deleteMany({
      where: { id: { in: dto.ids }, localityId },
    });
    const capacity = await this.syncCapacity(localityId);
    return { deleted: result.count, capacity };
  }

  // ---- Mapas de asiento (versionados) -------------------------------------

  async createSeatMap(eventId: string, dto: CreateSeatMapDto, user: AuthUser) {
    await this.events.getManaged(eventId, user);
    const last = await this.prisma.seatMap.findFirst({
      where: { eventId },
      orderBy: { version: 'desc' },
    });
    const version = (last?.version ?? 0) + 1;
    // Versiones inmutables: la nueva pasa a ser la activa; las demás se desactivan.
    return this.prisma.$transaction(async (tx) => {
      await tx.seatMap.updateMany({ where: { eventId }, data: { active: false } });
      return tx.seatMap.create({
        data: {
          eventId,
          version,
          name: dto.name,
          width: dto.width ?? 1000,
          height: dto.height ?? 800,
          background: (dto.background ?? undefined) as Prisma.InputJsonValue | undefined,
          layout: (dto.layout ?? {}) as Prisma.InputJsonValue,
          active: true,
        },
      });
    });
  }

  async listSeatMaps(eventId: string, user: AuthUser) {
    await this.events.getManaged(eventId, user);
    return this.prisma.seatMap.findMany({ where: { eventId }, orderBy: { version: 'desc' } });
  }

  async getActiveSeatMap(eventId: string) {
    const map = await this.prisma.seatMap.findFirst({ where: { eventId, active: true } });
    if (!map) throw new NotFoundException('El evento no tiene mapa de asientos activo');
    return map;
  }

  async setActiveSeatMap(seatMapId: string, user: AuthUser) {
    const map = await this.prisma.seatMap.findUnique({ where: { id: seatMapId } });
    if (!map) throw new NotFoundException('Mapa no encontrado');
    await this.events.getManaged(map.eventId, user);
    return this.prisma.$transaction(async (tx) => {
      await tx.seatMap.updateMany({ where: { eventId: map.eventId }, data: { active: false } });
      return tx.seatMap.update({ where: { id: seatMapId }, data: { active: true } });
    });
  }
}
