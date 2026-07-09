import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Cobertura de endpoints de gestión de eventos (la mayoría de suites crean eventos
 * vía Prisma directo y NO ejercen el controller). Cubre: enforcement de promotor
 * aprobado en publish, cancel, delete, detalle por slug (404), 409 por pasarela
 * congelada, validación de pasarela y de entrada, /mine, /manage, RBAC y 401.
 */
describe('Eventos: gestión (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string; // seed (aprobado)
  let promoterId: string;
  let promoterBToken: string; // segundo promotor aprobado
  let promoterBId: string;
  let pendingPromoterToken: string; // rol promoter pero NO aprobado
  let pendingPromoterId: string;
  let buyerToken: string;
  let adminToken: string;
  let stamp: number;
  let inactiveGatewayId: string;

  const body = (over: Record<string, unknown> = {}) => ({
    name: `Ev ${Date.now()}`,
    startsAt: new Date('2027-10-01T20:00:00-06:00').toISOString(),
    endsAt: new Date('2027-10-01T23:00:00-06:00').toISOString(),
    ...over,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    promoterToken = await loginTrusted(SEED.promoter, 'ev-prom');
    buyerToken = await loginTrusted(SEED.buyer, 'ev-buyer');
    adminToken = await loginTrusted(SEED.admin, 'ev-admin');

    promoterBId = (await mkUser('evpromb', { roles: ['promoter'], promoterStatus: 'approved' })).id;
    promoterBToken = await loginTrusted(`evpromb_${stamp}@test.com`, 'ev-promb');

    pendingPromoterId = (await mkUser('evpend', { roles: ['promoter'], promoterStatus: 'pending' })).id;
    pendingPromoterToken = await loginTrusted(`evpend_${stamp}@test.com`, 'ev-pend');

    const gw = await prisma.paymentGateway.create({
      data: { name: `EvInactive ${stamp}`, provider: 'simulator', feePct: '0.05000', status: 'inactive' },
    });
    inactiveGatewayId = gw.id;
  });

  async function mkUser(tag: string, data: Record<string, unknown>) {
    const email = `${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    return prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), ...data },
    });
  }

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
    const ids = [promoterBId, pendingPromoterId];
    await prisma.event.deleteMany({ where: { promoterId: { in: [promoterId, ...ids] }, slug: { contains: String(stamp) } } });
    await prisma.event.deleteMany({ where: { name: { startsWith: 'Ev ' }, promoterId: { in: ids } } });
    await prisma.paymentGateway.deleteMany({ where: { id: inactiveGatewayId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const createEvent = async (token: string, over = {}) =>
    (await http().post('/api/v1/events').set(bearer(token)).send(body(over)).expect(201)).body;

  it('publicar exige promotor aprobado: rol promoter pero pending → 403', async () => {
    // Evento propiedad del promotor no-aprobado (insertado directo para aislar publish).
    const ev = await prisma.event.create({
      data: {
        promoterId: pendingPromoterId,
        name: 'Pend Ev',
        slug: `pend-ev-${stamp}`,
        startsAt: new Date('2027-10-01T20:00:00-06:00'),
        endsAt: new Date('2027-10-01T23:00:00-06:00'),
      },
    });
    await prisma.locality.create({
      data: { eventId: ev.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 5 },
    });
    await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(pendingPromoterToken)).expect(403);
  });

  it('detalle por slug: inexistente → 404; borrador no es visible → 404', async () => {
    await http().get('/api/v1/events/no-existe-slug').expect(404);
    const draft = await createEvent(promoterToken);
    await http().get(`/api/v1/events/${draft.slug}`).expect(404); // draft no publicado
  });

  it('crear con pasarela inactiva → 400', async () => {
    await http()
      .post('/api/v1/events')
      .set(bearer(promoterToken))
      .send(body({ gatewayId: inactiveGatewayId }))
      .expect(400);
  });

  it('validación de entrada al crear → 400 (name corto, categoryId/lat inválidos)', async () => {
    await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ name: 'ab' })).expect(400);
    await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ categoryId: 'no-uuid' })).expect(400);
    await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ lat: 200 })).expect(400);
  });

  it('PATCH sobre evento con pasarela congelada → 409', async () => {
    const ev = await createEvent(promoterToken);
    const gw = await prisma.paymentGateway.findFirstOrThrow({ where: { isPlatformDefault: true } });
    await prisma.event.update({ where: { id: ev.id }, data: { frozenGatewayId: gw.id } });
    await http().patch(`/api/v1/events/${ev.id}`).set(bearer(promoterToken)).send({ ivaOnNet: false }).expect(409);
  });

  it('cancelar: dueño publicado → cancelled; ajeno → 403', async () => {
    const ev = await createEvent(promoterToken);
    await prisma.locality.create({
      data: { eventId: ev.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 5 },
    });
    await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(200);
    await http().post(`/api/v1/events/${ev.id}/cancel`).set(bearer(promoterBToken)).expect(403); // ajeno
    const res = await http().post(`/api/v1/events/${ev.id}/cancel`).set(bearer(promoterToken)).expect(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('eliminar: borrador OK (204); publicado → 400; ajeno → 403; inexistente → 404', async () => {
    const draft = await createEvent(promoterToken);
    await http().delete(`/api/v1/events/${draft.id}`).set(bearer(promoterBToken)).expect(403); // ajeno
    await http().delete(`/api/v1/events/${draft.id}`).set(bearer(promoterToken)).expect(204); // dueño draft

    const pub = await createEvent(promoterToken);
    await prisma.locality.create({
      data: { eventId: pub.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 5 },
    });
    await http().post(`/api/v1/events/${pub.id}/publish`).set(bearer(promoterToken)).expect(200);
    await http().delete(`/api/v1/events/${pub.id}`).set(bearer(promoterToken)).expect(400); // publicado

    await http()
      .delete('/api/v1/events/00000000-0000-0000-0000-000000000000')
      .set(bearer(promoterToken))
      .expect(404);
  });

  it('GET /events/mine: promotor ve los suyos; buyer → 403; sin token → 401', async () => {
    await createEvent(promoterBToken);
    const mine = await http().get('/api/v1/events/mine').set(bearer(promoterBToken)).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);
    expect(mine.body.every((e: { promoterId: string }) => e.promoterId === promoterBId)).toBe(true);
    await http().get('/api/v1/events/mine').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/events/mine').expect(401);
  });

  it('GET /events/all: admin ve todos con su promotor; promotor/buyer → 403; sin token → 401', async () => {
    await createEvent(promoterToken);
    const all = await http().get('/api/v1/events/all').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.length).toBeGreaterThan(0);
    expect(all.body[0].promoter).toBeDefined(); // incluye el promotor
    expect(all.body[0].promoter.email).toBeDefined();
    await http().get('/api/v1/events/all').set(bearer(promoterToken)).expect(403);
    await http().get('/api/v1/events/all').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/events/all').expect(401);
  });

  it('GET /events/:id/manage: dueño 200; ajeno 403; inexistente 404', async () => {
    const ev = await createEvent(promoterToken);
    await http().get(`/api/v1/events/${ev.id}/manage`).set(bearer(promoterToken)).expect(200);
    await http().get(`/api/v1/events/${ev.id}/manage`).set(bearer(promoterBToken)).expect(403);
    await http()
      .get('/api/v1/events/00000000-0000-0000-0000-000000000000/manage')
      .set(bearer(promoterToken))
      .expect(404);
  });
});
