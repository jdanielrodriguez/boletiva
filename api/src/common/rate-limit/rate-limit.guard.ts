import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { clientIp } from '../utils/client-ip';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
  SKIP_RATE_LIMIT_KEY,
} from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

/**
 * Guard GLOBAL de rate-limit por IP. Corre PRIMERO (antes de auth) para frenar floods
 * sin gastar en autenticación. Aplica el límite específico del endpoint (`@RateLimit`)
 * o, si no hay, el techo global por minuto. `@SkipRateLimit` exime (webhooks/SSE/health).
 * 429 con Retry-After. No-op si `RATE_LIMIT_ENABLED=false`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.rateLimit.isEnabled) return true;
    if (context.getType() !== 'http') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = clientIp(req) ?? 'unknown';

    const opts = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const scope = opts?.scope ?? `${req.method}:${(req.route as { path?: string })?.path ?? req.path}`;
    const limit = opts?.limit ?? this.rateLimit.globalPerMinute;
    const windowSec = opts?.windowSec ?? 60;

    const { allowed, retryAfter } = await this.rateLimit.hit(`${scope}:${ip}`, limit, windowSec);
    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        'Demasiadas solicitudes. Intenta de nuevo en un momento.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
