import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.8 · Modo mantenimiento. El admin activa/desactiva un flag global; mientras
 * está activo TODO request responde 503 salvo: rutas allowlisted (estado público,
 * health, auth) y el admin autenticado (que debe poder entrar y desactivarlo).
 * Cubre RBAC del toggle, lectura pública, 503 a buyer/anónimo, bypass de admin,
 * allowlist (health/auth/maintenance) y restauración del estado.
 */
describe('Modo mantenimiento e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    buyerToken = await login(app, SEED.buyer);
    // Estado limpio (desactivado) antes de empezar.
    await prisma.setting.deleteMany({ where: { key: { in: ['maintenance.enabled', 'maintenance.message'] } } });
  });

  afterAll(async () => {
    // Asegura desactivar el mantenimiento aunque un test falle (no contamina la suite).
    await prisma.setting.deleteMany({ where: { key: { in: ['maintenance.enabled', 'maintenance.message'] } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('estado público inicial: desactivado', async () => {
    const res = await http().get('/api/v1/maintenance').expect(200);
    expect(res.body).toEqual({ enabled: false, message: null });
  });

  it('RBAC del toggle: anónimo 401, buyer 403', async () => {
    await http().patch('/api/v1/admin/maintenance').send({ enabled: true }).expect(401);
    await http().patch('/api/v1/admin/maintenance').set(bearer(buyerToken)).send({ enabled: true }).expect(403);
  });

  it('validación: enabled debe ser booleano (400)', async () => {
    await http()
      .patch('/api/v1/admin/maintenance')
      .set(bearer(adminToken))
      .send({ enabled: 'sí' })
      .expect(400);
  });

  it('admin activa el mantenimiento (con mensaje) → estado público lo refleja', async () => {
    const res = await http()
      .patch('/api/v1/admin/maintenance')
      .set(bearer(adminToken))
      .send({ enabled: true, message: 'Volvemos pronto' })
      .expect(200);
    expect(res.body).toEqual({ enabled: true, message: 'Volvemos pronto' });
    const pub = await http().get('/api/v1/maintenance').expect(200);
    expect(pub.body).toEqual({ enabled: true, message: 'Volvemos pronto' });
  });

  it('con mantenimiento activo: buyer y anónimo → 503', async () => {
    const buyer = await http().get('/api/v1/wallet').set(bearer(buyerToken)).expect(503);
    expect(buyer.body.statusCode).toBe(503);
    expect(String(buyer.body.message)).toContain('Volvemos pronto');
    // Ruta pública (catálogo) también cortada.
    await http().get('/api/v1/events').expect(503);
  });

  it('allowlist durante mantenimiento: health, estado público y auth siguen vivos', async () => {
    await http().get('/api/v1/health/live').expect(200);
    await http().get('/api/v1/maintenance').expect(200);
    // El login (auth) debe funcionar para que un admin pueda entrar.
    await login(app, SEED.admin);
  });

  it('bypass de admin: un admin autenticado pasa aunque haya mantenimiento', async () => {
    await http().get('/api/v1/settings').set(bearer(adminToken)).expect(200);
  });

  it('admin desactiva el mantenimiento → todo vuelve a la normalidad', async () => {
    const res = await http()
      .patch('/api/v1/admin/maintenance')
      .set(bearer(adminToken))
      .send({ enabled: false })
      .expect(200);
    expect(res.body.enabled).toBe(false);
    await http().get('/api/v1/wallet').set(bearer(buyerToken)).expect(200);
    await http().get('/api/v1/events').expect(200);
  });
});
