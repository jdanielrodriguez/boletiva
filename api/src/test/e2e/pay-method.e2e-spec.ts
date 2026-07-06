import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

const money = (v: unknown) => new Decimal(v as string).toFixed(2);

/**
 * Ola 3.5 · Ticket D — Selección de método al pagar.
 * Verifica: recotización del total al elegir otra pasarela, rechazo de pasarela
 * inactiva, y que no se completa una compra si hay que cobrar por pasarela y no
 * hay una disponible (saldo parcial sin método).
 */
describe('Pago: selección de método + recotización (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let token: string;
  let buyerId: string;
  let eventId: string;
  let seatIds: string[];
  let gw10Id: string;
  let inactiveGwId: string;

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
    await prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true },
      data: { isPlatformDefault: false },
    });
    await prisma.paymentGateway.updateMany({
      where: { name: 'Sandbox' },
      data: { isPlatformDefault: true, status: 'active' },
    });

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'PM Test Event',
        slug: `pm-test-${Date.now()}`,
        startsAt: new Date('2027-10-01T20:00:00-06:00'),
        endsAt: new Date('2027-10-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'PM Loc', slug: 'pm-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({ localityId: loc.id, label: `M${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    const gw10 = await prisma.paymentGateway.create({
      data: { name: `PM_gw10_${Date.now()}`, provider: 'sim', feePct: '0.10000', status: 'active' },
    });
    gw10Id = gw10.id;
    const inactive = await prisma.paymentGateway.create({
      data: { name: `PM_inact_${Date.now()}`, provider: 'sim', feePct: '0.05', status: 'inactive' },
    });
    inactiveGwId = inactive.id;

    const buyer = await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } });
    buyerId = buyer.id;
    token = await loginTrusted(SEED.buyer, 'pm-buyer');
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
    await prisma.paymentGateway.deleteMany({ where: { name: { startsWith: 'PM_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = () => ({ Authorization: `Bearer ${token}` });
  const order = async (seatIdx: number) =>
    (
      await http()
        .post(`/api/v1/events/${eventId}/orders`)
        .set(bearer())
        .send({ seatIds: [seatIds[seatIdx]] })
        .expect(201)
    ).body;

  it('pagar sin elegir método usa la pasarela del evento (Sandbox) → 129.68', async () => {
    const o = await order(0);
    expect(money(o.total)).toBe('129.68');
    const res = await http().post(`/api/v1/orders/${o.id}/pay`).set(bearer()).send({}).expect(201);
    expect(money(res.body.amount)).toBe('129.68');
  });

  it('elegir otra pasarela RECOTIZA el total (0.10 → 136.89)', async () => {
    const o = await order(1);
    expect(money(o.total)).toBe('129.68'); // precio inicial con Sandbox
    const res = await http()
      .post(`/api/v1/orders/${o.id}/pay`)
      .set(bearer())
      .send({ gatewayId: gw10Id })
      .expect(201);
    expect(money(res.body.amount)).toBe('136.89'); // recotizado con 0.10
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(money(updated.total)).toBe('136.89'); // la orden quedó recotizada
    expect(updated.feeGatewayId).toBe(gw10Id);
  });

  it('elegir una pasarela inactiva → 400', async () => {
    const o = await order(2);
    await http()
      .post(`/api/v1/orders/${o.id}/pay`)
      .set(bearer())
      .send({ gatewayId: inactiveGwId })
      .expect(400);
  });

  it('saldo parcial + pasarela inactiva (sin método para el resto) → 400, no completa', async () => {
    // Dar algo de saldo (parcial) al comprador.
    await ledger.post({
      kind: 'wallet_credit_test',
      entries: [
        { type: 'user_wallet', ownerId: buyerId, amount: '30.00' },
        { type: 'gateway_clearing', amount: '-30.00' },
      ],
    });
    const o = await order(3);
    await http()
      .post(`/api/v1/orders/${o.id}/pay`)
      .set(bearer())
      .send({ useWallet: true, gatewayId: inactiveGwId })
      .expect(400);
    // La orden sigue pendiente y no se consumió saldo.
    const still = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(still.status).toBe('pending');
    expect((await ledger.walletBalance(buyerId)).toFixed(2)).toBe('30.00');
  });
});
