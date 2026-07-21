import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import { SettlementService } from './settlement.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * Cobertura de RAMAS de SettlementService (módulo FINANCIERO → 100% branches):
 * authz (404 evento inexistente, 403 ajeno, admin, owner), la agregación de
 * montos (evento vacío → nulls → 0.00; evento con órdenes pagadas → suma exacta)
 * y el cierre de caja v3.10 (finalizeAndTransfer): RBAC, idempotencia,
 * elegibilidad y el asiento contable de traslado.
 */
describe('SettlementService (branches, unit)', () => {
  const build = () => {
    const prisma = {
      event: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        // M1: claim atómico compare-and-set (por defecto reclama 1 fila).
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // A3: por defecto 0 órdenes pagadas (no bloquea el cierre de un cancelado).
      order: { aggregate: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      orderItem: { count: jest.fn() },
    };
    const ledger = { post: jest.fn().mockResolvedValue({}) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    // T5: SettlementService notifica al promotor (liquidación/evento finalizado).
    const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    const service = new SettlementService(
      prisma as never,
      ledger as never,
      audit as never,
      queue as never,
      notifications as never,
    );
    return { prisma, ledger, audit, queue, notifications, service };
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
      services: '0.00',
      iva: '0.00',
      refundsIssued: '0.00',
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
    // serviceFee = 20.00 + 12.96 + 4.00 (sin IVA)
    expect(res.serviceFee).toBe('36.96');
    // services = plataforma + pasarela + fijos + IVA = 20 + 12.96 + 4 + 26.40
    expect(res.services).toBe('63.36');
    // Identidad exacta: gross = services + net (200.00 + 63.36 = 263.36).
    expect(res.services).toBe(new Decimal(res.gross).sub(res.net).toFixed(2));
    expect(prisma.orderItem.count).toHaveBeenCalledWith({
      where: { order: { eventId: 'e1', status: 'paid' }, active: true },
    });
  });

  // ---- finalizeAndTransfer (cierre de caja v3.10) ----

  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  it('finalize: no-admin → 403 (el promotor no autoliquida su caja)', async () => {
    const { service, prisma } = build();
    await expect(service.finalizeAndTransfer('e1', owner)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('finalize: admin IMPERSONANDO → 403 (solo admin real; v3.11 F2)', async () => {
    const { service, prisma } = build();
    const impersonating: AuthUser = {
      userId: 'promo',
      email: 'p@x.com',
      roles: [Role.admin],
      impersonation: true,
      impersonatedBy: 'adm',
    };
    await expect(service.finalizeAndTransfer('e1', impersonating)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.event.findUnique).not.toHaveBeenCalled();
  });

  it('finalize: evento inexistente → 404', async () => {
    const { service, prisma } = build();
    prisma.event.findUnique.mockResolvedValue(null);
    await expect(service.finalizeAndTransfer('nope', admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('finalize: ya transferido → 409 (idempotencia)', async () => {
    const { service, prisma } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'X', promoterId: 'promo', status: 'finished', endsAt: past,
      cashTransferredAt: new Date(),
    });
    await expect(service.finalizeAndTransfer('e1', admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('finalize: evento no elegible (draft, futuro) → 409', async () => {
    const { service, prisma } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'X', promoterId: 'promo', status: 'draft', endsAt: future, cashTransferredAt: null,
    });
    await expect(service.finalizeAndTransfer('e1', admin)).rejects.toBeInstanceOf(ConflictException);
  });

  it('finalize: publicado y CONCLUIDO por fecha (completado) → OK (elegible)', async () => {
    // Un evento exitoso que simplemente terminó por fecha (published, endsAt pasado)
    // SÍ es elegible: es el caso "completado" del cierre de caja.
    const { service, prisma, ledger } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'X', promoterId: 'promo', status: 'published', endsAt: past, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: '150.00' } });
    const res = await service.finalizeAndTransfer('e1', admin);
    expect(res).toMatchObject({ eventId: 'e1', status: 'finished' });
    expect(ledger.post).toHaveBeenCalled();
  });

  it('finalize: publicado y AÚN VIGENTE (fecha futura) → 409 (no concluido)', async () => {
    const { service, prisma } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'X', promoterId: 'promo', status: 'published', endsAt: future, cashTransferredAt: null,
    });
    await expect(service.finalizeAndTransfer('e1', admin)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.event.update).not.toHaveBeenCalled();
  });

  it('finalize: evento CANCELADO → OK (estado elegible)', async () => {
    const { service, prisma, ledger } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'cancelled', endsAt: future, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: '150.00' } });
    const res = await service.finalizeAndTransfer('e1', admin, '1.2.3.4', 'jest');
    expect(res).toMatchObject({ eventId: 'e1', transferred: '150.00', status: 'finished' });
    expect(ledger.post).toHaveBeenCalled();
  });

  it('finalize: elegible con neto → asienta traslado payable→wallet, cierra y audita', async () => {
    const { service, prisma, ledger, audit } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'suspended', endsAt: future, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: '150.00' } });
    const res = await service.finalizeAndTransfer('e1', admin, '1.2.3.4', 'jest');
    expect(res).toMatchObject({ eventId: 'e1', promoterId: 'promo', transferred: '150.00', status: 'finished' });
    // M1: el cierre reclama con updateMany compare-and-set (where cashTransferredAt=null).
    expect(prisma.event.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'e1', cashTransferredAt: null }),
        data: expect.objectContaining({ status: 'finished' }),
      }),
    );
    const posted = ledger.post.mock.calls[0][0];
    expect(posted.kind).toBe('event_cash_transfer');
    const sum = posted.entries.reduce((a: number, e: { amount: string }) => a + Number(e.amount), 0);
    expect(sum).toBeCloseTo(0, 2); // partida doble cuadra
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'event.cash_transfer' }));
  });

  it('finalize: encola el correo de estado de cuentas al promotor (F4)', async () => {
    const { service, prisma, queue } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'finished', endsAt: past, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: '150.00' } });
    await service.finalizeAndTransfer('e1', admin);
    expect(queue.enqueue).toHaveBeenCalledWith(
      'mail',
      'event-settlement',
      expect.objectContaining({ eventId: 'e1', promoterId: 'promo', transferred: '150.00' }),
    );
  });

  it('A3: finalize de evento CANCELADO con órdenes pagadas sin reembolsar → 409', async () => {
    const { service, prisma, ledger } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'cancelled', endsAt: future, cashTransferredAt: null,
    });
    prisma.order.count.mockResolvedValue(3); // 3 órdenes pagadas sin reembolsar
    await expect(service.finalizeAndTransfer('e1', admin)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.event.updateMany).not.toHaveBeenCalled();
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('M1: si el claim atómico no reclama fila (ya transferido en carrera) → 409', async () => {
    const { service, prisma, ledger } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'finished', endsAt: past, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: '150.00' } });
    prisma.event.updateMany.mockResolvedValue({ count: 0 }); // otra petición ganó la carrera
    await expect(service.finalizeAndTransfer('e1', admin)).rejects.toBeInstanceOf(ConflictException);
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('A4: si el asiento contable falla, revierte la marca (event.update a null) y relanza', async () => {
    const { service, prisma, ledger } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'suspended', endsAt: future, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: '150.00' } });
    ledger.post.mockRejectedValue(new Error('ledger caído'));
    // El ledger es síncrono en el endpoint: un fallo relanza (500) y REVIERTE la marca
    // (no queda "finished sin acreditar"; permite reintento).
    await expect(service.finalizeAndTransfer('e1', admin)).rejects.toThrow('ledger caído');
    expect(prisma.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cashTransferredAt: null }) }),
    );
  });

  it('finalize: neto 0 → cierra sin asiento contable (evita partida vacía)', async () => {
    const { service, prisma, ledger } = build();
    prisma.event.findUnique.mockResolvedValue({
      id: 'e1', name: 'Show', promoterId: 'promo', status: 'finished', endsAt: past, cashTransferredAt: null,
    });
    prisma.order.aggregate.mockResolvedValue({ _sum: { net: null } });
    const res = await service.finalizeAndTransfer('e1', admin);
    expect(res.transferred).toBe('0.00');
    expect(ledger.post).not.toHaveBeenCalled();
  });
});
