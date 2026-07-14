import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../infra/integrations/integrations.service';
import { PricingModule } from '../pricing/pricing.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { SimulatorPaymentProvider } from './providers/simulator.provider';
import { RecurrentePaymentProvider } from './providers/recurrente.provider';
import { PagaloPaymentProvider } from './providers/pagalo.provider';

/**
 * El proveedor activo se resuelve por `payment.provider` (env PAYMENT_PROVIDER):
 * 'simulator' (default) | 'recurrente' | 'pagalo'. La selección NO valida credenciales al
 * arrancar: si se elige recurrente/pagalo sin credenciales, el 503 "servicio no disponible"
 * salta al intentar COBRAR (assertAvailable dentro de createPayment), no en el bootstrap.
 * Importa TicketsModule para emitir boletos (tras el pago) y revocarlos (reembolso).
 */
export function paymentProviderFactory(
  config: ConfigService,
  integrations: IntegrationsService,
): PaymentProvider {
  const selected = (config.get<string>('payment.provider') ?? 'simulator').toLowerCase();
  switch (selected) {
    case 'recurrente':
      return new RecurrentePaymentProvider(config, integrations);
    case 'pagalo':
      return new PagaloPaymentProvider(config, integrations);
    case 'simulator':
      return new SimulatorPaymentProvider(config);
    default:
      new Logger('PaymentsModule').warn(
        `payment.provider="${selected}" desconocido; usando el simulador por defecto`,
      );
      return new SimulatorPaymentProvider(config);
  }
}

@Module({
  imports: [PricingModule, TicketsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: paymentProviderFactory,
      inject: [ConfigService, IntegrationsService],
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
