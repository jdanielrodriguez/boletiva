import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 4 · Ticket 4 — Pases de wallet (proveedor stub) + cargo EXTRA repartido.
 * Cubre: pase Google (URL) y Apple (.pkpass firmado en storage), IDOR, plataforma
 * inválida (400), boleto revocado (400) y el reparto del cargo por wallet
 * promotor↔plataforma en el ledger cuando el cargo está configurado.
 */
describe('Pases de wallet (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let buyerToken: string;
  let buyerBToken: string;
  let eventId: string;
  let promoterId: string;
  let seatIds: string[];
  let stamp: number;
  const SYS = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    stamp = Date.now();
    // Chain contable limpio para poder verificarlo al final (verifyChain).
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    const event = await prisma.event.create({
      data: {
        promoterId,
        name: 'WPASS Event',
        slug: `wpass-${stamp}`,
        startsAt: new Date('2027-07-01T20:00:00-06:00'),
        endsAt: new Date('2027-07-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'WLoc', slug: 'wloc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: loc.id, label: `W${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    buyerToken = await loginTrusted(SEED.buyer, 'wpass-devA');
    const emailB = `wpass_b_${stamp}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({ where: { id: sB.body.user.id }, data: { emailVerifiedAt: new Date() } });
    buyerBToken = await loginTrusted(emailB, 'wpass-devB');
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
    await prisma.setting.update({ where: { key: 'wallet.pass_fee' }, data: { value: 0 } }).catch(() => undefined);
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const bal = async (type: string, ownerId: string) =>
    (
      await prisma.ledgerAccount.findUnique({
        where: { type_ownerId_currency: { type: type as never, ownerId, currency: 'GTQ' } },
      })
    )?.balance.toString() ?? '0';

  async function buyAndGetTicket(seatIdx: number): Promise<string> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const orderId = created.body.id;
    const p = await http().post(`/api/v1/orders/${orderId}/pay`).set(bearer(buyerToken)).expect(201);
    const evt = `evt_wpass_${seatIdx}_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    return ticket.id;
  }

  it('genera un pase de Google (URL "Save to Google Wallet")', async () => {
    const id = await buyAndGetTicket(0);
    const res = await http()
      .post(`/api/v1/tickets/${id}/wallet`)
      .set(bearer(buyerToken))
      .send({ platform: 'google' })
      .expect(200);
    expect(res.body.platform).toBe('google');
    expect(res.body.provider).toBe('stub');
    expect(res.body.url).toContain('pay.google.com');
    expect(res.body.feeApplied).toBe('0.00'); // sin cargo por defecto
  });

  it('genera un pase de Apple (.pkpass firmado en storage)', async () => {
    const id = await buyAndGetTicket(1);
    const res = await http()
      .post(`/api/v1/tickets/${id}/wallet`)
      .set(bearer(buyerToken))
      .send({ platform: 'apple' })
      .expect(200);
    expect(res.body.platform).toBe('apple');
    expect(res.body.url).toContain('pass.pkpass');
  });

  it('IDOR: otro usuario no genera el pase de un boleto ajeno → 404', async () => {
    const id = await buyAndGetTicket(2);
    await http()
      .post(`/api/v1/tickets/${id}/wallet`)
      .set(bearer(buyerBToken))
      .send({ platform: 'google' })
      .expect(404);
  });

  it('plataforma inválida → 400', async () => {
    const id = await buyAndGetTicket(3);
    await http()
      .post(`/api/v1/tickets/${id}/wallet`)
      .set(bearer(buyerToken))
      .send({ platform: 'samsung' })
      .expect(400);
  });

  it('boleto revocado no puede pasar a wallet → 400', async () => {
    const id = await buyAndGetTicket(4);
    await prisma.ticket.update({ where: { id }, data: { status: 'revoked' } });
    await http()
      .post(`/api/v1/tickets/${id}/wallet`)
      .set(bearer(buyerToken))
      .send({ platform: 'google' })
      .expect(400);
  });

  it('con cargo por wallet configurado, se reparte prom↔plat en el ledger', async () => {
    await prisma.setting.upsert({
      where: { key: 'wallet.pass_fee' },
      update: { value: 2 },
      create: { key: 'wallet.pass_fee', value: 2, description: 'test' },
    });
    const id = await buyAndGetTicket(5);
    const expenseBefore = await bal('platform_expense', SYS);
    const payableBefore = await bal('promoter_payable', promoterId);

    const res = await http()
      .post(`/api/v1/tickets/${id}/wallet`)
      .set(bearer(buyerToken))
      .send({ platform: 'google' })
      .expect(200);
    expect(res.body.feeApplied).toBe('2.00');

    // Default 50%: platform_expense +2; promotor asume 1 (su neto baja 1).
    expect(Number(await bal('platform_expense', SYS))).toBeCloseTo(Number(expenseBefore) + 2, 2);
    expect(Number(await bal('promoter_payable', promoterId))).toBeCloseTo(
      Number(payableBefore) - 1,
      2,
    );
    expect((await ledger.verifyChain()).ok).toBe(true);
  });
});
