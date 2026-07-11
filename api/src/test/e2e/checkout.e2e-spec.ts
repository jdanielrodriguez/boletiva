import { BadRequestException, INestApplication, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { CheckoutService } from '../../modules/orders/checkout.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/** Normaliza dinero a 2 decimales (Prisma serializa Decimal sin ceros de relleno). */
const money = (v: unknown): string => new Decimal(v as string).toFixed(2);

/**
 * Ola 2 · Ticket 3 — Commit anti-doble-venta.
 * Cubre happy path + exactitud de dinero (server-authoritative), todos los
 * errores capturados y su contrato, IDOR, y la garantía dura de 0 doble-venta
 * (SELECT FOR UPDATE + índice único parcial) bajo concurrencia.
 */
describe('Checkout / commit de compra (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let checkout: CheckoutService;
  let tokenA: string;
  let tokenB: string;
  let tokenUnverified: string;
  let buyerAId: string;
  let eventId: string;
  let otherEventId: string;
  let localityId: string;
  let seatIds: string[];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    checkout = app.get(CheckoutService);

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'CHECKOUT Test Event',
        slug: `checkout-test-${Date.now()}`,
        startsAt: new Date('2027-02-01T20:00:00-06:00'),
        endsAt: new Date('2027-02-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const locality = await prisma.locality.create({
      data: { eventId, name: 'CO Loc', slug: 'co-loc', kind: 'seated', desiredNet: 100 },
    });
    localityId = locality.id;
    await prisma.seat.createMany({
      data: Array.from({ length: 80 }, (_, i) => ({ localityId, label: `C${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId }, orderBy: { label: 'asc' } });
    // Ordenar por índice numérico real (C1..C80), no lexicográfico.
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    // Otro evento (para probar asiento ajeno al evento).
    const other = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'CHECKOUT Other Event',
        slug: `checkout-other-${Date.now()}`,
        startsAt: new Date('2027-03-01T20:00:00-06:00'),
        endsAt: new Date('2027-03-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    otherEventId = other.id;

    // Comprador A = cliente seed (verificado).
    tokenA = await loginTrusted(SEED.buyer, 'checkout-devA');
    const buyerA = await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } });
    buyerAId = buyerA.id;

    // Comprador B: creado y verificado.
    const emailB = `adv_cob_${Date.now()}@test.com`;
    const signupB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({
      where: { id: signupB.body.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    tokenB = await loginTrusted(emailB, 'checkout-devB');

    // Usuario sin verificar correo (no completa 2FA; login devuelve token directo).
    const emailU = `adv_counv_${Date.now()}@test.com`;
    const signupU = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailU, password: 'Password123', firstName: 'U' });
    tokenUnverified = signupU.body.tokens.accessToken;
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
    // Borrar órdenes de los eventos de prueba antes que los eventos (FK).
    await prisma.order.deleteMany({ where: { eventId: { in: [eventId, otherEventId] } } });
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    await prisma.user.deleteMany({
      where: { OR: [{ email: { contains: 'adv_cob_' } }, { email: { contains: 'adv_counv_' } }] },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const buy = (token: string, ids: string[]) =>
    http().post(`/api/v1/events/${eventId}/orders`).set(bearer(token)).send({ seatIds: ids });

  it('happy path: compra un asiento → 201, orden pending, asiento sold, precio exacto', async () => {
    const seat = seatIds[0];
    const res = await buy(tokenA, [seat]).expect(201);

    expect(res.body.status).toBe('pending');
    expect(res.body.currency).toBe('GTQ');
    // Dinero server-authoritative: neto 100 con comisiones por defecto → 129.68.
    expect(money(res.body.net)).toBe('100.00');
    expect(money(res.body.platformFee)).toBe('10.00');
    expect(money(res.body.taxableBase)).toBe('110.00');
    expect(money(res.body.iva)).toBe('13.20');
    expect(money(res.body.gatewayFee)).toBe('6.48');
    expect(money(res.body.total)).toBe('129.68');
    expect(res.body.expiresAt).toBeDefined();
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].seatId).toBe(seat);
    expect(res.body.items[0].quoteHash).toBeTruthy();
    // El snapshot inmutable del quote conserva el formato exacto del PricingEngine.
    expect(res.body.items[0].quote.net).toBe('100.00');
    expect(res.body.items[0].quote.total).toBe('129.68');
    expect(res.body.items[0].quote.hash).toBe(res.body.items[0].quoteHash);

    const dbSeat = await prisma.seat.findUniqueOrThrow({ where: { id: seat } });
    expect(dbSeat.status).toBe('sold');
  });

  it('multi-asiento: totales = suma exacta de los ítems', async () => {
    const ids = [seatIds[1], seatIds[2]];
    const res = await buy(tokenA, ids).expect(201);
    expect(res.body.items).toHaveLength(2);
    expect(money(res.body.net)).toBe('200.00');
    expect(money(res.body.iva)).toBe('26.40');
    expect(money(res.body.gatewayFee)).toBe('12.96');
    expect(money(res.body.total)).toBe('259.36'); // 2 * 129.68
  });

  it('asiento ya vendido → 409', async () => {
    await buy(tokenA, [seatIds[0]]).expect(409); // seat0 lo vendió el primer test
  });

  it('rechaza asiento reservado por OTRO en Redis → 409', async () => {
    const seat = seatIds[3];
    // B reserva el asiento (hold Redis). A intenta comprarlo.
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenB))
      .send({ seatIds: [seat] })
      .expect(201);
    await buy(tokenA, [seat]).expect(409);
    // Y B sí puede comprar lo que reservó.
    await buy(tokenB, [seat]).expect(201);
  });

  it('compra sin hold previo funciona (el hold es optimista; la BD es autoritativa) → 201', async () => {
    await buy(tokenA, [seatIds[4]]).expect(201);
  });

  it('libera el hold propio tras el commit', async () => {
    const seat = seatIds[5];
    await http()
      .post(`/api/v1/events/${eventId}/holds`)
      .set(bearer(tokenA))
      .send({ seatIds: [seat] })
      .expect(201);
    await buy(tokenA, [seat]).expect(201);
    const holder = await redis.getClient().get(`hold:${eventId}:${seat}`);
    expect(holder).toBeNull();
  });

  it('sin token → 401', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .send({ seatIds: [seatIds[6]] })
      .expect(401);
  });

  it('correo sin verificar → 403 (no puede comprar)', async () => {
    await buy(tokenUnverified, [seatIds[6]]).expect(403);
  });

  it('asiento inexistente (uuid válido) → 400', async () => {
    await buy(tokenA, ['00000000-0000-4000-8000-000000000000']).expect(400);
  });

  it('asiento de otro evento → 400', async () => {
    // seat8 pertenece a `eventId`; se pide contra `otherEventId` → no pertenece.
    await http()
      .post(`/api/v1/events/${otherEventId}/orders`)
      .set(bearer(tokenA))
      .send({ seatIds: [seatIds[8]] })
      .expect(400);
  });

  it('seatIds vacío → 400; uuid inválido → 400', async () => {
    await buy(tokenA, []).expect(400);
    await buy(tokenA, ['no-es-uuid']).expect(400);
  });

  it('server-authoritative: el cliente no puede inyectar montos (campos extra → 400)', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(tokenA))
      .send({ seatIds: [seatIds[9]], total: 0, net: 0, platformFee: 0 })
      .expect(400);
  });

  it('IDOR: B no puede leer la orden de A → 404', async () => {
    const res = await buy(tokenA, [seatIds[10]]).expect(201);
    const orderId = res.body.id;
    // A sí la ve
    await http().get(`/api/v1/orders/${orderId}`).set(bearer(tokenA)).expect(200);
    // B no
    await http().get(`/api/v1/orders/${orderId}`).set(bearer(tokenB)).expect(404);
  });

  it('GET /orders lista solo mis órdenes', async () => {
    const buyerB = await prisma.user.findFirstOrThrow({
      where: { email: { contains: 'adv_cob_' } },
    });
    const res = await http().get('/api/v1/orders').set(bearer(tokenB)).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const o of res.body.items) expect(o.buyerId).toBe(buyerB.id);
    expect(res.body).toHaveProperty('nextCursor');
  });

  it('índice único parcial: dos ítems ACTIVOS para el mismo asiento → viola constraint (belt-and-suspenders)', async () => {
    const seat = seatIds[11];
    const mkOrder = () =>
      prisma.order.create({
        data: {
          buyerId: buyerAId,
          eventId,
          net: '100.00',
          platformFee: '10.00',
          taxableBase: '110.00',
          iva: '13.20',
          gatewayFee: '6.48',
          total: '129.68',
          items: {
            create: {
              localityId,
              seatId: seat,
              net: '100.00',
              total: '129.68',
              quote: {},
              quoteHash: 'x',
            },
          },
        },
      });
    await mkOrder(); // primer ítem activo: OK
    await expect(mkOrder()).rejects.toThrow(); // segundo activo mismo asiento: 23505
  });

  it('0 DOBLE-VENTA: 30 commits concurrentes del MISMO asiento → exactamente 1 vendido', async () => {
    // Se ejerce el servicio directamente (capa autoritativa: SELECT FOR UPDATE +
    // índice único parcial), evitando la flakiness del socket HTTP con 30
    // conexiones simultáneas. La ruta HTTP 201/409 ya está cubierta arriba.
    const seat = seatIds[20];
    const N = 30;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => checkout.commit(eventId, [seat], buyerAId)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1); // solo UNA compra prospera
    expect(rejected).toHaveLength(N - 1);
    // Todos los rechazos deben ser conflictos/capacidad esperados (409/503), no bugs.
    for (const r of rejected) {
      const status =
        typeof r.reason?.getStatus === 'function' ? r.reason.getStatus() : r.reason?.status;
      if (![409, 503].includes(status)) {
        throw new Error(`Rechazo inesperado (status=${status}): ${r.reason?.message ?? r.reason}`);
      }
    }

    const dbSeat = await prisma.seat.findUniqueOrThrow({ where: { id: seat } });
    expect(dbSeat.status).toBe('sold');
    const activeItems = await prisma.orderItem.count({ where: { seatId: seat, active: true } });
    expect(activeItems).toBe(1); // jamás dos líneas activas para el asiento
  });

  it('lock_timeout: si otro sostiene el lock más que el timeout → rechaza (no cuelga, no vende)', async () => {
    const seat = seatIds[21];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));

    // Transacción en segundo plano que toma el lock del asiento y lo retiene.
    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM seats WHERE id = ${seat}::uuid FOR UPDATE`);
        await held; // mantener el lock hasta liberarlo manualmente
      },
      { timeout: 20000 },
    );

    await new Promise((r) => setTimeout(r, 300)); // asegurar que el holder ya tomó el lock

    // El commit espera el lock; a los ~5s lock_timeout lo cancela → 409/503, nunca cuelga.
    let status: number | undefined;
    try {
      await checkout.commit(eventId, [seat], buyerAId);
      throw new Error('el commit no debió prosperar con el lock retenido');
    } catch (e) {
      const err = e as { getStatus?: () => number; status?: number };
      status = typeof err.getStatus === 'function' ? err.getStatus() : err.status;
    }
    expect([409, 503]).toContain(status);

    // El asiento NO se vendió (sigue disponible tras el rechazo).
    const dbSeat = await prisma.seat.findUniqueOrThrow({ where: { id: seat } });
    expect(dbSeat.status).toBe('available');

    release();
    await holding;
  }, 15000);

  // ---- Guards del commit ejercidos por el servicio (no alcanzables por HTTP) ----

  it('commit directo con seatIds vacío → 400 (el guard vive en el servicio)', async () => {
    await expect(checkout.commit(eventId, [], buyerAId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('commit directo con evento inexistente → 400', async () => {
    await expect(
      checkout.commit('00000000-0000-4000-8000-000000000000', [seatIds[30]], buyerAId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('commit de asiento cuya localidad no tiene precio (desiredNet null) → 422', async () => {
    const loc = await prisma.locality.create({
      data: { eventId, name: 'CO Sin Precio', slug: `co-noprice-${Date.now()}`, kind: 'seated' },
    });
    const seat = await prisma.seat.create({
      data: { localityId: loc.id, label: `NP-${Date.now()}`, status: 'available' },
    });
    await expect(checkout.commit(eventId, [seat.id], buyerAId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    // El asiento NO se vendió (la tx hizo rollback).
    const after = await prisma.seat.findUniqueOrThrow({ where: { id: seat.id } });
    expect(after.status).toBe('available');
  });
});
