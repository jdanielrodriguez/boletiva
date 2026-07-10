import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.5 · Salones/venues reutilizables. Lectura para cualquier promotor/admin;
 * escritura solo admin. Cubre: happy por rol, RBAC, validación, 404, borrado que
 * desvincula eventos, y el PREFILL de dirección/coordenadas al crear evento.
 */
describe('Salones (halls) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let buyerToken: string;
  const created: string[] = [];
  const createdEvents: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    buyerToken = await login(app, SEED.buyer);
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: createdEvents } } });
    await prisma.hall.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('promotor lista salones (seed ≥ 3)', async () => {
    const res = await http().get('/api/v1/halls').set(bearer(promoterToken)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  it('sin token → 401; buyer → 403 (rol insuficiente)', async () => {
    await http().get('/api/v1/halls').expect(401);
    await http().get('/api/v1/halls').set(bearer(buyerToken)).expect(403);
  });

  it('admin crea un salón; valida entrada', async () => {
    await http().post('/api/v1/halls').set(bearer(adminToken)).send({}).expect(400); // sin name
    const res = await http()
      .post('/api/v1/halls')
      .set(bearer(adminToken))
      .send({ name: 'Salón Test', address: 'Zona 10', lat: 14.6, lng: -90.5, city: 'Guatemala' })
      .expect(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Salón Test');
    created.push(res.body.id);
  });

  it('crear con seatTemplateId inexistente → 400', async () => {
    await http()
      .post('/api/v1/halls')
      .set(bearer(adminToken))
      .send({ name: 'Salón X', seatTemplateId: '00000000-0000-0000-0000-000000000000' })
      .expect(400);
  });

  it('promotor NO puede crear/editar/borrar (403)', async () => {
    await http().post('/api/v1/halls').set(bearer(promoterToken)).send({ name: 'Nope' }).expect(403);
    await http().patch(`/api/v1/halls/${created[0]}`).set(bearer(promoterToken)).send({ name: 'X' }).expect(403);
    await http().delete(`/api/v1/halls/${created[0]}`).set(bearer(promoterToken)).expect(403);
  });

  it('admin actualiza; GET :id; 404 en inexistente', async () => {
    await http()
      .patch(`/api/v1/halls/${created[0]}`)
      .set(bearer(adminToken))
      .send({ notes: 'aforo 500' })
      .expect(200);
    const got = await http().get(`/api/v1/halls/${created[0]}`).set(bearer(adminToken)).expect(200);
    expect(got.body.notes).toBe('aforo 500');
    await http()
      .get('/api/v1/halls/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .expect(404);
    await http()
      .patch('/api/v1/halls/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .send({ notes: 'x' })
      .expect(404);
  });

  it('crear evento con hallId PREFIJA address/lat/lng vacíos', async () => {
    const hall = await http()
      .post('/api/v1/halls')
      .set(bearer(adminToken))
      .send({ name: 'Salón Prefill', address: 'Av. Reforma 1-1', lat: 14.59, lng: -90.51 })
      .expect(201);
    created.push(hall.body.id);

    const ev = await http()
      .post('/api/v1/events')
      .set(bearer(promoterToken))
      .send({ name: 'Evento con salón', hallId: hall.body.id, startsAt: '2027-01-01T00:00:00.000Z' })
      .expect(201);
    createdEvents.push(ev.body.id);
    expect(ev.body.hallId).toBe(hall.body.id);
    expect(ev.body.address).toBe('Av. Reforma 1-1');
    expect(ev.body.lat).toBeCloseTo(14.59);
    expect(ev.body.lng).toBeCloseTo(-90.51);
  });

  it('borrar salón lo desvincula del evento (SetNull)', async () => {
    const hall = await http()
      .post('/api/v1/halls')
      .set(bearer(adminToken))
      .send({ name: 'Salón Borrable', address: 'Zona 1' })
      .expect(201);
    const ev = await http()
      .post('/api/v1/events')
      .set(bearer(promoterToken))
      .send({ name: 'Evento a desvincular', hallId: hall.body.id, startsAt: '2027-02-01T00:00:00.000Z' })
      .expect(201);
    createdEvents.push(ev.body.id);

    await http().delete(`/api/v1/halls/${hall.body.id}`).set(bearer(adminToken)).expect(200);
    const after = await prisma.event.findUnique({ where: { id: ev.body.id } });
    expect(after?.hallId).toBeNull();
  });
});
