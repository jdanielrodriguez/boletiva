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
 * permite. **FAIL-SAFE (QA auth-H4):** si Redis no responde, el límite NO se abre — cae a
 * un respaldo EN MEMORIA (por instancia) para que login/2FA sigan protegidos contra fuerza
 * bruta. El respaldo no es global entre réplicas, pero corta el abuso desde una IP en cada una.
 */
@Injectable()
export class RateLimitService {
  private readonly enabled: boolean;
  readonly globalPerMinute: number;
  /** Respaldo en memoria (ventana fija) usado SOLO cuando Redis falla. */
  private readonly mem = new Map<string, { count: number; resetAt: number }>();

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

  // --- Respaldo en memoria (solo si Redis está caído) ---
  private memEntry(key: string, windowSec: number): { count: number; resetAt: number } {
    const now = Date.now();
    let e = this.mem.get(key);
    if (!e || now >= e.resetAt) {
      e = { count: 0, resetAt: now + windowSec * 1000 };
      this.mem.set(key, e);
    }
    // Cota anti-OOM (solo se llena con Redis caído): poda perezosa de entradas vencidas.
    if (this.mem.size > 50000) for (const [k, v] of this.mem) if (now >= v.resetAt) this.mem.delete(k);
    return e;
  }

  private memHit(key: string, limit: number, windowSec: number): RateLimitResult {
    const e = this.memEntry(key, windowSec);
    e.count += 1;
    if (e.count > limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000)) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Contador actual de una clave (0 si no existe o el rate-limit está apagado). Para
   * lockouts (p.ej. fallos de login por cuenta) donde se quiere consultar sin incrementar.
   */
  async count(key: string): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const v = await this.redis.getClient().get(`rl:${key}`);
      return v ? parseInt(v, 10) : 0;
    } catch {
      const e = this.mem.get(key); // fail-safe: consulta el respaldo en memoria
      return e && Date.now() < e.resetAt ? e.count : 0;
    }
  }

  /** Incrementa una clave (fija la expiración en el 1er golpe) y devuelve el nuevo valor. */
  async register(key: string, windowSec: number): Promise<number> {
    if (!this.enabled) return 0;
    try {
      const client = this.redis.getClient();
      const rkey = `rl:${key}`;
      const n = await client.incr(rkey);
      if (n === 1) await client.expire(rkey, windowSec);
      return n;
    } catch {
      const e = this.memEntry(key, windowSec); // fail-safe en memoria
      e.count += 1;
      return e.count;
    }
  }

  /** Borra una clave (p.ej. al loguear con éxito, resetea el contador de fallos). */
  async clear(key: string): Promise<void> {
    this.mem.delete(key); // limpia también el respaldo en memoria
    if (!this.enabled) return;
    try {
      await this.redis.getClient().del(`rl:${key}`);
    } catch {
      /* best-effort */
    }
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
      // FAIL-SAFE (auth-H4): Redis caído → el límite sigue aplicando EN MEMORIA (por instancia).
      return this.memHit(key, limit, windowSec);
    }
  }
}
