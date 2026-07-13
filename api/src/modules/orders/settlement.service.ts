import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

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

  /**
   * v3.10 — FINALIZAR EVENTO Y TRANSFERIR SALDOS DE CAJA (SOLO ADMIN).
   *
   * Cierra la caja de un evento y transfiere el NETO acumulado del promotor (su
   * liquidación = suma de `net` de las órdenes pagadas) desde `promoter_payable`
   * hacia su `user_wallet` (de donde puede retirarlo). Asienta en el ledger
   * inmutable (partida doble, encadenado por hash) reutilizando `LedgerService`.
   *
   * Elegibilidad: el evento debe estar FINALIZADO o SUSPENDIDO, o su fecha de fin
   * ya haber pasado. IDEMPOTENTE: `cashTransferredAt` evita transferir dos veces
   * (→ 409). Al finalizar, el evento queda en estado `finished`.
   *
   * Authz: SOLO admin (el promotor NO puede autoliquidarse su caja).
   */
  async finalizeAndTransfer(eventId: string, admin: AuthUser, ip?: string, userAgent?: string) {
    if (!admin.roles.includes(Role.admin)) {
      throw new ForbiddenException('Solo un administrador puede finalizar y transferir la caja');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        promoterId: true,
        status: true,
        endsAt: true,
        cashTransferredAt: true,
      },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    if (event.cashTransferredAt) {
      throw new ConflictException('La caja de este evento ya fue transferida al promotor');
    }
    const eligible =
      event.status === 'finished' ||
      event.status === 'suspended' ||
      event.endsAt.getTime() < Date.now();
    if (!eligible) {
      throw new ConflictException(
        'El evento no es elegible: debe estar finalizado o suspendido (o su fecha ya haber pasado)',
      );
    }

    // Neto a liquidar = suma de `net` de las órdenes pagadas del evento.
    const agg = await this.prisma.order.aggregate({
      where: { eventId, status: 'paid' },
      _sum: { net: true },
    });
    const net = new Decimal(agg._sum.net ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    // Marca de cierre (idempotencia) + estado finalizado, en una tx.
    const transferredAt = new Date();
    await this.prisma.event.update({
      where: { id: eventId },
      data: { cashTransferredAt: transferredAt, status: 'finished' },
    });

    // Asienta el traslado promoter_payable → user_wallet SOLO si hay neto (>0);
    // un neto 0 igual cierra la caja (idempotente) sin asiento vacío.
    if (net.gt(0)) {
      await this.ledger.post({
        kind: 'event_cash_transfer',
        refType: 'event',
        refId: eventId,
        memo: `Cierre de caja evento ${event.name}`,
        entries: [
          { type: 'promoter_payable', ownerId: event.promoterId, amount: net.negated().toFixed(2) },
          { type: 'user_wallet', ownerId: event.promoterId, amount: net.toFixed(2) },
        ],
      });
    }

    await this.audit.record({
      userId: admin.userId,
      action: 'event.cash_transfer',
      resource: `event:${eventId}`,
      ip,
      userAgent,
      payload: { promoterId: event.promoterId, net: net.toFixed(2) },
    });

    return {
      eventId: event.id,
      eventName: event.name,
      promoterId: event.promoterId,
      currency: 'GTQ',
      transferred: net.toFixed(2),
      status: 'finished' as const,
      transferredAt: transferredAt.toISOString(),
    };
  }
}
