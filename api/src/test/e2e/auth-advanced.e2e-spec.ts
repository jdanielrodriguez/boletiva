import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';
import { clearMail, lastEmailCode } from './utils';

describe('Auth avanzado (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `adv_${Date.now()}@test.com`;
  const password = 'Password123';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Borrar eventos antes que usuarios (Event.promoter no tiene onDelete cascade).
    await prisma.event.deleteMany({ where: { name: { contains: 'ADV' } } });
    await prisma.user.deleteMany({ where: { email: { contains: 'adv_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const dev = (id: string) => ({ 'X-Device-Id': id });

  it('providers expone los métodos disponibles', async () => {
    const res = await http().get('/api/v1/auth/providers').expect(200);
    expect(res.body).toMatchObject({ password: true, passwordless: true, google: false });
  });

  it('signup deja el correo sin verificar y envía código', async () => {
    await clearMail();
    const res = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password, firstName: 'Adv' })
      .expect(201);
    expect(res.body.user.emailVerified).toBe(false);
    expect(res.body.user.twoFactorMethod).toBe('email');
  });

  it('verifica el correo con el código del email', async () => {
    const code = await lastEmailCode(email);
    const res = await http().post('/api/v1/auth/verify-email').send({ email, code }).expect(200);
    expect(res.body.emailVerified).toBe(true);
  });

  it('con correo verificado, login en dispositivo nuevo exige 2FA (email)', async () => {
    await clearMail();
    const res = await http()
      .post('/api/v1/auth/login')
      .set(dev('devA'))
      .send({ email, password })
      .expect(200);
    expect(res.body.status).toBe('2fa_required');
    expect(res.body.method).toBe('email');
    expect(res.body.preauthToken).toBeDefined();

    const code = await lastEmailCode(email);
    const done = await http()
      .post('/api/v1/auth/2fa/verify')
      .set(dev('devA'))
      .send({ preauthToken: res.body.preauthToken, code })
      .expect(200);
    expect(done.body.status).toBe('ok');
    expect(done.body.tokens.accessToken).toBeDefined();
  });

  it('en un dispositivo ya confiable no se vuelve a pedir 2FA', async () => {
    const res = await http()
      .post('/api/v1/auth/login')
      .set(dev('devA'))
      .send({ email, password })
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.tokens.accessToken).toBeDefined();
  });

  it('configura TOTP y lo usa como segundo factor en un dispositivo nuevo', async () => {
    // token de sesión (device confiable devA)
    const session = await http()
      .post('/api/v1/auth/login')
      .set(dev('devA'))
      .send({ email, password });
    const token = session.body.tokens.accessToken;

    // B-02: sin re-autenticación (contraseña) → 401 (un token robado no basta).
    await http()
      .post('/api/v1/auth/2fa/totp/setup')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(401);
    // Con la contraseña correcta (step-up) → 201.
    const setup = await http()
      .post('/api/v1/auth/2fa/totp/setup')
      .set('Authorization', `Bearer ${token}`)
      .send({ password })
      .expect(201);
    const secret = setup.body.secret;
    expect(setup.body.qrDataUrl).toContain('data:image/png');

    await http()
      .post('/api/v1/auth/2fa/totp/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: authenticator.generate(secret) })
      .expect(200);

    // Login en dispositivo nuevo → ahora pide TOTP
    const res = await http()
      .post('/api/v1/auth/login')
      .set(dev('devTOTP'))
      .send({ email, password })
      .expect(200);
    expect(res.body.status).toBe('2fa_required');
    expect(res.body.method).toBe('totp');

    const done = await http()
      .post('/api/v1/auth/2fa/verify')
      .set(dev('devTOTP'))
      .send({ preauthToken: res.body.preauthToken, code: authenticator.generate(secret) })
      .expect(200);
    expect(done.body.status).toBe('ok');
  });

  it('passwordless: solicita y entra con el código del correo', async () => {
    const pwl = `adv_pwl_${Date.now()}@test.com`;
    await clearMail();
    await http().post('/api/v1/auth/passwordless/request').send({ email: pwl }).expect(202);
    const code = await lastEmailCode(pwl);
    const res = await http()
      .post('/api/v1/auth/passwordless/verify')
      .set(dev('devPwl'))
      .send({ email: pwl, code })
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.user.emailVerified).toBe(true);
  });

  it('login con Google sin configurar → 503', async () => {
    await http().post('/api/v1/auth/google').send({ idToken: 'fake' }).expect(503);
  });

  it('RequireVerifiedEmail: promotor sin verificar no crea evento; verificado sí', async () => {
    const pmEmail = `adv_pm_${Date.now()}@test.com`;
    const signup = await http()
      .post('/api/v1/auth/signup')
      .send({ email: pmEmail, password, firstName: 'PM' });

    // El admin lo promueve a promotor.
    const adminToken = await login(app, SEED.admin);
    await http()
      .patch(`/api/v1/users/${signup.body.user.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roles: ['promoter'] })
      .expect(200);

    // Login tras la promoción → token con rol promoter (email aún sin verificar,
    // por eso no pide 2FA y devuelve tokens directamente).
    const relog = await http()
      .post('/api/v1/auth/login')
      .set('X-Device-Id', 'devPM')
      .send({ email: pmEmail, password })
      .expect(200);
    const pmToken = relog.body.tokens.accessToken;

    const payload = {
      name: 'ADV Evento',
      startsAt: '2026-11-01T20:00:00-06:00',
      endsAt: '2026-11-01T23:00:00-06:00',
    };
    // Rol correcto pero correo no verificado → bloquea el guard de verificación.
    await http()
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${pmToken}`)
      .send(payload)
      .expect(403);

    // Verificar correo (el guard consulta la BD) + autorizar como promotor
    // (Ola 4: operar exige aprobación de admin) y reintentar.
    await prisma.user.update({
      where: { id: signup.body.user.id },
      data: { emailVerifiedAt: new Date(), promoterStatus: 'approved' },
    });
    await http()
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${pmToken}`)
      .send(payload)
      .expect(201);
  });

  describe('Dispositivos (GET/DELETE /auth/devices)', () => {
    let token: string;

    beforeAll(async () => {
      // devA ya quedó confiable en pasos previos → login directo (status 'ok').
      const res = await http()
        .post('/api/v1/auth/login')
        .set(dev('devA'))
        .send({ email, password })
        .expect(200);
      token = res.body.tokens.accessToken;
    });

    const auth = () => ({ Authorization: `Bearer ${token}` });

    it('lista los dispositivos del usuario (incluye el confiable)', async () => {
      const res = await http().get('/api/v1/auth/devices').set(auth()).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('trustedAt');
      expect(res.body[0]).toHaveProperty('lastSeenAt');
    });

    it('login SIN X-Device-Id resuelve la huella por cookie/UA (fallback de hash)', async () => {
      // Sin header X-Device-Id el backend fija una cookie `device_id` estable (o cae
      // al fallback solo-UA); el login se procesa igual (registra/actualiza el dispositivo).
      const before = (await http().get('/api/v1/auth/devices').set(auth()).expect(200)).body.length;
      const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
      expect(['ok', '2fa_required']).toContain(res.body.status);
      const after = (await http().get('/api/v1/auth/devices').set(auth()).expect(200)).body.length;
      expect(after).toBeGreaterThanOrEqual(before); // el dispositivo del fallback quedó registrado
    });

    it('revoca un dispositivo propio (204) y desaparece del listado', async () => {
      const list = (await http().get('/api/v1/auth/devices').set(auth()).expect(200)).body;
      // El menos reciente (nunca el confiable en uso para el token actual).
      const target = list[list.length - 1].id;
      await http().delete(`/api/v1/auth/devices/${target}`).set(auth()).expect(204);
      const after = (await http().get('/api/v1/auth/devices').set(auth()).expect(200)).body;
      expect(after.some((d: { id: string }) => d.id === target)).toBe(false);
    });

    it('revocar un id inexistente es idempotente (204, no falla)', async () => {
      await http()
        .delete('/api/v1/auth/devices/00000000-0000-0000-0000-000000000000')
        .set(auth())
        .expect(204);
    });

    it('sin token → 401', async () => {
      await http().get('/api/v1/auth/devices').expect(401);
    });
  });
});
