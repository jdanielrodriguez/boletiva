import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  imports: [EventsModule],
  controllers: [MediaController],
  providers: [MediaService],
})
export class MediaModule {}
