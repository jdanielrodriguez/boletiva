import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Dashboards de SALÓN y PLANTILLA (GET /halls/:id/dashboard, /seat-templates/:id/dashboard).
 * Agregan métricas sobre los eventos vinculados (salón→eventos; plantilla→salones→eventos)
 * reutilizando el snapshot de dinero de las órdenes (server-authoritative). Admin-only.
 * Cubre: agregación exacta, la plantilla llega al evento vía su salón, RBAC (promotor→403),
 * 404 y 401.
 */
describe('Dashboards de salón y plantilla (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let promoterId: string;
  let buyerId: string;
  let hallId: string;
  let templateId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const template = await prisma.seatTemplate.create({ data: { name: `TPL ${stamp}` } });
    templateId = template.id;
    const hall = await prisma.hall.create({ data: { name: `HALL ${stamp}`, seatTemplateId: template.id } });
    hallId = hall.id;
    const event = await prisma.event.create({
      data: {
        promoterId,
        name: `SCOPE ${stamp}`,
        slug: `scope-${stamp}`,
        startsAt: new Date('2027-05-01T00:00:00Z'),
        endsAt: new Date('2027-05-01T04:00:00Z'),
        status: 'published',
        hallId: hall.id,
      },
    });
    const general = await prisma.locality.create({
      data: { eventId: event.id, name: 'General', slug: `gen-${stamp}`, kind: 'general', capacity: 100 },
    });
    const order = await prisma.order.create({
      data: {
        buyerId,
        eventId: event.id,
        status: 'paid',
        net: '300.00',
        platformFee: '30.00',
        taxableBase: '330.00',
        iva: '39.60',
        gatewayFee: '20.00',
        total: '389.60',
        paidAt: new Date('2026-07-01T12:00:00Z'),
      },
    });
    await Promise.all(
      [0, 1].map((i) =>
        prisma.orderItem.create({
          data: {
            orderId: order.id,
            localityId: general.id,
            net: '150.00',
            total: '194.80',
            quote: {},
            quoteHash: `sh-${stamp}-${i}`,
            active: true,
          },
        }),
      ),
    );
  });

  afterAll(async () => {
    const evWhere = { event: { name: { contains: 'SCOPE ' } } };
    await prisma.ticket.deleteMany({ where: evWhere });
    await prisma.orderItem.deleteMany({ where: { order: evWhere } });
    await prisma.order.deleteMany({ where: evWhere });
    await prisma.locality.deleteMany({ where: evWhere });
    await prisma.event.deleteMany({ where: { name: { contains: 'SCOPE ' } } });
    await prisma.hall.deleteMany({ where: { name: { contains: 'HALL ' } } });
    await prisma.seatTemplate.deleteMany({ where: { name: { contains: 'TPL ' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('dashboard del salón: agrega el evento vinculado (KPIs, ocupación, top)', async () => {
    const res = await http().get(`/api/v1/halls/${hallId}/dashboard`).set(bearer(adminToken)).expect(200);
    expect(res.body).toMatchObject({ scope: 'hall', id: hallId, eventsCount: 1, publishedCount: 1 });
    expect(res.body.summary).toMatchObject({ paidOrders: 1, ticketsSold: 2, gross: '389.60', net: '300.00', iva: '39.60' });
    expect(res.body.summary.services).toBe('89.60'); // gross − net
    expect(res.body.occupancy).toMatchObject({ totalCapacity: 100, totalSold: 2, occupancyPct: 2 });
    expect(res.body.salesOverTime).toEqual([{ day: '2026-07-01', orders: 1, revenue: '389.60' }]);
    expect(res.body.topEvents.length).toBe(1);
    expect(res.body.topEvents[0]).toMatchObject({ ticketsSold: 2, gross: '389.60' });
  });

  it('dashboard de la plantilla: llega al evento vía su salón', async () => {
    const res = await http()
      .get(`/api/v1/seat-templates/${templateId}/dashboard`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({ scope: 'template', id: templateId, eventsCount: 1 });
    expect(res.body.summary).toMatchObject({ ticketsSold: 2, gross: '389.60' });
  });

  it('RBAC: un promotor NO puede ver estos dashboards (admin-only) → 403', async () => {
    await http().get(`/api/v1/halls/${hallId}/dashboard`).set(bearer(promoterToken)).expect(403);
    await http().get(`/api/v1/seat-templates/${templateId}/dashboard`).set(bearer(promoterToken)).expect(403);
  });

  it('404 con id inexistente; 401 sin token', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http().get(`/api/v1/halls/${ghost}/dashboard`).set(bearer(adminToken)).expect(404);
    await http().get(`/api/v1/seat-templates/${ghost}/dashboard`).expect(401);
  });
});
