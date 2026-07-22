import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
}

/**
 * Verificación ÚNICA de un ACCESS token para los canales que NO pasan por el
 * `JwtAuthGuard` HTTP: WebSockets (socket.io) y SSE (EventSource no envía headers, así
 * que la ruta es `@Public()` y verifica el token a mano). Comprueba firma+expiración
 * con el secreto de acceso y RECHAZA cualquier token que no sea de acceso —p.ej. el
 * preauth `typ:'2fa'` emitido tras la contraseña pero antes de completar el 2FA— aunque
 * comparta el secreto. Devuelve null si es inválido o no es un access token.
 *
 * En HTTP esta regla ya está centralizada en `JwtStrategy.validate` (guard global); este
 * helper evita "quemar" la misma validación en cada gateway/controlador de socket/SSE.
 */
export function verifyAccessToken(
  jwt: JwtService,
  secret: string,
  token?: string,
): AccessTokenClaims | null {
  if (!token) return null;
  try {
    const p = jwt.verify<{ sub?: string; roles?: Role[]; typ?: string }>(token, { secret });
    if (p.typ || !p.sub) return null; // no-ACCESS (preauth 2FA, etc.) → rechazado
    return { sub: p.sub, roles: p.roles ?? [] };
  } catch {
    return null;
  }
}
