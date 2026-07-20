import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { ADMIN_ONLY_KEY } from '../../../common/decorators/admin-only.decorator';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

/** Exige que el usuario tenga al menos uno de los roles requeridos. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('No tienes permisos para esta acción');

    let ok = user.roles?.some((r) => required.includes(r));

    // B2: el ASESOR hereda los permisos del ADMIN, EXCEPTO en endpoints marcados
    // `@AdminOnly()` (tab Sistema + operaciones de sistema/seguridad). Así no hay que
    // añadir `advisor` a decenas de `@Roles(admin)`; se centraliza aquí.
    if (!ok && required.includes(Role.admin) && user.roles?.includes(Role.advisor)) {
      const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!adminOnly) ok = true;
    }

    if (!ok) throw new ForbiddenException('No tienes permisos para esta acción');
    return true;
  }
}
