import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, login, restoreEnv, SEED } from './utils';

/**
 * Anti-abuso de reservas ANÓNIMAS por IP (visitantes sin login): 1 reserva activa
 * por IP a la vez + cooldown tras cancelar. Los usuarios logueados NO tienen límite.
 * El flag se enciende aquí (config se relee al construir la app de test) con un
 * cooldown corto para poder verificar que se libera al vencer.
 */
describe('Límite de reserva por IP (visitantes) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let eventId: string;
  let localityId: string;
  let buyerToken: string;
  const stamp = Date.now();
  const prevLimit = process.env.RESERVATION_ANON_LIMIT;
  const prevCooldown = process.env.RESERVATION_ANON_COOLDOWN_SECONDS;
  const prevTrustProxy = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.RESERVATION_ANON_LIMIT = 'true';
    process.env.RESERVATION_ANON_COOLDOWN_SECONDS = '2'; // cooldown corto para el test
    // Detrás de un proxy confiable: Express resuelve req.ip desde XFF → cada IP de
    // prueba se trata distinta. El caso anti-spoof (sin trust proxy) va en su suite.
    process.env.TRUST_PROXY = 'true';
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `RESIP ${stamp}`,
        slug: `resip-${stamp}`,
        startsAt: new Date('2028-10-01T20:00:00-06:00'),
        endsAt: new Date('2028-10-01T23:00:00-06:00'),
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
    buyerToken = await login(app, SEED.buyer);
  });

  afterAll(async () => {
    // Limpia las claves anti-abuso de las IPs de prueba.
    const c = redis.getClient();
    await c.del(
      'res:ip:active:203.0.113.10',
      'res:ip:cooldown:203.0.113.10',
      'res:ip:active:203.0.113.30',
      'res:ip:cooldown:203.0.113.30',
    );
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    restoreEnv('RESERVATION_ANON_LIMIT', prevLimit);
    restoreEnv('RESERVATION_ANON_COOLDOWN_SECONDS', prevCooldown);
    restoreEnv('TRUST_PROXY', prevTrustProxy);
    await app.close();
  });

  const reserve = (ip: string, token?: string) => {
    const req = request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/reservations`)
      .set('X-Forwarded-For', ip)
      .send({ localityId, quantity: 1 });
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('visitante: 1ª reserva 201; 2ª desde la MISMA IP → 429', async () => {
    await reserve('203.0.113.10').expect(201);
    await reserve('203.0.113.10').expect(429);
  });

  it('cancelar libera la activa e inicia cooldown → nueva reserva 429 (cooldown)', async () => {
    const created = await reserve('203.0.113.30').expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/reservations/${created.body.token}`)
      .set('X-Forwarded-For', '203.0.113.30')
      .expect(200)
      .expect((r) => expect(r.body.cancelled).toBe(true));
    // Aunque ya no hay reserva activa, el cooldown bloquea crear otra de inmediato.
    await reserve('203.0.113.30').expect(429);
    // Tras vencer el cooldown (2 s) vuelve a permitir.
    await new Promise((res) => setTimeout(res, 2300));
    await reserve('203.0.113.30').expect(201);
  });

  it('usuario logueado NO tiene límite (Bearer válido salta el guard por IP)', async () => {
    // La IP .10 ya tiene una reserva activa; con token igual crea → 201.
    await reserve('203.0.113.10', buyerToken).expect(201);
  });
});
