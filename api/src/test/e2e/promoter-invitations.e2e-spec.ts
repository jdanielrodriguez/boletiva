import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * F4 · Invitación de promotores por token. Un admin/promotor invita por correo;
 * el destinatario se registra con el email precargado y al aceptar queda
 * AUTO-APROBADO como promotor (se salta la autorización). Cubre: creación + URL,
 * peek público, aceptación (auto-aprueba), coincidencia de correo, revocación,
 * expiración, RBAC, validación de correos e IDOR.
 */
describe('Invitación de promotores (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    // Autorización EXIGIDA globalmente: así probamos que la invitación la SALTA.
    await prisma.setting.upsert({
      where: { key: 'promoters.require_approval' },
      update: { value: true },
      create: { key: 'promoters.require_approval', value: true, description: 'test' },
    });
    adminToken = await loginTrusted(SEED.admin, 'inv-admin');
    buyerToken = await loginTrusted(SEED.buyer, 'inv-buyer');
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

  /** Registra un usuario verificado con el email dado y lo loguea (dispositivo confiable). */
  async function registerAndLogin(email: string, device: string): Promise<{ id: string; token: string }> {
    const s = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Inv' });
    await prisma.user.update({ where: { id: s.body.user.id }, data: { emailVerifiedAt: new Date() } });
    const token = await loginTrusted(email, device);
    return { id: s.body.user.id, token };
  }

  afterAll(async () => {
    await prisma.promoterInvitation.deleteMany({ where: { email: { contains: `inv_${stamp}` } } });
    const users = await prisma.user.findMany({ where: { email: { contains: `inv_${stamp}` } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const invite = (emails: string[], t = adminToken) =>
    http().post('/api/v1/promoters/invitations').set(bearer(t)).send({ emails });

  it('admin invita a varios correos → devuelve URLs con token y crea filas pendientes', async () => {
    const e1 = `inv_${stamp}_a@test.com`;
    const e2 = `inv_${stamp}_b@test.com`;
    const res = await invite([e1, e2]).expect(201);
    expect(res.body.invitations).toHaveLength(2);
    expect(res.body.invitations[0].url).toContain('/registro?token=');
    expect(res.body.invitations[0].token).toBeTruthy();
    const rows = await prisma.promoterInvitation.findMany({ where: { email: { in: [e1, e2] } } });
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    // El token se guarda hasheado, nunca en claro.
    expect(rows[0].tokenHash).not.toBe(res.body.invitations[0].token);
  });

  it('peek público devuelve el correo del token (para precargar el registro)', async () => {
    const email = `inv_${stamp}_peek@test.com`;
    const { body } = await invite([email]).expect(201);
    const token = body.invitations[0].token;
    const res = await http().get(`/api/v1/promoters/invitations/peek?token=${token}`).expect(200);
    expect(res.body.email).toBe(email);
    expect(res.body.valid).toBe(true);
  });

  it('aceptar la invitación AUTO-APRUEBA como promotor (salta la autorización)', async () => {
    const email = `inv_${stamp}_accept@test.com`;
    const { body } = await invite([email]).expect(201);
    const token = body.invitations[0].token;
    const { id, token: userToken } = await registerAndLogin(email, 'inv-accept');
    // Antes de aceptar: no es promotor.
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).promoterStatus).toBe('none');
    await http().post('/api/v1/promoters/invitations/accept').set(bearer(userToken)).send({ token }).expect(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.promoterStatus).toBe('approved');
    expect(user.roles).toContain('promoter');
    // La invitación queda aceptada.
    const inv = await prisma.promoterInvitation.findFirstOrThrow({ where: { email } });
    expect(inv.status).toBe('accepted');
    expect(inv.acceptedByUserId).toBe(id);
  });

  it('aceptar con un correo que NO coincide → 403', async () => {
    const email = `inv_${stamp}_mismatch@test.com`;
    const { body } = await invite([email]).expect(201);
    const other = await registerAndLogin(`inv_${stamp}_other@test.com`, 'inv-other');
    await http()
      .post('/api/v1/promoters/invitations/accept')
      .set(bearer(other.token))
      .send({ token: body.invitations[0].token })
      .expect(403);
  });

  it('token inválido → peek 404 y accept 404', async () => {
    await http().get('/api/v1/promoters/invitations/peek?token=no-existe').expect(404);
    await http()
      .post('/api/v1/promoters/invitations/accept')
      .set(bearer(buyerToken))
      .send({ token: 'no-existe' })
      .expect(404);
  });

  it('token expirado → peek 400', async () => {
    const email = `inv_${stamp}_exp@test.com`;
    const { body } = await invite([email]).expect(201);
    const token = body.invitations[0].token;
    await prisma.promoterInvitation.updateMany({
      where: { tokenHash: sha256(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http().get(`/api/v1/promoters/invitations/peek?token=${token}`).expect(400);
  });

  it('revocar: el dueño puede; queda revoked y el token deja de servir', async () => {
    const email = `inv_${stamp}_rev@test.com`;
    const { body } = await invite([email]).expect(201);
    const { id, token: tok } = { id: body.invitations[0].id, token: body.invitations[0].token };
    await http().delete(`/api/v1/promoters/invitations/${id}`).set(bearer(adminToken)).expect(200);
    expect((await prisma.promoterInvitation.findUniqueOrThrow({ where: { id } })).status).toBe('revoked');
    await http().get(`/api/v1/promoters/invitations/peek?token=${tok}`).expect(404);
  });

  it('revocar una ya revocada → 409', async () => {
    const email = `inv_${stamp}_rev2@test.com`;
    const { body } = await invite([email]).expect(201);
    const id = body.invitations[0].id;
    await http().delete(`/api/v1/promoters/invitations/${id}`).set(bearer(adminToken)).expect(200);
    await http().delete(`/api/v1/promoters/invitations/${id}`).set(bearer(adminToken)).expect(409);
  });

  it('RBAC: un comprador (buyer) NO puede invitar → 403', async () => {
    await invite([`inv_${stamp}_x@test.com`], buyerToken).expect(403);
  });

  it('validación: lista vacía → 400; correo inválido → 400', async () => {
    await invite([]).expect(400);
    await invite(['no-es-correo']).expect(400);
  });

  it('sin token (401) al invitar y al aceptar', async () => {
    await http().post('/api/v1/promoters/invitations').send({ emails: ['a@b.com'] }).expect(401);
    await http().post('/api/v1/promoters/invitations/accept').send({ token: 'x' }).expect(401);
  });
});
