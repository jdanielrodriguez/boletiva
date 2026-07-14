import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SettlementService } from './settlement.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/** Un punto de la serie de ventas (por día). `revenue` es string (dinero exacto). */
export interface SalesPoint {
  day: string; // YYYY-MM-DD (America/Guatemala se aplica en el front al mostrar)
  orders: number;
  revenue: string;
}

/**
 * Dashboard analítico por evento (solo-lectura). NO recalcula dinero: reutiliza
 * `SettlementService.summaryForEvent` para los KPIs financieros (server-authoritative)
 * y agrega métricas operativas propias: ventas en el tiempo, ocupación por localidad
 * y asistencia (check-in). Todas las agregaciones se hacen en la BD.
 *
 * Authz: admin o el promotor dueño del evento (IDOR → 403; inexistente → 404), igual
 * que la liquidación.
 */
@Injectable()
export class EventDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
  ) {}

  async forEvent(eventId: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, promoterId: true, status: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const isAdmin = user.roles.includes(Role.admin);
    const isOwner = event.promoterId === user.userId;
    if (!isAdmin && !isOwner) throw new ForbiddenException('No es tu evento');

    const [summary, salesOverTime, occupancy, attendance] = await Promise.all([
      this.settlement.summaryForEvent(event.id, event.name),
      this.salesOverTime(event.id),
      this.occupancy(event.id),
      this.attendance(event.id),
    ]);

    return {
      eventId: event.id,
      eventName: event.name,
      currency: 'GTQ',
      status: event.status,
      startsAt: event.startsAt?.toISOString() ?? null,
      endsAt: event.endsAt?.toISOString() ?? null,
      summary,
      salesOverTime,
      occupancy,
      attendance,
    };
  }

  /**
   * Ventas por día (órdenes pagadas). Agregación en Postgres (`date_trunc`) para que
   * escale a eventos con miles de órdenes sin traer cada fila. `revenue` se castea a
   * texto y se normaliza con Decimal para no perder precisión de dinero.
   */
  private async salesOverTime(eventId: string): Promise<SalesPoint[]> {
    const rows = await this.prisma.$queryRaw<
      { day: Date; orders: number; revenue: string }[]
    >`
      SELECT date_trunc('day', COALESCE(paid_at, created_at)) AS day,
             count(*)::int AS orders,
             COALESCE(sum(total), 0)::text AS revenue
      FROM orders
      WHERE event_id = ${eventId}::uuid AND status = 'paid'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      orders: Number(r.orders),
      revenue: new Decimal(r.revenue || 0).toFixed(2),
    }));
  }

  /** Ocupación por localidad: vendidos (ítems activos de órdenes pagadas) vs aforo. */
  private async occupancy(eventId: string) {
    const localities = await this.prisma.locality.findMany({
      where: { eventId },
      select: { id: true, name: true, kind: true, capacity: true },
      orderBy: { createdAt: 'asc' },
    });
    const soldGroups = await this.prisma.orderItem.groupBy({
      by: ['localityId'],
      where: { order: { eventId, status: 'paid' }, active: true },
      _count: { _all: true },
    });
    const soldByLocality = new Map<string, number>(
      soldGroups.map((g) => [g.localityId, g._count._all]),
    );

    const byLocality = localities.map((loc) => {
      const sold = soldByLocality.get(loc.id) ?? 0;
      const capacity = loc.capacity ?? 0;
      return {
        localityId: loc.id,
        name: loc.name,
        kind: loc.kind,
        capacity,
        sold,
        occupancyPct: capacity > 0 ? Math.round((sold / capacity) * 1000) / 10 : 0,
      };
    });

    const totalCapacity = byLocality.reduce((a, l) => a + l.capacity, 0);
    const totalSold = byLocality.reduce((a, l) => a + l.sold, 0);
    return {
      totalCapacity,
      totalSold,
      occupancyPct: totalCapacity > 0 ? Math.round((totalSold / totalCapacity) * 1000) / 10 : 0,
      byLocality,
    };
  }

  /** Asistencia: desglose de boletos por estado (check-in = `used`). */
  private async attendance(eventId: string) {
    const groups = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
    });
    const count = (s: TicketStatus): number =>
      groups.find((g) => g.status === s)?._count._all ?? 0;

    const valid = count(TicketStatus.valid);
    const used = count(TicketStatus.used);
    const transferred = count(TicketStatus.transferred);
    const revoked = count(TicketStatus.revoked);
    // Universo "vigente" para el % de check-in = boletos que pueden entrar (válidos +
    // ya usados). Transferidos/revocados no cuentan en el denominador.
    const checkinBase = valid + used;
    return {
      totalTickets: valid + used + transferred + revoked,
      valid,
      used,
      transferred,
      revoked,
      checkedInPct: checkinBase > 0 ? Math.round((used / checkinBase) * 1000) / 10 : 0,
    };
  }
}
