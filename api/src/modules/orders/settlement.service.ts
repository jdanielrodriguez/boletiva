import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/**
 * Liquidación (cuentas) por evento. Solo-lectura: agrega, de las órdenes PAGADAS
 * del evento, cuánto corresponde a la pasarela / plataforma / promotor (+ IVA) a
 * partir del snapshot inmutable de cada orden (`net`, `platformFee`, `gatewayFee`,
 * `fixedFees`, `iva`, `total`). Es un módulo FINANCIERO (100% branches).
 *
 * Identidad del snapshot: `total = net + platformFee + fixedFees + iva + gatewayFee`.
 *  - `net`        → lo que se liquida al PROMOTOR.
 *  - `serviceFee` → plataforma + pasarela + fijos (lo que el comprador paga por
 *                   encima del neto, SIN IVA) = platformFee + gatewayFee + fixedFees.
 *  - `iva`        → impuesto (SAT), no es margen de nadie.
 *
 * Authz: admin o el promotor dueño del evento (IDOR → 403; evento inexistente → 404).
 */
@Injectable()
export class SettlementService {
  constructor(private readonly prisma: PrismaService) {}

  async forEvent(eventId: string, user: AuthUser) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, promoterId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    const isAdmin = user.roles.includes(Role.admin);
    const isOwner = event.promoterId === user.userId;
    if (!isAdmin && !isOwner) throw new ForbiddenException('No es tu evento');

    const where = { eventId, status: 'paid' as const };
    const agg = await this.prisma.order.aggregate({
      where,
      _count: true,
      _sum: {
        net: true,
        fixedFees: true,
        platformFee: true,
        gatewayFee: true,
        iva: true,
        total: true,
      },
    });
    const ticketsSold = await this.prisma.orderItem.count({
      where: { order: where, active: true },
    });

    const d = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);
    const net = d(agg._sum.net);
    const platformFee = d(agg._sum.platformFee);
    const gatewayFee = d(agg._sum.gatewayFee);
    const fixedFees = d(agg._sum.fixedFees);
    const iva = d(agg._sum.iva);
    const gross = d(agg._sum.total);
    const serviceFee = platformFee.add(gatewayFee).add(fixedFees);

    return {
      eventId: event.id,
      eventName: event.name,
      currency: 'GTQ',
      paidOrders: agg._count,
      ticketsSold,
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      platformFee: platformFee.toFixed(2),
      gatewayFee: gatewayFee.toFixed(2),
      fixedFees: fixedFees.toFixed(2),
      serviceFee: serviceFee.toFixed(2),
      iva: iva.toFixed(2),
    };
  }
}
