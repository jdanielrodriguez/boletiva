import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { OrdersController } from './orders.controller';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import { SettlementService } from './settlement.service';

@Module({
  imports: [PricingModule],
  controllers: [OrdersController],
  providers: [CheckoutService, OrdersService, SettlementService],
  exports: [CheckoutService],
})
export class OrdersModule {}
