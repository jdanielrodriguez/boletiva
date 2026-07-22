import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Gestión de asesores (admin): lista + deshabilitar (quita rol → cliente) + habilitar +
 * notificar + eliminar (soft). Un no-admin no accede (@AdminOnly).
 */
describe('Gestión de asesores (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let advisorId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    advisorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'asesor@boletiva.com' } })).id;
  });

  afterAll(async () => {
    // Restaura al asesor semilla (rol advisor + activo) por si otros specs dependen.
    await prisma.user.update({
      where: { id: advisorId },
      data: { roles: { set: ['advisor'] }, status: 'active' },
    });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('admin lista asesores (incluye al asesor semilla)', async () => {
    const res = await http().get('/api/v1/advisors').set(bearer(adminToken)).expect(200);
    expect(res.body.some((a: { email: string }) => a.email === 'asesor@boletiva.com')).toBe(true);
  });

  it('no-admin (promotor) → 403', async () => {
    await http().get('/api/v1/advisors').set(bearer(promoterToken)).expect(403);
  });

  it('deshabilitar quita el rol advisor y deja al usuario como cliente (buyer)', async () => {
    await http().post(`/api/v1/advisors/${advisorId}/disable`).set(bearer(adminToken)).expect(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: advisorId } });
    expect(u.roles).not.toContain('advisor');
    expect(u.roles).toContain('buyer');
    expect(u.status).toBe('active'); // sigue activo → continúa como cliente
  });

  it('eliminar (soft) tras deshabilitar → status inactive (bloquea login)', async () => {
    await http().delete(`/api/v1/advisors/${advisorId}`).set(bearer(adminToken)).expect(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: advisorId } });
    expect(u.status).toBe('inactive');
  });

  it('habilitar vuelve a dar el rol advisor y reactiva', async () => {
    await http().post(`/api/v1/advisors/${advisorId}/enable`).set(bearer(adminToken)).expect(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: advisorId } });
    expect(u.roles).toContain('advisor');
    expect(u.status).toBe('active');
  });

  it('notificar a un asesor deja la notificación', async () => {
    await http()
      .post(`/api/v1/advisors/${advisorId}/notify`)
      .set(bearer(adminToken))
      .send({ title: 'Aviso del admin', body: 'Revisa la cola de soporte.' })
      .expect(200);
    const n = await prisma.notification.findFirst({ where: { userId: advisorId, title: 'Aviso del admin' } });
    expect(n).not.toBeNull();
    await prisma.notification.deleteMany({ where: { userId: advisorId, title: 'Aviso del admin' } });
  });

  it('no se puede eliminar a un asesor que aún tiene el rol (primero deshabilitar) → 400', async () => {
    await http().delete(`/api/v1/advisors/${advisorId}`).set(bearer(adminToken)).expect(400);
  });
});
