import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PricingService } from './pricing.service';

/**
 * Cobertura de RAMAS de PricingService: fallback a `settings` cuando no hay
 * fee_schedule activo, y el manejo de errores al versionar comisiones. Dependencia
 * de Prisma mockeada (no toca la BD) — cubre los BORDES; los happy paths viven en
 * los e2e de `pricing-*`.
 */
describe('PricingService (ramas de error, unit)', () => {
  const makePrisma = () => ({
    feeSchedule: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    paymentGateway: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    setting: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  const build = () => {
    const prisma = makePrisma();
    const service = new PricingService(prisma as never);
    return { prisma, service };
  };

  describe('resolveFees sin fee_schedule activo → fallback a settings', () => {
    it('sin schedule ni settings ni pasarela usa los defaults', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findFirst.mockResolvedValue(null); // no hay schedule activo
      prisma.paymentGateway.findUnique.mockResolvedValue(null);
      prisma.paymentGateway.findFirst.mockResolvedValue(null); // no hay pasarela default
      prisma.setting.findMany.mockResolvedValue([]); // sin settings

      const r = await service.resolveFees();
      expect(r.params.platformFeePct).toBe(0.1);
      expect(r.params.gatewayFeePct).toBe(0.05);
      expect(r.params.ivaPct).toBe(0.12);
      expect(r.scheduleId).toBeNull();
      expect(r.version).toBeNull();
      expect(r.gatewayId).toBeNull();
    });

    it('lee settings: usa el valor numérico y cae al default si no es finito', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findFirst.mockResolvedValue(null);
      prisma.paymentGateway.findUnique.mockResolvedValue(null);
      prisma.paymentGateway.findFirst.mockResolvedValue(null);
      prisma.setting.findMany.mockResolvedValue([
        { key: 'pricing.platform_fee_pct', value: 0.2 }, // number → se usa
        { key: 'pricing.gateway_fee_pct', value: 'no-numerico' }, // Number()→NaN → default
        { key: 'pricing.iva_pct', value: 0.15 },
      ]);

      const r = await service.resolveFees();
      expect(r.params.platformFeePct).toBe(0.2);
      expect(r.params.gatewayFeePct).toBe(0.05); // fallback por valor no finito
      expect(r.params.ivaPct).toBe(0.15);
    });
  });

  describe('createSchedule: manejo de errores', () => {
    const input = { platformFeePct: 0.1, gatewayFeePct: 0.05, ivaPct: 0.12 };

    it('conflicto de versión (P2002) → ConflictException', async () => {
      const { prisma, service } = build();
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: '5.0.0',
        }),
      );
      await expect(service.createSchedule(input, 'admin')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('otros errores se propagan sin envolver', async () => {
      const { prisma, service } = build();
      prisma.$transaction.mockRejectedValue(new Error('boom'));
      await expect(service.createSchedule(input, 'admin')).rejects.toThrow('boom');
    });

    it('crea y activa una versión nueva (happy path del cuerpo transaccional)', async () => {
      const { prisma, service } = build();
      const tx = {
        feeSchedule: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst: jest.fn().mockResolvedValue({ version: 2 }),
          create: jest.fn().mockResolvedValue({ id: 'fs3', version: 3 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
      const created = await service.createSchedule({ ...input, label: 'v3', fixedFees: 5 }, 'admin');
      expect(created).toEqual({ id: 'fs3', version: 3 });
      expect(tx.feeSchedule.updateMany).toHaveBeenCalled();
      expect(tx.feeSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 3, active: true }) }),
      );
    });

    it('crea la primera versión cuando no hay ninguna previa', async () => {
      const { prisma, service } = build();
      const tx = {
        feeSchedule: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findFirst: jest.fn().mockResolvedValue(null), // sin versiones previas → v1
          create: jest.fn().mockResolvedValue({ id: 'fs1', version: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
      await service.createSchedule(input, null);
      expect(tx.feeSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
      );
    });
  });

  describe('activeSchedule', () => {
    it('devuelve la tabla activa', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findFirst.mockResolvedValue({ id: 'fs', version: 1 });
      await expect(service.activeSchedule()).resolves.toEqual({ id: 'fs', version: 1 });
    });

    it('sin tabla activa → 404', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findFirst.mockResolvedValue(null);
      await expect(service.activeSchedule()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('paramsForRequote', () => {
    const sched = {
      platformFeePct: new Prisma.Decimal(0.1),
      ivaPct: new Prisma.Decimal(0.12),
      fixedFees: new Prisma.Decimal(0),
    };

    it('con versión: busca ese schedule', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findUnique.mockResolvedValue(sched);
      const p = await service.paramsForRequote(2, 0.06, true, 2);
      expect(p.platformFeePct).toBe(0.1);
      expect(p.gatewayFeePct).toBe(0.06);
      expect(p.transactionFixedFee).toBe(2);
      expect(prisma.feeSchedule.findUnique).toHaveBeenCalledWith({ where: { version: 2 } });
    });

    it('sin versión: usa el schedule activo', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findFirst.mockResolvedValue(sched);
      const p = await service.paramsForRequote(null, 0.05, false);
      expect(p.platformFeePct).toBe(0.1);
      expect(p.ivaOnNet).toBe(false);
      expect(prisma.feeSchedule.findFirst).toHaveBeenCalled();
    });

    it('sin schedule alguno: cae a los defaults', async () => {
      const { prisma, service } = build();
      prisma.feeSchedule.findUnique.mockResolvedValue(null);
      prisma.feeSchedule.findFirst.mockResolvedValue(null);
      const p = await service.paramsForRequote(9, 0.05, true);
      expect(p.platformFeePct).toBe(0.1); // DEFAULTS
      expect(p.ivaPct).toBe(0.12);
      expect(p.fixedFees).toBe(0);
    });
  });

  describe('installmentRate', () => {
    const gw = (rates: Record<string, number> | null) => ({
      feePct: new Prisma.Decimal(0.05),
      installmentRates: rates as never,
    });

    it('count <= 1 → comisión de pago único', () => {
      const { service } = build();
      expect(service.installmentRate(gw({ '3': 0.08 }), 1)).toBe(0.05);
    });

    it('la pasarela sin tabla de cuotas → 400', () => {
      const { service } = build();
      expect(() => service.installmentRate(gw(null), 3)).toThrow(BadRequestException);
    });

    it('plazo no soportado → 400', () => {
      const { service } = build();
      expect(() => service.installmentRate(gw({ '6': 0.09 }), 3)).toThrow(BadRequestException);
    });

    it('plazo soportado → su tasa', () => {
      const { service } = build();
      expect(service.installmentRate(gw({ '3': 0.08 }), 3)).toBe(0.08);
    });
  });
});
