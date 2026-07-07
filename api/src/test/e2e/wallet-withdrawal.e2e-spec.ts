import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 6 · Ticket 1 — Retiros de saldo interno (solicitud→aprobación→pago).
 * Cubre: reserva en el ledger, comisión usuario vs promotor (doble), saldo
 * insuficiente, aprobación/pago (liquidación), rechazo/cancelación (reintegro),
 * guardas de estado, RBAC, IDOR y validación. El ledger cuadra en cada paso.
 */
describe('Retiros de wallet (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let buyerToken: string;
  let buyerId: string;
  let promoterToken: string;
  let promoterId: string;
  let adminToken: string;
  const SYS = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    await prisma.walletWithdrawal.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});

    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerToken = await loginTrusted(SEED.buyer, 'wd-buyer');
    promoterToken = await loginTrusted(SEED.promoter, 'wd-prom');
    adminToken = await loginTrusted(SEED.admin, 'wd-admin');

    // Fondear los wallets (créditos que normalmente vienen de reembolsos/reventas).
    await ledger.post({
      kind: 'seed_wallet',
      entries: [
        { type: 'user_wallet', ownerId: buyerId, amount: '200.00' },
        { type: 'user_wallet', ownerId: promoterId, amount: '200.00' },
        { type: 'platform_revenue', amount: '-400.00' },
      ],
    });
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
    await prisma.walletWithdrawal.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
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

  it('solicita un retiro (usuario 6%): reserva en el ledger y baja el saldo', async () => {
    const res = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 100 })
      .expect(201);
    expect(res.body).toMatchObject({ amount: '100.00', fee: '6.00', net: '94.00', status: 'pending' });

    expect(await bal('user_wallet', buyerId)).toBe('100'); // 200 - 100
    expect(await bal('payout_pending', SYS)).toBe('94');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('el promotor paga la mitad de comisión (3%)', async () => {
    const res = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(promoterToken))
      .send({ amount: 100 })
      .expect(201);
    expect(res.body).toMatchObject({ feePct: 0.03, fee: '3.00', net: '97.00' });
  });

  it('saldo insuficiente → 400 (sin reservar)', async () => {
    await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 100000 })
      .expect(400);
  });

  it('validación: monto <=0 o faltante → 400', async () => {
    await http().post('/api/v1/wallet/withdrawals').set(bearer(buyerToken)).send({ amount: 0 }).expect(400);
    await http().post('/api/v1/wallet/withdrawals').set(bearer(buyerToken)).send({}).expect(400);
  });

  it('aprueba y paga (admin): liquida payout_pending → payout_settled', async () => {
    const req = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 10 })
      .expect(201); // fee 0.60, net 9.40
    const id = req.body.id;
    const pendingBefore = Number(await bal('payout_pending', SYS));

    await http().post(`/api/v1/wallet/withdrawals/${id}/approve`).set(bearer(adminToken)).expect(200);
    const paid = await http()
      .post(`/api/v1/wallet/withdrawals/${id}/pay`)
      .set(bearer(adminToken))
      .send({ note: 'transf-ref-123' })
      .expect(200);
    expect(paid.body.status).toBe('paid');

    expect(Number(await bal('payout_pending', SYS))).toBeCloseTo(pendingBefore - 9.4, 2);
    expect(await bal('payout_settled', SYS)).toBe('9.4');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('rechazar reintegra el saldo y la comisión al wallet', async () => {
    const before = Number(await bal('user_wallet', buyerId));
    const req = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 20 })
      .expect(201);
    expect(Number(await bal('user_wallet', buyerId))).toBeCloseTo(before - 20, 2);

    await http()
      .post(`/api/v1/wallet/withdrawals/${req.body.id}/reject`)
      .set(bearer(adminToken))
      .send({ note: 'datos bancarios inválidos' })
      .expect(200);
    expect(Number(await bal('user_wallet', buyerId))).toBeCloseTo(before, 2); // reintegrado
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('el usuario cancela su retiro pendiente (reintegro); IDOR y estado', async () => {
    const before = Number(await bal('user_wallet', buyerId));
    const req = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 15 })
      .expect(201);
    const id = req.body.id;

    // Otro usuario no puede cancelar mi retiro (IDOR).
    await http().delete(`/api/v1/wallet/withdrawals/${id}`).set(bearer(promoterToken)).expect(404);
    const cancel = await http().delete(`/api/v1/wallet/withdrawals/${id}`).set(bearer(buyerToken)).expect(200);
    expect(cancel.body.status).toBe('cancelled');
    expect(Number(await bal('user_wallet', buyerId))).toBeCloseTo(before, 2);
    // Cancelar de nuevo → 409 (ya no está pendiente).
    await http().delete(`/api/v1/wallet/withdrawals/${id}`).set(bearer(buyerToken)).expect(409);
  });

  it('guardas de estado: pagar un retiro rechazado → 409', async () => {
    const req = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 5 })
      .expect(201);
    await http().post(`/api/v1/wallet/withdrawals/${req.body.id}/reject`).set(bearer(adminToken)).send({}).expect(200);
    await http().post(`/api/v1/wallet/withdrawals/${req.body.id}/pay`).set(bearer(adminToken)).send({}).expect(409);
  });

  it('RBAC: un no-admin no aprueba/paga (403); listado admin filtra por estado', async () => {
    const req = await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(buyerToken))
      .send({ amount: 5 })
      .expect(201);
    await http().post(`/api/v1/wallet/withdrawals/${req.body.id}/approve`).set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/wallet/withdrawals/all').set(bearer(buyerToken)).expect(403);

    const all = await http().get('/api/v1/wallet/withdrawals/all?status=pending').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(all.body)).toBe(true);
    await http().get('/api/v1/wallet/withdrawals/all?status=xxx').set(bearer(adminToken)).expect(400);
    // Limpieza: cancela el pendiente que quedó.
    await http().delete(`/api/v1/wallet/withdrawals/${req.body.id}`).set(bearer(buyerToken)).expect(200);
  });

  it('mis retiros lista solo los míos', async () => {
    const mine = await http().get('/api/v1/wallet/withdrawals').set(bearer(buyerToken)).expect(200);
    expect(mine.body.every((w: { userId: string }) => w.userId === buyerId)).toBe(true);
  });
});
