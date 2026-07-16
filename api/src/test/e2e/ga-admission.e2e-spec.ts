import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SeatHoldService } from '../../modules/inventory/seat-hold.service';
import { CheckoutService } from '../../modules/orders/checkout.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

const money = (v: unknown): string => new Decimal(v as string).toFixed(2);

/**
 * Ola 6.5 · Ticket 1 — Admisión general (GA) como filas `seats`.
 * Cubre: auto-generación del aforo al fijar capacity; ajuste (subir/bajar) con
 * guarda de no bajar bajo lo vendido; hold POR CANTIDAD (asignación server-side);
 * commit reusando el camino de asientos; validación/errores/RBAC; y la garantía
 * dura de 0 SOBREVENTA bajo concurrencia (sin fila caliente).
 */
describe('Admisión general (GA) por filas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let seatHold: SeatHoldService;
  let checkout: CheckoutService;
  let promoterToken: string;
  let buyerAToken: string;
  let buyerBToken: string;
  let buyerAId: string;
  let eventId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    seatHold = app.get(SeatHoldService);
    checkout = app.get(CheckoutService);
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'GA Test Event',
        slug: `ga-${stamp}`,
        startsAt: new Date('2028-05-01T20:00:00-06:00'),
        endsAt: new Date('2028-05-01T23:00:00-06:00'),
        // El inventario (localidades/aforo) se configura en BORRADOR; publicarlo lo
        // congela. Este fixture prueba la maquinaria GA (aforo/hold/commit) en draft.
        status: 'draft',
      },
    });
    eventId = event.id;

    promoterToken = await loginTrusted(SEED.promoter, 'ga-promo');
    buyerAToken = await loginTrusted(SEED.buyer, 'ga-buyerA');
    buyerAId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;

    const emailB = `ga_b_${stamp}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({
      where: { id: sB.body.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    buyerBToken = await loginTrusted(emailB, 'ga-buyerB');
  });

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
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `ga_b_${stamp}` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function createGaLocality(capacity: number, net = 100): Promise<string> {
    const res = await http()
      .post(`/api/v1/events/${eventId}/localities`)
      .set(bearer(promoterToken))
      .send({ name: `GA ${stamp}-${Math.random().toString(36).slice(2, 7)}`, kind: 'general', capacity, desiredNet: net })
      .expect(201);
    expect(res.body.kind).toBe('general');
    expect(res.body.capacity).toBe(capacity);
    return res.body.id;
  }

  // ---- Auto-generación del aforo ------------------------------------------

  it('crear localidad GA con capacity=N materializa N filas seats (GA-*) y capacity==N', async () => {
    const locId = await createGaLocality(20);
    const seats = await prisma.seat.findMany({ where: { localityId: locId } });
    expect(seats).toHaveLength(20);
    expect(seats.every((s) => s.label.startsWith('GA-') && s.section === 'GA')).toBe(true);
    expect(seats.every((s) => s.status === 'available')).toBe(true);
    // Labels únicos y con relleno a 7 dígitos.
    expect(new Set(seats.map((s) => s.label)).size).toBe(20);
    expect(seats.some((s) => s.label === 'GA-0000001')).toBe(true);
  });

  it('subir el aforo agrega filas; bajarlo elimina cupos disponibles', async () => {
    const locId = await createGaLocality(10);
    // Subir a 15 → +5 filas, numeración continúa (sin colisiones).
    const up = await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 15 })
      .expect(200);
    expect(up.body.capacity).toBe(15);
    expect(await prisma.seat.count({ where: { localityId: locId } })).toBe(15);
    // Bajar a 8 → -7 filas disponibles.
    const down = await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 8 })
      .expect(200);
    expect(down.body.capacity).toBe(8);
    expect(await prisma.seat.count({ where: { localityId: locId } })).toBe(8);
    // No quedan labels duplicados tras el ajuste.
    const labels = (await prisma.seat.findMany({ where: { localityId: locId } })).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('no se puede bajar el aforo por debajo de lo ya vendido → 409', async () => {
    const locId = await createGaLocality(5);
    // Vender 3 de los 5 cupos.
    const seats = await prisma.seat.findMany({ where: { localityId: locId }, take: 3 });
    await prisma.seat.updateMany({ where: { id: { in: seats.map((s) => s.id) } }, data: { status: 'sold' } });
    // Bajar a 2 (< 3 vendidos) → 409.
    await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 2 })
      .expect(409);
    // Bajar a 3 (== vendidos) sí procede: elimina los 2 disponibles.
    await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 3 })
      .expect(200);
    expect(await prisma.seat.count({ where: { localityId: locId } })).toBe(3);
  });

  // ---- Hold por cantidad + commit -----------------------------------------

  it('hold por cantidad asigna N cupos concretos y distintos → 201', async () => {
    const locId = await createGaLocality(10);
    const res = await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: locId, quantity: 3 })
      .expect(201);
    expect(res.body.seatIds).toHaveLength(3);
    expect(new Set(res.body.seatIds).size).toBe(3); // distintos
    expect(res.body.expiresAt).toBeDefined();
    // Están reservados en Redis a nombre del comprador A.
    for (const id of res.body.seatIds) {
      const inspect = await seatHold.inspect(eventId, id);
      expect(inspect.holder).toBe(buyerAId);
    }
  });

  it('commit GA con los seatIds del hold reusa el camino de asientos → 201, precio exacto', async () => {
    const locId = await createGaLocality(5); // aforo se configura en draft
    // El commit exige el evento publicado y con ventas abiertas (ciclo de vida por
    // fecha): se publica para vender (startsAt futuro) y se restaura draft al final.
    await prisma.event.update({ where: { id: eventId }, data: { status: 'published' } });
    try {
      const hold = await http()
        .post(`/api/v1/events/${eventId}/holds`)
        .set(bearer(buyerAToken))
        .send({ localityId: locId, quantity: 2 })
        .expect(201);
      const res = await http()
        .post(`/api/v1/events/${eventId}/orders`)
        .set(bearer(buyerAToken))
        .send({ seatIds: hold.body.seatIds })
        .expect(201);
      expect(res.body.items).toHaveLength(2);
      expect(money(res.body.net)).toBe('200.00');
      expect(money(res.body.total)).toBe('259.36'); // 2 * 129.68 (neto 100)
      for (const id of hold.body.seatIds) {
        const s = await prisma.seat.findUniqueOrThrow({ where: { id } });
        expect(s.status).toBe('sold');
      }
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { status: 'draft' } });
    }
  });

  it('dos compradores por cantidad no reciben cupos solapados', async () => {
    const locId = await createGaLocality(6);
    const a = await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: locId, quantity: 4 })
      .expect(201);
    const b = await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerBToken))
      .send({ localityId: locId, quantity: 2 })
      .expect(201);
    const overlap = a.body.seatIds.filter((id: string) => b.body.seatIds.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('pedir más cupos que los disponibles → 409', async () => {
    const locId = await createGaLocality(3);
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: locId, quantity: 4 })
      .expect(409);
  });

  // ---- Validación / errores / RBAC ----------------------------------------

  it('cantidad sobre una localidad numerada (seated) → 400', async () => {
    const seated = await prisma.locality.create({
      data: { eventId, name: `seat-${stamp}`, slug: `seat-${stamp}`, kind: 'seated', desiredNet: 100 },
    });
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: seated.id, quantity: 1 })
      .expect(400);
  });

  it('localidad inexistente → 404; body sin modo → 400; ambos modos → 400', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: '00000000-0000-4000-8000-000000000000', quantity: 1 })
      .expect(404);
    await http().post(`/api/v1/events/${eventId}/holds`).set(bearer(buyerAToken)).send({}).expect(400);
    const locId = await createGaLocality(2);
    const seat = await prisma.seat.findFirstOrThrow({ where: { localityId: locId } });
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: locId, quantity: 1, seatIds: [seat.id] })
      .expect(400);
  });

  it('validación de cantidad: 0 → 400, >50 → 400; sin token → 401', async () => {
    const locId = await createGaLocality(2);
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: locId, quantity: 0 })
      .expect(400);
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(buyerAToken))
      .send({ localityId: locId, quantity: 51 })
      .expect(400);
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .send({ localityId: locId, quantity: 1 })
      .expect(401);
  });

  // ---- 0 SOBREVENTA bajo concurrencia (sin fila caliente) -----------------

  it('0 SOBREVENTA: 25 flujos concurrentes sobre 10 cupos → exactamente 10 vendidos', async () => {
    const locId = await createGaLocality(10); // aforo en draft
    // Se publica para permitir el commit (ventas abiertas, startsAt futuro).
    await prisma.event.update({ where: { id: eventId }, data: { status: 'published' } });
    const K = 25;
    // Cada intento: hold por cantidad 1 y, si lo consigue, commit. Se ejercen los
    // servicios (capa autoritativa) para evitar flakiness del socket HTTP.
    const results = await Promise.allSettled(
      Array.from({ length: K }, async () => {
        const hold = await seatHold.holdByQuantity(eventId, locId, 1, buyerAId);
        return checkout.commit(eventId, hold.seatIds, buyerAId);
      }),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(10); // el aforo materializado acota la venta
    for (const r of rejected) {
      const status = typeof r.reason?.getStatus === 'function' ? r.reason.getStatus() : r.reason?.status;
      if (![409, 503].includes(status)) {
        throw new Error(`Rechazo inesperado (status=${status}): ${r.reason?.message ?? r.reason}`);
      }
    }
    // Exactamente 10 cupos vendidos, cada uno con UNA sola línea activa (0 doble-venta).
    const sold = await prisma.seat.count({ where: { localityId: locId, status: 'sold' } });
    expect(sold).toBe(10);
    const seatRows = await prisma.seat.findMany({ where: { localityId: locId }, select: { id: true } });
    const activeItems = await prisma.orderItem.count({
      where: { seatId: { in: seatRows.map((s) => s.id) }, active: true },
    });
    expect(activeItems).toBe(10);
  }, 30000);
});
