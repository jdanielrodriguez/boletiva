import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infra/redis/redis.service';

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos hasta que se libera la ventana (para el header Retry-After). */
  retryAfter: number;
}

/**
 * Rate-limiting por ventana fija sobre Redis (INCR + EXPIRE). Contadores efímeros por
 * clave (`rl:<scope>:<ip>`). Env-gated: con `RATE_LIMIT_ENABLED=false` (test) SIEMPRE
 * permite. Es defensa best-effort: si Redis falla, NO bloquea el tráfico (fail-open).
 */
@Injectable()
export class RateLimitService {
  private readonly enabled: boolean;
  readonly globalPerMinute: number;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('rateLimit.enabled') ?? true;
    this.globalPerMinute = config.get<number>('rateLimit.globalPerMinute') ?? 300;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Registra un golpe y dice si excede el `limit` dentro de la ventana `windowSec`. */
  async hit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    if (!this.enabled) return { allowed: true, retryAfter: 0 };
    try {
      const client = this.redis.getClient();
      const rkey = `rl:${key}`;
      const n = await client.incr(rkey);
      if (n === 1) await client.expire(rkey, windowSec);
      if (n > limit) {
        const pttl = await client.pttl(rkey);
        const retryAfter = Math.ceil((pttl > 0 ? pttl : windowSec * 1000) / 1000);
        return { allowed: false, retryAfter };
      }
      return { allowed: true, retryAfter: 0 };
    } catch {
      // Fail-open: un fallo de Redis no debe tumbar el tráfico legítimo.
      return { allowed: true, retryAfter: 0 };
    }
  }
}
