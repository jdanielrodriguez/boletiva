import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { sha256 } from '../../common/utils/crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, restoreEnv, SEED } from './utils';

/**
 * Anti-abuso de inventario para usuarios AUTENTICADOS:
 *  - 1.1 tope de asientos en reserva simultánea por holder (no acaparar el aforo);
 *  - 2.2 tope de órdenes PENDIENTES de pago por comprador.
 */
describe('Topes de holds y órdenes pending por usuario (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let eventId: string;
  let locId: string;
  let token: string;
  let buyerId: string;
  const stamp = Date.now();
  const prevPending = process.env.ORDERS_MAX_PENDING_PER_BUYER;

  beforeAll(async () => {
    process.env.ORDERS_MAX_PENDING_PER_BUYER = '2'; // bajo, para probar el tope
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `LIMITS ${stamp}`,
        slug: `limits-${stamp}`,
        startsAt: new Date('2029-01-01T20:00:00-06:00'),
        endsAt: new Date('2029-01-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'GA', slug: 'ga', kind: 'general', desiredNet: 100, capacity: 60 },
    });
    locId = loc.id;
    await prisma.seat.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({ localityId: loc.id, label: `GA-${i + 1}` })),
    });
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: buyerId, deviceHash: sha256('limits-dev') } },
      update: { trustedAt: new Date() },
      create: { userId: buyerId, deviceHash: sha256('limits-dev'), trustedAt: new Date() },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Device-Id', 'limits-dev')
      .send({ email: SEED.buyer, password: 'Password123' })
      .expect(200);
    token = login.body.tokens.accessToken;
    // Parte de cero: otras suites de la corrida serial usan SEED.buyer vía /holds y
    // dejan poblado su set de cap `hold:owner:<buyerId>` (TTL 10 min) → limpiarlo aquí
    // para que el tope de 50 asientos simultáneos se mida limpio.
    const stale = await redis.getClient().keys('hold:owner:*');
    if (stale.length) await redis.getClient().del(...stale);
    await redis.getClient().del(`res:seats:u:${buyerId}`);
  });

  afterAll(async () => {
    const keys = await redis.getClient().keys('hold:*');
    if (keys.length) await redis.getClient().del(...keys);
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    restoreEnv('ORDERS_MAX_PENDING_PER_BUYER', prevPending);
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('1.1 hold por cantidad > tope (51) → 400', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(auth())
      .send({ localityId: locId, quantity: 51 })
      .expect(400);
  });

  it('1.1 tope de asientos SIMULTÁNEOS por holder: 50 ok, el siguiente → 409', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(auth())
      .send({ localityId: locId, quantity: 50 })
      .expect(201);
    // Ya tiene 50 en reserva; pedir 1 más excede el tope simultáneo.
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(auth())
      .send({ localityId: locId, quantity: 1 })
      .expect(409);
    // Libera y ahora sí puede volver a reservar.
    const held = await redis.getClient().smembers(`hold:owner:${buyerId}`);
    await http().delete(`/api/v1/events/${eventId}/holds`).set(auth()).send({ seatIds: held }).expect(200);
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(auth())
      .send({ localityId: locId, quantity: 1 })
      .expect(201);
  });

  it('2.2 tope de órdenes pending por comprador (2): la 3ª compra → 409', async () => {
    // Limpia holds previos del comprador para partir de cero.
    const prev = await redis.getClient().smembers(`hold:owner:${buyerId}`);
    if (prev.length) await http().delete(`/api/v1/events/${eventId}/holds`).set(auth()).send({ seatIds: prev });

    const buyOne = async () => {
      const h = await http()
        .post(`/api/v1/events/${eventId}/holds`)
        .set(auth())
        .send({ localityId: locId, quantity: 1 })
        .expect(201);
      return http()
        .post(`/api/v1/events/${eventId}/orders`)
        .set(auth())
        .send({ seatIds: h.body.seatIds });
    };
    await buyOne().then((r) => expect(r.status).toBe(201));
    await buyOne().then((r) => expect(r.status).toBe(201));
    // 2 órdenes pending → la 3ª excede el tope.
    await buyOne().then((r) => expect(r.status).toBe(409));
  });
});
