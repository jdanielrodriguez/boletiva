import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ScopeDashboardDto } from './dto/scope-dashboard.dto';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/** Evento del alcance (salón o plantilla) con lo mínimo para agregar. */
export interface ScopeEvent {
  id: string;
  name: string;
  status: string;
}

/**
 * Agregación reutilizable de métricas sobre un CONJUNTO de eventos (el alcance de un
 * salón o de una plantilla). NO recalcula dinero: suma el snapshot inmutable de cada
 * orden (`net`/`total`/`iva`/…), server-authoritative igual que la liquidación. Devuelve
 * KPIs + ventas/día + ocupación + top de eventos, con la misma forma que el dashboard
 * de evento para reutilizar el estilo en el frontend.
 */
@Injectable()
export class ScopeDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async aggregate(
    scope: 'hall' | 'template',
    id: string,
    name: string,
    events: ScopeEvent[],
  ): Promise<ScopeDashboardDto> {
    const eventIds = events.map((e) => e.id);
    const publishedCount = events.filter((e) => e.status === 'published').length;
    const base = {
      scope,
      id,
      name,
      currency: 'GTQ',
      eventsCount: events.length,
      publishedCount,
    };

    if (eventIds.length === 0) {
      return {
        ...base,
        summary: { paidOrders: 0, ticketsSold: 0, gross: '0.00', net: '0.00', services: '0.00', iva: '0.00' },
        salesOverTime: [],
        occupancy: { totalCapacity: 0, totalSold: 0, occupancyPct: 0 },
        topEvents: [],
      };
    }

    const where = { eventId: { in: eventIds }, status: 'paid' as const };
    const [agg, ticketsSold, capacityAgg, salesOverTime, topEvents] = await Promise.all([
      this.prisma.order.aggregate({ where, _count: true, _sum: { net: true, total: true, iva: true } }),
      this.prisma.orderItem.count({ where: { order: where, active: true } }),
      this.prisma.locality.aggregate({ where: { eventId: { in: eventIds } }, _sum: { capacity: true } }),
      this.salesOverTime(eventIds),
      this.topEvents(eventIds, events),
    ]);

    const d = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);
    const gross = d(agg._sum.total);
    const net = d(agg._sum.net);
    const iva = d(agg._sum.iva);
    const totalCapacity = capacityAgg._sum.capacity ?? 0;

    return {
      ...base,
      summary: {
        paidOrders: agg._count,
        ticketsSold,
        gross: gross.toFixed(2),
        net: net.toFixed(2),
        services: gross.sub(net).toFixed(2),
        iva: iva.toFixed(2),
      },
      salesOverTime,
      occupancy: {
        totalCapacity,
        totalSold: ticketsSold,
        occupancyPct: totalCapacity > 0 ? Math.round((ticketsSold / totalCapacity) * 1000) / 10 : 0,
      },
      topEvents,
    };
  }

  /** Ventas por día agregadas sobre todos los eventos del alcance (Postgres). */
  private async salesOverTime(eventIds: string[]) {
    const idList = Prisma.join(eventIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await this.prisma.$queryRaw<{ day: Date; orders: number; revenue: string }[]>`
      SELECT date_trunc('day', COALESCE(paid_at, created_at)) AS day,
             count(*)::int AS orders,
             COALESCE(sum(total), 0)::text AS revenue
      FROM orders
      WHERE event_id IN (${idList}) AND status = 'paid'
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return rows.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      orders: Number(r.orders),
      revenue: new Decimal(r.revenue || 0).toFixed(2),
    }));
  }

  /** Top 5 eventos por recaudación, con boletos vendidos. */
  private async topEvents(eventIds: string[], events: ScopeEvent[]) {
    const where = { eventId: { in: eventIds }, status: 'paid' as const };
    const [byRevenue, soldGroups] = await Promise.all([
      this.prisma.order.groupBy({ by: ['eventId'], where, _sum: { total: true } }),
      this.prisma.orderItem.groupBy({
        by: ['orderId'],
        where: { order: where, active: true },
        _count: { _all: true },
      }),
    ]);
    // Boletos vendidos por evento: agrupamos ítems por orden y sumamos por evento.
    const orderToEvent = new Map(
      (await this.prisma.order.findMany({ where, select: { id: true, eventId: true } })).map((o) => [
        o.id,
        o.eventId,
      ]),
    );
    const soldByEvent = new Map<string, number>();
    for (const g of soldGroups) {
      const ev = orderToEvent.get(g.orderId);
      if (ev) soldByEvent.set(ev, (soldByEvent.get(ev) ?? 0) + g._count._all);
    }
    const nameById = new Map(events.map((e) => [e.id, e]));
    return byRevenue
      .map((g) => {
        const ev = nameById.get(g.eventId);
        return {
          eventId: g.eventId,
          name: ev?.name ?? '',
          status: ev?.status ?? '',
          ticketsSold: soldByEvent.get(g.eventId) ?? 0,
          gross: new Decimal(g._sum.total ?? 0).toFixed(2),
        };
      })
      .sort((a, b) => Number(b.gross) - Number(a.gross))
      .slice(0, 5);
  }
}
