import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Reservas ANÓNIMAS y COMPARTIBLES: crear sin login (hold bajo el token),
 * verlas por token (link compartido), integridad del token, y checkout que
 * exige login y crea la orden a nombre del comprador (el hijo reserva, el padre
 * paga).
 */
describe('Reservas anónimas compartibles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let eventId: string;
  let localityId: string;
  let buyerToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `RES ${stamp}`,
        slug: `res-${stamp}`,
        startsAt: new Date('2028-09-01T20:00:00-06:00'),
        endsAt: new Date('2028-09-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'General', slug: 'general', kind: 'general', desiredNet: 100, capacity: 50 },
    });
    localityId = loc.id;
    await prisma.seat.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({ localityId: loc.id, label: `GA-${i + 1}` })),
    });
    buyerToken = await login(app, SEED.buyer);
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const reserve = (qty: number) =>
    http().post(`/api/v1/events/${eventId}/reservations`).send({ localityId, quantity: qty });

  it('crea reserva anónima por cantidad SIN login → 201 (token + items + total)', async () => {
    const res = await reserve(2).expect(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.valid).toBe(true);
    expect(res.body.items.length).toBe(2);
    expect(res.body.total).toBe('259.36'); // 2 × 129.68
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('ver la reserva por token (link compartido) → 200 valid', async () => {
    const c = await reserve(1).expect(201);
    const res = await http().get(`/api/v1/reservations/${c.body.token}`).expect(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.eventId).toBe(eventId);
    expect(res.body.total).toBe('129.68');
  });

  it('token manipulado → 400 (integridad HMAC)', async () => {
    const c = await reserve(1).expect(201);
    await http().get(`/api/v1/reservations/${c.body.token}x`).expect(400);
  });

  it('checkout de la reserva SIN login → 401', async () => {
    const c = await reserve(1).expect(201);
    await http().post(`/api/v1/reservations/${c.body.token}/checkout`).send({}).expect(401);
  });

  it('checkout CON login → 201 orden pending con los ítems de la reserva', async () => {
    const c = await reserve(2).expect(201);
    const res = await http()
      .post(`/api/v1/reservations/${c.body.token}/checkout`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({})
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.items.length).toBe(2);
    expect(res.body.total).toBe('259.36');
  });
});
