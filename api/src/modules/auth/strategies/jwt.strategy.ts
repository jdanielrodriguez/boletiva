import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: AuthUser['roles'];
  /** Tipo del token. Los ACCESS no lo llevan; el preauth de 2FA usa `typ:'2fa'`. */
  typ?: string;
  /** Solo en tokens de puerta SafeTix: evento al que está acotado el token. */
  gateEventId?: string;
  /** Solo en gate-tokens de VALIDADOR: sesión "último gana" (sid) del enlace. */
  sid?: string;
  /** Solo en tokens de IMPERSONACIÓN (soporte, v3.8). */
  impersonation?: boolean;
  impersonatedBy?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      // SOLO header Bearer. NO se acepta ?access_token= en la query de forma global
      // (QA: un token en la URL se filtra por access logs / Referer / historial). Los
      // endpoints SSE (que se consumen con EventSource, sin headers) son `@Public()` y
      // resuelven su propia auth con un ticket de un solo uso (o token) que verifican
      // manualmente — no dependen de este extractor.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  // Lo retornado se adjunta a request.user.
  validate(payload: JwtPayload): AuthUser {
    // Seguridad (QA T5-H1): el ACCESS token nunca lleva `typ`. Un token de otro tipo
    // firmado con el mismo secreto —p.ej. el preauth `typ:'2fa'` emitido tras la
    // contraseña pero ANTES de completar el 2FA— NO debe valer como Bearer en la API.
    if (payload.typ) {
      throw new UnauthorizedException('Token no válido para esta operación');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      roles: payload.roles,
      gateEventId: payload.gateEventId,
      sid: payload.sid,
      impersonation: payload.impersonation,
      impersonatedBy: payload.impersonatedBy,
    };
  }
}
