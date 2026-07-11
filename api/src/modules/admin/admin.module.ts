import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
import { ImpersonationService } from './impersonation.service';

/**
 * Consola de administración (v3.8). Hoy expone la IMPERSONACIÓN de promotores
 * (soporte técnico). PrismaService y AuditService son globales; JwtModule se
 * registra localmente para firmar el token de impersonación.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminController],
  providers: [ImpersonationService],
})
export class AdminModule {}
