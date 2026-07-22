import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * El ADMINISTRADOR ve todo lo del cliente pero NO puede actuar como comprador real:
 * no crea órdenes, no paga ni agrega tarjetas (regla de negocio). El promotor, el
 * asesor y el comprador SÍ pueden comprar como cualquier cliente. Se aplica a los
 * endpoints de compra/pago/medios de pago. Corre tras la autenticación (req.user listo).
 *
 * También corta las sesiones de IMPERSONACIÓN: un admin suplantando a un promotor tampoco
 * puede comprar/registrar tarjetas en la cuenta ajena (el token impersonado lleva los roles
 * del promotor, así que el chequeo de rol admin NO lo atrapa → hay que mirar impersonation).
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
    if (user?.impersonatedBy || user?.impersonation) {
      throw new ForbiddenException(
        'No se puede comprar ni registrar medios de pago en una sesión de impersonación; usa tu sesión real.',
      );
    }
    return true;
  }
}
