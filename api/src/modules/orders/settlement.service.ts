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
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/notification.types';

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
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
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

    return this.summaryForEvent(event.id, event.name);
  }

  /**
   * Agregación de cuentas de un evento SIN authz (uso interno: F4 correo de estado
   * de cuentas). Mismos montos que `forEvent`. Incluye `refundsIssued` = neto ya
   * devuelto a compradores (órdenes en estado `refunded`), informativo.
   */
  async summaryForEvent(eventId: string, eventName: string) {
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
    // Neto ya devuelto a compradores (órdenes refunded) — informativo para el estado
    // de cuentas. Las órdenes refunded ya NO cuentan en `net` (filtro status=paid).
    const refundAgg = await this.prisma.order.aggregate({
      where: { eventId, status: 'refunded' },
      _sum: { net: true },
    });

    const d = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);
    const net = d(agg._sum.net);
    const platformFee = d(agg._sum.platformFee);
    const gatewayFee = d(agg._sum.gatewayFee);
    const fixedFees = d(agg._sum.fixedFees);
    const iva = d(agg._sum.iva);
    const gross = d(agg._sum.total);
    const serviceFee = platformFee.add(gatewayFee).add(fixedFees);
    // `services` = cuota de servicio TOTAL que NO va al promotor (plataforma +
    // pasarela + fijos + IVA). Identidad exacta: gross = services + net, de modo
    // que el frontend muestra al promotor: recaudado (gross) − servicios = neto.
    const services = platformFee.add(gatewayFee).add(fixedFees).add(iva);
    const refundsIssued = d(refundAgg._sum.net);

    return {
      eventId,
      eventName,
      currency: 'GTQ',
      paidOrders: agg._count,
      ticketsSold,
      gross: gross.toFixed(2),
      net: net.toFixed(2),
      platformFee: platformFee.toFixed(2),
      gatewayFee: gatewayFee.toFixed(2),
      fixedFees: fixedFees.toFixed(2),
      serviceFee: serviceFee.toFixed(2),
      services: services.toFixed(2),
      iva: iva.toFixed(2),
      refundsIssued: refundsIssued.toFixed(2),
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
   * (→ 409). Al finalizar, el evento queda en estado `finished` y se ENCOLA el
   * correo de estado de cuentas al promotor (F4, en su idioma).
   *
   * Authz: SOLO ADMIN REAL. El promotor NO puede autoliquidarse su caja; y un admin
   * IMPERSONANDO a un promotor (token con `impersonatedBy`) tampoco: el pago al
   * promotor solo lo ejecuta el admin actuando como sí mismo (v3.11 · F2).
   */
  async finalizeAndTransfer(eventId: string, admin: AuthUser, ip?: string, userAgent?: string) {
    // Un token de impersonación actúa CON las capacidades del usuario suplantado
    // (un promotor), por lo que normalmente ya no traería el rol admin; aun así lo
    // bloqueamos EXPLÍCITAMENTE: esta acción financiera es del admin real, nunca
    // impersonando (aunque el token conservara el rol admin).
    if (admin.impersonatedBy || admin.impersonation) {
      throw new ForbiddenException(
        'El cierre de caja no puede ejecutarse en una sesión de impersonación; usa tu sesión de administrador real',
      );
    }
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
    // Elegibilidad por estado (no confiar en el `disabled` del UI): el evento debe
    // estar suspendido, cancelado, ya finalizado, o COMPLETADO (concluido por fecha:
    // `endsAt` en el pasado). Un evento exitoso que simplemente terminó por fecha se
    // liquida sin suspenderlo ni cancelarlo; un borrador o un publicado aún vigente
    // (fecha futura) NO se puede finalizar todavía.
    const hasEnded = !!event.endsAt && event.endsAt.getTime() < Date.now();
    const eligible =
      event.status === 'suspended' ||
      event.status === 'cancelled' ||
      event.status === 'finished' ||
      hasEnded;
    if (!eligible) {
      throw new ConflictException(
        'El evento no es elegible: debe estar suspendido, cancelado o haber concluido',
      );
    }

    // A3: un evento CANCELADO no se liquida al promotor mientras existan órdenes pagadas
    // sin reembolsar — ese dinero es de los compradores (el evento no ocurrirá). Hay que
    // reembolsar primero (mueve el dinero a los wallets de los compradores y las saca del
    // neto); luego el cierre queda en 0. Un evento CONCLUIDO por fecha sí se liquida.
    if (event.status === 'cancelled') {
      const paidCount = await this.prisma.order.count({ where: { eventId, status: 'paid' } });
      if (paidCount > 0) {
        throw new ConflictException(
          `Reembolsa las ${paidCount} órdenes pagadas antes de cerrar la caja de un evento cancelado`,
        );
      }
    }

    // Neto a liquidar = suma de `net` de las órdenes pagadas del evento.
    const agg = await this.prisma.order.aggregate({
      where: { eventId, status: 'paid' },
      _sum: { net: true },
    });
    const net = new Decimal(agg._sum.net ?? 0).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

    // M1 (TOCTOU): claim ATÓMICO compare-and-set — solo UN finalize procede aunque haya
    // doble clic/pestañas concurrentes (evita doble asiento `event_cash_transfer`).
    const transferredAt = new Date();
    const claim = await this.prisma.event.updateMany({
      where: { id: eventId, cashTransferredAt: null },
      data: { cashTransferredAt: transferredAt, status: 'finished' },
    });
    if (claim.count === 0) {
      throw new ConflictException('La caja de este evento ya fue transferida al promotor');
    }

    // Asienta el traslado promoter_payable → user_wallet SOLO si hay neto (>0);
    // un neto 0 igual cierra la caja (idempotente) sin asiento vacío.
    // A4: si el asiento contable falla, REVIERTE la marca para no dejar el evento
    // "finished sin acreditar" (permitiendo reintento); `ledger.post` es atómico aparte.
    if (net.gt(0)) {
      try {
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
      } catch (e) {
        await this.prisma.event.update({
          where: { id: eventId },
          data: { cashTransferredAt: null, status: event.status },
        });
        throw e;
      }
    }

    await this.audit.record({
      userId: admin.userId,
      action: 'event.cash_transfer',
      resource: `event:${eventId}`,
      ip,
      userAgent,
      payload: { promoterId: event.promoterId, net: net.toFixed(2) },
    });

    // F4 (v3.11): al finalizar, enviar al promotor (en su idioma) el ESTADO DE
    // CUENTAS del evento. Se ENCOLA (cola MAIL) para no bloquear la respuesta; el
    // handler recalcula el settlement. enqueue nunca lanza (un fallo de correo no
    // debe revertir un cierre de caja ya asentado en el ledger).
    await this.queue.enqueue(QUEUES.MAIL, 'event-settlement', {
      eventId,
      promoterId: event.promoterId,
      transferred: net.toFixed(2),
    });

    // Notificaciones in-app (T5): evento finalizado + liquidación acreditada al promotor.
    await this.notifications.emit(event.promoterId, {
      type: NotificationType.EVENT_FINISHED,
      title: 'Evento finalizado',
      body: `"${event.name}" se cerró.`,
      resourceType: 'event',
      resourceId: eventId,
    });
    await this.notifications.emit(event.promoterId, {
      type: NotificationType.SETTLEMENT_PAID,
      title: 'Liquidación acreditada',
      body: `Se acreditó Q${net.toFixed(2)} a tu saldo por "${event.name}".`,
      payload: { net: net.toFixed(2) },
      resourceType: 'event',
      resourceId: eventId,
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
