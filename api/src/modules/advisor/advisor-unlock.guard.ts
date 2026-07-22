import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { SKIP_ADVISOR_UNLOCK_KEY } from '../../common/decorators/skip-advisor-unlock.decorator';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AdvisorUnlockService } from './advisor-unlock.service';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Guard GLOBAL (B2): un ASESOR que hereda permisos de admin solo puede MUTAR en
 * endpoints de ÁREA ADMIN si tiene una ventana de desbloqueo aprobada (salvo que
 * `advisor.lock_enabled=false`). Alcance mínimo para no molestar el resto:
 *  - Solo aplica si el actor es asesor y NO admin.
 *  - Solo a métodos de mutación (GET/HEAD/OPTIONS pasan siempre → lectura libre).
 *  - Solo a endpoints cuyo `@Roles` incluye `admin` (área admin). Los propios del
 *    asesor (perfil, solicitar desbloqueo, chat) no piden `admin` → pasan.
 * Corre después de la autenticación (req.user ya está).
 */
@Injectable()
export class AdvisorUnlockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly unlock: AdvisorUnlockService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) return true; // sin sesión → lo maneja el JwtAuthGuard
    if (user.roles?.includes(Role.admin) || !user.roles?.includes(Role.advisor)) return true;
    if (!MUTATION_METHODS.has(req.method)) return true;

    // Dominio propio del asesor (p.ej. atender tickets de soporte): no exige desbloqueo.
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ADVISOR_UNLOCK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || !required.includes(Role.admin)) return true; // no es mutación de área admin

    if (!(await this.unlock.lockEnabled())) return true;
    if (await this.unlock.isUnlocked(user.userId)) return true;
    throw new ForbiddenException(
      'Como asesor necesitas un desbloqueo aprobado por un administrador para esta acción',
    );
  }
}
