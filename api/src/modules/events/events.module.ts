import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromotersModule } from '../promoters/promoters.module';
import { PricingModule } from '../pricing/pricing.module';
import { EventsController } from './events.controller';
import { EventEditUnlockController } from './edit-unlock.controller';
import { EventsService } from './events.service';
import { EditUnlockService } from './edit-unlock.service';

@Module({
  imports: [AuthModule, PromotersModule, PricingModule],
  controllers: [EventsController, EventEditUnlockController],
  providers: [EventsService, EditUnlockService],
  exports: [EventsService, EditUnlockService],
})
export class EventsModule {}
