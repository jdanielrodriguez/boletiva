import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthUser {
  userId: string;
  email: string;
  roles: Role[];
  /** Solo en tokens de PUERTA (SafeTix): evento al que está acotado el token. */
  gateEventId?: string;
  /** Solo en tokens de IMPERSONACIÓN (soporte, v3.8): true si el token actúa como
   * otro usuario. */
  impersonation?: boolean;
  /** Solo en tokens de IMPERSONACIÓN: id del admin que originó la sesión. */
  impersonatedBy?: string;
}

/** Inyecta el usuario autenticado (payload del JWT) en el handler. */
export const CurrentUser = createParamDecorator(
  (
    data: keyof AuthUser | undefined,
    ctx: ExecutionContext,
  ): AuthUser | AuthUser[keyof AuthUser] => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
