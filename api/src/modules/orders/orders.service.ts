import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Órdenes propias del usuario (más recientes primero). */
  listMine(buyerId: string) {
    return this.prisma.order.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  /**
   * Detalle de una orden. Protección IDOR: solo el dueño o un admin la ven; para
   * cualquier otro caso se responde 404 (no se filtra la existencia del recurso).
   */
  async findOne(id: string, user: AuthUser) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    const isOwner = order?.buyerId === user.userId;
    const isAdmin = user.roles.includes(Role.admin);
    if (!order || (!isOwner && !isAdmin)) {
      throw new NotFoundException('Orden no encontrada');
    }
    return order;
  }
}
