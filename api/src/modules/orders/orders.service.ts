import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /** Relaciones para una facturación rica: evento + nombre de localidad por ítem. */
  private static readonly DETAIL_INCLUDE = {
    event: { select: { name: true, slug: true, startsAt: true } },
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
   * Detalle de una orden. Protección IDOR: solo el dueño o un admin la ven; para
   * cualquier otro caso se responde 404 (no se filtra la existencia del recurso).
   */
  async findOne(id: string, user: AuthUser) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: OrdersService.DETAIL_INCLUDE,
    });
    const isOwner = order?.buyerId === user.userId;
    const isAdmin = user.roles.includes(Role.admin);
    if (!order || (!isOwner && !isAdmin)) {
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
