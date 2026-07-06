import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 3.5 · Ticket A — Pasarelas de pago configurables.
 * CRUD admin, RBAC, invariante de default única, y guardas de estado.
 */
describe('Pasarelas de pago configurables (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let gwName: string;
  let gwId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    // Estado base: Sandbox activa y default (por si un run previo la cambió).
    await prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true },
      data: { isPlatformDefault: false },
    });
    await prisma.paymentGateway.updateMany({
      where: { name: 'Sandbox' },
      data: { isPlatformDefault: true, status: 'active' },
    });
    adminToken = await loginTrusted(SEED.admin, 'gw-admin');
    buyerToken = await loginTrusted(SEED.buyer, 'gw-buyer');
    gwName = `TEST_gw_${Date.now()}`;
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
    // Restaurar Sandbox como default y limpiar pasarelas de prueba.
    await prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true },
      data: { isPlatformDefault: false },
    });
    await prisma.paymentGateway.updateMany({
      where: { name: 'Sandbox' },
      data: { isPlatformDefault: true, status: 'active' },
    });
    await prisma.paymentGateway.deleteMany({ where: { name: { startsWith: 'TEST_gw_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('listar es admin-only (buyer→403, admin→200 con Sandbox)', async () => {
    await http().get('/api/v1/payment-gateways').set(bearer(buyerToken)).expect(403);
    const res = await http().get('/api/v1/payment-gateways').set(bearer(adminToken)).expect(200);
    expect(res.body.some((g: { name: string }) => g.name === 'Sandbox')).toBe(true);
  });

  it('GET /active lista pasarelas activas', async () => {
    const res = await http()
      .get('/api/v1/payment-gateways/active')
      .set(bearer(buyerToken))
      .expect(200);
    expect(res.body.every((g: { status: string }) => g.status === 'active')).toBe(true);
  });

  it('crear pasarela (admin) → 201; buyer → 403', async () => {
    await http()
      .post('/api/v1/payment-gateways')
      .set(bearer(buyerToken))
      .send({ name: gwName, provider: 'pagalo', feePct: 0.03 })
      .expect(403);
    const res = await http()
      .post('/api/v1/payment-gateways')
      .set(bearer(adminToken))
      .send({ name: gwName, provider: 'pagalo', feePct: 0.03, credentialsRef: 'PAGALO_KEY' })
      .expect(201);
    gwId = res.body.id;
    expect(res.body.isPlatformDefault).toBe(false);
    expect(res.body.status).toBe('active');
  });

  it('nombre duplicado → 409; feePct fuera de rango → 400', async () => {
    await http()
      .post('/api/v1/payment-gateways')
      .set(bearer(adminToken))
      .send({ name: gwName, provider: 'x', feePct: 0.03 })
      .expect(409);
    await http()
      .post('/api/v1/payment-gateways')
      .set(bearer(adminToken))
      .send({ name: `${gwName}_2`, provider: 'x', feePct: 1.5 })
      .expect(400);
  });

  it('actualizar la comisión (admin)', async () => {
    const res = await http()
      .patch(`/api/v1/payment-gateways/${gwId}`)
      .set(bearer(adminToken))
      .send({ feePct: 0.04 })
      .expect(200);
    expect(Number(res.body.feePct)).toBe(0.04);
  });

  it('make-default cambia la default y solo queda UNA', async () => {
    await http()
      .post(`/api/v1/payment-gateways/${gwId}/make-default`)
      .set(bearer(adminToken))
      .expect(201);
    const defaults = await prisma.paymentGateway.findMany({ where: { isPlatformDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(gwId);
  });

  it('no se puede desactivar la pasarela default → 409', async () => {
    await http()
      .patch(`/api/v1/payment-gateways/${gwId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'inactive' })
      .expect(409);
  });

  it('desactivar una NO-default → ok y desaparece de /active', async () => {
    // Devolver la default a Sandbox y luego desactivar la de prueba.
    const sandbox = await prisma.paymentGateway.findUniqueOrThrow({ where: { name: 'Sandbox' } });
    await http()
      .post(`/api/v1/payment-gateways/${sandbox.id}/make-default`)
      .set(bearer(adminToken))
      .expect(201);
    await http()
      .patch(`/api/v1/payment-gateways/${gwId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'inactive' })
      .expect(200);
    const active = await http()
      .get('/api/v1/payment-gateways/active')
      .set(bearer(adminToken))
      .expect(200);
    expect(active.body.some((g: { id: string }) => g.id === gwId)).toBe(false);
  });
});
