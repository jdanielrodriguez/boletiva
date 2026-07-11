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
    // BD compartida entre suites: garantiza el contrato del seed (built-ins
    // publicadas/visibles/habilitadas) para tests deterministas.
    await prisma.seatTemplate.updateMany({
      where: { isBuiltIn: true },
      data: { status: 'published', hidden: false, disabled: false },
    });
  });

  afterAll(async () => {
    await prisma.seatTemplate.deleteMany({ where: { id: { in: created } } });
    // Restaura el estado del contrato del seed para las suites siguientes.
    await prisma.seatTemplate.updateMany({
      where: { isBuiltIn: true },
      data: { status: 'published', hidden: false, disabled: false },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('promotor lista plantillas publicadas (4 built-in del seed)', async () => {
    const res = await http().get('/api/v1/seat-templates').set(bearer(promoterToken)).expect(200);
    const builtins = res.body.filter((t: { isBuiltIn: boolean }) => t.isBuiltIn);
    expect(builtins.length).toBeGreaterThanOrEqual(4);
    expect(res.body.every((t: { layoutJson: unknown }) => t.layoutJson !== undefined)).toBe(true);
    // El desplegable del promotor solo muestra publicadas, visibles y habilitadas.
    expect(
      res.body.every(
        (t: { status: string; hidden: boolean; disabled: boolean }) =>
          t.status === 'published' && !t.hidden && !t.disabled,
      ),
    ).toBe(true);
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

  it('nueva plantilla nace en borrador (draft) y NO sale al promotor', async () => {
    const res = await http()
      .post('/api/v1/seat-templates')
      .set(bearer(adminToken))
      .send({ name: 'Borrador oculto', kind: 'grid', params: { rows: 2, cols: 2 } })
      .expect(201);
    created.push(res.body.id);
    expect(res.body.status).toBe('draft');
    expect(res.body.hidden).toBe(false);
    expect(res.body.disabled).toBe(false);
    const list = await http().get('/api/v1/seat-templates').set(bearer(promoterToken)).expect(200);
    expect(list.body.some((t: { id: string }) => t.id === res.body.id)).toBe(false);
  });

  it('transiciones publish/unpublish/hide/unhide/disable/enable (admin)', async () => {
    const id = created[created.length - 1];
    let r = await http().post(`/api/v1/seat-templates/${id}/publish`).set(bearer(adminToken)).expect(200);
    expect(r.body.status).toBe('published');
    // publicada → aparece al promotor
    let list = await http().get('/api/v1/seat-templates').set(bearer(promoterToken)).expect(200);
    expect(list.body.some((t: { id: string }) => t.id === id)).toBe(true);
    // ocultar → desaparece del desplegable
    r = await http().post(`/api/v1/seat-templates/${id}/hide`).set(bearer(adminToken)).expect(200);
    expect(r.body.hidden).toBe(true);
    list = await http().get('/api/v1/seat-templates').set(bearer(promoterToken)).expect(200);
    expect(list.body.some((t: { id: string }) => t.id === id)).toBe(false);
    // unhide
    r = await http().post(`/api/v1/seat-templates/${id}/unhide`).set(bearer(adminToken)).expect(200);
    expect(r.body.hidden).toBe(false);
    // disable / enable
    r = await http().post(`/api/v1/seat-templates/${id}/disable`).set(bearer(adminToken)).expect(200);
    expect(r.body.disabled).toBe(true);
    r = await http().post(`/api/v1/seat-templates/${id}/enable`).set(bearer(adminToken)).expect(200);
    expect(r.body.disabled).toBe(false);
    // unpublish
    r = await http().post(`/api/v1/seat-templates/${id}/unpublish`).set(bearer(adminToken)).expect(200);
    expect(r.body.status).toBe('draft');
  });

  it('transiciones exigen admin (promotor/buyer → 403)', async () => {
    const id = created[created.length - 1];
    await http().post(`/api/v1/seat-templates/${id}/publish`).set(bearer(promoterToken)).expect(403);
    await http().post(`/api/v1/seat-templates/${id}/disable`).set(bearer(buyerToken)).expect(403);
  });

  it('borrado exige DESHABILITAR primero: hidden-no-disabled → 409, disabled → 200', async () => {
    const res = await http()
      .post('/api/v1/seat-templates')
      .set(bearer(adminToken))
      .send({ name: 'Descartable' })
      .expect(201);
    const id = res.body.id;
    // habilitada (default) → no se puede eliminar
    await http().delete(`/api/v1/seat-templates/${id}`).set(bearer(adminToken)).expect(409);
    // solo oculta pero NO deshabilitada → sigue 409
    await http().post(`/api/v1/seat-templates/${id}/hide`).set(bearer(adminToken)).expect(200);
    await http().delete(`/api/v1/seat-templates/${id}`).set(bearer(adminToken)).expect(409);
    // deshabilitada → 200
    await http().post(`/api/v1/seat-templates/${id}/disable`).set(bearer(adminToken)).expect(200);
    await http().delete(`/api/v1/seat-templates/${id}`).set(bearer(adminToken)).expect(200);
  });

  it('GET /seat-templates/all lista TODAS (admin) e incluye draft; promotor → 403', async () => {
    const res = await http().get('/api/v1/seat-templates/all').set(bearer(adminToken)).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(res.body.filter((t: { status: string }) => t.status === 'published').length);
    await http().get('/api/v1/seat-templates/all').set(bearer(promoterToken)).expect(403);
  });

  it('built-in SÍ se puede ocultar/deshabilitar (pero no editar/eliminar)', async () => {
    const builtin = await prisma.seatTemplate.findFirstOrThrow({ where: { isBuiltIn: true } });
    await http().post(`/api/v1/seat-templates/${builtin.id}/hide`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/seat-templates/${builtin.id}/unhide`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/seat-templates/${builtin.id}/disable`).set(bearer(adminToken)).expect(200);
    // deshabilitada pero built-in → eliminar sigue 409
    await http().delete(`/api/v1/seat-templates/${builtin.id}`).set(bearer(adminToken)).expect(409);
    await http().post(`/api/v1/seat-templates/${builtin.id}/enable`).set(bearer(adminToken)).expect(200);
  });
});
