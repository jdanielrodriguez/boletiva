import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ALLOW_DURING_MAINTENANCE } from '../../common/decorators/maintenance.decorator';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MaintenanceService } from './maintenance.service';

/**
 * Guard GLOBAL de mantenimiento (v3.8). Cuando el modo mantenimiento está activo
 * responde 503 a TODO request EXCEPTO:
 *  - rutas marcadas con @AllowDuringMaintenance() (estado público, health, auth),
 *  - un admin autenticado (bypass: para que pueda entrar y desactivarlo).
 *
 * Debe registrarse DESPUÉS del JwtAuthGuard (para que `request.user` ya esté
 * poblado en las rutas protegidas) y ANTES de RolesGuard/VerifiedEmailGuard (el 503
 * corta antes de comprobar rol/correo). El bypass de admin solo aplica a rutas
 * protegidas (las públicas no autentican → sin user → 503 salvo allowlist).
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly maintenance: MaintenanceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_MAINTENANCE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const { enabled, message } = await this.maintenance.getStatus();
    if (!enabled) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (user?.roles?.includes(Role.admin)) return true;

    throw new ServiceUnavailableException({
      statusCode: 503,
      error: 'Service Unavailable',
      maintenance: true,
      message: message || 'La plataforma está en mantenimiento. Vuelve en unos minutos.',
    });
  }
}
