import { Module } from '@nestjs/common';
import { AdvisorController } from './advisor.controller';
import { AdvisorUnlockService } from './advisor-unlock.service';

/**
 * Rol ASESOR (B2). Provee el servicio de desbloqueo (lo usa el controller y el
 * `AdvisorUnlockGuard` global registrado en AppModule). El asesor hereda permisos de
 * admin (RolesGuard) salvo endpoints `@AdminOnly()`; muta con ventana aprobada.
 */
@Module({
  controllers: [AdvisorController],
  providers: [AdvisorUnlockService],
  exports: [AdvisorUnlockService],
})
export class AdvisorModule {}
