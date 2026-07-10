import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
      event: { findUnique: jest.fn() },
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

  describe('listForEvent (transacciones del evento)', () => {
    const owner: AuthUser = { userId: 'promo', email: 'p@x.com', roles: [Role.promoter] };
    const other: AuthUser = { userId: 'otro', email: 'o@x.com', roles: [Role.promoter] };
    const dec = (v: string) => ({ toFixed: () => v });

    it('evento inexistente → 404 (no consulta órdenes)', async () => {
      const { prisma, service } = build();
      prisma.event.findUnique.mockResolvedValue(null);
      await expect(service.listForEvent('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('promotor que no es dueño ni admin → 403 (IDOR)', async () => {
      const { prisma, service } = build();
      prisma.event.findUnique.mockResolvedValue({ id: 'e1', promoterId: 'promo' });
      await expect(service.listForEvent('e1', other)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('el promotor dueño ve las transacciones mapeadas (comprador, localidades, conteo)', async () => {
      const { prisma, service } = build();
      prisma.event.findUnique.mockResolvedValue({ id: 'e1', promoterId: 'promo' });
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1',
          status: 'paid',
          total: dec('259.36'),
          currency: 'GTQ',
          createdAt: new Date('2026-07-01T10:00:00Z'),
          buyer: { firstName: 'Ana', lastName: 'López', email: 'ana@x.com' },
          items: [
            { locality: { name: 'VIP' } },
            { locality: { name: 'VIP' } },
            { locality: { name: 'General' } },
          ],
        },
      ]);
      const res = await service.listForEvent('e1', owner, { limit: 10 });
      expect(res.nextCursor).toBeNull();
      expect(res.items[0]).toEqual({
        id: 'o1',
        buyerName: 'Ana López',
        buyerEmail: 'ana@x.com',
        status: 'paid',
        total: '259.36',
        currency: 'GTQ',
        itemCount: 3,
        localities: ['VIP', 'General'],
        createdAt: '2026-07-01T10:00:00.000Z',
      });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventId: 'e1' } }),
      );
    });

    it('un admin ve las transacciones de un evento ajeno; comprador anónimo → null', async () => {
      const { prisma, service } = build();
      prisma.event.findUnique.mockResolvedValue({ id: 'e1', promoterId: 'promo' });
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o2',
          status: 'refunded',
          total: dec('129.68'),
          currency: 'GTQ',
          createdAt: new Date('2026-07-02T10:00:00Z'),
          buyer: { firstName: null, lastName: null, email: null },
          items: [{ locality: null }],
        },
      ]);
      const res = await service.listForEvent('e1', admin);
      expect(res.items[0]).toMatchObject({
        buyerName: null,
        buyerEmail: null,
        itemCount: 1,
        localities: [],
      });
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

    it('el promotor dueño del evento ve la orden de un comprador (tabla de transacciones)', async () => {
      const { prisma, service } = build();
      const promoter: AuthUser = { userId: 'promo', email: 'p@x.com', roles: [Role.promoter] };
      const order = { id: 'o1', buyerId: 'otro', items: [], event: { promoterId: 'promo' } };
      prisma.order.findUnique.mockResolvedValue(order);
      await expect(service.findOne('o1', promoter)).resolves.toEqual(order);
    });

    it('un tercero no dueño ni admin recibe 404 (IDOR, no filtra existencia)', async () => {
      const { prisma, service } = build();
      prisma.order.findUnique.mockResolvedValue({
        id: 'o1',
        buyerId: 'otro',
        items: [],
        event: { promoterId: 'alguien-mas' },
      });
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
