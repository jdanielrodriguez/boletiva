import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, restoreEnv } from './utils';

/**
 * Rate-limit global por IP (hallazgo 0). Enciende el guard con un techo bajo y prueba:
 * (a) un endpoint público corta con 429 + Retry-After al exceder; (b) las rutas
 * exentas (@SkipRateLimit: health) nunca se cortan; (c) IPs distintas cuentan aparte.
 */
describe('Rate-limit global por IP (e2e)', () => {
  let app: INestApplication;
  let redis: RedisService;
  const prevEnabled = process.env.RATE_LIMIT_ENABLED;
  const prevGlobal = process.env.RATE_LIMIT_GLOBAL_PER_MIN;
  const prevTrustProxy = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_GLOBAL_PER_MIN = '3';
    process.env.TRUST_PROXY = 'true'; // XFF define la IP → buckets por IP de prueba
    app = await createTestApp();
    redis = app.get(RedisService);
    const keys = await redis.getClient().keys('rl:*');
    if (keys.length) await redis.getClient().del(...keys);
  });

  afterAll(async () => {
    const keys = await redis.getClient().keys('rl:*');
    if (keys.length) await redis.getClient().del(...keys);
    restoreEnv('RATE_LIMIT_ENABLED', prevEnabled);
    restoreEnv('RATE_LIMIT_GLOBAL_PER_MIN', prevGlobal);
    restoreEnv('TRUST_PROXY', prevTrustProxy);
    await app.close();
  });

  const hit = (ip: string) =>
    request(app.getHttpServer()).get('/api/v1/public/config').set('X-Forwarded-For', ip);

  it('excede el techo global → 429 con Retry-After', async () => {
    await hit('10.0.0.1').expect(200);
    await hit('10.0.0.1').expect(200);
    await hit('10.0.0.1').expect(200);
    const res = await hit('10.0.0.1').expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('otra IP tiene su propio cupo (no la afecta la primera)', async () => {
    await hit('10.0.0.2').expect(200);
  });

  it('health está exento (@SkipRateLimit): no corta aunque se exceda', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .get('/api/v1/health/live')
        .set('X-Forwarded-For', '10.0.0.3')
        .expect(200);
    }
  });
});
