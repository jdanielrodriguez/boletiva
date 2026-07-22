import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * El ADMINISTRADOR ve todo lo del cliente pero NO puede actuar como comprador real:
 * no crea órdenes, no paga ni agrega tarjetas (regla de negocio). El promotor, el
 * asesor y el comprador SÍ pueden comprar como cualquier cliente. Se aplica a los
 * endpoints de compra/pago/medios de pago. Corre tras la autenticación (req.user listo).
 */
@Injectable()
export class NoAdminPurchaseGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (user?.roles?.includes(Role.admin)) {
      throw new ForbiddenException(
        'El administrador no puede comprar ni registrar medios de pago; usa una cuenta de cliente para probar el flujo de compra.',
      );
    }
    return true;
  }
}
