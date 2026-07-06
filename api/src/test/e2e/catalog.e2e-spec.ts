import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

describe('Catálogo y venues (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let buyerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    buyerToken = await login(app, SEED.buyer);
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { name: { contains: 'E2E' } } });
    await prisma.category.deleteMany({ where: { name: { contains: 'E2E' } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'e2e_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ---- Categorías --------------------------------------------------------

  it('GET /categories es público', async () => {
    const res = await http().get('/api/v1/categories').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /categories requiere rol admin (promoter → 403)', async () => {
    await http()
      .post('/api/v1/categories')
      .set(auth(promoterToken))
      .send({ name: 'E2E No Autorizada' })
      .expect(403);
  });

  it('POST /categories como admin crea con slug', async () => {
    const res = await http()
      .post('/api/v1/categories')
      .set(auth(adminToken))
      .send({ name: 'E2E Categoría' })
      .expect(201);
    expect(res.body.slug).toBe('e2e-categoria');
  });

  // ---- Eventos -----------------------------------------------------------

  let eventId: string;

  it('POST /events como promoter crea en estado draft', async () => {
    const res = await http()
      .post('/api/v1/events')
      .set(auth(promoterToken))
      .send({
        name: 'E2E Concierto',
        startsAt: '2026-11-01T20:00:00-06:00',
        endsAt: '2026-11-01T23:00:00-06:00',
      })
      .expect(201);
    expect(res.body.status).toBe('draft');
    eventId = res.body.id;
  });

  it('POST /events con fechas inválidas → 400', async () => {
    await http()
      .post('/api/v1/events')
      .set(auth(promoterToken))
      .send({
        name: 'E2E Fechas',
        startsAt: '2026-11-01T23:00:00-06:00',
        endsAt: '2026-11-01T20:00:00-06:00',
      })
      .expect(400);
  });

  it('POST /events como buyer → 403 (RBAC)', async () => {
    await http()
      .post('/api/v1/events')
      .set(auth(buyerToken))
      .send({
        name: 'E2E Buyer',
        startsAt: '2026-11-01T20:00:00-06:00',
        endsAt: '2026-11-01T23:00:00-06:00',
      })
      .expect(403);
  });

  it('publicar sin localidades → 400', async () => {
    await http().post(`/api/v1/events/${eventId}/publish`).set(auth(promoterToken)).expect(400);
  });

  it('agrega localidad, genera asientos y publica', async () => {
    const loc = await http()
      .post(`/api/v1/events/${eventId}/localities`)
      .set(auth(promoterToken))
      .send({ name: 'E2E General', kind: 'general', desiredNet: 100 })
      .expect(201);

    const seats = await http()
      .post(`/api/v1/localities/${loc.body.id}/seats/generate`)
      .set(auth(promoterToken))
      .send({ count: 10, labelPrefix: 'G' })
      .expect(201);
    expect(seats.body.created).toBe(10);
    expect(seats.body.capacity).toBe(10);

    await http().post(`/api/v1/events/${eventId}/publish`).set(auth(promoterToken)).expect(200);
  });

  it('el evento publicado aparece en el listado público por slug', async () => {
    const list = await http().get('/api/v1/events?search=E2E Concierto').expect(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    const slug = list.body.items[0].slug;
    const detail = await http().get(`/api/v1/events/${slug}`).expect(200);
    expect(detail.body.localities.length).toBe(1);
  });

  it('ownership: otro promoter no puede editar el evento ajeno (403)', async () => {
    // Crear un 2º usuario y promoverlo a promoter vía admin.
    const email = `e2e_owner_${Date.now()}@test.com`;
    const signup = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Otro' })
      .expect(201);
    await http()
      .patch(`/api/v1/users/${signup.body.user.id}/roles`)
      .set(auth(adminToken))
      .send({ roles: ['promoter'] })
      .expect(200);
    const otherToken = await login(app, email);

    await http()
      .patch(`/api/v1/events/${eventId}`)
      .set(auth(otherToken))
      .send({ name: 'E2E Hackeado' })
      .expect(403);
  });

  it('el dueño sí puede editar su evento', async () => {
    await http()
      .patch(`/api/v1/events/${eventId}`)
      .set(auth(promoterToken))
      .send({ description: 'Actualizado por el dueño' })
      .expect(200);
  });
});
