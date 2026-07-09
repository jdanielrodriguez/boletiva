import { BadRequestException, ConflictException } from '@nestjs/common';
import { GatewayStatus, Prisma } from '@prisma/client';
import { PaymentGatewaysService } from './payment-gateways.service';

/**
 * Cobertura de RAMAS de PaymentGatewaysService: validaciones (assertPct/assertFixed
 * /assertSharePct/assertInstallmentRates), conflictos de nombre (P2002), guardas de
 * la default de plataforma (make-default / remove / update) y migración al eliminar.
 * Prisma mockeado.
 */
describe('PaymentGatewaysService (guardas y validaciones, unit)', () => {
  const dec = (n: number) => new Prisma.Decimal(n);

  const makePrisma = () => ({
    paymentGateway: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    event: { updateMany: jest.fn() },
    $transaction: jest.fn(),
  });

  const build = () => {
    const prisma = makePrisma();
    const service = new PaymentGatewaysService(prisma as never);
    return { prisma, service };
  };

  const P2002 = new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });

  describe('validaciones de entrada', () => {
    it('feePct >= 1 → 400', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('feePct negativo → 400', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: -0.01 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('transactionFixedFee negativo → 400', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: 0.05, transactionFixedFee: -1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('minCostSharePct > 1 → 400', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: 0.05, minCostSharePct: 1.5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('installmentRates con cuota < 2 → 400', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: 0.05, installmentRates: { '1': 0.05 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('installmentRates con tasa >= 1 → 400', async () => {
      const { service } = build();
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: 0.05, installmentRates: { '3': 1.2 } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('installmentRates con tasa no numérica → 400', async () => {
      const { service } = build();
      await expect(
        service.create({
          name: 'x',
          provider: 'sim',
          feePct: 0.05,
          installmentRates: { '3': 'nope' as unknown as number },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('get', () => {
    it('devuelve la pasarela existente', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'g1', name: 'Sandbox' });
      await expect(service.get('g1')).resolves.toEqual({ id: 'g1', name: 'Sandbox' });
    });

    it('pasarela inexistente → 404', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue(null);
      await expect(service.get('nope')).rejects.toThrow();
    });
  });

  describe('create: éxito con y sin campos opcionales', () => {
    it('crea con TODOS los campos opcionales', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.create.mockImplementation(async ({ data }: never) => ({ id: 'g', ...(data as object) }));
      const gw = await service.create({
        name: 'Recurrente',
        provider: 'recurrente',
        feePct: 0.045,
        transactionFixedFee: 2,
        minCostSharePct: 0.3,
        installmentRates: { '3': 0.08, '6': 0.09 },
        installmentFixedFee: 2,
        credentialsRef: 'secret://rec',
        sandbox: true,
      });
      expect(gw).toMatchObject({ name: 'Recurrente' });
      expect(prisma.paymentGateway.create).toHaveBeenCalled();
    });

    it('crea solo con los campos requeridos (opcionales por defecto)', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.create.mockImplementation(async ({ data }: never) => ({ id: 'g', ...(data as object) }));
      const gw = await service.create({ name: 'Mínima', provider: 'sim', feePct: 0.05 });
      expect(gw).toMatchObject({ name: 'Mínima' });
    });
  });

  describe('update: éxito con y sin campos opcionales', () => {
    it('actualiza TODOS los campos', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        isPlatformDefault: false,
        minCostSharePct: dec(0),
      });
      prisma.paymentGateway.update.mockImplementation(async ({ data }: never) => ({ id: 'g1', ...(data as object) }));
      await service.update('g1', {
        name: 'X',
        feePct: 0.06,
        transactionFixedFee: 1,
        minCostSharePct: 0.4,
        installmentRates: { '3': 0.08 },
        installmentFixedFee: 1,
        credentialsRef: 'r',
        sandbox: false,
      });
      expect(prisma.paymentGateway.update).toHaveBeenCalled();
    });

    it('actualización vacía deja los campos sin tocar', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        isPlatformDefault: false,
        minCostSharePct: dec(0),
      });
      prisma.paymentGateway.update.mockResolvedValue({ id: 'g1' });
      await service.update('g1', {});
      expect(prisma.paymentGateway.update).toHaveBeenCalled();
    });
  });

  describe('setStatus / makeDefault (éxito)', () => {
    it('setStatus cambia el estado de una pasarela no default', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'g1', isPlatformDefault: false });
      prisma.paymentGateway.update.mockResolvedValue({ id: 'g1', status: GatewayStatus.maintenance });
      await service.setStatus('g1', GatewayStatus.maintenance);
      expect(prisma.paymentGateway.update).toHaveBeenCalled();
    });

    it('no se puede desactivar la default → 409', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'g1', isPlatformDefault: true });
      await expect(service.setStatus('g1', GatewayStatus.inactive)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('makeDefault promueve una activa sin colaboración mínima (atómico)', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        status: GatewayStatus.active,
        minCostSharePct: dec(0),
      });
      const tx = { paymentGateway: { updateMany: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'g1' }) } };
      prisma.$transaction.mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx));
      await service.makeDefault('g1');
      expect(tx.paymentGateway.updateMany).toHaveBeenCalled();
      expect(tx.paymentGateway.update).toHaveBeenCalled();
    });
  });

  describe('create: conflicto de nombre', () => {
    it('P2002 → ConflictException', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.create.mockRejectedValue(P2002);
      await expect(
        service.create({ name: 'dup', provider: 'sim', feePct: 0.05 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('otros errores se propagan', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.create.mockRejectedValue(new Error('boom'));
      await expect(
        service.create({ name: 'x', provider: 'sim', feePct: 0.05 }),
      ).rejects.toThrow('boom');
    });
  });

  describe('update', () => {
    it('P2002 → ConflictException', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        isPlatformDefault: false,
        minCostSharePct: dec(0),
      });
      prisma.paymentGateway.update.mockRejectedValue(P2002);
      await expect(service.update('g1', { name: 'dup' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('otros errores se propagan', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        isPlatformDefault: false,
        minCostSharePct: dec(0),
      });
      prisma.paymentGateway.update.mockRejectedValue(new Error('boom'));
      await expect(service.update('g1', { name: 'x' })).rejects.toThrow('boom');
    });

    it('la default no puede exigir colaboración mínima → 409', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        isPlatformDefault: true,
        minCostSharePct: dec(0),
      });
      await expect(service.update('g1', { minCostSharePct: 0.5 })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.paymentGateway.update).not.toHaveBeenCalled();
    });
  });

  describe('makeDefault', () => {
    it('una pasarela inactiva no puede ser default → 409', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        status: GatewayStatus.inactive,
        minCostSharePct: dec(0),
      });
      await expect(service.makeDefault('g1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('una pasarela que exige colaboración mínima no puede ser default → 409', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({
        id: 'g1',
        status: GatewayStatus.active,
        minCostSharePct: dec(0.3),
      });
      await expect(service.makeDefault('g1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('no se puede eliminar la default → 409', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'g1', isPlatformDefault: true });
      await expect(service.remove('g1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('sin default para migrar → 409', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'g1', isPlatformDefault: false });
      prisma.paymentGateway.findFirst.mockResolvedValue(null); // no hay default
      await expect(service.remove('g1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('migra los eventos a la default y elimina', async () => {
      const { prisma, service } = build();
      prisma.paymentGateway.findUnique.mockResolvedValue({ id: 'g1', isPlatformDefault: false });
      prisma.paymentGateway.findFirst.mockResolvedValue({ id: 'def', isPlatformDefault: true });
      prisma.$transaction.mockResolvedValue([]);
      const res = await service.remove('g1');
      expect(res).toEqual({ deleted: 'g1', migratedTo: 'def' });
    });
  });
});
