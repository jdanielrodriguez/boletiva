import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
   * Aforo/geometría editables solo cuando el evento es RECONFIGURABLE: `draft`
   * (nunca publicado) o `suspended` (v3.7: despublicado a propósito para cambiar
   * salón/plantilla/localidades). Un evento `published`/`cancelled`/`finished`
   * tiene su aforo CONGELADO (no alterar lo que está a la venta). Devuelve el
   * evento gestionable (reusa la autorización owner/admin de getManaged). Un admin
   * NO-dueño requiere token de desbloqueo (`x-edit-unlock`).
   */
  private async assertEditable(eventId: string, user: AuthUser, unlockToken?: string) {
    const event = await this.events.getManaged(eventId, user);
    await this.editUnlock.assertCanMutate(user, event, unlockToken);
    if (event.status !== 'draft' && event.status !== 'suspended') {
      throw new ConflictException(
        'El evento no es editable en su estado actual; suspéndelo para reconfigurar su aforo y localidades',
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
    // Seguridad contable (v3.10): no se elimina una localidad con boletos vendidos
    // (ítems de orden activos). Borrarla dejaría boletos/asientos huérfanos y
    // rompería la trazabilidad del ledger. Primero hay que reasignar/reembolsar.
    const soldItems = await this.prisma.orderItem.count({
      where: { localityId, active: true, order: { status: 'paid' } },
    });
    if (soldItems > 0) {
      throw new ConflictException(
        `No puedes eliminar la localidad: tiene ${soldItems} boleto(s) vendido(s). Reasígnalos o reembólsalos primero.`,
      );
    }
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
    // Seguridad de reconfiguración (v3.7): SOLO se borran cupos `available`. Al
    // reconfigurar un evento suspendido con ventas, un asiento VENDIDO nunca se
    // elimina (dejaría un boleto huérfano / abriría la puerta a doble venta); esos
    // asientos se preservan y su devolución debe ejecutarse aparte.
    const result = await this.prisma.seat.deleteMany({
      where: { id: { in: dto.ids }, localityId, status: 'available' },
    });
    const capacity = await this.syncCapacity(localityId);
    return { deleted: result.count, capacity };
  }

  /**
   * REEMPLAZA (migra) el mapa de asientos de una localidad SEATED por un layout
   * nuevo, ATÓMICAMENTE y SIN orfanar boletos vendidos. Pensado para reconfigurar
   * un evento en `draft`/`suspended` (nunca `published` activo) cuando se aplica
   * otra plantilla sobre una localidad que YA tiene ventas.
   *
   * Política de migración (por `label` = identidad lógica del asiento):
   *  1. Label nuevo que coincide con uno existente → se CONSERVA el asiento (mismo
   *     `id`, mismo `status`, mismo boleto apuntándolo) y solo se actualiza su
   *     geometría (`x/y/section/row`). Nunca se duplica.
   *  2. Label nuevo sin coincidencia → se crea `available`.
   *  3. Asiento viejo `available` cuyo label NO está en el layout nuevo → se borra.
   *  4. Asiento viejo OCUPADO (vendido/held/blocked o con ítem de orden activo /
   *     boleto) cuyo label NO está en el layout nuevo → se PRESERVA ("arrastrado"):
   *     el layout nuevo NO puede eliminar un asiento ya vendido (fallback seguro).
   *
   * Garantías: 0 huérfanos (jamás se borra un asiento ocupado), 0 doble-venta
   * (`SELECT … FOR UPDATE` sobre los asientos de la localidad + índice único
   * `(locality_id, label)`; no se toca `order_items` ni su índice parcial). El
   * LEDGER no se toca (es inventario, no dinero). Localidades SIN vendidos usan el
   * camino rápido delete-all + insert (comportamiento idéntico al de siempre).
   */
  async replaceSeats(
    localityId: string,
    dto: BulkSeatsDto,
    user: AuthUser,
    unlockToken?: string,
  ) {
    const locality = await this.getLocalityEditable(localityId, user, unlockToken);
    if (locality.kind === 'general') {
      throw new BadRequestException(
        'Para admisión general ajusta el aforo (capacity), no el mapa de asientos',
      );
    }
    // Labels duplicados en el propio payload → 400 (el índice único los rechazaría
    // igual, pero un error de validación es más claro que un 409 de la BD).
    const incomingLabels = dto.seats.map((s) => s.label);
    if (new Set(incomingLabels).size !== incomingLabels.length) {
      throw new BadRequestException('El layout tiene labels de asiento duplicados');
    }
    const incomingSet = new Set(incomingLabels);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Fallar rápido si otro proceso sostiene el lock (no colgar el pool).
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5000ms'`);
          // Capa 2 (anti-doble-venta): bloquear TODOS los asientos de la localidad.
          const existing = await tx.$queryRaw<
            { id: string; label: string; status: string }[]
          >(Prisma.sql`
            SELECT id, label, status::text AS status
            FROM seats
            WHERE locality_id = ${localityId}::uuid
            FOR UPDATE
          `);

          // Conjunto de asientos OCUPADOS (jamás se borran): estado != available o
          // referenciados por un ítem de orden ACTIVO o por un boleto emitido.
          const ids = existing.map((s) => s.id);
          const occupied = new Set<string>();
          for (const s of existing) if (s.status !== 'available') occupied.add(s.id);
          if (ids.length) {
            const items = await tx.orderItem.findMany({
              where: { seatId: { in: ids }, active: true },
              select: { seatId: true },
            });
            for (const it of items) if (it.seatId) occupied.add(it.seatId);
            const tks = await tx.ticket.findMany({
              where: { seatId: { in: ids } },
              select: { seatId: true },
            });
            for (const t of tks) if (t.seatId) occupied.add(t.seatId);
          }

          // Camino rápido: sin asientos ocupados → delete-all + insert (idéntico al
          // comportamiento histórico; más barato con createMany).
          if (occupied.size === 0) {
            await tx.seat.deleteMany({ where: { localityId } });
            const ins = await tx.seat.createMany({
              data: dto.seats.map((s) => ({ localityId, ...s })),
              skipDuplicates: true,
            });
            await tx.locality.update({
              where: { id: localityId },
              data: { capacity: ins.count },
            });
            return {
              created: ins.count,
              updated: 0,
              preserved: 0,
              deleted: existing.length,
              capacity: ins.count,
            };
          }

          // Camino de migración: hay ventas → conservar/arrastrar lo ocupado.
          const existingByLabel = new Map(existing.map((s) => [s.label, s]));
          let created = 0;
          let updated = 0;
          let deleted = 0;
          let preserved = 0;

          // (3) Borrar SOLO asientos disponibles cuyo label ya no está en el layout.
          const toDelete = existing
            .filter((s) => !occupied.has(s.id) && !incomingSet.has(s.label))
            .map((s) => s.id);
          if (toDelete.length) {
            const del = await tx.seat.deleteMany({ where: { id: { in: toDelete } } });
            deleted = del.count;
          }
          // (4) Ocupados fuera del layout nuevo → preservados (arrastrados).
          preserved = existing.filter(
            (s) => occupied.has(s.id) && !incomingSet.has(s.label),
          ).length;

          // (1) y (2): actualizar geometría de los que coinciden por label, crear
          // los genuinamente nuevos. Un label que coincide con un ocupado gana el
          // ocupado (se actualiza, nunca se duplica).
          for (const seat of dto.seats) {
            const match = existingByLabel.get(seat.label);
            if (match) {
              await tx.seat.update({
                where: { id: match.id },
                data: {
                  section: seat.section ?? null,
                  row: seat.row ?? null,
                  x: seat.x ?? null,
                  y: seat.y ?? null,
                },
              });
              updated++;
            } else {
              await tx.seat.create({ data: { localityId, ...seat } });
              created++;
            }
          }

          const capacity = await tx.seat.count({ where: { localityId } });
          await tx.locality.update({ where: { id: localityId }, data: { capacity } });
          return { created, updated, preserved, deleted, capacity };
        },
        {
          maxWait: 10000,
          timeout: 20000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (e) {
      throw this.translateSeatError(e);
    }
  }

  /** Traduce errores de Postgres/Prisma del reemplazo de asientos a HTTP claros. */
  private translateSeatError(e: unknown): Error {
    if (e instanceof BadRequestException || e instanceof ConflictException) return e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('lock_timeout') || msg.includes('55P03') || msg.includes('canceling statement')) {
      return new ConflictException('Los asientos están en disputa, reintenta en un momento');
    }
    if (
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
      msg.includes('23505')
    ) {
      return new ConflictException('Conflicto de labels de asiento (duplicado)');
    }
    return e instanceof Error ? e : new Error(msg);
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
