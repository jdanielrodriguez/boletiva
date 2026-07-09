import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import Decimal from 'decimal.js';
import { WalletWithdrawalService } from './wallet-withdrawal.service';

/**
 * Cobertura de RAMAS de WalletWithdrawalService: resolución de la comisión por rol
 * (feePctFor: valor numérico / no numérico / faltante → fallback), validación del
 * monto y los listados paginados. Prisma/Ledger mockeados.
 */
describe('WalletWithdrawalService (comisión + monto, unit)', () => {
  const build = () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn() },
      setting: { findUnique: jest.fn() },
      walletWithdrawal: { create: jest.fn(), findMany: jest.fn() },
    };
    const ledger = { walletBalance: jest.fn(), post: jest.fn() };
    const service = new WalletWithdrawalService(prisma as never, ledger as never);
    return { prisma, ledger, service };
  };

  it('rechaza un monto <= 0', async () => {
    const { service } = build();
    await expect(service.request('u1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.request('u1', -5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('usa la comisión del setting cuando es un número válido (usuario 6%)', async () => {
    const { prisma, ledger, service } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', roles: [Role.buyer] });
    prisma.setting.findUnique.mockResolvedValue({ value: 0.06 });
    ledger.walletBalance.mockResolvedValue(new Decimal('100.00'));
    ledger.post.mockResolvedValue(undefined);
    prisma.walletWithdrawal.create.mockImplementation(async ({ data }: never) => ({
      ...(data as Record<string, unknown>),
      status: 'pending',
      note: null,
      createdAt: new Date(),
      paidAt: null,
    }));

    const res = await service.request('u1', 50);
    expect(res.amount).toBe('50.00');
    expect(res.fee).toBe('3.00'); // 50 * 0.06
    expect(res.net).toBe('47.00');
    expect(res.feePct).toBe(0.06);
  });

  it('promotor sin setting cae al default 3%', async () => {
    const { prisma, ledger, service } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'p1', roles: [Role.promoter] });
    prisma.setting.findUnique.mockResolvedValue(null); // sin override → fallback 0.03
    ledger.walletBalance.mockResolvedValue(new Decimal('100.00'));
    prisma.walletWithdrawal.create.mockImplementation(async ({ data }: never) => ({
      ...(data as Record<string, unknown>),
      status: 'pending',
      note: null,
      createdAt: new Date(),
      paidAt: null,
    }));

    const res = await service.request('p1', 100);
    expect(res.fee).toBe('3.00'); // 100 * 0.03 (default promotor)
    expect(res.feePct).toBe(0.03);
  });

  it('un valor de setting no numérico cae al default', async () => {
    const { prisma, ledger, service } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', roles: [Role.buyer] });
    prisma.setting.findUnique.mockResolvedValue({ value: 'no-numerico' }); // Number()→NaN
    ledger.walletBalance.mockResolvedValue(new Decimal('100.00'));
    prisma.walletWithdrawal.create.mockImplementation(async ({ data }: never) => ({
      ...(data as Record<string, unknown>),
      status: 'pending',
      note: null,
      createdAt: new Date(),
      paidAt: null,
    }));

    const res = await service.request('u1', 10);
    expect(res.feePct).toBe(0.06); // default usuario
  });

  it('saldo insuficiente → 400', async () => {
    const { prisma, ledger, service } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', roles: [Role.buyer] });
    prisma.setting.findUnique.mockResolvedValue({ value: 0.06 });
    ledger.walletBalance.mockResolvedValue(new Decimal('5.00'));
    await expect(service.request('u1', 50)).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('listados paginados por keyset', () => {
    it('listMine filtra por usuario', async () => {
      const { prisma, service } = build();
      prisma.walletWithdrawal.findMany.mockResolvedValue([{ id: 'w1' }]);
      const res = await service.listMine('u1', { limit: 5 });
      expect(res.items).toEqual([{ id: 'w1' }]);
      expect(prisma.walletWithdrawal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });

    it('listMine usa el default de paginación sin argumento', async () => {
      const { prisma, service } = build();
      prisma.walletWithdrawal.findMany.mockResolvedValue([]);
      const res = await service.listMine('u1');
      expect(res.items).toEqual([]);
    });

    it('listAll sin filtro de estado', async () => {
      const { prisma, service } = build();
      prisma.walletWithdrawal.findMany.mockResolvedValue([]);
      const res = await service.listAll(undefined, {});
      expect(res.items).toEqual([]);
      expect(prisma.walletWithdrawal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('listAll filtra por estado y usa el default de paginación', async () => {
      const { prisma, service } = build();
      prisma.walletWithdrawal.findMany.mockResolvedValue([]);
      await service.listAll('pending' as never);
      expect(prisma.walletWithdrawal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      );
    });
  });
});
