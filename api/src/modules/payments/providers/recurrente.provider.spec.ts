import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { RecurrentePaymentProvider } from './recurrente.provider';

function makeIntegrations(available: boolean): IntegrationsService {
  return {
    available: () => available,
    assertAvailable: () => {
      if (!available) {
        throw new ServiceUnavailableException('Servicio no disponible: la pasarela Recurrente…');
      }
    },
  } as unknown as IntegrationsService;
}

describe('RecurrentePaymentProvider (env-only, diferido)', () => {
  const config = { get: () => undefined, getOrThrow: () => undefined } as unknown as ConfigService;

  it('se llama recurrente', () => {
    const p = new RecurrentePaymentProvider(config, makeIntegrations(false));
    expect(p.name).toBe('recurrente');
  });

  it('sin credenciales → createPayment lanza ServiceUnavailableException (503)', async () => {
    const p = new RecurrentePaymentProvider(config, makeIntegrations(false));
    await expect(
      p.createPayment({ providerRef: 'r1', orderId: 'o1', amount: '129.68', currency: 'GTQ' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
