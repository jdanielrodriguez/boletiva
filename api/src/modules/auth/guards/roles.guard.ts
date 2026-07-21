import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { ADMIN_ONLY_KEY } from '../../../common/decorators/admin-only.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

/** Exige que el usuario tenga al menos uno de los roles requeridos. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Rutas públicas: el JwtAuthGuard ya las dejó pasar; aquí no hay nada que exigir
    // (aunque estén bajo una clase @AdminOnly, p.ej. GET /maintenance es @Public).
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Endurecimiento (QA): `@AdminOnly` EXIGE admin por sí mismo. Antes solo se
    // consultaba dentro de la herencia advisor→admin y requería un `@Roles(admin)`
    // presente; un handler @AdminOnly SIN @Roles quedaba abierto a cualquier
    // autenticado (audit.confirm, payment-gateways.active, admin.stop). Ahora un
    // endpoint @AdminOnly (no público) exige rol admin siempre.
    if (adminOnly) {
      const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
      if (!user?.roles?.includes(Role.admin)) {
        throw new ForbiddenException('No tienes permisos para esta acción');
      }
      return true;
    }

    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('No tienes permisos para esta acción');

    let ok = user.roles?.some((r) => required.includes(r));

    // B2: el ASESOR hereda los permisos del ADMIN, EXCEPTO en endpoints `@AdminOnly()`
    // (ya cortados arriba con 403). Aquí `adminOnly` es siempre false, así que el asesor
    // hereda admin en los `@Roles(admin)` normales. Así no hay que añadir `advisor` a
    // decenas de `@Roles(admin)`; se centraliza aquí.
    if (!ok && required.includes(Role.admin) && user.roles?.includes(Role.advisor)) {
      ok = true;
    }

    if (!ok) throw new ForbiddenException('No tienes permisos para esta acción');
    return true;
  }
}
