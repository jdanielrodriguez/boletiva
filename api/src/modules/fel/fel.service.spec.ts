import { FelService } from './fel.service';
import { StubFelCertifier } from './stub-fel-certifier';
import { CONSUMIDOR_FINAL_NIT } from './fel-certifier.port';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { QueueService } from '../../infra/queue/queue.service';
import type { IntegrationsService } from '../../infra/integrations/integrations.service';
import type { ConfigService } from '@nestjs/config';

/** Decimal falso: solo necesitamos `.toString()`. */
const dec = (v: string) => ({ toString: () => v }) as unknown as never;

function makeOrder(billingNit: string) {
  return {
    id: 'order-1',
    currency: 'GTQ',
    net: dec('100.00'),
    platformFee: dec('10.00'),
    gatewayFee: dec('6.48'),
    iva: dec('13.20'),
    total: dec('129.68'),
    billingNit,
    billingName: null,
    billingAddress: null,
    event: { name: 'Concierto', promoter: { firstName: 'Ana', lastName: 'Ruiz' } },
  };
}

interface Mocks {
  prisma: { order: { findUnique: jest.Mock; update: jest.Mock } };
  queue: { enqueue: jest.Mock };
  integrations: { available: jest.Mock };
  config: { get: jest.Mock };
}

function setup(opts: { billingNit?: string; felAvailable?: boolean } = {}) {
  const order = makeOrder(opts.billingNit ?? '1234567');
  const mocks: Mocks = {
    prisma: {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue(order),
      },
    },
    queue: { enqueue: jest.fn().mockResolvedValue(undefined) },
    integrations: { available: jest.fn().mockReturnValue(opts.felAvailable ?? false) },
    config: { get: jest.fn().mockReturnValue({ requestorNit: '9999999', certifier: '', apiUser: '', apiKey: '', baseUrl: '' }) },
  };
  const certifier = new StubFelCertifier();
  const certifySpy = jest.spyOn(certifier, 'certify');
  const svc = new FelService(
    mocks.prisma as unknown as PrismaService,
    mocks.queue as unknown as QueueService,
    mocks.integrations as unknown as IntegrationsService,
    mocks.config as unknown as ConfigService,
    certifier,
  );
  return { svc, mocks, certifier, certifySpy };
}

describe('FelService', () => {
  describe('requestCertification (encola, no certifica en línea)', () => {
    it('encola el job certify-order en la cola FEL', async () => {
      const { svc, mocks } = setup();
      await svc.requestCertification('order-1');
      expect(mocks.queue.enqueue).toHaveBeenCalledWith('fel', 'certify-order', { orderId: 'order-1' });
    });

    it('NO lanza aunque el enqueue falle (la factura no bloquea nada)', async () => {
      const { svc, mocks } = setup();
      mocks.queue.enqueue.mockRejectedValueOnce(new Error('redis caído'));
      await expect(svc.requestCertification('order-1')).resolves.toBeUndefined();
    });
  });

  describe('certifyOrder (doble factura + fallback)', () => {
    it('NIT válido → certifica los 2 DTEs (plataforma + promotor) y persiste la plataforma', async () => {
      const { svc, mocks, certifySpy } = setup({ billingNit: '1234567' });
      await svc.certifyOrder('order-1');

      // Dos DTEs: uno por tipo, ambos al NIT solicitado (válido).
      expect(certifySpy).toHaveBeenCalledTimes(2);
      const types = certifySpy.mock.calls.map((c) => c[0].type).sort();
      expect(types).toEqual(['platform', 'promoter']);
      expect(certifySpy.mock.calls.every((c) => c[0].receptorNit === '1234567')).toBe(true);

      // Persiste SOLO la factura de la plataforma (el juego FEL existente en el schema).
      expect(mocks.prisma.order.update).toHaveBeenCalledTimes(1);
      const data = mocks.prisma.order.update.mock.calls[0][0].data;
      expect(data.felUuid).toMatch(/^[0-9A-F-]+$/);
      expect(data.felSerie).toBeDefined();
      expect(data.felNumero).toBeDefined();
      expect(data.felCertifiedAt).toBeInstanceOf(Date);
    });

    it("NIT 'BAD...' → fallback a CF en ambos DTEs (reintento por tipo)", async () => {
      const { svc, mocks, certifySpy } = setup({ billingNit: 'BAD999' });
      await svc.certifyOrder('order-1');

      // Por cada tipo: 1er intento con BAD (rechazado) + reintento con CF → 4 llamadas.
      expect(certifySpy).toHaveBeenCalledTimes(4);
      const retriedNits = certifySpy.mock.calls.map((c) => c[0].receptorNit);
      expect(retriedNits.filter((n) => n === CONSUMIDOR_FINAL_NIT)).toHaveLength(2);

      // La plataforma se persiste con la autorización obtenida vía CF.
      expect(mocks.prisma.order.update).toHaveBeenCalledTimes(1);
      expect(mocks.prisma.order.update.mock.calls[0][0].data.felUuid).toBeDefined();
    });

    it('orden inexistente → no lanza ni actualiza', async () => {
      const { svc, mocks } = setup();
      mocks.prisma.order.findUnique.mockResolvedValueOnce(null);
      await expect(svc.certifyOrder('nope')).resolves.toBeUndefined();
      expect(mocks.prisma.order.update).not.toHaveBeenCalled();
    });
  });
});
