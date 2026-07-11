import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Users (perfil propio + gestión admin) y Categories (CRUD admin). Cubre huecos:
 * PATCH /users/me, listado admin con búsqueda, suspensión → login rechazado,
 * categorías por slug (404), y borrado con eventos asociados (409).
 */
describe('Users + Categories (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let promoterId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'uc-admin');
    buyerToken = await loginTrusted(SEED.buyer, 'uc-buyer');
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
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
    await prisma.category.deleteMany({ where: { slug: { contains: `uc-${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // ---- Users ----

  it('PATCH /users/me actualiza el perfil propio', async () => {
    const res = await http()
      .patch('/api/v1/users/me')
      .set(bearer(buyerToken))
      .send({ firstName: 'ClienteEditado' })
      .expect(200);
    expect(res.body.firstName).toBe('ClienteEditado');
  });

  it('PATCH /users/me persiste la preferencia de idioma y se refleja en /auth/me', async () => {
    const upd = await http()
      .patch('/api/v1/users/me')
      .set(bearer(buyerToken))
      .send({ language: 'en' })
      .expect(200);
    expect(upd.body.language).toBe('en');

    const me = await http().get('/api/v1/auth/me').set(bearer(buyerToken)).expect(200);
    expect(me.body.language).toBe('en');

    // Restaura el default para no afectar a otros specs seriales.
    const back = await http()
      .patch('/api/v1/users/me')
      .set(bearer(buyerToken))
      .send({ language: 'es' })
      .expect(200);
    expect(back.body.language).toBe('es');
  });

  it('PATCH /users/me con idioma no soportado → 400', async () => {
    await http()
      .patch('/api/v1/users/me')
      .set(bearer(buyerToken))
      .send({ language: 'fr' })
      .expect(400);
  });

  it('GET /users (admin) lista y busca; no-admin → 403', async () => {
    const list = await http().get('/api/v1/users?search=admin').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(list.body.items ?? list.body)).toBe(true);
    await http().get('/api/v1/users').set(bearer(buyerToken)).expect(403);
  });

  it('admin suspende a un usuario y este ya no puede iniciar sesión (401)', async () => {
    const email = `uc_susp_${stamp}@test.com`;
    const signup = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Susp' });
    await prisma.user.update({ where: { id: signup.body.user.id }, data: { emailVerifiedAt: new Date() } });

    await http()
      .patch(`/api/v1/users/${signup.body.user.id}/status`)
      .set(bearer(adminToken))
      .send({ status: 'inactive' })
      .expect(200);

    await http()
      .post('/api/v1/auth/login')
      .set('X-Device-Id', 'uc-susp-dev')
      .send({ email, password: 'Password123' })
      .expect(401); // Cuenta inactiva
  });

  it('validación: status inválido → 400; UUID inválido → 400', async () => {
    await http()
      .patch(`/api/v1/users/${promoterId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'zombie' })
      .expect(400);
    await http().get('/api/v1/users/no-uuid').set(bearer(adminToken)).expect(400);
  });

  // ---- Categories ----

  it('GET /categories/:slug inexistente → 404', async () => {
    await http().get('/api/v1/categories/no-existe-uc').expect(404);
  });

  it('CRUD admin: crear, obtener por slug, actualizar; no-admin → 403', async () => {
    const created = await http()
      .post('/api/v1/categories')
      .set(bearer(adminToken))
      .send({ name: `UC ${stamp}` })
      .expect(201);
    const { id, slug } = created.body;

    await http().get(`/api/v1/categories/${slug}`).expect(200);
    const upd = await http()
      .patch(`/api/v1/categories/${id}`)
      .set(bearer(adminToken))
      .send({ description: 'editada' })
      .expect(200);
    expect(upd.body.description).toBe('editada');

    await http().post('/api/v1/categories').set(bearer(buyerToken)).send({ name: 'x' }).expect(403);
    await http().patch(`/api/v1/categories/${id}`).set(bearer(buyerToken)).send({ name: 'y' }).expect(403);
  });

  it('GET /categories?all=true incluye inactivas; el listado por defecto solo activas', async () => {
    const created = await http()
      .post('/api/v1/categories')
      .set(bearer(adminToken))
      .send({ name: `UC ${stamp} Inactiva`, active: false })
      .expect(201);
    expect(created.body.active).toBe(false); // rama `dto.active ?? true` con active explícito

    const all = await http().get('/api/v1/categories?all=true').expect(200);
    expect(all.body.some((c: { id: string }) => c.id === created.body.id)).toBe(true);

    const activeOnly = await http().get('/api/v1/categories').expect(200);
    expect(activeOnly.body.some((c: { id: string }) => c.id === created.body.id)).toBe(false);
  });

  it('nombre duplicado → el slug se desambigua con sufijo (uniqueSlug)', async () => {
    const first = await http()
      .post('/api/v1/categories')
      .set(bearer(adminToken))
      .send({ name: `UC ${stamp} Dup` })
      .expect(201);
    const second = await http()
      .post('/api/v1/categories')
      .set(bearer(adminToken))
      .send({ name: `UC ${stamp} Dup` })
      .expect(201);
    expect(second.body.slug).not.toBe(first.body.slug);
    expect(second.body.slug.startsWith(first.body.slug)).toBe(true); // base + sufijo
  });

  it('actualizar categoría inexistente → 404', async () => {
    await http()
      .patch('/api/v1/categories/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .send({ description: 'x' })
      .expect(404);
  });

  it('borrar categoría inexistente → 404', async () => {
    await http()
      .delete('/api/v1/categories/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .expect(404);
  });

  it('borrar categoría con eventos asociados → 409; sin eventos → 204', async () => {
    const cat = await http()
      .post('/api/v1/categories')
      .set(bearer(adminToken))
      .send({ name: `UC Del ${stamp}` })
      .expect(201);
    const catId = cat.body.id;

    const ev = await prisma.event.create({
      data: {
        promoterId,
        categoryId: catId,
        name: 'Cat Ev',
        slug: `uc-catev-${stamp}`,
        startsAt: new Date('2027-12-01T20:00:00-06:00'),
        endsAt: new Date('2027-12-01T23:00:00-06:00'),
      },
    });
    await http().delete(`/api/v1/categories/${catId}`).set(bearer(adminToken)).expect(409);

    await prisma.event.delete({ where: { id: ev.id } });
    await http().delete(`/api/v1/categories/${catId}`).set(bearer(adminToken)).expect(204);
  });
});
