import { Module } from '@nestjs/common';
import { ScopeDashboardService } from './scope-dashboard.service';
import { PromoterDashboardService } from './promoter-dashboard.service';
import { PromoterDashboardExportService } from './promoter-dashboard-export.service';
import { AnalyticsController } from './analytics.controller';

/**
 * Analítica reutilizable (solo-lectura). Expone `ScopeDashboardService` para agregar
 * métricas sobre un conjunto de eventos (alcance de un salón o de una plantilla) sin
 * duplicar la lógica de dinero. Lo importan HallsModule y SeatTemplatesModule.
 *
 * Además sirve el dashboard GLOBAL del promotor (`AnalyticsController` →
 * `PromoterDashboardService` + export a Excel).
 */
@Module({
  controllers: [AnalyticsController],
  providers: [ScopeDashboardService, PromoterDashboardService, PromoterDashboardExportService],
  exports: [ScopeDashboardService],
})
export class AnalyticsModule {}
