import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../infra/integrations/integrations.service';
import { paymentProviderFactory } from './payments.module';
import { SimulatorPaymentProvider } from './providers/simulator.provider';
import { RecurrentePaymentProvider } from './providers/recurrente.provider';
import { PagaloPaymentProvider } from './providers/pagalo.provider';

function configWith(provider: string | undefined): ConfigService {
  return { get: (k: string) => (k === 'payment.provider' ? provider : undefined) } as unknown as ConfigService;
}

const integrations = {} as IntegrationsService;

describe('paymentProviderFactory — selección por config', () => {
  it("'simulator' → SimulatorPaymentProvider", () => {
    expect(paymentProviderFactory(configWith('simulator'), integrations)).toBeInstanceOf(
      SimulatorPaymentProvider,
    );
  });

  it("'recurrente' → RecurrentePaymentProvider", () => {
    expect(paymentProviderFactory(configWith('recurrente'), integrations)).toBeInstanceOf(
      RecurrentePaymentProvider,
    );
  });

  it("'pagalo' → PagaloPaymentProvider", () => {
    expect(paymentProviderFactory(configWith('pagalo'), integrations)).toBeInstanceOf(
      PagaloPaymentProvider,
    );
  });

  it('sin config (undefined) → simulador por defecto', () => {
    expect(paymentProviderFactory(configWith(undefined), integrations)).toBeInstanceOf(
      SimulatorPaymentProvider,
    );
  });

  it('valor desconocido → simulador por defecto', () => {
    expect(paymentProviderFactory(configWith('stripe-x'), integrations)).toBeInstanceOf(
      SimulatorPaymentProvider,
    );
  });
});
