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
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      // Header Bearer (default) o, como fallback, ?access_token= en la query: los
      // endpoints SSE se consumen con EventSource, que NO puede enviar headers. El
      // token se valida igual (firma+expiración); los clientes normales usan el header.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('access_token'),
      ]),
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
    };
  }
}
