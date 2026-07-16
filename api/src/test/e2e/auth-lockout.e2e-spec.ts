import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, restoreEnv } from './utils';

/**
 * Lockout de login por CUENTA (hallazgo 3.1): defensa contra fuerza bruta DISTRIBUIDA
 * (muchas IPs contra una cuenta). Usa un correo inexistente y una IP distinta por intento
 * (para aislar del rate-limit por IP): tras 10 fallos, el 11º da 429 aunque cambie la IP.
 */
describe('Lockout de login por cuenta (e2e)', () => {
  let app: INestApplication;
  let redis: RedisService;
  const email = `lockout-${Date.now()}@example.com`;
  const prevRl = process.env.RATE_LIMIT_ENABLED;
  const prevTp = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_GLOBAL_PER_MIN = '1000'; // no estorbar con el techo global
    process.env.TRUST_PROXY = 'true';
    app = await createTestApp();
    redis = app.get(RedisService);
    const keys = await redis.getClient().keys('rl:*');
    if (keys.length) await redis.getClient().del(...keys);
  });

  afterAll(async () => {
    const keys = await redis.getClient().keys('rl:*');
    if (keys.length) await redis.getClient().del(...keys);
    restoreEnv('RATE_LIMIT_ENABLED', prevRl);
    restoreEnv('TRUST_PROXY', prevTp);
    await app.close();
  });

  const attempt = (ip: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Device-Id', 'lockout-dev')
      .set('X-Forwarded-For', ip)
      .send({ email, password: 'WrongPassword1' });

  it('10 fallos (IPs distintas) → 401; el 11º → 429 (cuenta bloqueada)', async () => {
    for (let i = 0; i < 10; i++) {
      await attempt(`198.51.100.${i + 1}`).expect(401);
    }
    // Umbral superado: aunque la IP sea nueva, la CUENTA está bloqueada.
    await attempt('198.51.100.200').expect(429);
  });
});
