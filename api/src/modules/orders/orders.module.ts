import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { TicketsModule } from '../tickets/tickets.module';
import { OrdersController } from './orders.controller';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import { SettlementService } from './settlement.service';
import { SettlementExportService } from './settlement-export.service';
import { EventRefundsService } from './event-refunds.service';
import { EventSettlementMailService } from './event-settlement-mail.service';
import { EventDashboardService } from './event-dashboard.service';
import { OrdersSweeperService } from './orders-sweeper.service';

@Module({
  imports: [PricingModule, TicketsModule],
  controllers: [OrdersController],
  providers: [
    CheckoutService,
    OrdersService,
    OrdersSweeperService,
    SettlementService,
    SettlementExportService,
    EventRefundsService,
    EventSettlementMailService,
    EventDashboardService,
  ],
  exports: [CheckoutService],
})
export class OrdersModule {}
