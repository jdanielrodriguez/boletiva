import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Dashboard por evento (GET /events/:id/dashboard). Solo-lectura: KPIs financieros
 * (reutiliza la liquidación) + ventas/día + ocupación por localidad + asistencia.
 * Cubre: happy (promotor dueño y admin), agregaciones exactas, IDOR (403), 404 y 401.
 */
describe('Dashboard por evento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let promoterId: string;
  let buyerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
  });

  afterAll(async () => {
    // Limpieza en orden de FK (Event no tiene cascade hacia orders/localities).
    const where = { event: { name: { contains: 'DASH ' } } };
    await prisma.ticket.deleteMany({ where });
    await prisma.orderItem.deleteMany({ where: { order: where } });
    await prisma.order.deleteMany({ where });
    await prisma.locality.deleteMany({ where });
    await prisma.event.deleteMany({ where: { name: { contains: 'DASH ' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /**
   * Siembra un evento con: 2 localidades (general cap 100, seated cap 50), 1 orden
   * pagada con 3 ítems (2 general + 1 seated) y 3 boletos con estados distintos
   * (valid, used=check-in, revoked) para ejercitar ocupación y asistencia.
   */
  async function seedEvent(): Promise<{ eventId: string; genId: string; seatId: string }> {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const event = await prisma.event.create({
      data: {
        promoterId,
        name: `DASH ${stamp}`,
        slug: `dash-${stamp}`,
        startsAt: new Date('2027-05-01T00:00:00Z'),
        endsAt: new Date('2027-05-01T04:00:00Z'),
        status: 'published',
      },
    });
    const general = await prisma.locality.create({
      data: { eventId: event.id, name: 'General', slug: `gen-${stamp}`, kind: 'general', capacity: 100 },
    });
    const seated = await prisma.locality.create({
      data: { eventId: event.id, name: 'VIP', slug: `vip-${stamp}`, kind: 'seated', capacity: 50 },
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
    // 3 ítems: 2 general + 1 seated (todos activos → ticketsSold=3).
    const items = await Promise.all(
      [general.id, general.id, seated.id].map((localityId, i) =>
        prisma.orderItem.create({
          data: {
            orderId: order.id,
            localityId,
            net: '100.00',
            total: '129.87',
            quote: {},
            quoteHash: `h-${stamp}-${i}`,
            active: true,
          },
        }),
      ),
    );
    // 1 boleto por ítem, estados: valid, used (check-in), revoked.
    const statuses = ['valid', 'used', 'revoked'] as const;
    await Promise.all(
      items.map((it, i) =>
        prisma.ticket.create({
          data: {
            orderItemId: it.id,
            orderId: order.id,
            eventId: event.id,
            localityId: it.localityId,
            ownerId: buyerId,
            serial: `PE-${stamp}-${i}`,
            status: statuses[i],
            signature: 'sig-fake',
            signingKeyId: 'test-key',
            totpSecret: 'enc-fake',
            usedAt: statuses[i] === 'used' ? new Date() : null,
            revokedAt: statuses[i] === 'revoked' ? new Date() : null,
          },
        }),
      ),
    );
    return { eventId: event.id, genId: general.id, seatId: seated.id };
  }

  it('promotor dueño ve el dashboard con KPIs, ventas, ocupación y asistencia exactos', async () => {
    const { eventId, genId, seatId } = await seedEvent();
    const res = await http()
      .get(`/api/v1/events/${eventId}/dashboard`)
      .set(bearer(promoterToken))
      .expect(200);

    // KPIs financieros (de la liquidación).
    expect(res.body).toMatchObject({ eventId, currency: 'GTQ', status: 'published' });
    expect(res.body.summary).toMatchObject({
      paidOrders: 1,
      ticketsSold: 3,
      gross: '389.60',
      net: '300.00',
      iva: '39.60',
    });

    // Ventas por día: un punto (2026-07-01) con 1 orden y el total recaudado.
    expect(res.body.salesOverTime).toEqual([
      { day: '2026-07-01', orders: 1, revenue: '389.60' },
    ]);

    // Ocupación: general 2/100, VIP 1/50; totales 3/150.
    expect(res.body.occupancy.totalCapacity).toBe(150);
    expect(res.body.occupancy.totalSold).toBe(3);
    const gen = res.body.occupancy.byLocality.find((l: { localityId: string }) => l.localityId === genId);
    const vip = res.body.occupancy.byLocality.find((l: { localityId: string }) => l.localityId === seatId);
    expect(gen).toMatchObject({ capacity: 100, sold: 2, occupancyPct: 2 });
    expect(vip).toMatchObject({ capacity: 50, sold: 1, occupancyPct: 2 });

    // Asistencia: valid=1, used=1, revoked=1; check-in% = used/(valid+used) = 50.
    expect(res.body.attendance).toMatchObject({
      totalTickets: 3,
      valid: 1,
      used: 1,
      transferred: 0,
      revoked: 1,
      checkedInPct: 50,
    });
  });

  it('admin puede ver el dashboard de cualquier evento', async () => {
    const { eventId } = await seedEvent();
    await http().get(`/api/v1/events/${eventId}/dashboard`).set(bearer(adminToken)).expect(200);
  });

  it('IDOR: un promotor que NO es dueño del evento → 403', async () => {
    // Evento propiedad de OTRO usuario real (el comprador). El promotor semilla tiene
    // rol promoter (pasa el guard de rol) pero no es el dueño → el service da 403.
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const foreign = await prisma.event.create({
      data: {
        promoterId: buyerId,
        name: `DASH ${stamp}`,
        slug: `dash-${stamp}`,
        startsAt: new Date('2027-05-01T00:00:00Z'),
        endsAt: new Date('2027-05-01T04:00:00Z'),
        status: 'published',
      },
    });
    await http().get(`/api/v1/events/${foreign.id}/dashboard`).set(bearer(promoterToken)).expect(403);
  });

  it('404 evento inexistente; 401 sin token', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http().get(`/api/v1/events/${ghost}/dashboard`).set(bearer(promoterToken)).expect(404);
    await http().get(`/api/v1/events/${ghost}/dashboard`).expect(401);
  });
});
