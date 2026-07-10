import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { slugify, slugWithSuffix } from '../../common/utils/slug';
import { EventsService } from '../events/events.service';
import { EditUnlockService } from '../events/edit-unlock.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly editUnlock: EditUnlockService,
  ) {}

  /**
   * Un evento publicado (o cancelado) tiene su aforo/geometría CONGELADOS: no se
   * pueden crear/editar/borrar localidades ni asientos (alteraría lo que ya está a
   * la venta). Solo en `draft` se edita libremente. Devuelve el evento gestionable
   * (reusa la autorización owner/admin de getManaged). Un admin NO-dueño requiere
   * token de desbloqueo (`x-edit-unlock`).
   */
  private async assertEditable(eventId: string, user: AuthUser, unlockToken?: string) {
    const event = await this.events.getManaged(eventId, user);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    if (event.status !== 'draft') {
      throw new ConflictException(
        'El evento no está en borrador; su aforo y localidades están bloqueados',
      );
    }
    return event;
  }

  // ---- Localidades --------------------------------------------------------

  async listLocalities(eventId: string, user: AuthUser) {
    await this.events.getManaged(eventId, user);
    return this.prisma.locality.findMany({
      where: { eventId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { seats: true } } },
    });
  }

  async addLocality(eventId: string, dto: CreateLocalityDto, user: AuthUser, unlockToken?: string) {
    await this.assertEditable(eventId, user, unlockToken);
    const base = slugify(dto.name);
    const exists = await this.prisma.locality.findFirst({ where: { eventId, slug: base } });
    const kind = dto.kind ?? 'general';
    const capacity = dto.capacity ?? 0;
    const locality = await this.prisma.locality.create({
      data: {
        eventId,
        name: dto.name,
        slug: exists ? slugWithSuffix(dto.name, Date.now().toString(36).slice(-4)) : base,
        kind,
        // En GA el aforo se materializa en filas (reconcile); parte de 0 y se ajusta.
        capacity: kind === 'general' ? 0 : capacity,
        desiredNet: dto.desiredNet,
      },
    });
    if (kind === 'general' && capacity > 0) {
      await this.reconcileGaSeats(locality.id, capacity);
      return this.prisma.locality.findUniqueOrThrow({ where: { id: locality.id } });
    }
    return locality;
  }

  private async getLocalityManaged(localityId: string, user: AuthUser) {
    const locality = await this.prisma.locality.findUnique({ where: { id: localityId } });
    if (!locality) throw new NotFoundException('Localidad no encontrada');
    await this.events.getManaged(locality.eventId, user);
    return locality;
  }

  /** Como getLocalityManaged pero exige que el evento esté en borrador (mutable). */
  private async getLocalityEditable(localityId: string, user: AuthUser, unlockToken?: string) {
    const locality = await this.prisma.locality.findUnique({ where: { id: localityId } });
    if (!locality) throw new NotFoundException('Localidad no encontrada');
    await this.assertEditable(locality.eventId, user, unlockToken);
    return locality;
  }

  async updateLocality(
    localityId: string,
    dto: UpdateLocalityDto,
    user: AuthUser,
    unlockToken?: string,
  ) {
    const current = await this.getLocalityEditable(localityId, user, unlockToken);
    const nextKind = dto.kind ?? current.kind;
    const isGa = nextKind === 'general';
    const updated = await this.prisma.locality.update({
      where: { id: localityId },
      data: {
        name: dto.name,
        kind: dto.kind,
        // El aforo de GA lo gobierna reconcile (materializa filas); no se setea aquí.
        capacity: isGa ? undefined : dto.capacity,
        desiredNet: dto.desiredNet,
      },
    });
    if (isGa && dto.capacity !== undefined) {
      await this.reconcileGaSeats(localityId, dto.capacity);
      return this.prisma.locality.findUniqueOrThrow({ where: { id: localityId } });
    }
    return updated;
  }

  /**
   * Materializa el aforo de una localidad GENERAL como filas `seats` reales
   * (`GA-0000001`…), para reutilizar el anti-doble-venta probado (FOR UPDATE +
   * índice parcial) sin fila caliente. Idempotente: ajusta la cantidad de filas
   * al `target`. Al reducir, solo elimina filas `available` (nunca vendidas);
   * si no hay suficientes libres → 409 (no bajar el aforo bajo lo ya vendido).
   * `capacity` de la localidad queda == nº de filas materializadas (== target).
   */
  private async reconcileGaSeats(localityId: string, target: number) {
    const current = await this.prisma.seat.count({ where: { localityId } });
    if (target > current) {
      const last = await this.prisma.seat.findFirst({
        where: { localityId, label: { startsWith: 'GA-' } },
        orderBy: { label: 'desc' },
        select: { label: true },
      });
      let next = last ? parseInt(last.label.slice(3), 10) + 1 : 1;
      const toAdd = target - current;
      // Por lotes: aforos grandes (hasta 1M) no caben en un solo INSERT cómodo.
      const CHUNK = 10_000;
      for (let done = 0; done < toAdd; done += CHUNK) {
        const size = Math.min(CHUNK, toAdd - done);
        const data = Array.from({ length: size }, (_, i) => ({
          localityId,
          label: `GA-${String(next + i).padStart(7, '0')}`,
          section: 'GA',
        }));
        await this.prisma.seat.createMany({ data, skipDuplicates: true });
        next += size;
      }
    } else if (target < current) {
      const surplus = current - target;
      // Solo se pueden liberar cupos aún disponibles (no vendidos/reservados).
      const removable = await this.prisma.seat.findMany({
        where: { localityId, status: 'available' },
        select: { id: true },
        orderBy: { label: 'desc' }, // quita primero los de mayor número
        take: surplus,
      });
      if (removable.length < surplus) {
        throw new ConflictException(
          'No puedes reducir el aforo por debajo de los boletos ya vendidos',
        );
      }
      await this.prisma.seat.deleteMany({ where: { id: { in: removable.map((r) => r.id) } } });
    }
    await this.prisma.locality.update({ where: { id: localityId }, data: { capacity: target } });
  }

  async removeLocality(localityId: string, user: AuthUser, unlockToken?: string) {
    await this.getLocalityEditable(localityId, user, unlockToken);
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

  async bulkCreateSeats(
    localityId: string,
    dto: BulkSeatsDto,
    user: AuthUser,
    unlockToken?: string,
  ) {
    await this.getLocalityEditable(localityId, user, unlockToken);
    const result = await this.prisma.seat.createMany({
      data: dto.seats.map((s) => ({ localityId, ...s })),
      skipDuplicates: true,
    });
    const capacity = await this.syncCapacity(localityId);
    return { created: result.count, capacity };
  }

  async generateSeats(
    localityId: string,
    dto: GenerateSeatsDto,
    user: AuthUser,
    unlockToken?: string,
  ) {
    await this.getLocalityEditable(localityId, user, unlockToken);
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

  async deleteSeats(
    localityId: string,
    dto: DeleteSeatsDto,
    user: AuthUser,
    unlockToken?: string,
  ) {
    await this.getLocalityEditable(localityId, user, unlockToken);
    const result = await this.prisma.seat.deleteMany({
      where: { id: { in: dto.ids }, localityId },
    });
    const capacity = await this.syncCapacity(localityId);
    return { deleted: result.count, capacity };
  }

  // ---- Mapas de asiento (versionados) -------------------------------------

  async createSeatMap(eventId: string, dto: CreateSeatMapDto, user: AuthUser, unlockToken?: string) {
    const event = await this.events.getManaged(eventId, user);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
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

  async setActiveSeatMap(seatMapId: string, user: AuthUser, unlockToken?: string) {
    const map = await this.prisma.seatMap.findUnique({ where: { id: seatMapId } });
    if (!map) throw new NotFoundException('Mapa no encontrado');
    const event = await this.events.getManaged(map.eventId, user);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    return this.prisma.$transaction(async (tx) => {
      await tx.seatMap.updateMany({ where: { eventId: map.eventId }, data: { active: false } });
      return tx.seatMap.update({ where: { id: seatMapId }, data: { active: true } });
    });
  }
}
