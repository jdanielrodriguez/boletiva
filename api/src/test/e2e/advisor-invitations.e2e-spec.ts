import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * T7e · Invitación de asesores. Cubre: RBAC (solo admin invita), usuario NUEVO
 * (se crea + fija contraseña → asesor activo), usuario EXISTENTE (confirma → gana
 * rol asesor), peek (needsPassword), y ya-asesor → 409.
 */
describe('Invitación de asesores (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let buyerEmail = '';
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'adv-admin');
    // Un comprador verificado (para probar RBAC + confirmación de usuario existente).
    const email = `advbuyer_${stamp}@test.com`;
    const res = await request(app.getHttpServer()).post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: 'Buyer' });
    await prisma.user.update({ where: { id: res.body.user.id }, data: { emailVerifiedAt: new Date() } });
    buyerToken = await loginTrusted(email, 'adv-buyer');
    buyerEmail = email;
  });

  afterAll(async () => {
    await prisma.advisorInvitation.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
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
    const res = await http().post('/api/v1/auth/login').set('X-Device-Id', deviceId).send({ email, password: 'Password123' }).expect(200);
    return res.body.tokens.accessToken;
  }

  it('RBAC: un no-admin no puede invitar asesores (403)', async () => {
    await http().post('/api/v1/advisors/invitations').set(bearer(buyerToken)).send({ emails: ['x@x.com'] }).expect(403);
  });

  it('usuario NUEVO: se crea, peek pide contraseña, fija contraseña → asesor activo', async () => {
    const email = `advnew_${stamp}@test.com`;
    const created = await http().post('/api/v1/advisors/invitations').set(bearer(adminToken)).send({ emails: [email] }).expect(201);
    const inv = created.body.invitations[0];
    expect(inv.isNewUser).toBe(true);
    // El usuario ya existe en BD (pending, sin password).
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.status).toBe('pending');
    // peek → needsPassword true.
    const peek = await http().get(`/api/v1/advisors/invitations/peek?token=${inv.token}`).expect(200);
    expect(peek.body.needsPassword).toBe(true);
    expect(peek.body.email).toBe(email);
    // set-password → asesor + activo.
    await http().post('/api/v1/advisors/invitations/set-password').send({ token: inv.token, password: 'Password123' }).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.status).toBe('active');
    expect(after.roles).toContain('advisor');
    expect(after.passwordHash).toBeTruthy();
    // token ya usado → 409
    await http().post('/api/v1/advisors/invitations/set-password').send({ token: inv.token, password: 'Password123' }).expect(409);
  });

  it('usuario EXISTENTE: confirma (autenticado) → gana rol asesor; peek no pide contraseña', async () => {
    const email = buyerEmail;
    const created = await http().post('/api/v1/advisors/invitations').set(bearer(adminToken)).send({ emails: [email] }).expect(201);
    const inv = created.body.invitations[0];
    expect(inv.isNewUser).toBe(false);
    const peek = await http().get(`/api/v1/advisors/invitations/peek?token=${inv.token}`).expect(200);
    expect(peek.body.needsPassword).toBe(false);
    // El propio comprador confirma.
    await http().post('/api/v1/advisors/invitations/accept').set(bearer(buyerToken)).send({ token: inv.token }).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.roles).toContain('advisor');
  });

  it('invitar a alguien que YA es asesor → 409', async () => {
    const email = buyerEmail; // ya es asesor del test previo
    await http().post('/api/v1/advisors/invitations').set(bearer(adminToken)).send({ emails: [email] }).expect(409);
  });
});
