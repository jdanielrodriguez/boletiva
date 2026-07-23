import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infra/redis/redis.service';
import { RateLimitService } from './rate-limit.service';

/**
 * Rate-limit fail-SAFE (QA auth-H4): con Redis vivo usa Redis; si Redis CAE, el límite NO
 * se abre — cae al respaldo en memoria y sigue bloqueando la fuerza bruta.
 */
describe('RateLimitService', () => {
  const config = { get: (k: string) => (k === 'rateLimit.enabled' ? true : undefined) } as unknown as ConfigService;

  /** Redis en memoria simple (INCR/EXPIRE/PTTL/GET/DEL) para el camino feliz. */
  function fakeRedisUp() {
    const store = new Map<string, number>();
    const client = {
      incr: (k: string) => Promise.resolve(store.set(k, (store.get(k) ?? 0) + 1).get(k) as number),
      expire: () => Promise.resolve(1),
      pttl: () => Promise.resolve(60000),
      get: (k: string) => Promise.resolve(store.has(k) ? String(store.get(k)) : null),
      del: (k: string) => Promise.resolve(store.delete(k) ? 1 : 0),
    };
    return { getClient: () => client } as unknown as RedisService;
  }

  /** Redis caído: cualquier uso del cliente lanza. */
  const fakeRedisDown = {
    getClient: () => {
      throw new Error('Redis down');
    },
  } as unknown as RedisService;

  it('Redis vivo: permite hasta el límite y bloquea al excederlo', async () => {
    const svc = new RateLimitService(fakeRedisUp(), config);
    expect((await svc.hit('k', 2, 60)).allowed).toBe(true); // 1
    expect((await svc.hit('k', 2, 60)).allowed).toBe(true); // 2
    const blocked = await svc.hit('k', 2, 60); // 3 > 2
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('FAIL-SAFE: con Redis caído NO se abre — bloquea vía respaldo en memoria', async () => {
    const svc = new RateLimitService(fakeRedisDown, config);
    expect((await svc.hit('brute', 3, 60)).allowed).toBe(true); // 1
    expect((await svc.hit('brute', 3, 60)).allowed).toBe(true); // 2
    expect((await svc.hit('brute', 3, 60)).allowed).toBe(true); // 3
    const blocked = await svc.hit('brute', 3, 60); // 4 > 3 → bloqueado en memoria
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('FAIL-SAFE: count() refleja el respaldo en memoria y clear() lo resetea', async () => {
    const svc = new RateLimitService(fakeRedisDown, config);
    await svc.register('acc', 60);
    await svc.register('acc', 60);
    expect(await svc.count('acc')).toBe(2);
    await svc.clear('acc');
    expect(await svc.count('acc')).toBe(0);
  });

  it('deshabilitado (test): siempre permite', async () => {
    const off = { get: () => false } as unknown as ConfigService;
    const svc = new RateLimitService(fakeRedisDown, off);
    expect((await svc.hit('x', 1, 60)).allowed).toBe(true);
    expect((await svc.hit('x', 1, 60)).allowed).toBe(true);
  });
});
