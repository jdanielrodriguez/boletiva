import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AdminProfitabilityDto, AdminProfitabilityRowDto } from './dto/admin-profitability.dto';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/**
 * Rentabilidad de la PLATAFORMA por evento (Fase 4, admin). Agrega el snapshot inmutable
 * de las órdenes PAGADAS de TODOS los eventos (server-authoritative, NO recalcula precios)
 * y expone, por evento, el reparto (bruto/neto/ganancia-plataforma/pasarela/IVA) y el
 * **% de comisión de plataforma EFECTIVO** (`platformFee/net`), que puede variar por evento
 * (uno vendido al 5% y otro al 20%). `platformFee` ya refleja lo que la plataforma se lleva
 * (neto de absorciones de cuotas), por eso es su "ganancia" real. Ordena por ganancia desc.
 */
@Injectable()
export class AdminProfitabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(): Promise<AdminProfitabilityDto> {
    const grouped = await this.prisma.order.groupBy({
      by: ['eventId'],
      where: { status: 'paid' },
      _count: true,
      _sum: { net: true, platformFee: true, gatewayFee: true, iva: true, total: true },
    });

    const eventIds = grouped.map((g) => g.eventId);
    const d = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);
    const pct = (fee: Decimal, net: Decimal): number =>
      net.gt(0) ? Number(fee.div(net).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN)) : 0;

    const base: AdminProfitabilityDto = {
      currency: 'GTQ',
      eventsCount: 0,
      paidOrders: 0,
      ticketsSold: 0,
      gross: '0.00',
      net: '0.00',
      platformFee: '0.00',
      gatewayFee: '0.00',
      iva: '0.00',
      platformPct: 0,
      events: [],
    };
    if (eventIds.length === 0) return base;

    const [events, soldRows] = await Promise.all([
      this.prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          name: true,
          status: true,
          promoter: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      this.soldByEvent(eventIds),
    ]);
    const evById = new Map(events.map((e) => [e.id, e]));
    const soldById = new Map(soldRows.map((r) => [r.eventId, r.sold]));
    const promoterName = (e?: (typeof events)[number]): string => {
      if (!e) return '';
      return [e.promoter?.firstName, e.promoter?.lastName].filter(Boolean).join(' ').trim() ||
        e.promoter?.email || '';
    };

    const rows: AdminProfitabilityRowDto[] = grouped.map((g) => {
      const ev = evById.get(g.eventId);
      const net = d(g._sum.net);
      const platformFee = d(g._sum.platformFee);
      return {
        eventId: g.eventId,
        name: ev?.name ?? '',
        promoterName: promoterName(ev),
        status: ev?.status ?? '',
        ticketsSold: soldById.get(g.eventId) ?? 0,
        gross: d(g._sum.total).toFixed(2),
        net: net.toFixed(2),
        platformFee: platformFee.toFixed(2),
        gatewayFee: d(g._sum.gatewayFee).toFixed(2),
        iva: d(g._sum.iva).toFixed(2),
        platformPct: pct(platformFee, net),
      };
    });
    rows.sort((a, b) => Number(b.platformFee) - Number(a.platformFee));

    const sum = (key: keyof AdminProfitabilityRowDto): Decimal =>
      rows.reduce((acc, r) => acc.add(new Decimal(r[key] as string)), new Decimal(0));
    const totalNet = sum('net');
    const totalPlatform = sum('platformFee');

    return {
      currency: 'GTQ',
      eventsCount: rows.length,
      paidOrders: grouped.reduce((acc, g) => acc + g._count, 0),
      ticketsSold: rows.reduce((acc, r) => acc + r.ticketsSold, 0),
      gross: sum('gross').toFixed(2),
      net: totalNet.toFixed(2),
      platformFee: totalPlatform.toFixed(2),
      gatewayFee: sum('gatewayFee').toFixed(2),
      iva: sum('iva').toFixed(2),
      platformPct: pct(totalPlatform, totalNet),
      events: rows,
    };
  }

  /** Boletos vendidos (ítems activos de órdenes pagadas) por evento. */
  private async soldByEvent(eventIds: string[]): Promise<{ eventId: string; sold: number }[]> {
    const idList = Prisma.join(eventIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await this.prisma.$queryRaw<{ event_id: string; sold: number }[]>`
      SELECT o.event_id AS event_id, count(*)::int AS sold
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.event_id IN (${idList}) AND o.status = 'paid' AND oi.active = true
      GROUP BY 1
    `;
    return rows.map((r) => ({ eventId: r.event_id, sold: Number(r.sold) }));
  }
}
