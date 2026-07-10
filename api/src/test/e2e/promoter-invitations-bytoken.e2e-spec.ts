import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * v3.5 · Invitación por token: la vista pública `by-token` informa si YA existe
 * cuenta (→ iniciar sesión y aceptar sin registro) o no (→ registro). El aceptar
 * activa el rol promotor aprobado. Cubre: cuenta existe/no existe, aceptar cuenta
 * existente, email no coincide (403), token inválido/consumido.
 */
describe('Invitación de promotor · by-token (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    await prisma.setting.upsert({
      where: { key: 'promoters.require_approval' },
      update: { value: true },
      create: { key: 'promoters.require_approval', value: true, description: 'test' },
    });
    adminToken = await loginTrusted(SEED.admin, 'bt-admin');
  });

  afterAll(async () => {
    await prisma.promoterInvitation.deleteMany({ where: { email: { contains: `bt_${stamp}` } } });
    const users = await prisma.user.findMany({ where: { email: { contains: `bt_${stamp}` } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function loginTrusted(rawEmail: string, deviceId: string): Promise<string> {
    const email = rawEmail.toLowerCase().trim();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: user.id, deviceHash: sha256(deviceId) } },
      update: { trustedAt: new Date() },
      create: { userId: user.id, deviceHash: sha256(deviceId), trustedAt: new Date() },
    });
    const res = await http()
      .post('/api/v1/auth/login')
      .set('X-Device-Id', deviceId)
      .send({ email, password: 'Password123' })
      .expect(200);
    return res.body.tokens.accessToken;
  }

  async function registerAndLogin(email: string, device: string) {
    const s = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'BT' });
    await prisma.user.update({ where: { id: s.body.user.id }, data: { emailVerifiedAt: new Date() } });
    const token = await loginTrusted(email, device);
    return { id: s.body.user.id, token };
  }

  async function inviteToken(email: string): Promise<string> {
    const res = await http()
      .post('/api/v1/promoters/invitations')
      .set(bearer(adminToken))
      .send({ emails: [email] })
      .expect(201);
    return res.body.invitations[0].token;
  }

  it('by-token: cuenta NO existe → accountExists=false', async () => {
    const email = `bt_${stamp}_new@test.com`;
    const token = await inviteToken(email);
    const res = await http().get(`/api/v1/promoters/invitations/by-token/${token}`).expect(200);
    expect(res.body.email).toBe(email);
    expect(res.body.accountExists).toBe(false);
    expect(res.body.valid).toBe(true);
  });

  it('by-token: cuenta EXISTE → accountExists=true; aceptar activa promotor', async () => {
    const email = `bt_${stamp}_exists@test.com`;
    const { id, token: userToken } = await registerAndLogin(email, 'bt-exists');
    const invToken = await inviteToken(email);

    const peek = await http().get(`/api/v1/promoters/invitations/by-token/${invToken}`).expect(200);
    expect(peek.body.accountExists).toBe(true);

    const acc = await http()
      .post(`/api/v1/promoters/invitations/by-token/${invToken}/accept`)
      .set(bearer(userToken))
      .expect(200);
    expect(acc.body.accepted).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(user.promoterStatus).toBe('approved');
    expect(user.roles).toContain('promoter');
  });

  it('aceptar con email que NO coincide → 403', async () => {
    const invitedEmail = `bt_${stamp}_target@test.com`;
    const invToken = await inviteToken(invitedEmail);
    const { token: otherToken } = await registerAndLogin(`bt_${stamp}_other@test.com`, 'bt-other');
    await http()
      .post(`/api/v1/promoters/invitations/by-token/${invToken}/accept`)
      .set(bearer(otherToken))
      .expect(403);
  });

  it('by-token con token inválido → 404', async () => {
    await http().get('/api/v1/promoters/invitations/by-token/token-inexistente').expect(404);
  });

  it('by-token con invitación ya consumida → 409', async () => {
    const email = `bt_${stamp}_used@test.com`;
    const { token: userToken } = await registerAndLogin(email, 'bt-used');
    const invToken = await inviteToken(email);
    await http()
      .post(`/api/v1/promoters/invitations/by-token/${invToken}/accept`)
      .set(bearer(userToken))
      .expect(200);
    // Ya aceptada: la vista por token responde 409.
    await http().get(`/api/v1/promoters/invitations/by-token/${invToken}`).expect(409);
  });
});
