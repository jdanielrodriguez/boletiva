import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Order } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../audit/audit.service';
import { StreamService } from '../stream/stream.service';
import { TicketsService } from '../tickets/tickets.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/**
 * F1 (v3.11) — DEVOLUCIÓN por CANCELACIÓN/SUSPENSIÓN del evento.
 *
 * RBAC (re-asignado en v3.12): la ejecuta el PROMOTOR DUEÑO del evento. El
 * controller exige `@Roles(promoter)` (el admin REAL, cuyo token no trae el rol
 * promoter, queda excluido → 403) y aquí se verifica la PROPIEDAD: solo el dueño
 * (`event.promoterId === user.userId`) puede devolver. Un admin IMPERSONANDO al
 * promotor dueño actúa con `user.userId` = dueño → sí puede (soporte); otro
 * promotor (no dueño) → 403.
 *
 * DISTINTA del refund/chargeback de pasarela (webhook, `PaymentsService.reverse`):
 * aquí el evento NO se realizará, así que se le devuelve al comprador SOLO el NETO
 * del boleto a su WALLET interno. La CUOTA DE SERVICIO (comisión de plataforma +
 * pasarela + IVA) NO se devuelve: ya se consumió (procesamiento del pago). Por eso
 * el asiento contable solo mueve el neto:
 *
 *   promoter_payable (promotor) −= net     // se le quita al promotor lo que iba a cobrar
 *   user_wallet      (comprador) += net     // se acredita al saldo del comprador
 *
 * La plataforma/pasarela/IVA CONSERVAN su ingreso (sus asientos quedan intactos) y la
 * partida cuadra en 0. Reutiliza `LedgerService` (hash-chain), la liberación de
 * asientos y la revocación offline (Ola 5, `TicketsService.revokeByOrder`).
 *
 * Idempotente: solo procesa órdenes en estado `paid`; una orden ya devuelta se omite
 * (modo "todas") o responde 409 (orden concreta). Elegible solo si el evento está
 * `suspended` o `cancelled`.
 */
@Injectable()
export class EventRefundsService {
  private readonly logger = new Logger(EventRefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly stream: StreamService,
    private readonly tickets: TicketsService,
  ) {}

  /**
   * Devuelve el neto a la wallet del comprador de UNA orden (si `orderId`) o de
   * TODAS las órdenes pagadas del evento.
   */
  async refund(
    eventId: string,
    user: AuthUser,
    opts: { orderId?: string } = {},
    ip?: string,
    userAgent?: string,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, name: true, status: true, promoterId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');

    // Propiedad: solo el promotor DUEÑO del evento devuelve. El guard @Roles(promoter)
    // ya excluye al admin real; un admin impersonando actúa como el dueño (user.userId
    // = promoterId) → pasa; otro promotor (no dueño) → 403.
    if (event.promoterId !== user.userId) {
      throw new ForbiddenException(
        'Solo el promotor dueño del evento puede tramitar devoluciones',
      );
    }

    // Elegibilidad: el evento no se realizará (suspendido o cancelado).
    if (event.status !== 'suspended' && event.status !== 'cancelled') {
      throw new ConflictException(
        'Solo se pueden tramitar devoluciones de un evento suspendido o cancelado',
      );
    }

    let orders: Order[];
    if (opts.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: opts.orderId } });
      // No filtra existencia entre eventos: una orden de otro evento → 404 (no IDOR).
      if (!order || order.eventId !== eventId) {
        throw new NotFoundException('Orden no encontrada en este evento');
      }
      if (order.status !== 'paid') {
        // Orden concreta ya devuelta / no pagada → 409 (informativo para el admin).
        throw new ConflictException(`La orden no está pagada (${order.status}); no es devolvible`);
      }
      orders = [order];
    } else {
      orders = await this.prisma.order.findMany({ where: { eventId, status: 'paid' } });
    }

    const refunded: Array<{ orderId: string; buyerId: string; net: string; status: string }> = [];
    let totalNet = new Decimal(0);
    const buyersToPush = new Set<string>();

    for (const order of orders) {
      // Idempotencia dura: reconfirmar el estado (por si cambió entre la lista y aquí).
      if (order.status !== 'paid') continue;
      const net = await this.refundOne(order, event.promoterId);
      totalNet = totalNet.add(net);
      refunded.push({
        orderId: order.id,
        buyerId: order.buyerId,
        net: net.toFixed(2),
        status: 'refunded',
      });
      buyersToPush.add(order.buyerId);
    }

    await this.audit.record({
      userId: user.userId,
      action: 'event.refund',
      resource: `event:${eventId}`,
      ip,
      userAgent,
      payload: {
        mode: opts.orderId ? 'single' : 'all',
        refundedOrders: refunded.length,
        totalNetRefunded: totalNet.toFixed(2),
        // Trazabilidad: si un admin tramitó esto IMPERSONANDO al promotor, deja constancia
        // del actor REAL en la bitácora (el userId es el del dueño). El payload va firmado
        // en la hash-chain, así que no se puede alterar sin romper la cadena.
        ...(user.impersonatedBy ? { impersonatedBy: user.impersonatedBy } : {}),
      },
    });

    // Push del saldo actualizado a cada comprador (best-effort, fuera de la tx).
    for (const buyerId of buyersToPush) await this.pushWallet(buyerId);

    return {
      eventId: event.id,
      currency: 'GTQ',
      refundedOrders: refunded.length,
      // "skipped" solo aplica en modo "todas": las no-pagadas nunca entraron a la lista,
      // por lo que en la práctica es 0 (queda para reintentos idempotentes explícitos).
      skipped: opts.orderId ? 0 : orders.length - refunded.length,
      totalNetRefunded: totalNet.toFixed(2),
      orders: refunded,
    };
  }

  /**
   * Devuelve el neto de UNA orden pagada: asiento contable (solo neto), marca la
   * orden/ítems como reembolsados, libera asientos y revoca los boletos (propaga
   * la revocación a validadores offline). Devuelve el neto acreditado.
   */
  private async refundOne(order: Order, promoterId: string): Promise<Decimal> {
    const net = new Decimal(order.net.toString());

    // CLAIM-FIRST: solo el ganador del CAS `paid→refunded` procesa. Evita doble devolución
    // si corre en paralelo con un refund/chargeback del pago o con otra devolución del evento;
    // el perdedor ve count==0 y sale (devuelve 0 → no suma al total ni re-libera asientos).
    const claim = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'paid' },
      data: { status: 'refunded' },
    });
    if (claim.count === 0) return new Decimal(0);

    // Asiento contable IDEMPOTENTE (solo el neto): no duplica si ya existe.
    if (net.gt(0)) {
      await this.ledger.post({
        kind: 'event_refund',
        refType: 'order',
        refId: order.id,
        memo: `Devolución (neto) por cancelación/suspensión de la orden ${order.id}`,
        idempotent: true,
        entries: [
          { type: 'promoter_payable', ownerId: promoterId, amount: net.negated().toFixed(2) },
          { type: 'user_wallet', ownerId: order.buyerId, amount: net.toFixed(2) },
        ] as never,
      });
    }

    const items = await this.prisma.orderItem.findMany({
      where: { orderId: order.id },
      select: { seatId: true },
    });
    const seatIds = items.map((i) => i.seatId).filter((x): x is string => !!x);

    await this.prisma.$transaction([
      this.prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { active: false } }),
      this.prisma.seat.updateMany({
        where: { id: { in: seatIds } },
        data: { status: 'available' },
      }),
      // (el estado de la orden ya se fijó a 'refunded' en el CAS claim-first de arriba)
    ]);

    // Invalida los boletos + propaga la revocación a validadores offline (Ola 5).
    await this.tickets.revokeByOrder(order.id);

    // Push SSE: orden revertida + asientos liberados (mapa del evento).
    this.stream.emitOrder(order.id, { status: 'refunded' });
    if (seatIds.length) this.stream.emitSeat(order.eventId, { released: seatIds });

    return net;
  }

  /** Notifica el saldo de wallet del comprador por SSE (best-effort, nunca lanza). */
  private async pushWallet(userId: string): Promise<void> {
    try {
      const balance = await this.ledger.walletBalance(userId);
      this.stream.emitWallet(userId, { balance: balance.toFixed(2) });
    } catch {
      /* best-effort */
    }
  }
}
