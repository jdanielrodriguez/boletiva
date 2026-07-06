import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER } from './payment.provider';
import { SimulatorPaymentProvider } from './providers/simulator.provider';

/**
 * El proveedor activo se resuelve por PAYMENT_PROVIDER. Hoy: simulador. Al
 * integrar Pagalo/Stripe se cambia aquí (o por config) sin tocar el servicio.
 */
@Module({
  imports: [PricingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: PAYMENT_PROVIDER, useClass: SimulatorPaymentProvider }],
  exports: [PaymentsService],
})
export class PaymentsModule {}
