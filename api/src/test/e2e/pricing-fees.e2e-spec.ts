import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/** Normaliza dinero/porcentaje a comparación numérica exacta. */
const eq = (v: unknown, n: number) => expect(new Decimal(v as string).toNumber()).toBe(n);

/**
 * Ola 2 · fee_schedules versionado + panel admin + preview de cotización +
 * captura FEL en checkout + INMUTABILIDAD del snapshot de la orden.
 */
describe('Comisiones versionadas (fee_schedules) + FEL (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let eventId: string;
  let seatIds: string[];
  let baselineOrderId: string;
  let newVersion: number; // versión creada por el admin en este run (dinámica)

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'FEES Test Event',
        slug: `fees-test-${Date.now()}`,
        startsAt: new Date('2027-04-01T20:00:00-06:00'),
        endsAt: new Date('2027-04-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const locality = await prisma.locality.create({
      data: { eventId, name: 'FEES Loc', slug: 'fees-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ localityId: locality.id, label: `F${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: locality.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    adminToken = await loginTrusted(SEED.admin, 'fees-admin');
    buyerToken = await loginTrusted(SEED.buyer, 'fees-buyer');

    // Estado base determinista: v1 (0.10/0.05/0.12 del seed) activa. Otros runs
    // pudieron dejar versiones posteriores; aquí partimos siempre de v1.
    await prisma.feeSchedule.updateMany({ where: { active: true }, data: { active: false } });
    await prisma.feeSchedule.updateMany({ where: { version: 1 }, data: { active: true } });
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
    // Restaurar v1 como activa para no contaminar otras suites (estado global).
    await prisma.feeSchedule.updateMany({ where: { active: true }, data: { active: false } });
    await prisma.feeSchedule.updateMany({ where: { version: 1 }, data: { active: true } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const buy = (body: object) =>
    http().post(`/api/v1/events/${eventId}/orders`).set(bearer(buyerToken)).send(body);

  it('GET /pricing/schedules/active → v1 con comisiones base', async () => {
    const res = await http()
      .get('/api/v1/pricing/schedules/active')
      .set(bearer(buyerToken))
      .expect(200);
    expect(res.body.version).toBe(1);
    eq(res.body.platformFeePct, 0.1);
    eq(res.body.gatewayFeePct, 0.05);
    eq(res.body.ivaPct, 0.12);
    expect(res.body.active).toBe(true);
  });

  it('GET /pricing/schedules es admin-only (buyer→403, admin→200)', async () => {
    await http().get('/api/v1/pricing/schedules').set(bearer(buyerToken)).expect(403);
    const res = await http().get('/api/v1/pricing/schedules').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((s: { version: number }) => s.version === 1)).toBe(true);
  });

  it('GET /pricing/quote?net=100 → 129.68 con la versión vigente (v1)', async () => {
    const res = await http()
      .get('/api/v1/pricing/quote?net=100')
      .set(bearer(buyerToken))
      .expect(200);
    expect(res.body.feeScheduleVersion).toBe(1);
    expect(res.body.quote.total).toBe('129.68');
    expect(res.body.quote.net).toBe('100.00');
  });

  it('GET /pricing/quote con net inválido (0 / negativo / ausente) → 400', async () => {
    await http().get('/api/v1/pricing/quote?net=0').set(bearer(buyerToken)).expect(400);
    await http().get('/api/v1/pricing/quote?net=-5').set(bearer(buyerToken)).expect(400);
    await http().get('/api/v1/pricing/quote').set(bearer(buyerToken)).expect(400);
  });

  it('checkout SIN billing → NIT "CF" (consumidor final) y versión de comisiones estampada', async () => {
    const res = await buy({ seatIds: [seatIds[0]] }).expect(201);
    baselineOrderId = res.body.id;
    expect(res.body.billingNit).toBe('CF');
    expect(res.body.billingName).toBeNull();
    expect(res.body.feeScheduleVersion).toBe(1);
    expect(res.body.total).toBe('129.68');
  });

  it('checkout CON billing → NIT normalizado (mayúsculas/trim) y datos guardados', async () => {
    const res = await buy({
      seatIds: [seatIds[1]],
      billingNit: '  1234567-8  ',
      billingName: 'Juan Pérez',
      billingAddress: 'Zona 10, Guatemala',
    }).expect(201);
    expect(res.body.billingNit).toBe('1234567-8');
    expect(res.body.billingName).toBe('Juan Pérez');
    expect(res.body.billingAddress).toBe('Zona 10, Guatemala');
  });

  it('POST /pricing/schedules requiere admin (buyer → 403)', async () => {
    await http()
      .post('/api/v1/pricing/schedules')
      .set(bearer(buyerToken))
      .send({ platformFeePct: 0.2, gatewayFeePct: 0.05, ivaPct: 0.12 })
      .expect(403);
  });

  it('POST /pricing/schedules rechaza porcentajes fuera de [0,1) → 400', async () => {
    await http()
      .post('/api/v1/pricing/schedules')
      .set(bearer(adminToken))
      .send({ platformFeePct: 1.5, gatewayFeePct: 0.05, ivaPct: 0.12 })
      .expect(400);
    await http()
      .post('/api/v1/pricing/schedules')
      .set(bearer(adminToken))
      .send({ platformFeePct: -0.1, gatewayFeePct: 0.05, ivaPct: 0.12 })
      .expect(400);
  });

  it('POST /pricing/schedules (admin) → crea v2 activa; solo una activa a la vez', async () => {
    const res = await http()
      .post('/api/v1/pricing/schedules')
      .set(bearer(adminToken))
      .send({
        platformFeePct: 0.2,
        gatewayFeePct: 0.05,
        ivaPct: 0.12,
        label: 'sube plataforma a 20%',
      })
      .expect(201);
    newVersion = res.body.version;
    expect(newVersion).toBeGreaterThan(1); // versión nueva por encima de la base
    expect(res.body.active).toBe(true);

    const all = await prisma.feeSchedule.findMany();
    expect(all.filter((s) => s.active)).toHaveLength(1); // exactamente UNA activa
    const active = await http()
      .get('/api/v1/pricing/schedules/active')
      .set(bearer(buyerToken))
      .expect(200);
    expect(active.body.version).toBe(newVersion);
  });

  it('la cotización refleja la versión vigente (v2): 100 → 141.47', async () => {
    const res = await http()
      .get('/api/v1/pricing/quote?net=100')
      .set(bearer(buyerToken))
      .expect(200);
    expect(res.body.feeScheduleVersion).toBe(newVersion);
    // base=120, iva=14.40, pre=134.40, total=134.40/0.95=141.47
    expect(res.body.quote.total).toBe('141.47');
  });

  it('INMUTABILIDAD: la orden creada bajo v1 NO cambia al activarse v2', async () => {
    const order = await http()
      .get(`/api/v1/orders/${baselineOrderId}`)
      .set(bearer(buyerToken))
      .expect(200);
    expect(order.body.total).toBe('129.68'); // sigue con el precio de v1
    expect(order.body.feeScheduleVersion).toBe(1);
    expect(order.body.items[0].quote.total).toBe('129.68'); // snapshot intacto
  });

  it('una compra nueva ya usa v2 (141.47, versión 2)', async () => {
    const res = await buy({ seatIds: [seatIds[2]] }).expect(201);
    expect(res.body.total).toBe('141.47');
    expect(res.body.feeScheduleVersion).toBe(newVersion);
  });
});
