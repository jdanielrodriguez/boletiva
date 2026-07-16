import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, restoreEnv, SEED } from './utils';

/**
 * Anti-spoof (hallazgo 3.6): SIN `trust proxy`, un cliente NO puede evadir el límite
 * de reservas por IP mandando un X-Forwarded-For falso distinto en cada petición.
 * Como Express no confía en XFF, `req.ip` es el socket real (el mismo para todas) →
 * la 2ª reserva desde el mismo socket, aunque cambie el XFF, recibe 429.
 */
describe('Reserva anónima: XFF spoofeado se ignora sin trust proxy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let eventId: string;
  let localityId: string;
  const stamp = Date.now();
  const prevLimit = process.env.RESERVATION_ANON_LIMIT;
  const prevTrustProxy = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.RESERVATION_ANON_LIMIT = 'true';
    process.env.RESERVATION_ANON_COOLDOWN_SECONDS = '2';
    process.env.TRUST_PROXY = 'false'; // NO confiar en XFF → req.ip = socket real
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    // Limpia claves anti-abuso de corridas previas (el socket loopback se comparte).
    const existing = await redis.getClient().keys('res:ip:*');
    if (existing.length) await redis.getClient().del(...existing);
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `RESSPOOF ${stamp}`,
        slug: `resspoof-${stamp}`,
        startsAt: new Date('2028-11-01T20:00:00-06:00'),
        endsAt: new Date('2028-11-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'General', slug: 'g', kind: 'general', desiredNet: 100, capacity: 50 },
    });
    localityId = loc.id;
    await prisma.seat.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ localityId: loc.id, label: `GA-${i + 1}` })),
    });
  });

  afterAll(async () => {
    // Limpia la clave del socket real (loopback) que use este entorno.
    const c = redis.getClient();
    const keys = await c.keys('res:ip:*');
    if (keys.length) await c.del(...keys);
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    restoreEnv('RESERVATION_ANON_LIMIT', prevLimit);
    restoreEnv('TRUST_PROXY', prevTrustProxy);
    await app.close();
  });

  it('dos reservas con XFF distinto pero mismo socket → la 2ª es 429 (no se evade)', async () => {
    const reserve = (spoofedIp: string) =>
      request(app.getHttpServer())
        .post(`/api/v1/events/${eventId}/reservations`)
        .set('X-Forwarded-For', spoofedIp)
        .send({ localityId, quantity: 1 });

    await reserve('1.2.3.4').expect(201);
    // XFF distinto pero el socket es el mismo → NO evade el límite.
    await reserve('5.6.7.8').expect(429);
  });
});
