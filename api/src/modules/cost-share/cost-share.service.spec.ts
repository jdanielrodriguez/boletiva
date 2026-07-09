import { BadRequestException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { CostShareService } from './cost-share.service';

/**
 * Cobertura de RAMAS de CostShareService: validación del %, defaults globales,
 * override por promotor, umbral de cuotas, pasarelas permitidas y el asiento
 * contable del gasto extra repartido. Prisma/Ledger mockeados.
 */
describe('CostShareService (unit)', () => {
  const build = () => {
    const prisma = {
      setting: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn(), update: jest.fn() },
    };
    const ledger = { post: jest.fn().mockResolvedValue({}) };
    const service = new CostShareService(prisma as never, ledger as never);
    return { prisma, ledger, service };
  };

  describe('assertPct (validación de %)', () => {
    it('setDefaultPct rechaza > 1, negativo y NaN', async () => {
      const { service } = build();
      await expect(service.setDefaultPct(1.5)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setDefaultPct(-0.1)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.setDefaultPct(Number.NaN)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('setDefaultPct válido hace upsert del setting', async () => {
      const { prisma, service } = build();
      const res = await service.setDefaultPct(0.5);
      expect(res).toEqual({ defaultPct: 0.5 });
      expect(prisma.setting.upsert).toHaveBeenCalled();
    });
  });

  describe('getDefaultPct', () => {
    it('usa el valor numérico del setting', async () => {
      const { prisma, service } = build();
      prisma.setting.findUnique.mockResolvedValue({ value: 0.4 });
      expect(await service.getDefaultPct()).toBe(0.4);
    });

    it('cae al default (0) si no hay setting o no es finito', async () => {
      const { prisma, service } = build();
      prisma.setting.findUnique.mockResolvedValue(null);
      expect(await service.getDefaultPct()).toBe(0);
      prisma.setting.findUnique.mockResolvedValue({ value: 'x' }); // Number('x')=NaN
      expect(await service.getDefaultPct()).toBe(0);
    });
  });

  describe('effectivePct', () => {
    it('promotor inexistente → 404', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.effectivePct('p1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('usa el override del promotor cuando existe', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: new Decimal(0.7) });
      expect(await service.effectivePct('p1')).toBe(0.7);
    });

    it('sin override cae al default global', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: null });
      prisma.setting.findUnique.mockResolvedValue({ value: 0.5 });
      expect(await service.effectivePct('p1')).toBe(0.5);
    });
  });

  describe('installmentsMinPct / installmentsAllowed', () => {
    it('lee el umbral del setting o cae al default 0.3', async () => {
      const { prisma, service } = build();
      prisma.setting.findUnique.mockResolvedValue({ value: 0.25 });
      expect(await service.installmentsMinPct()).toBe(0.25);
      prisma.setting.findUnique.mockResolvedValue({ value: 'no-num' }); // Number()→NaN
      expect(await service.installmentsMinPct()).toBe(0.3);
      prisma.setting.findUnique.mockResolvedValue(null);
      expect(await service.installmentsMinPct()).toBe(0.3);
    });

    it('installmentsAllowed compara el % efectivo con el umbral', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: new Decimal(0.5) });
      prisma.setting.findUnique.mockResolvedValue({ value: 0.3 });
      expect(await service.installmentsAllowed('p1')).toBe(true);
      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: new Decimal(0.1) });
      expect(await service.installmentsAllowed('p1')).toBe(false);
    });
  });

  describe('gatewayAllowed', () => {
    it('la default de plataforma siempre está permitida', () => {
      const { service } = build();
      const gw = { minCostSharePct: { toNumber: () => 0.9 }, isPlatformDefault: true };
      expect(service.gatewayAllowed(gw, 0)).toBe(true);
    });

    it('las demás exigen el cost-share mínimo', () => {
      const { service } = build();
      const gw = { minCostSharePct: { toNumber: () => 0.3 }, isPlatformDefault: false };
      expect(service.gatewayAllowed(gw, 0.5)).toBe(true);
      expect(service.gatewayAllowed(gw, 0.1)).toBe(false);
    });
  });

  describe('setPromoterPct', () => {
    it('% fuera de rango → 400 antes de tocar la BD', async () => {
      const { prisma, service } = build();
      await expect(service.setPromoterPct('p1', 2)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('promotor inexistente → 404', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setPromoterPct('p1', 0.5)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('fija el override (o lo limpia con null)', async () => {
      const { prisma, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: null });
      prisma.user.update.mockResolvedValue({ costSharePct: new Decimal(0.5) });
      const res = await service.setPromoterPct('p1', 0.5);
      expect(res.override).toBe(0.5);

      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: null });
      prisma.user.update.mockResolvedValue({ costSharePct: null });
      const cleared = await service.setPromoterPct('p1', null);
      expect(cleared.override).toBeNull();
    });
  });

  describe('applyExtraCost', () => {
    it('monto <= 0 → 400', async () => {
      const { service } = build();
      await expect(
        service.applyExtraCost({ promoterId: 'p1', amount: 0, kind: 'wallet_pass_fee' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reparte el gasto y asienta en el ledger (partida doble)', async () => {
      const { prisma, ledger, service } = build();
      prisma.user.findUnique.mockResolvedValue({ id: 'p1', costSharePct: new Decimal(0.5) });
      const res = await service.applyExtraCost({
        promoterId: 'p1',
        amount: 10,
        kind: 'wallet_pass_fee',
      });
      expect(res.promoterShare).toBe('5.00');
      expect(res.platformShare).toBe('5.00');
      expect(ledger.post).toHaveBeenCalled();
    });
  });
});
