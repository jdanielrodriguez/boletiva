import { Module } from '@nestjs/common';
import { ScopeDashboardService } from './scope-dashboard.service';

/**
 * Analítica reutilizable (solo-lectura). Expone `ScopeDashboardService` para agregar
 * métricas sobre un conjunto de eventos (alcance de un salón o de una plantilla) sin
 * duplicar la lógica de dinero. Lo importan HallsModule y SeatTemplatesModule.
 */
@Module({
  providers: [ScopeDashboardService],
  exports: [ScopeDashboardService],
})
export class AnalyticsModule {}
