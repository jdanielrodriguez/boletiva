import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Fase 4 · Dashboard ADMIN de rentabilidad por evento (GET /admin/analytics/profitability
 * [+ /export.xlsx]). Agrega el snapshot de órdenes pagadas por evento y expone el reparto
 * + el % de comisión de plataforma EFECTIVO por evento (varía: uno al 10%, otro al 20%).
 * Cubre: cálculo exacto del % y totales, orden por ganancia, RBAC (promotor→403, sin
 * token→401) y la descarga .xlsx.
 */
describe('Rentabilidad admin por evento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let promoterId: string;
  let buyerId: string;
  const stamp = `${Date.now()}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;

    // Evento A: plataforma 10% (net 1000 → platformFee 100). Evento B: 20% (200).
    const mk = async (tag: string, net: number, platformFee: number) => {
      const ev = await prisma.event.create({
        data: {
          promoterId,
          name: `PROF ${tag} ${stamp}`,
          slug: `prof-${tag}-${stamp}`,
          startsAt: new Date('2027-09-01T00:00:00Z'),
          endsAt: new Date('2027-09-01T04:00:00Z'),
          status: 'published',
        },
      });
      const loc = await prisma.locality.create({
        data: { eventId: ev.id, name: 'General', slug: `g-${tag}-${stamp}`, kind: 'general', capacity: 100 },
      });
      const iva = net * 0.12;
      const order = await prisma.order.create({
        data: {
          buyerId,
          eventId: ev.id,
          status: 'paid',
          net: net.toFixed(2),
          platformFee: platformFee.toFixed(2),
          fixedFees: '0.00',
          taxableBase: (net + platformFee).toFixed(2),
          iva: iva.toFixed(2),
          gatewayFee: '50.00',
          total: (net + platformFee + iva + 50).toFixed(2),
          paidAt: new Date('2026-07-01T12:00:00Z'),
        },
      });
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          localityId: loc.id,
          net: net.toFixed(2),
          total: (net + platformFee + iva + 50).toFixed(2),
          quote: {},
          quoteHash: `prof-${tag}-${stamp}`,
          active: true,
        },
      });
      return ev.id;
    };
    await mk('A', 1000, 100); // 10%
    await mk('B', 1000, 200); // 20%
  });

  afterAll(async () => {
    const evWhere = { event: { name: { contains: `PROF ` } } };
    await prisma.orderItem.deleteMany({ where: { order: evWhere } });
    await prisma.order.deleteMany({ where: evWhere });
    await prisma.locality.deleteMany({ where: evWhere });
    await prisma.event.deleteMany({ where: { name: { contains: `PROF ` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('admin: rentabilidad con % efectivo por evento + totales', async () => {
    const res = await http().get('/api/v1/admin/analytics/profitability').set(bearer(adminToken)).expect(200);
    const a = res.body.events.find((e: { name: string }) => e.name === `PROF A ${stamp}`);
    const b = res.body.events.find((e: { name: string }) => e.name === `PROF B ${stamp}`);
    expect(a).toMatchObject({ net: '1000.00', platformFee: '100.00', platformPct: 10 });
    expect(b).toMatchObject({ net: '1000.00', platformFee: '200.00', platformPct: 20 });
    // Ordenado por ganancia desc → B antes que A.
    const idxA = res.body.events.findIndex((e: { name: string }) => e.name === `PROF A ${stamp}`);
    const idxB = res.body.events.findIndex((e: { name: string }) => e.name === `PROF B ${stamp}`);
    expect(idxB).toBeLessThan(idxA);
    // Totales incluyen ambos (≥ 2000 neto, ≥ 300 ganancia).
    expect(Number(res.body.net)).toBeGreaterThanOrEqual(2000);
    expect(Number(res.body.platformFee)).toBeGreaterThanOrEqual(300);
  });

  it('RBAC: promotor → 403; sin token → 401', async () => {
    await http().get('/api/v1/admin/analytics/profitability').set(bearer(promoterToken)).expect(403);
    await http().get('/api/v1/admin/analytics/profitability').expect(401);
  });

  it('exporta la rentabilidad en Excel (.xlsx)', async () => {
    const res = await http()
      .get('/api/v1/admin/analytics/profitability/export.xlsx')
      .set(bearer(adminToken))
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });
});
