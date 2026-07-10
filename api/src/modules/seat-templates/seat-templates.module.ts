import { Module } from '@nestjs/common';
import { SeatTemplatesController } from './seat-templates.controller';
import { SeatTemplatesService } from './seat-templates.service';

@Module({
  controllers: [SeatTemplatesController],
  providers: [SeatTemplatesService],
  exports: [SeatTemplatesService],
})
export class SeatTemplatesModule {}
