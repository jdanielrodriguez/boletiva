import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { VenuesService } from './venues.service';
import { LocalitiesController, SeatMapsController, SeatsController } from './venues.controllers';

@Module({
  imports: [EventsModule],
  controllers: [LocalitiesController, SeatsController, SeatMapsController],
  providers: [VenuesService],
})
export class VenuesModule {}
