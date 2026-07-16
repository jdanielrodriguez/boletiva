import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';
import { CANON } from './canon';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);
const SYS = '00000000-0000-0000-0000-000000000000';

/**
 * Ola 3 · Ticket 4 — Reembolsos y contracargos.
 * refund → acredita al wallet del comprador (inflow, sin la comisión de pasarela);
 * chargeback → el dinero sale por gateway_clearing (no se acredita al wallet).
 * Ambos: revierten la contabilidad, invalidan la orden y liberan el asiento.
 */
describe('Reembolsos y contracargos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let promoterId: string;
  let eventId: string;
  let seatIds: string[];
  let tokenR: string;
  let tokenCb: string;

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
        name: 'REF Test Event',
        slug: `ref-test-${Date.now()}`,
        startsAt: new Date('2027-08-01T20:00:00-06:00'),
        endsAt: new Date('2027-08-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'REF Loc', slug: 'ref-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: loc.id, label: `R${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    const mk = async (suffix: string, device: string) => {
      const email = `adv_ref_${suffix}_${Date.now()}@test.com`;
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
    const r = await mk('r', 'ref-r');
    const cb = await mk('cb', 'ref-cb');
    tokenR = r.token;
    tokenCb = cb.token;
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
    await prisma.user.deleteMany({ where: { email: { contains: 'adv_ref_' } } });
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

  const webhook = (id: string, type: string, ref: string) =>
    http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(id, type, ref))
      .send({ id, type, providerRef: ref });

  // Crea orden, la paga por pasarela y la confirma. Devuelve {orderId, providerRef}.
  async function paidOrder(token: string, seatIdx: number, evt: string) {
    const orderId = await order(token, seatIdx);
    const p = await http().post(`/api/v1/orders/${orderId}/pay`).set(bearer(token)).expect(201);
    await webhook(evt, 'payment.succeeded', p.body.providerRef).expect(200);
    return { orderId, providerRef: p.body.providerRef as string };
  }

  const bal = async (type: string, ownerId: string) =>
    (
      await prisma.ledgerAccount.findUnique({
        where: { type_ownerId_currency: { type: type as never, ownerId, currency: 'GTQ' } },
      })
    )?.balance.toString() ?? '0';

  const walletBalance = async (token: string) =>
    (await http().get('/api/v1/wallet').set(bearer(token)).expect(200)).body.balance as string;

  it('reembolso → orden refunded, asiento liberado y saldo acreditado al wallet (sin fee)', async () => {
    const { orderId, providerRef } = await paidOrder(tokenR, 0, 'ref_s1');
    expect(await bal('promoter_payable', promoterId)).toBe('100'); // tras el pago

    await webhook('ref_r1', 'payment.refunded', providerRef).expect(200);

    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('refunded');
    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatIds[0] } });
    expect(seat.status).toBe('available'); // liberado para reventa
    const payment = await prisma.payment.findUniqueOrThrow({ where: { providerRef } });
    expect(payment.status).toBe('refunded');

    // Clawback: promotor/plataforma/IVA vuelven a 0; el comprador recibe inflow (123.20).
    expect(await bal('promoter_payable', promoterId)).toBe('0');
    expect(await bal('platform_revenue', SYS)).toBe('0');
    expect(await bal('tax_payable', SYS)).toBe('0');
    expect(await walletBalance(tokenR)).toBe(CANON.inflow); // total - gatewayFee (fee no reembolsable)
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('idempotencia: reenviar el mismo reembolso no duplica ni recredita', async () => {
    const before = await prisma.ledgerTransaction.count();
    const res = await webhook('ref_r1', 'payment.refunded', 'irrelevante').expect(200);
    expect(res.body.duplicate).toBe(true);
    expect(await prisma.ledgerTransaction.count()).toBe(before);
    expect(await walletBalance(tokenR)).toBe(CANON.inflow); // sin recrédito
  });

  it('contracargo → orden refunded, asiento liberado; NO se acredita al wallet', async () => {
    const { orderId, providerRef } = await paidOrder(tokenCb, 1, 'ref_s2');
    await webhook('ref_cb1', 'payment.chargeback', providerRef).expect(200);

    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('refunded');
    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatIds[1] } });
    expect(seat.status).toBe('available');
    expect(await walletBalance(tokenCb)).toBe('0.00'); // el dinero salió por la tarjeta
    expect(await bal('promoter_payable', promoterId)).toBe('0'); // clawback
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('facturación (movimientos): requiere auth y separa ingreso (refund) de egreso (compra)', async () => {
    // Sin token → 401 (guard global).
    await http().get('/api/v1/orders/movements').expect(401);

    // El comprador tokenR ya tiene: una compra reembolsada (egreso) + su refund
    // acreditado al wallet (ingreso, 123.20).
    const res = await http().get('/api/v1/orders/movements').set(bearer(tokenR)).expect(200);
    const items = res.body.items as Array<{
      direction: string;
      kind: string;
      amount: string;
      status: string | null;
      orderId: string | null;
      createdAt: string;
    }>;
    expect(items.some((i) => i.direction === 'expense' && i.kind === 'purchase')).toBe(true);
    const refund = items.find((i) => i.direction === 'income' && i.kind === 'refund');
    expect(refund).toBeDefined();
    expect(refund?.amount).toBe(CANON.inflow);
    // v3.7: los ingresos de devolución llevan un `status` coherente ('refunded')
    // para poder filtrar la facturación por estado igual que los egresos.
    expect(refund?.status).toBe('refunded');
    // Los egresos conservan el estado real de la orden (la compra fue reembolsada).
    const expense = items.find((i) => i.direction === 'expense' && i.kind === 'purchase');
    expect(expense?.status).toBe('refunded');

    // Ordenado por fecha DESC.
    const dates = items.map((i) => i.createdAt);
    expect([...dates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))).toEqual(dates);
  });

  it('no se puede reembolsar una orden no pagada (webhook ignorado, orden intacta)', async () => {
    const orderId = await order(tokenR, 2);
    const p = await http().post(`/api/v1/orders/${orderId}/pay`).set(bearer(tokenR)).expect(201);
    // Sin confirmar el pago; llega un refund → no-op.
    await webhook('ref_r_unpaid', 'payment.refunded', p.body.providerRef).expect(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('pending'); // intacta
    expect(await walletBalance(tokenR)).toBe(CANON.inflow); // sin cambios
  });
});
