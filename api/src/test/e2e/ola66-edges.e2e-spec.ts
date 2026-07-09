import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const money = (v: unknown) => new Decimal(v as string).toFixed(2);
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 6.6 · Los 5 edge cases inusuales aprobados por el arquitecto para el modelo
 * de FIJO POR TRANSACCIÓN (Q2) + gating por cost-share del promotor:
 *   1) surplus (N-1)·fijo en compra combinada + reembolso no descuadra;
 *   2) cortesía Q0 en el carrito: el surplus cuenta solo ítems con total>0;
 *   3) pago mixto wallet+pasarela con porción de tarjeta < fijo → 400;
 *   4) race: el admin baja el cost-share del promotor entre el quote y el pago → 409;
 *   5) paradoja: la pasarela default no puede exigir cost-share (>0) → 409.
 */
describe('Ola 6.6 edge cases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let token: string; // SEED.buyer
  let adminToken: string;
  let walletToken: string;
  let walletBuyerId: string;
  let promoterId: string;
  let eventId: string;
  let recurrenteId: string;
  let seats: string[];
  let stamp: number;

  async function wipeLedger() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
  }

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
    stamp = Date.now();
    await wipeLedger();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    // Cuotas habilitadas (cost-share ≥ 0.3) para el test de race; se ajusta dentro.
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: '0.50000' } });

    token = await loginTrusted(SEED.buyer, 'e66-buyer');
    adminToken = await loginTrusted(SEED.admin, 'e66-admin');

    const walletEmail = `e66_wal_${stamp}@test.com`;
    const s = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: walletEmail, password: 'Password123', firstName: 'Wal' });
    walletBuyerId = s.body.user.id;
    await prisma.user.update({ where: { id: walletBuyerId }, data: { emailVerifiedAt: new Date() } });
    walletToken = await loginTrusted(walletEmail, 'e66-wal');

    // Recurrente: 5% + Q2 FIJO por transacción (aplica a 1 pago y cuotas) + cuotas.
    const recu = await prisma.paymentGateway.create({
      data: {
        name: `E66_recu_${stamp}`,
        provider: 'simulator',
        feePct: '0.05000',
        transactionFixedFee: '2.00',
        installmentRates: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
        status: 'active',
      },
    });
    recurrenteId = recu.id;

    const ev = await prisma.event.create({
      data: {
        promoterId,
        name: `E66 ${stamp}`,
        slug: `e66-${stamp}`,
        startsAt: new Date('2028-09-01T20:00:00-06:00'),
        endsAt: new Date('2028-09-01T23:00:00-06:00'),
        status: 'published',
        gatewayId: recurrenteId,
      },
    });
    eventId = ev.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'E', slug: `e-${stamp}`, kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ localityId: loc.id, label: `E${i + 1}` })),
    });
    const rows = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seats = rows.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s2) => s2.id);
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
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: null } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ticket.deleteMany({ where: { order: { eventId } } });
    await wipeLedger();
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.paymentGateway.deleteMany({ where: { name: { startsWith: 'E66_' } } });
    await prisma.user.deleteMany({ where: { email: { contains: `e66_wal_${stamp}` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string = token) => ({ Authorization: `Bearer ${t}` });
  const order = async (seatIds: string[], t: string = token) =>
    (await http().post(`/api/v1/events/${eventId}/orders`).set(bearer(t)).send({ seatIds }).expect(201))
      .body;
  const webhook = (id: string, type: string, ref: string) =>
    http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(id, type, ref))
      .send({ id, type, providerRef: ref })
      .expect(200);
  /** Asientos contables de la tx de pago de una orden (type → monto firmado). */
  async function paymentEntries(orderId: string): Promise<Record<string, string>> {
    const tx = await prisma.ledgerTransaction.findFirstOrThrow({
      where: { kind: 'order_payment', refType: 'order', refId: orderId },
      include: { entries: { include: { account: true } } },
    });
    const map: Record<string, string> = {};
    for (const e of tx.entries) map[e.account.type] = e.amount.toString();
    return map;
  }

  it('edge 1: compra combinada (2 asientos, 1 tx) → surplus (N-1)·Q2=2.00 a la plataforma; reembolso no descuadra', async () => {
    const o = await order([seats[0], seats[1]]);
    expect(money(o.total)).toBe('263.58'); // 2 × 131.79
    expect(money(o.gatewayFee)).toBe('17.18'); // 2 × 8.59 (cada uno embebe Q2)

    const p = await http().post(`/api/v1/orders/${o.id}/pay`).set(bearer()).send({}).expect(201);
    const evt = `e66_1_${stamp}`;
    await webhook(evt, 'payment.succeeded', p.body.providerRef);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(paid.status).toBe('paid');
    const e = await paymentEntries(o.id);
    // La pasarela cobra UN solo Q2: realGatewayFee = 13.18 (%) + 2 = 15.18.
    // platform_revenue = platformFee(20.00) + surplus(2.00) = 22.00.
    expect(money(e.promoter_payable)).toBe('200.00');
    expect(money(e.platform_revenue)).toBe('22.00');
    expect(money(e.tax_payable)).toBe('26.40');
    expect(money(e.gateway_clearing)).toBe('-248.40'); // 263.58 − 15.18
    expect((await ledger.verifyChain()).ok).toBe(true);

    // Reembolso de la orden completa: la cadena sigue íntegra (surplus consumido no descuadra).
    await webhook(`e66_1r_${stamp}`, 'payment.refunded', p.body.providerRef);
    const refunded = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(refunded.status).toBe('refunded');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('edge 2: cortesía Q0 en el carrito → el surplus cuenta SOLO ítems con total>0 (sin Q2 fantasma)', async () => {
    const o = await order([seats[2]]); // 1 asiento pagado (131.79)
    // Se agrega una línea de cortesía (total 0) — no debe sumar un Q2 fantasma al surplus.
    const loc = (await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).localityId;
    await prisma.orderItem.create({
      data: {
        orderId: o.id,
        localityId: loc,
        seatId: seats[3],
        net: '0.00',
        total: '0.00',
        quote: {},
        quoteHash: '',
      },
    });

    const p = await http().post(`/api/v1/orders/${o.id}/pay`).set(bearer()).send({}).expect(201);
    await webhook(`e66_2_${stamp}`, 'payment.succeeded', p.body.providerRef);

    const e = await paymentEntries(o.id);
    // paidItems = 1 → sin surplus: platform_revenue = platformFee(10.00) exacto.
    expect(money(e.platform_revenue)).toBe('10.00');
    expect(money(e.promoter_payable)).toBe('100.00');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('edge 3: pago mixto con porción de pasarela < fijo por transacción → 400 (no procesable)', async () => {
    const o = await order([seats[4]], walletToken); // total 131.79
    await creditWallet(walletBuyerId, '131.00'); // deja por pagar 0.79 (< Q2=2)
    await http()
      .post(`/api/v1/orders/${o.id}/pay`)
      .set(bearer(walletToken))
      .send({ useWallet: true })
      .expect(400);
    // La orden sigue pendiente (no se cobró ni se reservó saldo definitivamente).
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('pending');
  });

  it('edge 4: el admin baja el cost-share del promotor entre el quote y el pago → cuotas 409', async () => {
    const o = await order([seats[5]]);
    // Con cost-share 0.5 las cuotas están disponibles en payment-options.
    const opts = (await http().get(`/api/v1/orders/${o.id}/payment-options`).set(bearer()).expect(200)).body;
    const recu = opts.gateways.find((g: { gatewayId: string }) => g.gatewayId === recurrenteId);
    expect(recu.installmentOptions.length).toBeGreaterThan(1);

    // El admin baja el cost-share por debajo del umbral (0.3) → ya no califica para cuotas.
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: '0.00000' } });
    await http().post(`/api/v1/orders/${o.id}/pay`).set(bearer()).send({ installments: 3 }).expect(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('pending');
    // Restaurar para no afectar otros asserts del suite.
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: '0.50000' } });
  });

  it('edge 5: la pasarela default no puede exigir cost-share (>0) → 409 al hacerla default y al subírselo', async () => {
    // Crear una pasarela con umbral > 0 (no default) es válido.
    const gw = await http()
      .post('/api/v1/payment-gateways')
      .set(bearer(adminToken))
      .send({ name: `E66_gated_${stamp}`, provider: 'simulator', feePct: 0.05, minCostSharePct: 0.5 })
      .expect(201);
    // Hacerla default → 409 (dejaría a promotores sin ninguna pasarela).
    await http()
      .post(`/api/v1/payment-gateways/${gw.body.id}/make-default`)
      .set(bearer(adminToken))
      .expect(409);
    // Subirle el umbral a la default actual → 409 (debe estar disponible para todos).
    const def = await prisma.paymentGateway.findFirstOrThrow({ where: { isPlatformDefault: true } });
    await http()
      .patch(`/api/v1/payment-gateways/${def.id}`)
      .set(bearer(adminToken))
      .send({ minCostSharePct: 0.5 })
      .expect(409);

    await prisma.paymentGateway.deleteMany({ where: { name: `E66_gated_${stamp}` } });
  });
});
