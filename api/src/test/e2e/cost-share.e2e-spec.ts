import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { CostShareService } from '../../modules/cost-share/cost-share.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 3.5 · Ticket E — Reparto de gastos EXTRA promotor↔plataforma.
 * Config global + override por promotor + aplicación del gasto extra en el ledger
 * (partida doble: la parte del promotor se descuenta de su liquidación).
 */
describe('Reparto de gastos extra (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let costShare: CostShareService;
  let adminToken: string;
  let buyerToken: string;
  let promoterId: string;
  const SYS = '00000000-0000-0000-0000-000000000000';

  async function wipeLedger() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    costShare = app.get(CostShareService);
    await wipeLedger();
    await costShare.setDefaultPct(0.5); // estado base determinista
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: null } });
    adminToken = await loginTrusted(SEED.admin, 'cs-admin');
    buyerToken = await loginTrusted(SEED.buyer, 'cs-buyer');
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
    await costShare.setDefaultPct(0.5);
    await wipeLedger();
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

  it('config global es admin-only (buyer→403); default 0.5', async () => {
    await http().get('/api/v1/cost-share/default').set(bearer(buyerToken)).expect(403);
    const res = await http().get('/api/v1/cost-share/default').set(bearer(adminToken)).expect(200);
    expect(res.body.defaultPct).toBe(0.5);
  });

  it('override por promotor y su limpieza (vuelve al global)', async () => {
    const set = await http()
      .patch(`/api/v1/cost-share/promoter/${promoterId}`)
      .set(bearer(adminToken))
      .send({ pct: 1 })
      .expect(200);
    expect(set.body.effectivePct).toBe(1);
    // GET expone el override CRUDO + el efectivo (v3.8, para que el panel lea/edite).
    const withOverride = await http()
      .get(`/api/v1/cost-share/promoter/${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(withOverride.body.override).toBe(1);
    expect(withOverride.body.effectivePct).toBe(1);
    await http()
      .delete(`/api/v1/cost-share/promoter/${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    const eff = await http()
      .get(`/api/v1/cost-share/promoter/${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(eff.body.override).toBeNull(); // sin override tras limpiar
    expect(eff.body.effectivePct).toBe(0.5); // volvió al default global
  });

  it('GET /cost-share/promoter/:id → 403 buyer; 404 promotor inexistente', async () => {
    await http().get(`/api/v1/cost-share/promoter/${promoterId}`).set(bearer(buyerToken)).expect(403);
    await http()
      .get('/api/v1/cost-share/promoter/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .expect(404);
  });

  it('valida el rango del porcentaje (>1 → 400)', async () => {
    await http()
      .patch('/api/v1/cost-share/default')
      .set(bearer(adminToken))
      .send({ pct: 1.5 })
      .expect(400);
  });

  it('aplica gasto extra 50/50: descuenta la parte del promotor de su neto', async () => {
    // Neto de arranque del promotor.
    await ledger.post({
      kind: 'seed_payable',
      entries: [
        { type: 'promoter_payable', ownerId: promoterId, amount: '100.00' },
        { type: 'platform_revenue', amount: '-100.00' },
      ],
    });
    const res = await costShare.applyExtraCost({
      promoterId,
      amount: '10.00',
      kind: 'wallet_pass_fee',
    });
    expect(res.pct).toBe(0.5);
    expect(res.promoterShare).toBe('5.00');
    expect(res.platformShare).toBe('5.00');
    // promoter_payable: 100 - 5 = 95; platform_revenue: -100 - 5 = -105; platform_expense: +10.
    expect(await bal('promoter_payable', promoterId)).toBe('95');
    expect(await bal('platform_expense', SYS)).toBe('10');
    expect((await ledger.verifyChain()).ok).toBe(true);
  });

  it('con reparto en 0% (deshabilitado) la plataforma cubre todo el gasto', async () => {
    await costShare.setDefaultPct(0);
    const before = await bal('promoter_payable', promoterId);
    const res = await costShare.applyExtraCost({
      promoterId,
      amount: '8.00',
      kind: 'wallet_pass_fee',
    });
    expect(res.promoterShare).toBe('0.00');
    expect(res.platformShare).toBe('8.00');
    expect(await bal('promoter_payable', promoterId)).toBe(before); // el promotor no paga nada
    expect((await ledger.verifyChain()).ok).toBe(true);
  });
});
