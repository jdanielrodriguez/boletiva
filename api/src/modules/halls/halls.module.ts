import { Module } from '@nestjs/common';
import { HallsController } from './halls.controller';
import { HallsService } from './halls.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [HallsController],
  providers: [HallsService],
  exports: [HallsService],
})
export class HallsModule {}
