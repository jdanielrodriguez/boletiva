import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerAccountType, Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';
import { LedgerService } from '../ledger/ledger.service';

/** Dirección de un movimiento en la facturación del usuario. */
export type MovementDirection = 'income' | 'expense';

/**
 * Un movimiento del feed unificado de facturación. Los EGRESOS son las compras
 * (órdenes del comprador). Los INGRESOS son créditos a las cuentas del usuario en
 * el ledger: `refund` (devolución al wallet) y `resale` (reventa) para el cliente,
 * y `order_payment` (venta/liquidación a `promoter_payable`) para el promotor.
 */
export interface Movement {
  /** id sintético estable (`order:<id>` o `ledger:<entryId>`). */
  id: string;
  direction: MovementDirection;
  /** 'purchase' | 'refund' | 'resale' | 'sale' | 'other'. */
  kind: string;
  /** Monto absoluto (Decimal como string, 2 decimales). */
  amount: string;
  currency: string;
  /** Estado: egresos = estado real de la orden; ingresos = `refunded`/`paid` coherente. */
  status: string | null;
  eventName: string | null;
  /** Orden asociada (para abrir su detalle); null si no aplica. */
  orderId: string | null;
  createdAt: string;
}

/**
 * Tipos de transacción del ledger que representan un INGRESO para el usuario.
 * `wallet_reserve`/`withdrawal_*` NO entran (o ya se cuentan en la compra, o son
 * flujo de retiro que vive en la sección Wallet) para no duplicar movimientos.
 */
const INCOME_TX_KINDS = new Set(['refund', 'resale', 'order_payment']);

/** Traduce el kind de la transacción del ledger al kind del movimiento. */
function movementKind(txKind: string): string {
  if (txKind === 'refund') return 'refund';
  if (txKind === 'resale') return 'resale';
  if (txKind === 'order_payment') return 'sale';
  return 'other';
}

/**
 * Estado coherente para un INGRESO del ledger (no tiene `OrderStatus` propio): las
 * devoluciones/reventas se marcan `refunded` (dinero devuelto al usuario) y las
 * ventas/liquidaciones del promotor `paid`. Así la facturación puede filtrarse por
 * estado igual que los egresos (compras), que sí llevan el estado real de la orden.
 */
function incomeStatus(movKind: string): string {
  if (movKind === 'refund' || movKind === 'resale') return 'refunded';
  return 'paid';
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Relaciones para una facturación rica: evento + nombre de localidad por ítem.
   * `promoterId` se incluye para autorizar al PROMOTOR dueño del evento a ver el
   * detalle de las órdenes de sus eventos (no solo el comprador/admin). */
  private static readonly DETAIL_INCLUDE = {
    event: { select: { name: true, slug: true, startsAt: true, promoterId: true } },
    items: { include: { locality: { select: { name: true } } } },
  } as const;

  /** Órdenes propias del usuario (más recientes primero), paginadas por keyset. */
  async listMine(buyerId: string, page: KeysetQuery = {}) {
    const rows = await this.prisma.order.findMany({
      where: { buyerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: OrdersService.DETAIL_INCLUDE,
      ...keysetTake(page),
    });
    return keysetResult(rows, page);
  }

  /**
   * Feed unificado de movimientos (INGRESOS + EGRESOS) del usuario para la
   * facturación de la cuenta. Server-authoritative: los egresos salen de las
   * órdenes del comprador y los ingresos de los créditos a sus cuentas del ledger
   * (devolución/reventa para el cliente; venta/liquidación para el promotor). Se
   * devuelve la lista completa ordenada por fecha DESC (más reciente primero).
   */
  async listMovements(userId: string): Promise<{ items: Movement[] }> {
    // EGRESOS: compras del usuario (todas sus órdenes).
    const orders = await this.prisma.order.findMany({
      where: { buyerId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        total: true,
        currency: true,
        status: true,
        createdAt: true,
        event: { select: { name: true } },
      },
    });
    const expenses: Movement[] = orders.map((o) => ({
      id: `order:${o.id}`,
      direction: 'expense',
      kind: 'purchase',
      amount: o.total.toFixed(2),
      currency: o.currency,
      status: o.status,
      eventName: o.event?.name ?? null,
      orderId: o.id,
      createdAt: o.createdAt.toISOString(),
    }));

    // INGRESOS: créditos (amount > 0) a las cuentas del usuario en el ledger.
    const credits = await this.prisma.ledgerEntry.findMany({
      where: {
        amount: { gt: 0 },
        account: {
          ownerId: userId,
          type: { in: [LedgerAccountType.user_wallet, LedgerAccountType.promoter_payable] },
        },
      },
      include: {
        account: { select: { currency: true } },
        transaction: { select: { kind: true, refType: true, refId: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const incomeEntries = credits.filter((e) => INCOME_TX_KINDS.has(e.transaction.kind));

    // Resolver nombre de evento de las órdenes referenciadas (para mostrar/enlazar).
    const orderIds = [
      ...new Set(
        incomeEntries
          .filter((e) => e.transaction.refType === 'order' && e.transaction.refId)
          .map((e) => e.transaction.refId as string),
      ),
    ];
    const refOrders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, event: { select: { name: true } } },
        })
      : [];
    const eventByOrder = new Map(refOrders.map((o) => [o.id, o.event?.name ?? null]));

    const incomes: Movement[] = incomeEntries.map((e) => {
      const orderId =
        e.transaction.refType === 'order' ? (e.transaction.refId ?? null) : null;
      const kind = movementKind(e.transaction.kind);
      return {
        id: `ledger:${e.id}`,
        direction: 'income',
        kind,
        amount: e.amount.toFixed(2),
        currency: e.account.currency,
        status: incomeStatus(kind),
        eventName: orderId ? (eventByOrder.get(orderId) ?? null) : null,
        orderId,
        createdAt: e.transaction.createdAt.toISOString(),
      };
    });

    const items = [...expenses, ...incomes].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );
    return { items };
  }

  /**
   * Transacciones (órdenes) de un evento para la tabla de Cuentas del panel.
   * Authz: admin o el promotor DUEÑO del evento (evento inexistente → 404; ajeno
   * → 403). Paginado por keyset (más recientes primero). Server-authoritative:
   * total/estado salen del snapshot inmutable de la orden.
   */
  async listForEvent(eventId: string, user: AuthUser, page: KeysetQuery = {}) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, promoterId: true },
    });
    if (!event) throw new NotFoundException('Evento no encontrado');
    const isAdmin = user.roles.includes(Role.admin);
    const isOwner = event.promoterId === user.userId;
    if (!isAdmin && !isOwner) throw new ForbiddenException('No es tu evento');

    const rows = await this.prisma.order.findMany({
      where: { eventId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        buyer: { select: { firstName: true, lastName: true, email: true } },
        items: { include: { locality: { select: { name: true } } } },
      },
      ...keysetTake(page),
    });
    const { items, nextCursor } = keysetResult(rows, page);
    return {
      items: items.map((o) => {
        const buyerName =
          [o.buyer?.firstName, o.buyer?.lastName].filter(Boolean).join(' ').trim() || null;
        const localities = [
          ...new Set(
            o.items.map((i) => i.locality?.name).filter((n): n is string => !!n),
          ),
        ];
        return {
          id: o.id,
          buyerName,
          buyerEmail: o.buyer?.email ?? null,
          status: o.status,
          total: o.total.toFixed(2),
          currency: o.currency,
          itemCount: o.items.length,
          localities,
          createdAt: o.createdAt.toISOString(),
        };
      }),
      nextCursor,
    };
  }

  /**
   * Detalle de una orden. Protección IDOR: la ven el COMPRADOR dueño, un ADMIN o el
   * PROMOTOR dueño del evento (para la tabla de transacciones del panel); cualquier
   * otro caso responde 404 (no se filtra la existencia del recurso).
   */
  async findOne(id: string, user: AuthUser) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: OrdersService.DETAIL_INCLUDE,
    });
    const isBuyer = order?.buyerId === user.userId;
    const isAdmin = user.roles.includes(Role.admin);
    const isEventOwner = !!order && order.event?.promoterId === user.userId;
    if (!order || (!isBuyer && !isAdmin && !isEventOwner)) {
      throw new NotFoundException('Orden no encontrada');
    }
    return order;
  }

  /**
   * Cadena contable (hash-chain) de la orden, para la vista "blockchain" del
   * comprador. Reusa la protección IDOR de findOne (solo dueño/admin; si no, 404).
   */
  async ledgerChain(id: string, user: AuthUser) {
    await this.findOne(id, user);
    return this.ledger.orderChain(id);
  }
}
