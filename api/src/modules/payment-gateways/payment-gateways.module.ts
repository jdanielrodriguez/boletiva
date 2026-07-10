import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentGatewaysController } from './payment-gateways.controller';
import { PaymentGatewaysService } from './payment-gateways.service';

/** Global: pricing y payments consultan la pasarela activa/default. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PaymentGatewaysController],
  providers: [PaymentGatewaysService],
  exports: [PaymentGatewaysService],
})
export class PaymentGatewaysModule {}
