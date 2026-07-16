import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersModule } from '../orders/orders.module';
import { PricingModule } from '../pricing/pricing.module';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [InventoryModule, OrdersModule, PricingModule, JwtModule.register({})],
  controllers: [ReservationsController],
  providers: [ReservationsService],
})
export class ReservationsModule {}
