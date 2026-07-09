import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SettlementService } from './settlement.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Cobertura de RAMAS de SettlementService (módulo FINANCIERO → 100% branches):
 * authz (404 evento inexistente, 403 ajeno, admin, owner) y la agregación de
 * montos (evento vacío → nulls → 0.00; evento con órdenes pagadas → suma exacta).
 */
describe('SettlementService (branches, unit)', () => {
  const build = () => {
    const prisma = {
      event: { findUnique: jest.fn() },
      order: { aggregate: jest.fn() },
      orderItem: { count: jest.fn() },
    };
    const service = new SettlementService(prisma as never);
    return { prisma, service };
  };

  const owner: AuthUser = { userId: 'promo', email: 'p@x.com', roles: [Role.promoter] };
  const other: AuthUser = { userId: 'otro', email: 'o@x.com', roles: [Role.promoter] };
  const admin: AuthUser = { userId: 'adm', email: 'a@x.com', roles: [Role.admin] };

  const emptyAgg = {
    _count: 0,
    _sum: { net: null, fixedFees: null, platformFee: null, gatewayFee: null, iva: null, total: null },
  };

  it('evento inexistente → 404', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.forEvent('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('promotor que no es dueño ni admin → 403 (IDOR)', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue({ id: 'e1', name: 'X', promoterId: 'promo' });
    await expect(service.forEvent('e1', other)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.order.aggregate).not.toHaveBeenCalled();
  });

  it('evento sin órdenes pagadas → montos en 0.00 (nulls del _sum)', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue({ id: 'e1', name: 'Vacío', promoterId: 'promo' });
    prisma.order.aggregate.mockResolvedValue(emptyAgg);
    prisma.orderItem.count.mockResolvedValue(0);
    const res = await service.forEvent('e1', owner);
    expect(res).toEqual({
      eventId: 'e1',
      eventName: 'Vacío',
      currency: 'GTQ',
      paidOrders: 0,
      ticketsSold: 0,
      gross: '0.00',
      net: '0.00',
      platformFee: '0.00',
      gatewayFee: '0.00',
      fixedFees: '0.00',
      serviceFee: '0.00',
      iva: '0.00',
    });
  });

  it('admin ve la liquidación con montos sumados y serviceFee = plat+gw+fijos', async () => {
    const { prisma, service } = build();
    prisma.event.findUnique.mockResolvedValue({ id: 'e1', name: 'Show', promoterId: 'promo' });
    prisma.order.aggregate.mockResolvedValue({
      _count: 2,
      _sum: {
        net: '200.00',
        fixedFees: '4.00',
        platformFee: '20.00',
        gatewayFee: '12.96',
        iva: '26.40',
        total: '263.36',
      },
    });
    prisma.orderItem.count.mockResolvedValue(2);
    const res = await service.forEvent('e1', admin);
    expect(res.paidOrders).toBe(2);
    expect(res.ticketsSold).toBe(2);
    expect(res.net).toBe('200.00');
    expect(res.platformFee).toBe('20.00');
    expect(res.gatewayFee).toBe('12.96');
    expect(res.fixedFees).toBe('4.00');
    expect(res.iva).toBe('26.40');
    expect(res.gross).toBe('263.36');
    // serviceFee = 20.00 + 12.96 + 4.00
    expect(res.serviceFee).toBe('36.96');
    expect(prisma.orderItem.count).toHaveBeenCalledWith({
      where: { order: { eventId: 'e1', status: 'paid' }, active: true },
    });
  });
});
