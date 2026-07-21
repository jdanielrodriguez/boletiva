import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: AuthUser['roles'];
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
