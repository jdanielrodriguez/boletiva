import { ConfigService } from '@nestjs/config';
import { SimulatorPaymentProvider } from './simulator.provider';
import { hmacSha256 } from '../../../common/utils/crypto';

const SECRET = 'test-secret';

function makeProvider(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'payment.webhookSecret': SECRET,
    'payment.simulatorAutoConfirm': false,
    'payment.simulatorJitterMinMs': 1000,
    'payment.simulatorJitterMaxMs': 5000,
    ...overrides,
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new SimulatorPaymentProvider(config);
}

describe('SimulatorPaymentProvider — jitter + auto-confirm (Ola 6.5)', () => {
  it('createPayment refleja las cuotas en la URL y el eco', async () => {
    const p = makeProvider();
    const r = await p.createPayment({ providerRef: 'ref1', orderId: 'o1', amount: '129.68', currency: 'GTQ', installments: 3 });
    expect(r.installments).toBe(3);
    expect(r.paymentUrl).toContain('?cuotas=3');
    const r1 = await p.createPayment({ providerRef: 'ref2', orderId: 'o1', amount: '129.68', currency: 'GTQ' });
    expect(r1.installments).toBe(1);
    expect(r1.paymentUrl).not.toContain('cuotas');
  });

  it('jitterMs cae dentro del rango configurado [min, max]', () => {
    const p = makeProvider({ 'payment.simulatorJitterMinMs': 1000, 'payment.simulatorJitterMaxMs': 5000 });
    for (let i = 0; i < 200; i++) {
      const v = p.jitterMs();
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(5000);
    }
  });

  describe('scheduleAutoConfirm', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('desactivado (default) → NO entrega webhook aunque pase el tiempo', () => {
      const p = makeProvider({ 'payment.simulatorAutoConfirm': false });
      const deliver = jest.fn().mockResolvedValue(undefined);
      p.scheduleAutoConfirm('ref-x', deliver);
      jest.advanceTimersByTime(10_000);
      expect(deliver).not.toHaveBeenCalled();
    });

    it('activado → tras el jitter entrega un payment.succeeded FIRMADO para ese providerRef', () => {
      const p = makeProvider({
        'payment.simulatorAutoConfirm': true,
        'payment.simulatorJitterMinMs': 1000,
        'payment.simulatorJitterMaxMs': 5000,
      });
      const deliver = jest.fn().mockResolvedValue(undefined);
      p.scheduleAutoConfirm('ref-y', deliver);
      expect(deliver).not.toHaveBeenCalled(); // aún no vence el jitter
      jest.advanceTimersByTime(5000); // >= max jitter
      expect(deliver).toHaveBeenCalledTimes(1);
      const [payload, signature] = deliver.mock.calls[0];
      expect(payload).toMatchObject({ type: 'payment.succeeded', providerRef: 'ref-y' });
      expect(typeof payload.id).toBe('string');
      // Firma HMAC válida sobre los campos canónicos (el handler la verificará).
      expect(signature).toBe(hmacSha256(SECRET, `${payload.id}.payment.succeeded.ref-y`));
    });
  });
});
