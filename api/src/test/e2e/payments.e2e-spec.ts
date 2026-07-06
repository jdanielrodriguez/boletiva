import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 3 · Ticket 2 — PaymentProvider + simulador webhook-first.
 * Cubre iniciar pago, webhook firmado (fulfillment + asientos en el ledger),
 * idempotencia/replay, firma inválida, pago fallido que libera inventario, IDOR
 * y seguridad de los endpoints.
 */
describe('Pagos: PaymentProvider + webhooks (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let buyerToken: string;
  let buyerBToken: string;
  let unverifiedToken: string;
  let promoterId: string;
  let eventId: string;
  let seatIds: string[];

  async function wipeLedger() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await wipeLedger();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    const event = await prisma.event.create({
      data: {
        promoterId,
        name: 'PAY Test Event',
        slug: `pay-test-${Date.now()}`,
        startsAt: new Date('2027-05-01T20:00:00-06:00'),
        endsAt: new Date('2027-05-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'PAY Loc', slug: 'pay-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ localityId: loc.id, label: `P${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    buyerToken = await loginTrusted(SEED.buyer, 'pay-devA');

    const emailB = `adv_payb_${Date.now()}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({
      where: { id: sB.body.user.id },
      data: { emailVerifiedAt: new Date() },
    });
    buyerBToken = await loginTrusted(emailB, 'pay-devB');

    const emailU = `adv_payu_${Date.now()}@test.com`;
    const sU = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailU, password: 'Password123', firstName: 'U' });
    unverifiedToken = sU.body.tokens.accessToken;
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
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await wipeLedger();
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({
      where: { OR: [{ email: { contains: 'adv_payb_' } }, { email: { contains: 'adv_payu_' } }] },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // Crea una orden (checkout) para el comprador A y devuelve su id.
  async function createOrder(seatIdx: number): Promise<string> {
    const res = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    return res.body.id;
  }

  const pay = (orderId: string, token = buyerToken) =>
    http().post(`/api/v1/orders/${orderId}/pay`).set(bearer(token));

  const webhook = (id: string, type: string, ref: string, sig?: string) =>
    http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sig ?? sign(id, type, ref))
      .send({ id, type, providerRef: ref });

  it('inicia el pago → 201 pending; la orden sigue pending (webhook-first)', async () => {
    const orderId = await createOrder(0);
    const res = await pay(orderId).expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.providerRef).toMatch(/^simulator_/);
    expect(res.body.amount).toBe('129.68');
    expect(res.body.paymentUrl).toContain('sim://checkout/');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending'); // no se confirma en la iniciación
  });

  it('IDOR: otro comprador no puede pagar una orden ajena → 404', async () => {
    const orderId = await createOrder(1);
    await pay(orderId, buyerBToken).expect(404);
  });

  it('sin token → 401; correo sin verificar → 403', async () => {
    const orderId = await createOrder(2);
    await http().post(`/api/v1/orders/${orderId}/pay`).expect(401);
    await pay(orderId, unverifiedToken).expect(403);
  });

  it('webhook con firma inválida → 401', async () => {
    const orderId = await createOrder(3);
    const p = await pay(orderId).expect(201);
    await webhook('evt_bad', 'payment.succeeded', p.body.providerRef, 'firma-falsa').expect(401);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending'); // no se confirmó
  });

  it('webhook payment.succeeded → orden pagada + asientos contables balanceados', async () => {
    const orderId = await createOrder(4);
    const p = await pay(orderId).expect(201);
    await webhook('evt_ok_1', 'payment.succeeded', p.body.providerRef).expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('paid');
    expect(order.paidAt).not.toBeNull();
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { providerRef: p.body.providerRef },
    });
    expect(payment.status).toBe('succeeded');

    // Ledger: promotor +100, plataforma +10, IVA +13.20, gateway_clearing -123.20.
    const bal = async (
      type: 'promoter_payable' | 'platform_revenue' | 'tax_payable' | 'gateway_clearing',
      ownerId: string,
    ) =>
      (
        await prisma.ledgerAccount.findUniqueOrThrow({
          where: { type_ownerId_currency: { type, ownerId, currency: 'GTQ' } },
        })
      ).balance.toString();
    const SYS = '00000000-0000-0000-0000-000000000000';
    expect(await bal('promoter_payable', promoterId)).toBe('100');
    expect(await bal('platform_revenue', SYS)).toBe('10');
    expect(await bal('tax_payable', SYS)).toBe('13.2');
    expect(await bal('gateway_clearing', SYS)).toBe('-123.2');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('idempotencia: reenviar el MISMO evento no reprocesa (sin doble asiento)', async () => {
    const before = await prisma.ledgerTransaction.count();
    const balBefore = (
      await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'promoter_payable' } })
    ).balance.toString();
    // Reenvío del evento evt_ok_1 ya procesado.
    const res = await webhook('evt_ok_1', 'payment.succeeded', 'irrelevante').expect(200);
    expect(res.body.duplicate).toBe(true);
    expect(await prisma.ledgerTransaction.count()).toBe(before); // no duplicó asientos
    const balAfter = (
      await prisma.ledgerAccount.findFirstOrThrow({ where: { type: 'promoter_payable' } })
    ).balance.toString();
    expect(balAfter).toBe(balBefore);
  });

  it('pagar una orden ya pagada → 409', async () => {
    // La orden del test anterior (seat 4) ya está pagada; reusar una nueva.
    const orderId = await createOrder(5);
    const p = await pay(orderId).expect(201);
    await webhook('evt_ok_2', 'payment.succeeded', p.body.providerRef).expect(200);
    await pay(orderId).expect(409);
  });

  it('webhook payment.failed → orden cancelada y asiento liberado', async () => {
    const seatIdx = 6;
    const orderId = await createOrder(seatIdx);
    const p = await pay(orderId).expect(201);
    await webhook('evt_fail_1', 'payment.failed', p.body.providerRef).expect(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('cancelled');
    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatIds[seatIdx] } });
    expect(seat.status).toBe('available'); // inventario liberado
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items.every((i) => !i.active)).toBe(true);
  });

  it('webhook con providerRef desconocido → 200 (no rompe, no reintenta en bucle)', async () => {
    const res = await webhook('evt_unknown', 'payment.succeeded', 'no-existe-ref').expect(200);
    expect(res.body.unknown).toBe(true);
  });
});
