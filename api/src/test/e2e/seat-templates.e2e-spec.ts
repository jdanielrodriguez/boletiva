import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.5 · Plantillas de asientos. Lectura promotor/admin; escritura solo admin.
 * Built-in (sembradas) no se editan/borran. Cubre happy por rol, RBAC, validación,
 * 404 y bloqueo de built-in.
 */
describe('Plantillas de asientos (seat-templates) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let buyerToken: string;
  const created: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    buyerToken = await login(app, SEED.buyer);
  });

  afterAll(async () => {
    await prisma.seatTemplate.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('promotor lista plantillas (4 built-in del seed)', async () => {
    const res = await http().get('/api/v1/seat-templates').set(bearer(promoterToken)).expect(200);
    const builtins = res.body.filter((t: { isBuiltIn: boolean }) => t.isBuiltIn);
    expect(builtins.length).toBeGreaterThanOrEqual(4);
    expect(res.body.every((t: { layoutJson: unknown }) => t.layoutJson !== undefined)).toBe(true);
  });

  it('sin token → 401; buyer → 403', async () => {
    await http().get('/api/v1/seat-templates').expect(401);
    await http().get('/api/v1/seat-templates').set(bearer(buyerToken)).expect(403);
  });

  it('admin crea una plantilla (isBuiltIn=false); valida entrada', async () => {
    await http().post('/api/v1/seat-templates').set(bearer(adminToken)).send({}).expect(400);
    const res = await http()
      .post('/api/v1/seat-templates')
      .set(bearer(adminToken))
      .send({ name: 'Mi plantilla', kind: 'grid', params: { rows: 3, cols: 3 } })
      .expect(201);
    expect(res.body.isBuiltIn).toBe(false);
    expect(res.body.kind).toBe('grid');
    created.push(res.body.id);
  });

  it('promotor NO puede crear/editar/borrar (403)', async () => {
    await http().post('/api/v1/seat-templates').set(bearer(promoterToken)).send({ name: 'X' }).expect(403);
    await http().patch(`/api/v1/seat-templates/${created[0]}`).set(bearer(promoterToken)).send({ name: 'Y' }).expect(403);
    await http().delete(`/api/v1/seat-templates/${created[0]}`).set(bearer(promoterToken)).expect(403);
  });

  it('admin edita una plantilla custom; 404 en inexistente', async () => {
    await http()
      .patch(`/api/v1/seat-templates/${created[0]}`)
      .set(bearer(adminToken))
      .send({ name: 'Renombrada' })
      .expect(200);
    await http()
      .patch('/api/v1/seat-templates/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .send({ name: 'ZZ' })
      .expect(404);
  });

  it('built-in NO se puede editar ni borrar (409)', async () => {
    const builtin = await prisma.seatTemplate.findFirstOrThrow({ where: { isBuiltIn: true } });
    await http()
      .patch(`/api/v1/seat-templates/${builtin.id}`)
      .set(bearer(adminToken))
      .send({ name: 'Hackeada' })
      .expect(409);
    await http().delete(`/api/v1/seat-templates/${builtin.id}`).set(bearer(adminToken)).expect(409);
  });

  it('admin borra su plantilla custom', async () => {
    const res = await http()
      .post('/api/v1/seat-templates')
      .set(bearer(adminToken))
      .send({ name: 'Descartable' })
      .expect(201);
    await http().delete(`/api/v1/seat-templates/${res.body.id}`).set(bearer(adminToken)).expect(200);
  });
});
