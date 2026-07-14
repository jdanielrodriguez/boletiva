import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Dashboard GLOBAL del promotor (GET /promoter/dashboard [+ /export.xlsx]).
 * Agrega, sobre TODOS los eventos del promotor, el snapshot inmutable de las órdenes
 * en estado terminal (pagadas / reembolsadas), server-authoritative, y arma la tabla
 * cruzada por dimensión (evento/categoría/salón/estado/mes) YA sumada en el backend.
 *
 * Cubre: KPIs globales exactos (incl. devoluciones y check-ins), agregación por cada
 * dimensión (2 eventos → categorías/salones distintos), authz (admin ve a cualquiera
 * con ?promoterId, un promotor NO ve a otro → 403, buyer → 403 por rol, 401 sin token,
 * 404 promotor inexistente) y la descarga .xlsx.
 */
describe('Dashboard global del promotor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let buyerToken: string;
  let promoterId: string; // promotor fresco (aislado del seed)
  let buyerId: string;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    buyerToken = await login(app, SEED.buyer);
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;

    // Promotor FRESCO sin eventos del seed → totales deterministas.
    const promoter = await prisma.user.create({
      data: {
        email: `pdash-${stamp}@pasaeventos.com`,
        firstName: 'Promo',
        lastName: 'Dash',
        roles: ['promoter'],
        promoterStatus: 'approved',
        emailVerifiedAt: new Date(),
      },
    });
    promoterId = promoter.id;

    const catA = await prisma.category.create({ data: { name: `PDCat A ${stamp}`, slug: `pdcat-a-${stamp}` } });
    const catB = await prisma.category.create({ data: { name: `PDCat B ${stamp}`, slug: `pdcat-b-${stamp}` } });
    const hallA = await prisma.hall.create({ data: { name: `PDHall A ${stamp}` } });
    const hallB = await prisma.hall.create({ data: { name: `PDHall B ${stamp}` } });

    // --- Evento 1: publicado, categoría A / salón A, mayo 2027 ---
    const ev1 = await prisma.event.create({
      data: {
        promoterId,
        name: `PDASH E1 ${stamp}`,
        slug: `pdash-e1-${stamp}`,
        startsAt: new Date('2027-05-01T00:00:00Z'),
        endsAt: new Date('2027-05-01T04:00:00Z'),
        status: 'published',
        categoryId: catA.id,
        hallId: hallA.id,
      },
    });
    const loc1 = await prisma.locality.create({
      data: { eventId: ev1.id, name: 'General', slug: `pd-g1-${stamp}`, kind: 'general', capacity: 100 },
    });
    const o1 = await prisma.order.create({
      data: {
        buyerId,
        eventId: ev1.id,
        status: 'paid',
        net: '300.00',
        platformFee: '30.00',
        fixedFees: '0.00',
        taxableBase: '330.00',
        iva: '39.60',
        gatewayFee: '20.00',
        total: '389.60',
        paidAt: new Date('2026-07-01T12:00:00Z'),
      },
    });
    const items1 = await Promise.all(
      [0, 1].map((i) =>
        prisma.orderItem.create({
          data: {
            orderId: o1.id,
            localityId: loc1.id,
            net: '150.00',
            total: '194.80',
            quote: {},
            quoteHash: `pd-${stamp}-1-${i}`,
            active: true,
          },
        }),
      ),
    );
    // 2 boletos: 1 con check-in (used), 1 válido.
    const tk = (i: number, itemId: string, status: 'used' | 'valid') => ({
      orderItemId: itemId, orderId: o1.id, eventId: ev1.id, localityId: loc1.id, ownerId: buyerId, status,
      serial: `PD-${stamp}-1${i}`, totpSecret: 'x', signature: 'x', signingKeyId: 'k1',
    });
    await prisma.ticket.create({ data: tk(0, items1[0].id, 'used') });
    await prisma.ticket.create({ data: tk(1, items1[1].id, 'valid') });

    // --- Evento 2: finalizado, categoría B / salón B, junio 2027 + 1 orden reembolsada ---
    const ev2 = await prisma.event.create({
      data: {
        promoterId,
        name: `PDASH E2 ${stamp}`,
        slug: `pdash-e2-${stamp}`,
        startsAt: new Date('2027-06-15T00:00:00Z'),
        endsAt: new Date('2027-06-15T04:00:00Z'),
        status: 'finished',
        categoryId: catB.id,
        hallId: hallB.id,
      },
    });
    const loc2 = await prisma.locality.create({
      data: { eventId: ev2.id, name: 'VIP', slug: `pd-g2-${stamp}`, kind: 'general', capacity: 50 },
    });
    const o2 = await prisma.order.create({
      data: {
        buyerId, eventId: ev2.id, status: 'paid',
        net: '150.00', platformFee: '15.00', fixedFees: '0.00', taxableBase: '165.00',
        iva: '19.80', gatewayFee: '10.00', total: '194.80',
        paidAt: new Date('2026-07-02T12:00:00Z'),
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: o2.id, localityId: loc2.id, net: '150.00', total: '194.80',
        quote: {}, quoteHash: `pd-${stamp}-2-0`, active: true,
      },
    });
    // Orden reembolsada del ev2 (cuenta en devoluciones, NO en gross/net).
    await prisma.order.create({
      data: {
        buyerId, eventId: ev2.id, status: 'refunded',
        net: '150.00', platformFee: '15.00', fixedFees: '0.00', taxableBase: '165.00',
        iva: '19.80', gatewayFee: '10.00', total: '194.80',
        paidAt: new Date('2026-07-02T13:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    const evWhere = { event: { name: { contains: `PDASH ` } } };
    await prisma.ticket.deleteMany({ where: evWhere });
    await prisma.orderItem.deleteMany({ where: { order: evWhere } });
    await prisma.order.deleteMany({ where: evWhere });
    await prisma.locality.deleteMany({ where: evWhere });
    await prisma.event.deleteMany({ where: { name: { contains: `PDASH ` } } });
    await prisma.hall.deleteMany({ where: { name: { contains: `PDHall ` } } });
    await prisma.category.deleteMany({ where: { name: { contains: `PDCat ` } } });
    await prisma.user.deleteMany({ where: { email: { contains: `pdash-${stamp}` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('KPIs globales exactos (admin con ?promoterId): 2 eventos, devoluciones y check-ins', async () => {
    const res = await http()
      .get(`/api/v1/promoter/dashboard?promoterId=${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({ promoterId, currency: 'GTQ', eventsCount: 2, publishedCount: 1 });
    // gross = 389.60 + 194.80 = 584.40 ; net = 300 + 150 = 450 ; iva = 39.60 + 19.80 = 59.40
    expect(res.body.summary).toMatchObject({
      paidOrders: 2,
      ticketsSold: 3, // 2 (ev1) + 1 (ev2)
      gross: '584.40',
      net: '450.00',
      platformFee: '45.00',
      gatewayFee: '30.00',
      iva: '59.40',
      services: '75.00', // 45 + 30 + 0 fijos
      refundsCount: 1,
      refundsIssued: '150.00',
      capacity: 150,
      checkedIn: 1,
    });
    // ocupación = 3/150 = 2%
    expect(res.body.summary.occupancyPct).toBe(2);
  });

  it('tabla cruzada por dimensión: cada una suma a los mismos totales', async () => {
    const res = await http()
      .get(`/api/v1/promoter/dashboard?promoterId=${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    const dims = res.body.dimensions;
    for (const key of ['event', 'category', 'hall', 'status', 'month']) {
      expect(Array.isArray(dims[key])).toBe(true);
    }
    // 2 eventos → 2 filas por evento/categoría/salón/mes; estado: published + finished.
    expect(dims.event.length).toBe(2);
    expect(dims.category.length).toBe(2);
    expect(dims.hall.length).toBe(2);
    expect(dims.month.length).toBe(2);
    expect(dims.status.map((r: { key: string }) => r.key).sort()).toEqual(['finished', 'published']);
    // La fila top por recaudación es el evento 1 (389.60).
    expect(dims.event[0]).toMatchObject({ ticketsSold: 2, gross: '389.60', net: '300.00', checkedIn: 1 });
    // Suma de gross de las filas de "category" == gross global (agregación consistente).
    const sumGross = dims.category.reduce((a: number, r: { gross: string }) => a + Number(r.gross), 0);
    expect(sumGross.toFixed(2)).toBe('584.40');
    // La devolución aparece en la fila de la categoría B (evento 2).
    const catB = dims.category.find((r: { refunds: string }) => r.refunds !== '0.00');
    expect(catB.refunds).toBe('150.00');
  });

  it('un promotor ve SU propio dashboard sin ?promoterId (200, forma correcta)', async () => {
    const res = await http().get('/api/v1/promoter/dashboard').set(bearer(promoterToken)).expect(200);
    expect(res.body.dimensions).toBeDefined();
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.promoterId).toBe('string');
  });

  it('authz: un promotor NO puede ver el de otro promotor → 403', async () => {
    await http()
      .get(`/api/v1/promoter/dashboard?promoterId=${promoterId}`)
      .set(bearer(promoterToken))
      .expect(403);
  });

  it('RBAC: un comprador (sin rol promotor) → 403; sin token → 401', async () => {
    await http().get('/api/v1/promoter/dashboard').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/promoter/dashboard').expect(401);
  });

  it('404: admin pide un promotor inexistente', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http()
      .get(`/api/v1/promoter/dashboard?promoterId=${ghost}`)
      .set(bearer(adminToken))
      .expect(404);
  });

  it('exporta el dashboard en Excel (.xlsx) con adjunto', async () => {
    const res = await http()
      .get(`/api/v1/promoter/dashboard/export.xlsx?promoterId=${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.xlsx');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });
});
