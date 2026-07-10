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
    const prisma = {
      order: { findMany: jest.fn(), findUnique: jest.fn() },
      ledgerEntry: { findMany: jest.fn() },
    };
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

  describe('listMovements', () => {
    /** Helper: Decimal-like con toFixed (imita el Decimal de Prisma). */
    const dec = (v: string) => ({ toFixed: () => v });

    it('las compras son EGRESOS (kind purchase) y enlazan a su orden', async () => {
      const { prisma, service } = build();
      prisma.order.findMany.mockResolvedValueOnce([
        {
          id: 'o1',
          total: dec('129.68'),
          currency: 'GTQ',
          status: 'paid',
          createdAt: new Date('2026-07-01T10:00:00Z'),
          event: { name: 'Concierto' },
        },
      ]);
      prisma.ledgerEntry.findMany.mockResolvedValue([]);
      const { items } = await service.listMovements('u1');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        direction: 'expense',
        kind: 'purchase',
        amount: '129.68',
        orderId: 'o1',
        eventName: 'Concierto',
        status: 'paid',
      });
    });

    it('un refund del ledger es un INGRESO (kind refund) y resuelve el evento', async () => {
      const { prisma, service } = build();
      prisma.order.findMany
        .mockResolvedValueOnce([]) // compras del usuario
        .mockResolvedValueOnce([{ id: 'o9', event: { name: 'Show' } }]); // evento referenciado
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: 'e1',
          amount: dec('123.20'),
          account: { currency: 'GTQ' },
          transaction: {
            kind: 'refund',
            refType: 'order',
            refId: 'o9',
            createdAt: new Date('2026-07-02T10:00:00Z'),
          },
        },
      ]);
      const { items } = await service.listMovements('u1');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        direction: 'income',
        kind: 'refund',
        amount: '123.20',
        orderId: 'o9',
        eventName: 'Show',
        status: null,
      });
    });

    it('order_payment (promoter_payable) es un INGRESO de venta (kind sale)', async () => {
      const { prisma, service } = build();
      prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: 'e2',
          amount: dec('100.00'),
          account: { currency: 'GTQ' },
          transaction: {
            kind: 'order_payment',
            refType: 'order',
            refId: null,
            createdAt: new Date('2026-07-03T10:00:00Z'),
          },
        },
      ]);
      const { items } = await service.listMovements('promo1');
      expect(items[0]).toMatchObject({ direction: 'income', kind: 'sale', orderId: null });
    });

    it('mezcla egresos e ingresos ordenados por fecha DESC', async () => {
      const { prisma, service } = build();
      prisma.order.findMany
        .mockResolvedValueOnce([
          {
            id: 'o1',
            total: dec('50.00'),
            currency: 'GTQ',
            status: 'paid',
            createdAt: new Date('2026-07-01T00:00:00Z'),
            event: { name: 'A' },
          },
        ])
        .mockResolvedValueOnce([{ id: 'o1', event: { name: 'A' } }]);
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: 'e1',
          amount: dec('25.00'),
          account: { currency: 'GTQ' },
          transaction: {
            kind: 'refund',
            refType: 'order',
            refId: 'o1',
            createdAt: new Date('2026-07-05T00:00:00Z'),
          },
        },
      ]);
      const { items } = await service.listMovements('u1');
      expect(items.map((i) => i.direction)).toEqual(['income', 'expense']);
    });

    it('ignora débitos y kinds que no son ingreso (no duplica el pago con wallet)', async () => {
      const { prisma, service } = build();
      // El where del prisma ya filtra amount>0; el service filtra por kind. Aquí
      // llega un wallet_reserve que NO debe convertirse en movimiento.
      prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: 'e3',
          amount: dec('10.00'),
          account: { currency: 'GTQ' },
          transaction: {
            kind: 'wallet_reserve',
            refType: 'order',
            refId: 'oX',
            createdAt: new Date(),
          },
        },
      ]);
      const { items } = await service.listMovements('u1');
      expect(items).toHaveLength(0);
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
