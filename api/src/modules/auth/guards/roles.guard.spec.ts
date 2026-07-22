import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { ADMIN_ONLY_KEY } from '../../../common/decorators/admin-only.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  // Reflector consciente de la CLAVE (el guard lee IS_PUBLIC → ADMIN_ONLY → ROLES).
  const build = (meta: { required?: Role[]; adminOnly?: boolean; isPublic?: boolean }) => {
    const reflector = {
      getAllAndOverride: (key: string) => {
        if (key === IS_PUBLIC_KEY) return meta.isPublic;
        if (key === ADMIN_ONLY_KEY) return meta.adminOnly;
        if (key === ROLES_KEY) return meta.required;
        return undefined;
      },
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('permite si no hay roles requeridos', () => {
    expect(build({ required: undefined }).canActivate(ctx({ roles: [Role.buyer] }))).toBe(true);
  });

  it('permite si el usuario tiene un rol requerido', () => {
    expect(build({ required: [Role.admin] }).canActivate(ctx({ roles: [Role.admin] }))).toBe(true);
  });

  it('deniega si el usuario no tiene el rol', () => {
    expect(() => build({ required: [Role.admin] }).canActivate(ctx({ roles: [Role.buyer] }))).toThrow(
      ForbiddenException,
    );
  });

  it('deniega si no hay usuario', () => {
    expect(() => build({ required: [Role.admin] }).canActivate(ctx(undefined))).toThrow(
      ForbiddenException,
    );
  });

  // --- Herencia advisor→admin (B2) ---
  it('el asesor HEREDA admin en un @Roles(admin) normal (sin @AdminOnly)', () => {
    expect(build({ required: [Role.admin] }).canActivate(ctx({ roles: [Role.advisor] }))).toBe(true);
  });

  // --- @AdminOnly: exige admin por sí mismo (QA) ---
  it('@AdminOnly: admin pasa', () => {
    expect(build({ adminOnly: true, required: [Role.admin] }).canActivate(ctx({ roles: [Role.admin] }))).toBe(true);
  });

  it('@AdminOnly: el ASESOR NO pasa (aunque herede admin en otros)', () => {
    expect(() =>
      build({ adminOnly: true, required: [Role.admin] }).canActivate(ctx({ roles: [Role.advisor] })),
    ).toThrow(ForbiddenException);
  });

  it('@AdminOnly SIN @Roles: un autenticado no-admin NO pasa (cierra el hueco del guard)', () => {
    expect(() => build({ adminOnly: true }).canActivate(ctx({ roles: [Role.buyer] }))).toThrow(
      ForbiddenException,
    );
  });

  // --- @Public: se salta todo (aunque la clase sea @AdminOnly, p.ej. GET /maintenance) ---
  it('@Public: pasa aunque sea @AdminOnly y no haya usuario', () => {
    expect(build({ isPublic: true, adminOnly: true }).canActivate(ctx(undefined))).toBe(true);
  });
});
