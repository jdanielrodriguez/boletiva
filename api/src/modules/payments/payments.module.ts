import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SimulatorPaymentProvider } from './providers/simulator.provider';
import { RecurrentePaymentProvider } from './providers/recurrente.provider';
import { PagaloPaymentProvider } from './providers/pagalo.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';

/**
 * ENRUTAMIENTO multi-pasarela: se registran las 3 clases provider y un
 * `PaymentProviderRegistry` que elige la correcta según el `provider` del gateway efectivo
 * (o la fuerza por `PAYMENT_PROVIDER` — los e2e fijan 'simulator'). La selección NO valida
 * credenciales al arrancar: recurrente/pagalo sin llaves lanzan 503 al COBRAR
 * (assertAvailable en createPayment), no en el bootstrap. TicketsModule: emisión/revocación.
 */
@Module({
  imports: [PricingModule, TicketsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    SimulatorPaymentProvider,
    RecurrentePaymentProvider,
    PagaloPaymentProvider,
    PaymentProviderRegistry,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
