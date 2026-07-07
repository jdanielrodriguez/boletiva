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
  let stamp: number;
  const SYS = '00000000-0000-0000-0000-000000000000';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    stamp = Date.now();
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

  // ---- Cobertura adicional (auditoría QA) ----

  async function fundedUser(tag: string, amount: string, promoter = false): Promise<string> {
    const email = `wd_${tag}_${stamp}@test.com`;
    const s = await http().post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: tag });
    const id = s.body.user.id;
    await prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date(), ...(promoter ? { roles: ['promoter'] } : {}) },
    });
    await ledger.post({
      kind: 'seed_wallet',
      entries: [
        { type: 'user_wallet', ownerId: id, amount },
        { type: 'platform_revenue', amount: `-${amount}` },
      ],
    });
    return id;
  }

  it("[dinero] Banker's rounding del fee (medio centavo): usuario 6% y promotor 3%", async () => {
    const u = await fundedUser('round6', '100.00');
    const tok = await loginTrusted(`wd_round6_${stamp}@test.com`, 'wd-round6');
    // 12.75 * 0.06 = 0.765 → HALF_EVEN a 2 dec = 0.76 (dígito previo 6 par); net 11.99.
    const r = await http().post('/api/v1/wallet/withdrawals').set(bearer(tok)).send({ amount: 12.75 }).expect(201);
    expect(r.body).toMatchObject({ fee: '0.76', net: '11.99' });
    expect(Number(r.body.amount)).toBeCloseTo(Number(r.body.fee) + Number(r.body.net), 2);
    void u;

    const p = await fundedUser('round3', '100.00', true);
    const ptok = await loginTrusted(`wd_round3_${stamp}@test.com`, 'wd-round3');
    // 12.50 * 0.03 = 0.375 → HALF_EVEN = 0.38 (dígito previo 7 impar → sube); net 12.12.
    const r2 = await http().post('/api/v1/wallet/withdrawals').set(bearer(ptok)).send({ amount: 12.5 }).expect(201);
    expect(r2.body).toMatchObject({ feePct: 0.03, fee: '0.38', net: '12.12' });
    void p;
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('[dinero] pago directo desde pending (sin approve) liquida el ledger', async () => {
    await fundedUser('direct', '30.00');
    const tok = await loginTrusted(`wd_direct_${stamp}@test.com`, 'wd-direct');
    const req = await http().post('/api/v1/wallet/withdrawals').set(bearer(tok)).send({ amount: 10 }).expect(201);
    const settledBefore = Number(await bal('payout_settled', SYS));
    const paid = await http().post(`/api/v1/wallet/withdrawals/${req.body.id}/pay`).set(bearer(adminToken)).send({}).expect(200);
    expect(paid.body.status).toBe('paid'); // pending → paid directo
    expect(Number(await bal('payout_settled', SYS))).toBeCloseTo(settledBefore + 9.4, 2);
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('[concurrencia] dos solicitudes por el saldo total: una gana, la otra 409 (sin sobre-reserva)', async () => {
    const u = await fundedUser('race', '100.00');
    const tok = await loginTrusted(`wd_race_${stamp}@test.com`, 'wd-race');
    const reqOnce = () => http().post('/api/v1/wallet/withdrawals').set(bearer(tok)).send({ amount: 100 });
    const [a, b] = await Promise.all([reqOnce(), reqOnce()]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([201, 409]); // el guard del ledger rechaza la sobre-reserva
    expect(Number(await bal('user_wallet', u))).toBeGreaterThanOrEqual(0); // wallet nunca negativo
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('guardas de estado (409): re-aprobar, re-pagar, re-rechazar y cancelar un aprobado', async () => {
    await fundedUser('states', '50.00');
    const tok = await loginTrusted(`wd_states_${stamp}@test.com`, 'wd-states');
    const mk = async () =>
      (await http().post('/api/v1/wallet/withdrawals').set(bearer(tok)).send({ amount: 5 }).expect(201)).body.id;

    const a = await mk();
    await http().post(`/api/v1/wallet/withdrawals/${a}/approve`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/wallet/withdrawals/${a}/approve`).set(bearer(adminToken)).expect(409); // ya approved
    await http().delete(`/api/v1/wallet/withdrawals/${a}`).set(bearer(tok)).expect(409); // cancelar approved

    const b = await mk();
    await http().post(`/api/v1/wallet/withdrawals/${b}/pay`).set(bearer(adminToken)).send({}).expect(200);
    await http().post(`/api/v1/wallet/withdrawals/${b}/pay`).set(bearer(adminToken)).send({}).expect(409); // ya paid

    const c = await mk();
    await http().post(`/api/v1/wallet/withdrawals/${c}/reject`).set(bearer(adminToken)).send({}).expect(200);
    await http().post(`/api/v1/wallet/withdrawals/${c}/reject`).set(bearer(adminToken)).send({}).expect(409); // ya rejected
  });

  it('404 en approve/pay/reject con id inexistente; RBAC en pay/reject; 401 sin token', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http().post(`/api/v1/wallet/withdrawals/${ghost}/approve`).set(bearer(adminToken)).expect(404);
    await http().post(`/api/v1/wallet/withdrawals/${ghost}/pay`).set(bearer(adminToken)).send({}).expect(404);
    await http().post(`/api/v1/wallet/withdrawals/${ghost}/reject`).set(bearer(adminToken)).send({}).expect(404);

    const req = await http().post('/api/v1/wallet/withdrawals').set(bearer(buyerToken)).send({ amount: 3 }).expect(201);
    await http().post(`/api/v1/wallet/withdrawals/${req.body.id}/pay`).set(bearer(buyerToken)).send({}).expect(403);
    await http().post(`/api/v1/wallet/withdrawals/${req.body.id}/reject`).set(bearer(buyerToken)).send({}).expect(403);
    await http().delete(`/api/v1/wallet/withdrawals/${req.body.id}`).set(bearer(buyerToken)).expect(200); // limpieza

    // 401 sin token en rutas representativas.
    await http().post('/api/v1/wallet/withdrawals').send({ amount: 1 }).expect(401);
    await http().get('/api/v1/wallet/withdrawals').expect(401);
    await http().get('/api/v1/wallet/withdrawals/all').expect(401);
  });

  it('validación: correo sin verificar → 403; monto con >2 decimales o <1 → 400; /all sin filtro lista', async () => {
    const email = `wd_unverified_${stamp}@test.com`;
    const s = await http().post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: 'U' });
    await http().post('/api/v1/wallet/withdrawals').set(bearer(s.body.tokens.accessToken)).send({ amount: 5 }).expect(403);

    await http().post('/api/v1/wallet/withdrawals').set(bearer(buyerToken)).send({ amount: 12.345 }).expect(400);
    await http().post('/api/v1/wallet/withdrawals').set(bearer(buyerToken)).send({ amount: 0.5 }).expect(400);

    const all = await http().get('/api/v1/wallet/withdrawals/all').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(all.body)).toBe(true); // sin filtro de estado
  });
});
