import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SeatHoldService } from '../../modules/inventory/seat-hold.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

describe('Seat Hold en Redis (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let seatHold: SeatHoldService;
  let tokenA: string;
  let tokenB: string;
  let eventId: string;
  let seatIds: string[];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    seatHold = app.get(SeatHoldService);

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'HOLD Test Event',
        slug: `hold-test-${Date.now()}`,
        startsAt: new Date('2027-01-01T20:00:00-06:00'),
        endsAt: new Date('2027-01-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const locality = await prisma.locality.create({
      data: { eventId, name: 'HOLD Loc', slug: 'hold-loc', kind: 'seated' },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: locality.id, label: `H${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({
      where: { localityId: locality.id },
      orderBy: { label: 'asc' },
    });
    seatIds = seats.map((s) => s.id);

    // Comprador A = cliente seed (verificado). Login determinista con dispositivo confiable.
    tokenA = await loginTrusted(SEED.buyer, 'seathold-devA');
    // Comprador B: creado y verificado, con dispositivo confiable (sin depender de 2FA/MailHog).
    const emailB = `adv_holdb_${Date.now()}@test.com`; // minúsculas (el signup normaliza)
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({
      where: { id: signup.body.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    tokenB = await loginTrusted(emailB, 'seathold-devB');
  });

  // Login determinista: marca el dispositivo como confiable y entra sin 2FA.
  async function loginTrusted(rawEmail: string, deviceId: string): Promise<string> {
    const email = rawEmail.toLowerCase().trim();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: user.id, deviceHash: sha256(deviceId) } },
      update: { trustedAt: new Date() },
      create: { userId: user.id, deviceHash: sha256(deviceId), trustedAt: new Date() },
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Device-Id', deviceId)
      .send({ email, password: 'Password123' })
      .expect(200);
    return res.body.tokens.accessToken;
  }

  afterAll(async () => {
    const keys = await redis.getClient().keys(`hold:${eventId}:*`);
    if (keys.length) await redis.getClient().del(...keys);
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: 'adv_holdb_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('A reserva un asiento → 201 con expiración', async () => {
    const res = await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: [seatIds[0]] })
      .expect(201);
    expect(res.body.seatIds).toEqual([seatIds[0]]);
    expect(res.body.expiresAt).toBeDefined();
  });

  it('B no puede reservar el mismo asiento → 409', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenB))
      .send({ seatIds: [seatIds[0]] })
      .expect(409);
  });

  it('B sí puede reservar otro asiento libre → 201', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenB))
      .send({ seatIds: [seatIds[1]] })
      .expect(201);
  });

  it('release por NO dueño no libera el asiento ajeno', async () => {
    const res = await http()
      .delete(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenB))
      .send({ seatIds: [seatIds[0]] })
      .expect(200);
    expect(res.body.released).toBe(0); // seat0 es de A
  });

  it('release por el dueño libera y permite re-reservar', async () => {
    await http()
      .delete(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: [seatIds[0]] })
      .expect(200);
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenB))
      .send({ seatIds: [seatIds[0]] })
      .expect(201);
  });

  it('reserva atómica (todos o ninguno): si un asiento del lote está tomado, no toma ninguno', async () => {
    // seatIds[1] está tomado por B. A intenta [seat4, seat1] → debe fallar y NO tomar seat4.
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: [seatIds[4], seatIds[1]] })
      .expect(409);
    const seat4 = await seatHold.inspect(eventId, seatIds[4]);
    expect(seat4.holder).toBeNull(); // no quedó huérfano
  });

  it('rechaza asiento inexistente → 400', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
  });

  it('rechaza asiento no disponible (vendido) → 409', async () => {
    await prisma.seat.update({ where: { id: seatIds[5] }, data: { status: 'sold' } });
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: [seatIds[5]] })
      .expect(409);
  });

  it('requiere autenticación (sin token → 401)', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .send({ seatIds: [seatIds[2]] })
      .expect(401);
  });

  it('el TTL libera el asiento automáticamente sin intervención (caída de servidor)', async () => {
    const seat = seatIds[3];
    // Hold directo con TTL de 1s (simula que el proceso muere sin release).
    await seatHold.hold(eventId, [seat], 'holder-fantasma', 1);
    const before = await seatHold.inspect(eventId, seat);
    expect(before.holder).toBe('holder-fantasma');
    expect(before.pttl).toBeGreaterThan(0);
    expect(before.pttl).toBeLessThanOrEqual(1000);

    await new Promise((r) => setTimeout(r, 1300)); // esperar expiración real
    const after = await seatHold.inspect(eventId, seat);
    expect(after.holder).toBeNull(); // Redis lo liberó solo
    // y se puede volver a reservar
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: [seat] })
      .expect(201);
  });
});
