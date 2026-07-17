import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PromoterDashboardDto, PromoterDimensionRowDto } from './dto/promoter-dashboard.dto';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/** Métricas server-authoritative acumuladas de un evento o de un grupo de eventos. */
interface Metric {
  events: number;
  ticketsSold: number;
  gross: Decimal;
  net: Decimal;
  platformFee: Decimal;
  gatewayFee: Decimal;
  fixedFees: Decimal;
  iva: Decimal;
  refunds: Decimal;
  capacity: number;
  checkedIn: number;
}

/** Evento con lo mínimo para construir sus métricas y clasificarlo por dimensión. */
interface EventRow {
  id: string;
  name: string;
  status: string;
  startsAt: Date;
  categoryId: string | null;
  categoryName: string | null;
  hallId: string | null;
  hallName: string | null;
}

const zeroMetric = (): Metric => ({
  events: 0,
  ticketsSold: 0,
  gross: new Decimal(0),
  net: new Decimal(0),
  platformFee: new Decimal(0),
  gatewayFee: new Decimal(0),
  fixedFees: new Decimal(0),
  iva: new Decimal(0),
  refunds: new Decimal(0),
  capacity: 0,
  checkedIn: 0,
});

/**
 * Dashboard GLOBAL del promotor (analítica sobre TODOS sus eventos). NO recalcula
 * dinero: agrega el snapshot inmutable de cada orden en estado TERMINAL (pagada →
 * `net`/`platformFee`/`gatewayFee`/`fixedFees`/`iva`/`total`; reembolsada → `net`
 * devuelto) con `decimal.js`, igual que la liquidación. Construye las métricas por
 * evento UNA vez y las suma en el backend por cada dimensión (Evento / Categoría /
 * Salón / Estado / Mes) → el frontend solo presenta filas ya agregadas y redondeadas
 * (regla de oro: cero aritmética de dinero en el cliente).
 *
 * Authz: el propio promotor ve su dashboard; un admin puede ver el de cualquier
 * promotor pasando `promoterId`. Un promotor pidiendo el de otro → 403.
 */
@Injectable()
export class PromoterDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resuelve el promotor objetivo aplicando authz y lo devuelve con su nombre. */
  private async resolvePromoter(user: AuthUser, promoterId?: string) {
    const isAdmin = user.roles.includes(Role.admin);
    const targetId = promoterId ?? user.userId;
    if (!isAdmin && targetId !== user.userId) {
      throw new ForbiddenException('No puedes ver el dashboard de otro promotor');
    }
    const promoter = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!promoter) throw new NotFoundException('Promotor no encontrado');
    const name =
      [promoter.firstName, promoter.lastName].filter(Boolean).join(' ').trim() ||
      promoter.email ||
      'Promotor';
    return { id: promoter.id, name };
  }

  async forPromoter(
    user: AuthUser,
    promoterId?: string,
    eventId?: string,
  ): Promise<PromoterDashboardDto> {
    const promoter = await this.resolvePromoter(user, promoterId);

    const allEvents = (await this.prisma.event.findMany({
      where: { promoterId: promoter.id },
      select: {
        id: true,
        name: true,
        status: true,
        startsAt: true,
        categoryId: true,
        hallId: true,
        category: { select: { name: true } },
        hall: { select: { name: true } },
      },
      orderBy: { startsAt: 'desc' },
    })).map(
      (e): EventRow => ({
        id: e.id,
        name: e.name,
        status: e.status,
        startsAt: e.startsAt,
        categoryId: e.categoryId,
        categoryName: e.category?.name ?? null,
        hallId: e.hallId,
        hallName: e.hall?.name ?? null,
      }),
    );

    // Lista para el selector de evento (todos los del promotor) + evento seleccionado.
    const availableEvents = allEvents.map((e) => ({ id: e.id, name: e.name }));
    const selectedEventId = eventId && allEvents.some((e) => e.id === eventId) ? eventId : null;
    // Filtro por evento: si se pide uno válido, el dashboard agrega SOLO ese evento.
    const events = selectedEventId ? allEvents.filter((e) => e.id === selectedEventId) : allEvents;

    const base = {
      promoterId: promoter.id,
      promoterName: promoter.name,
      currency: 'GTQ',
      eventsCount: events.length,
      publishedCount: events.filter((e) => e.status === 'published').length,
      availableEvents,
      selectedEventId,
    };

    if (events.length === 0) {
      return {
        ...base,
        summary: this.metricToSummary(zeroMetric(), 0, 0),
        salesOverTime: [],
        dimensions: { event: [], category: [], hall: [], status: [], month: [] },
      };
    }

    const eventIds = events.map((e) => e.id);
    const perEvent = await this.buildPerEvent(eventIds);
    const [paidOrders, refundsCount, salesOverTime] = await Promise.all([
      this.prisma.order.count({ where: { eventId: { in: eventIds }, status: 'paid' } }),
      this.prisma.order.count({ where: { eventId: { in: eventIds }, status: 'refunded' } }),
      this.salesOverTime(eventIds),
    ]);

    // KPIs globales = suma de todas las métricas por evento.
    const global = zeroMetric();
    for (const e of events) this.accumulate(global, perEvent.get(e.id) ?? zeroMetric());

    return {
      ...base,
      summary: this.metricToSummary(global, paidOrders, refundsCount),
      salesOverTime,
      dimensions: {
        event: this.groupBy(events, perEvent, (e) => ({ key: e.id, label: e.name })),
        category: this.groupBy(events, perEvent, (e) => ({
          key: e.categoryId ?? 'none',
          label: e.categoryName ?? 'Sin categoría',
        })),
        hall: this.groupBy(events, perEvent, (e) => ({
          key: e.hallId ?? 'none',
          label: e.hallName ?? 'Sin salón',
        })),
        status: this.groupBy(events, perEvent, (e) => ({ key: e.status, label: e.status })),
        month: this.groupBy(events, perEvent, (e) => {
          const m = e.startsAt.toISOString().slice(0, 7);
          return { key: m, label: m };
        }),
      },
    };
  }

  /** Métricas por evento (dinero del snapshot + conteos de inventario/asistencia). */
  private async buildPerEvent(eventIds: string[]): Promise<Map<string, Metric>> {
    const [paidAgg, refundAgg, soldRows, capacityAgg, checkinAgg] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds }, status: 'paid' },
        _sum: { net: true, platformFee: true, gatewayFee: true, fixedFees: true, iva: true, total: true },
      }),
      this.prisma.order.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds }, status: 'refunded' },
        _sum: { net: true },
      }),
      this.soldByEvent(eventIds),
      this.prisma.locality.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds } },
        _sum: { capacity: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds }, status: 'used' },
        _count: { _all: true },
      }),
    ]);

    const map = new Map<string, Metric>();
    const get = (id: string): Metric => {
      let m = map.get(id);
      if (!m) {
        m = zeroMetric();
        m.events = 1;
        map.set(id, m);
      }
      return m;
    };
    // Asegura una entrada por evento (aunque sin ventas) para contar events=1.
    for (const id of eventIds) get(id);

    const d = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);
    for (const g of paidAgg) {
      const m = get(g.eventId);
      m.gross = m.gross.add(d(g._sum.total));
      m.net = m.net.add(d(g._sum.net));
      m.platformFee = m.platformFee.add(d(g._sum.platformFee));
      m.gatewayFee = m.gatewayFee.add(d(g._sum.gatewayFee));
      m.fixedFees = m.fixedFees.add(d(g._sum.fixedFees));
      m.iva = m.iva.add(d(g._sum.iva));
    }
    for (const g of refundAgg) get(g.eventId).refunds = get(g.eventId).refunds.add(d(g._sum.net));
    for (const g of soldRows) get(g.eventId).ticketsSold += g.sold;
    for (const g of capacityAgg) get(g.eventId).capacity += g._sum.capacity ?? 0;
    for (const g of checkinAgg) get(g.eventId).checkedIn += g._count._all;
    return map;
  }

  /** Boletos vendidos (ítems activos de órdenes pagadas) por evento. */
  private async soldByEvent(eventIds: string[]): Promise<{ eventId: string; sold: number }[]> {
    const idList = Prisma.join(eventIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await this.prisma.$queryRaw<{ event_id: string; sold: number }[]>`
      SELECT o.event_id AS event_id, count(*)::int AS sold
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.event_id IN (${idList}) AND o.status = 'paid' AND oi.active = true
      GROUP BY 1
    `;
    return rows.map((r) => ({ eventId: r.event_id, sold: Number(r.sold) }));
  }

  /** Ventas por día agregadas sobre todos los eventos del promotor. */
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

  private accumulate(acc: Metric, m: Metric): void {
    acc.events += m.events;
    acc.ticketsSold += m.ticketsSold;
    acc.gross = acc.gross.add(m.gross);
    acc.net = acc.net.add(m.net);
    acc.platformFee = acc.platformFee.add(m.platformFee);
    acc.gatewayFee = acc.gatewayFee.add(m.gatewayFee);
    acc.fixedFees = acc.fixedFees.add(m.fixedFees);
    acc.iva = acc.iva.add(m.iva);
    acc.refunds = acc.refunds.add(m.refunds);
    acc.capacity += m.capacity;
    acc.checkedIn += m.checkedIn;
  }

  private services(m: Metric): Decimal {
    return m.platformFee.add(m.gatewayFee).add(m.fixedFees);
  }

  private occupancy(sold: number, capacity: number): number {
    return capacity > 0 ? Math.round((sold / capacity) * 1000) / 10 : 0;
  }

  private metricToSummary(m: Metric, paidOrders: number, refundsCount: number) {
    return {
      paidOrders,
      ticketsSold: m.ticketsSold,
      gross: m.gross.toFixed(2),
      net: m.net.toFixed(2),
      services: this.services(m).toFixed(2),
      platformFee: m.platformFee.toFixed(2),
      gatewayFee: m.gatewayFee.toFixed(2),
      fixedFees: m.fixedFees.toFixed(2),
      iva: m.iva.toFixed(2),
      refundsCount,
      refundsIssued: m.refunds.toFixed(2),
      capacity: m.capacity,
      checkedIn: m.checkedIn,
      occupancyPct: this.occupancy(m.ticketsSold, m.capacity),
    };
  }

  /** Agrupa los eventos por una clave y suma sus métricas → filas ordenadas por recaudación. */
  private groupBy(
    events: EventRow[],
    perEvent: Map<string, Metric>,
    keyOf: (e: EventRow) => { key: string; label: string },
  ): PromoterDimensionRowDto[] {
    const groups = new Map<string, { label: string; metric: Metric }>();
    for (const e of events) {
      const { key, label } = keyOf(e);
      let g = groups.get(key);
      if (!g) {
        g = { label, metric: zeroMetric() };
        groups.set(key, g);
      }
      this.accumulate(g.metric, perEvent.get(e.id) ?? zeroMetric());
    }
    return Array.from(groups.entries())
      .map(([key, g]) => ({
        key,
        label: g.label,
        events: g.metric.events,
        ticketsSold: g.metric.ticketsSold,
        gross: g.metric.gross.toFixed(2),
        net: g.metric.net.toFixed(2),
        services: this.services(g.metric).toFixed(2),
        iva: g.metric.iva.toFixed(2),
        refunds: g.metric.refunds.toFixed(2),
        capacity: g.metric.capacity,
        checkedIn: g.metric.checkedIn,
        occupancyPct: this.occupancy(g.metric.ticketsSold, g.metric.capacity),
      }))
      .sort((a, b) => Number(b.gross) - Number(a.gross));
  }
}
