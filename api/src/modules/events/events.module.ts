import { Module } from '@nestjs/common';
import { PromotersModule } from '../promoters/promoters.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [PromotersModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
