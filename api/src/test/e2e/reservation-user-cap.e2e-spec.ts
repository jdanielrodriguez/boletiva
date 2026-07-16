import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { sha256 } from '../../common/utils/crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, SEED } from './utils';

/**
 * Cierre de H1 (auditoría dual): la ruta de RESERVAS evadía el cap de holds porque cada
 * reserva usa un `rid` nuevo y un usuario logueado no tenía límite. Ahora el cap de
 * asientos en reserva es por IDENTIDAD ESTABLE (cuenta), a través de TODAS las reservas.
 */
describe('Cap de asientos reservados por cuenta (H1) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let eventId: string;
  let locId: string;
  let token: string;
  let buyerId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `RESCAP ${stamp}`,
        slug: `rescap-${stamp}`,
        startsAt: new Date('2029-02-01T20:00:00-06:00'),
        endsAt: new Date('2029-02-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'GA', slug: 'ga', kind: 'general', desiredNet: 100, capacity: 120 },
    });
    locId = loc.id;
    await prisma.seat.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({ localityId: loc.id, label: `GA-${i + 1}` })),
    });
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: buyerId, deviceHash: sha256('rescap-dev') } },
      update: { trustedAt: new Date() },
      create: { userId: buyerId, deviceHash: sha256('rescap-dev'), trustedAt: new Date() },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Device-Id', 'rescap-dev')
      .send({ email: SEED.buyer, password: 'Password123' })
      .expect(200);
    token = login.body.tokens.accessToken;
  });

  afterAll(async () => {
    await redis.getClient().del(`res:seats:u:${buyerId}`);
    const keys = await redis.getClient().keys('hold:*');
    if (keys.length) await redis.getClient().del(...keys);
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await app.close();
  });

  const reserve = (quantity: number) =>
    request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/reservations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ localityId: locId, quantity });

  it('logueado: reserva de 40 ok; una 2ª reserva (rid nuevo) que exceda 50 → 429', async () => {
    // (cantidades elegidas para que la 2ª tenga cupos libres en su ventana de candidatos
    // y el rechazo sea por el CAP por cuenta, no por falta de cupos)
    const first = await reserve(40).expect(201);
    // Antes cada reserva estrenaba 50 limpios (rid nuevo). Ahora el cap es por cuenta: 40+15>50.
    await reserve(15).expect(429);
    // Cancelar la 1ª descuenta del cap → vuelve a poder reservar.
    await request(app.getHttpServer())
      .delete(`/api/v1/reservations/${first.body.token}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await reserve(15).expect(201);
  });
});
