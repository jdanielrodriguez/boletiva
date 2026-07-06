import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 3 · Ticket 3 — Wallet + pago mixto.
 * Verifica pago 100% saldo (confirmación inmediata), pago mixto (reserva +
 * pasarela vía webhook), reembolso de la reserva al fallar, y el invariante de
 * que el saldo interno nunca queda negativo. La integridad contable se comprueba
 * con verifyChain() (suma 0 + saldos = suma de asientos).
 */
describe('Wallet + pago mixto (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let eventId: string;
  let seatIds: string[];
  let aId: string;
  let bId: string;
  let cId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  async function wipeLedger() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
  }

  // Acredita saldo al wallet (simula un reembolso/reventa previa).
  async function creditWallet(userId: string, amount: string) {
    await ledger.post({
      kind: 'wallet_credit_test',
      entries: [
        { type: 'user_wallet', ownerId: userId, amount },
        { type: 'gateway_clearing', amount: `-${amount}` },
      ],
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await wipeLedger();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'WAL Test Event',
        slug: `wal-test-${Date.now()}`,
        startsAt: new Date('2027-07-01T20:00:00-06:00'),
        endsAt: new Date('2027-07-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'WAL Loc', slug: 'wal-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({ localityId: loc.id, label: `W${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    const mk = async (suffix: string, device: string) => {
      const email = `adv_wal_${suffix}_${Date.now()}@test.com`;
      const s = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: 'Password123', firstName: suffix });
      await prisma.user.update({
        where: { id: s.body.user.id },
        data: { emailVerifiedAt: new Date() },
      });
      const token = await loginTrusted(email, device);
      return { id: s.body.user.id as string, token };
    };
    const a = await mk('a', 'wal-a');
    const b = await mk('b', 'wal-b');
    const c = await mk('c', 'wal-c');
    aId = a.id;
    bId = b.id;
    cId = c.id;
    tokenA = a.token;
    tokenB = b.token;
    tokenC = c.token;

    await creditWallet(aId, '200.00'); // A: paga 100% con saldo
    await creditWallet(bId, '50.00'); // B: pago mixto (50 saldo + 79.68 pasarela)
    await creditWallet(cId, '50.00'); // C: pago mixto que falla → reembolso
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
    await prisma.user.deleteMany({ where: { email: { contains: 'adv_wal_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const order = async (token: string, seatIdx: number) =>
    (
      await http()
        .post(`/api/v1/events/${eventId}/orders`)
        .set(bearer(token))
        .send({ seatIds: [seatIds[seatIdx]] })
        .expect(201)
    ).body.id as string;

  const pay = (orderId: string, token: string, useWallet: boolean) =>
    http().post(`/api/v1/orders/${orderId}/pay`).set(bearer(token)).send({ useWallet });

  const webhook = (id: string, type: string, ref: string) =>
    http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(id, type, ref))
      .send({ id, type, providerRef: ref });

  it('GET /wallet requiere auth (401) y devuelve el saldo', async () => {
    await http().get('/api/v1/wallet').expect(401);
    const res = await http().get('/api/v1/wallet').set(bearer(tokenA)).expect(200);
    expect(res.body.balance).toBe('200.00');
    expect(res.body.currency).toBe('GTQ');
  });

  it('pago 100% con saldo → se confirma al instante (sin webhook) y debita el wallet', async () => {
    const orderId = await order(tokenA, 0);
    const res = await pay(orderId, tokenA, true).expect(201);
    expect(res.body.status).toBe('succeeded'); // estado del PAGO
    expect(res.body.method).toBe('wallet');
    expect(res.body.walletAmount).toBe('129.68');

    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('paid'); // la ORDEN quedó pagada al instante
    // 200 - 129.68 = 70.32
    const wallet = await http().get('/api/v1/wallet').set(bearer(tokenA)).expect(200);
    expect(wallet.body.balance).toBe('70.32');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('pago mixto → reserva el saldo (wallet a 0) + pasarela; webhook confirma', async () => {
    const orderId = await order(tokenB, 1);
    const res = await pay(orderId, tokenB, true).expect(201);
    expect(res.body.method).toBe('mixed');
    expect(res.body.status).toBe('pending');
    expect(res.body.walletAmount).toBe('50.00');
    expect(res.body.amount).toBe('79.68'); // 129.68 - 50

    // El saldo quedó reservado (payment_holding), wallet a 0.
    const w1 = await http().get('/api/v1/wallet').set(bearer(tokenB)).expect(200);
    expect(w1.body.balance).toBe('0.00');

    await webhook('evt_mix_ok', 'payment.succeeded', res.body.providerRef).expect(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('paid');
    // Wallet sigue en 0 (la reserva se consumió); contabilidad íntegra.
    const w2 = await http().get('/api/v1/wallet').set(bearer(tokenB)).expect(200);
    expect(w2.body.balance).toBe('0.00');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('pago mixto que FALLA → reembolsa la reserva al wallet y libera el asiento', async () => {
    const seatIdx = 2;
    const orderId = await order(tokenC, seatIdx);
    const res = await pay(orderId, tokenC, true).expect(201);
    expect(res.body.method).toBe('mixed');
    // Reserva tomada → wallet a 0.
    expect((await http().get('/api/v1/wallet').set(bearer(tokenC))).body.balance).toBe('0.00');

    await webhook('evt_mix_fail', 'payment.failed', res.body.providerRef).expect(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('cancelled');
    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatIds[seatIdx] } });
    expect(seat.status).toBe('available'); // inventario liberado
    // Reserva devuelta al wallet.
    const w = await http().get('/api/v1/wallet').set(bearer(tokenC)).expect(200);
    expect(w.body.balance).toBe('50.00');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('invariante: el ledger impide dejar el wallet negativo (saldo insuficiente)', async () => {
    const ghost = '99999999-9999-4999-8999-999999999999';
    await expect(
      ledger.post({
        kind: 'wallet_overspend',
        entries: [
          { type: 'user_wallet', ownerId: ghost, amount: '-10.00' },
          { type: 'gateway_clearing', amount: '10.00' },
        ],
      }),
    ).rejects.toThrow();
  });
});
