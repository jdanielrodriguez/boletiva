import { Module } from '@nestjs/common';
import { PromotersModule } from '../promoters/promoters.module';
import { PricingModule } from '../pricing/pricing.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [PromotersModule, PricingModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
