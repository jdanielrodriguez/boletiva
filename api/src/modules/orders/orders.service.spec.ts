import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrdersService } from './orders.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Cobertura de RAMAS de OrdersService: paginación keyset de las órdenes propias y
 * la protección IDOR de `findOne` (dueño / admin / ajeno / inexistente). Prisma
 * mockeado.
 */
describe('OrdersService (IDOR + keyset, unit)', () => {
  const build = () => {
    const prisma = { order: { findMany: jest.fn(), findUnique: jest.fn() } };
    const ledger = { orderChain: jest.fn() };
    const service = new OrdersService(prisma as never, ledger as never);
    return { prisma, ledger, service };
  };

  const buyer: AuthUser = { userId: 'u1', email: 'u1@x.com', roles: [Role.buyer] };
  const admin: AuthUser = { userId: 'adm', email: 'a@x.com', roles: [Role.admin] };

  describe('listMine', () => {
    it('devuelve las órdenes del comprador paginadas por keyset', async () => {
      const { prisma, service } = build();
      const rows = [{ id: 'o2', items: [] }, { id: 'o1', items: [] }];
      prisma.order.findMany.mockResolvedValue(rows);
      const res = await service.listMine('u1', { limit: 10 });
      expect(res.items).toEqual(rows);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buyerId: 'u1' } }),
      );
    });

    it('funciona sin argumento de paginación (usa el default)', async () => {
      const { prisma, service } = build();
      prisma.order.findMany.mockResolvedValue([]);
      const res = await service.listMine('u1');
      expect(res.items).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('el dueño ve su orden', async () => {
      const { prisma, service } = build();
      const order = { id: 'o1', buyerId: 'u1', items: [] };
      prisma.order.findUnique.mockResolvedValue(order);
      await expect(service.findOne('o1', buyer)).resolves.toEqual(order);
    });

    it('un admin ve una orden de otro comprador', async () => {
      const { prisma, service } = build();
      const order = { id: 'o1', buyerId: 'u1', items: [] };
      prisma.order.findUnique.mockResolvedValue(order);
      await expect(service.findOne('o1', admin)).resolves.toEqual(order);
    });

    it('un tercero no dueño ni admin recibe 404 (IDOR, no filtra existencia)', async () => {
      const { prisma, service } = build();
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', buyerId: 'otro', items: [] });
      await expect(service.findOne('o1', buyer)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('orden inexistente → 404', async () => {
      const { prisma, service } = build();
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('ledgerChain', () => {
    it('el dueño obtiene la cadena contable de su orden', async () => {
      const { prisma, ledger, service } = build();
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', buyerId: 'u1', items: [] });
      const chain = { orderId: 'o1', transactions: [], chainValid: true };
      ledger.orderChain.mockResolvedValue(chain);
      await expect(service.ledgerChain('o1', buyer)).resolves.toEqual(chain);
      expect(ledger.orderChain).toHaveBeenCalledWith('o1');
    });

    it('un tercero recibe 404 y NO se consulta el ledger (IDOR)', async () => {
      const { prisma, ledger, service } = build();
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', buyerId: 'otro', items: [] });
      await expect(service.ledgerChain('o1', buyer)).rejects.toBeInstanceOf(NotFoundException);
      expect(ledger.orderChain).not.toHaveBeenCalled();
    });
  });
});
