import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * B2 · Rol ASESOR. Cubre: herencia de permisos de admin (lectura de área admin →
 * 200), exclusión de la tab "Sistema" y ops de sistema (`@AdminOnly` → 403), gating
 * de MUTACIONES por ventana de desbloqueo (403 sin desbloqueo → 200 tras aprobar),
 * lectura libre sin desbloqueo, `advisor.lock_enabled=false` (muta sin desbloqueo) y
 * el flujo request→approve (RBAC + errores de token).
 */
describe('Rol asesor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let advisorToken: string;
  let advisorId: string;
  let promoterId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'adv-admin');
    await setLock(true);

    const email = `advisor_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Aso' });
    advisorId = res.body.user.id;
    await prisma.user.update({
      where: { id: advisorId },
      data: { emailVerifiedAt: new Date(), roles: ['advisor'] },
    });
    advisorToken = await loginTrusted(email, 'adv-dev');
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter.toLowerCase().trim() } })).id;
  });

  afterAll(async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    await prisma.user.deleteMany({ where: { email: { contains: `advisor_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setLock(v: boolean) {
    await prisma.setting.upsert({
      where: { key: 'advisor.lock_enabled' },
      update: { value: v },
      create: { key: 'advisor.lock_enabled', value: v, description: 'test' },
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

  /** Pide desbloqueo (devuelve devToken en no-prod) y lo aprueba como admin. */
  async function unlock(): Promise<void> {
    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    const token = req.body.devToken as string;
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token }).expect(200);
  }

  it('LECTURA de área admin: el asesor hereda permisos (GET /promoters → 200)', async () => {
    await http().get('/api/v1/promoters').set(bearer(advisorToken)).expect(200);
    await http().get('/api/v1/events/all').set(bearer(advisorToken)).expect(200);
  });

  it('tab SISTEMA excluida: GET /settings, GET /payment-gateways y PATCH /maintenance → 403 para el asesor', async () => {
    await http().get('/api/v1/settings').set(bearer(advisorToken)).expect(403);
    await http().get('/api/v1/payment-gateways').set(bearer(advisorToken)).expect(403);
    await http().patch('/api/v1/admin/maintenance').set(bearer(advisorToken)).send({ enabled: true }).expect(403);
    // Pero el admin sí puede (control).
    await http().get('/api/v1/settings').set(bearer(adminToken)).expect(200);
  });

  it('MUTACIÓN de área admin SIN desbloqueo → 403; tras aprobar el desbloqueo → 200', async () => {
    await setLock(true);
    // Sin ventana → bloqueado.
    await http()
      .patch(`/api/v1/promoters/${promoterId}/note`)
      .set(bearer(advisorToken))
      .send({ note: 'nota del asesor' })
      .expect(403);
    // Solicita + admin aprueba → ventana abierta.
    await unlock();
    await http()
      .patch(`/api/v1/promoters/${promoterId}/note`)
      .set(bearer(advisorToken))
      .send({ note: 'nota del asesor' })
      .expect(200);
  });

  it('con advisor.lock_enabled=false el asesor MUTA sin desbloqueo', async () => {
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } }); // sin ventana
    await setLock(false);
    try {
      await http()
        .patch(`/api/v1/promoters/${promoterId}/note`)
        .set(bearer(advisorToken))
        .send({ note: 'sin candado' })
        .expect(200);
    } finally {
      await setLock(true);
    }
  });

  it('status refleja el flujo: pendiente → desbloqueado tras aprobar', async () => {
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    await setLock(true);
    let st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body).toMatchObject({ lockEnabled: true, unlocked: false });

    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body.pending).toBe(true);

    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: req.body.devToken }).expect(200);
    st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body.unlocked).toBe(true);
    expect(st.body.expiresAt).toBeTruthy();
  });

  it('approve: token inválido → 404; token ya aprobado → 400', async () => {
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: 'x'.repeat(20) }).expect(404);
    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: req.body.devToken }).expect(200);
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: req.body.devToken }).expect(400);
  });

  it('RBAC: request exige rol asesor (admin 403); approve exige admin (asesor 403)', async () => {
    await http().post('/api/v1/advisor/unlock/request').set(bearer(adminToken)).expect(403);
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(advisorToken)).send({ token: 'y'.repeat(20) }).expect(403);
  });

  // --- Seguridad QA (verificación final) ---

  it('C-1: el asesor, AUN DESBLOQUEADO, NO puede asignar roles ni estado (@AdminOnly) → 403', async () => {
    await setLock(true);
    await unlock(); // ventana aprobada vigente
    // Escalada de privilegios: intentar auto-ascenderse a admin o tocar roles/estado ajenos.
    await http()
      .patch(`/api/v1/users/${advisorId}/roles`)
      .set(bearer(advisorToken))
      .send({ roles: ['admin'] })
      .expect(403);
    await http()
      .patch(`/api/v1/users/${promoterId}/roles`)
      .set(bearer(advisorToken))
      .send({ roles: ['admin'] })
      .expect(403);
    await http()
      .patch(`/api/v1/users/${promoterId}/status`)
      .set(bearer(advisorToken))
      .send({ status: 'inactive' })
      .expect(403);
  });

  it('C-1: ni el admin puede modificar SUS PROPIOS roles/estado (auto-bloqueo) → 403', async () => {
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin.toLowerCase().trim() } })).id;
    await http()
      .patch(`/api/v1/users/${adminId}/roles`)
      .set(bearer(adminToken))
      .send({ roles: ['admin', 'promoter'] })
      .expect(403);
    await http()
      .patch(`/api/v1/users/${adminId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'inactive' })
      .expect(403);
  });

  it('A-1: el candado NO bloquea la bandeja de soporte del asesor (take pasa el guard → 404 por ticket inexistente, no 403)', async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } }); // sin ventana
    // Con el fix @SkipAdvisorUnlock, el guard deja pasar → el servicio responde 404
    // (ticket inexistente), NO 403 de desbloqueo. Antes del fix era 403.
    await http()
      .post(`/api/v1/support/00000000-0000-0000-0000-000000000000/take`)
      .set(bearer(advisorToken))
      .expect(404);
  });
});
