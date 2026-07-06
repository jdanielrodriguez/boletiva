import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const build = (required: Role[] | undefined) => {
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('permite si no hay roles requeridos', () => {
    expect(build(undefined).canActivate(ctx({ roles: [Role.buyer] }))).toBe(true);
  });

  it('permite si el usuario tiene un rol requerido', () => {
    expect(build([Role.admin]).canActivate(ctx({ roles: [Role.admin] }))).toBe(true);
  });

  it('deniega si el usuario no tiene el rol', () => {
    expect(() => build([Role.admin]).canActivate(ctx({ roles: [Role.buyer] }))).toThrow(
      ForbiddenException,
    );
  });

  it('deniega si no hay usuario', () => {
    expect(() => build([Role.admin]).canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
