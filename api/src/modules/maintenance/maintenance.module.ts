import { Global, Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceController } from './maintenance.controller';

/**
 * Módulo del modo mantenimiento (v3.8). Global para que el MaintenanceGuard
 * (registrado como APP_GUARD en AppModule) pueda inyectar MaintenanceService.
 */
@Global()
@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
