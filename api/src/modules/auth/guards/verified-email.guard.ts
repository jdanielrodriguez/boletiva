import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_VERIFIED_EMAIL } from '../../../common/decorators/verified-email.decorator';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/** Bloquea acciones marcadas con @RequireVerifiedEmail() si el correo no está verificado. */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Correo no verificado');
    const record = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { emailVerifiedAt: true },
    });
    if (!record?.emailVerifiedAt) {
      throw new ForbiddenException('Debes verificar tu correo para realizar esta acción');
    }
    return true;
  }
}
