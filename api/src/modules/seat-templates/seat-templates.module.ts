import { Module } from '@nestjs/common';
import { SeatTemplatesController } from './seat-templates.controller';
import { SeatTemplatesService } from './seat-templates.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [SeatTemplatesController],
  providers: [SeatTemplatesService],
  exports: [SeatTemplatesService],
})
export class SeatTemplatesModule {}
