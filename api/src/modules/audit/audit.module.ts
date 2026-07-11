import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/**
 * Bitácora de auditoría (v3.8). Global para que cualquier módulo pueda inyectar
 * AuditService.record() y dejar rastro de acciones sensibles (no-repudio).
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
