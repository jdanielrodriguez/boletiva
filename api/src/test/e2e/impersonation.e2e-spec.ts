import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * v3.8 · G2 — Impersonación de promotores (soporte técnico). `POST /admin/impersonate/:userId`
 * (solo admin) emite un token de vida corta que actúa como el promotor con el claim
 * `impersonatedBy`; `POST /admin/impersonate/stop` deja rastro. Cubre: token válido que
 * resuelve a las capacidades del promotor, claim presente, RBAC, target inválido
 * (no-promotor / admin / inexistente) y registro en la bitácora de auditoría.
 */
describe('Impersonación de promotores (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let adminId: string;
  let promoterId: string;
  let buyerId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'imp-admin');
    buyerToken = await loginTrusted(SEED.buyer, 'imp-buyer');
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin } })).id;
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    await prisma.auditEvent.deleteMany({ where: { action: { startsWith: 'admin.impersonate' } } });
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
    await prisma.event.deleteMany({ where: { name: { startsWith: `Imp Ev ${stamp}` } } });
    await prisma.auditEvent.deleteMany({ where: { action: { startsWith: 'admin.impersonate' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('admin impersona a un promotor → token válido con capacidades del promotor', async () => {
    const res = await http()
      .post(`/api/v1/admin/impersonate/${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.impersonatedBy).toBe(adminId);
    expect(res.body.user.id).toBe(promoterId);
    expect(res.body.expiresIn).toBeGreaterThan(0);

    const impToken = res.body.accessToken as string;
    // El token actúa como el promotor: puede listar SUS eventos (endpoint promoter/admin).
    const mine = await http().get('/api/v1/events/mine').set(bearer(impToken)).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);

    // /auth/me resuelve al promotor + expone impersonatedBy para el banner del front.
    const me = await http().get('/api/v1/auth/me').set(bearer(impToken)).expect(200);
    expect(me.body.id).toBe(promoterId);
    expect(me.body.impersonatedBy).toBe(adminId);

    // Puede crear un evento a nombre del promotor (capacidad efectiva).
    const created = await http()
      .post('/api/v1/events')
      .set(bearer(impToken))
      .send({
        name: `Imp Ev ${stamp}`,
        startsAt: new Date('2027-11-01T20:00:00-06:00').toISOString(),
      })
      .expect(201);
    expect(created.body.promoterId).toBe(promoterId);
  });

  it('el inicio queda en la bitácora de auditoría (no-repudio)', async () => {
    await http().post(`/api/v1/admin/impersonate/${promoterId}`).set(bearer(adminToken)).expect(200);
    const rec = await prisma.auditEvent.findFirst({
      where: { action: 'admin.impersonate.start', resource: promoterId },
      orderBy: { seq: 'desc' },
    });
    expect(rec).toBeTruthy();
    expect(rec?.userId).toBe(adminId);
  });

  it('stop deja rastro en la bitácora (se llama con el token impersonado)', async () => {
    const start = await http()
      .post(`/api/v1/admin/impersonate/${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    await http()
      .post('/api/v1/admin/impersonate/stop')
      .set(bearer(start.body.accessToken))
      .expect(200);
    const rec = await prisma.auditEvent.findFirst({
      where: { action: 'admin.impersonate.stop', resource: promoterId },
      orderBy: { seq: 'desc' },
    });
    expect(rec).toBeTruthy();
    expect(rec?.userId).toBe(adminId); // el actor real es el admin que la inició
  });

  it('S4 (QA): en sesión de impersonación NO se puede solicitar un retiro de wallet → 403', async () => {
    const start = await http()
      .post(`/api/v1/admin/impersonate/${promoterId}`)
      .set(bearer(adminToken))
      .expect(200);
    // El chequeo del controller corta ANTES del servicio (saldo/etc.): acción financiera ajena.
    await http()
      .post('/api/v1/wallet/withdrawals')
      .set(bearer(start.body.accessToken))
      .send({ amount: 10 })
      .expect(403);
  });

  it('no-admin → 403; sin token → 401', async () => {
    await http().post(`/api/v1/admin/impersonate/${promoterId}`).set(bearer(buyerToken)).expect(403);
    await http().post(`/api/v1/admin/impersonate/${promoterId}`).expect(401);
  });

  it('target NO promotor (buyer) → 400', async () => {
    await http().post(`/api/v1/admin/impersonate/${buyerId}`).set(bearer(adminToken)).expect(400);
  });

  it('no se puede impersonar a otro admin → 400', async () => {
    await http().post(`/api/v1/admin/impersonate/${adminId}`).set(bearer(adminToken)).expect(400);
  });

  it('target inexistente → 404; id no-UUID → 400', async () => {
    await http()
      .post('/api/v1/admin/impersonate/00000000-0000-0000-0000-000000000000')
      .set(bearer(adminToken))
      .expect(404);
    await http().post('/api/v1/admin/impersonate/no-uuid').set(bearer(adminToken)).expect(400);
  });
});
