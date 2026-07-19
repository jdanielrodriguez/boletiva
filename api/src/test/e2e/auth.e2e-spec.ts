import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e_${Date.now()}@test.com`;
  const password = 'Password123';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: 'e2e_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('POST /auth/signup crea usuario y devuelve tokens', async () => {
    const res = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password, firstName: 'E2E' })
      .expect(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.roles).toEqual(['buyer']);
    expect(res.body.tokens.accessToken).toBeDefined();
    expect(res.body.tokens.refreshToken).toBeDefined();
  });

  it('POST /auth/signup con email duplicado → 202 genérico (anti-enumeración, sin tokens)', async () => {
    // M-01: NO revela que el correo existe (no 409). Devuelve 202 con mensaje genérico y
    // sin sesión; NO crea una segunda cuenta.
    const before = await prisma.user.count({ where: { email } });
    const res = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password, firstName: 'Dup' })
      .expect(202);
    expect(res.body.tokens).toBeUndefined();
    expect(res.body.user).toBeUndefined();
    expect(typeof res.body.message).toBe('string');
    const after = await prisma.user.count({ where: { email } });
    expect(after).toBe(before); // no se creó una cuenta nueva
  });

  it('POST /auth/signup con payload inválido → 400', async () => {
    await http()
      .post('/api/v1/auth/signup')
      .send({ email: 'no-mail', password: '123' })
      .expect(400);
  });

  it('POST /auth/login con credenciales correctas → 200', async () => {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    expect(res.body.tokens.accessToken).toBeDefined();
  });

  it('POST /auth/login con password incorrecta → 401', async () => {
    await http().post('/api/v1/auth/login').send({ email, password: 'wrong' }).expect(401);
  });

  it('GET /auth/me requiere token', async () => {
    await http().get('/api/v1/auth/me').expect(401);
  });

  it('GET /auth/me con token devuelve el perfil', async () => {
    const login = await http().post('/api/v1/auth/login').send({ email, password });
    const token = login.body.tokens.accessToken;
    const res = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.email).toBe(email);
  });

  it('POST /auth/refresh rota el refresh token y detecta reuso', async () => {
    const login = await http().post('/api/v1/auth/login').send({ email, password });
    const oldRefresh = login.body.tokens.refreshToken;

    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh })
      .expect(200);
    expect(rotated.body.accessToken).toBeDefined();
    expect(rotated.body.refreshToken).not.toBe(oldRefresh);

    // Reusar el refresh viejo (ya rotado) debe fallar.
    await http().post('/api/v1/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);
  });

  it('login del seed funciona (admin/promotor/cliente)', async () => {
    for (const mail of Object.values(SEED)) {
      await http().post('/api/v1/auth/login').send({ email: mail, password }).expect(200);
    }
  });

  // ---- Refresh token en cookie httpOnly (Ola 6.6) --------------------------

  const cookiesOf = (res: request.Response): string[] => {
    const raw = res.headers['set-cookie'];
    return Array.isArray(raw) ? raw : raw ? [raw] : [];
  };
  const refreshCookie = (res: request.Response): string | undefined =>
    cookiesOf(res).find((c) => c.startsWith('refresh_token='));

  it('POST /auth/login set-ea la cookie httpOnly refresh_token', async () => {
    const res = await http().post('/api/v1/auth/login').send({ email, password }).expect(200);
    const cookie = refreshCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toContain('Path=/');
    // El valor de la cookie coincide con el refresh del body (fallback no-web).
    expect(cookie).toContain(`refresh_token=${res.body.tokens.refreshToken}`);
  });

  it('POST /auth/refresh lee el refresh de la cookie (sin body) y rota', async () => {
    const login = await http().post('/api/v1/auth/login').send({ email, password });
    const loginCookie = refreshCookie(login) as string;
    const oldRefresh = login.body.tokens.refreshToken;

    const rotated = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', loginCookie)
      .send({})
      .expect(200);
    expect(rotated.body.accessToken).toBeDefined();
    expect(rotated.body.refreshToken).not.toBe(oldRefresh);
    // Re-set de la cookie con el token rotado.
    const rotatedCookie = refreshCookie(rotated);
    expect(rotatedCookie).toContain(`refresh_token=${rotated.body.refreshToken}`);
  });

  it('POST /auth/refresh detecta reuso del refresh de la cookie', async () => {
    const login = await http().post('/api/v1/auth/login').send({ email, password });
    const loginCookie = refreshCookie(login) as string;
    await http().post('/api/v1/auth/refresh').set('Cookie', loginCookie).send({}).expect(200);
    // Reusar la cookie vieja (ya rotada) revoca la familia → 401.
    await http().post('/api/v1/auth/refresh').set('Cookie', loginCookie).send({}).expect(401);
  });

  it('POST /auth/refresh sin cookie ni body → 401', async () => {
    await http().post('/api/v1/auth/refresh').send({}).expect(401);
  });

  it('POST /auth/logout borra la cookie y revoca la familia', async () => {
    const login = await http().post('/api/v1/auth/login').send({ email, password });
    const loginCookie = refreshCookie(login) as string;

    const out = await http()
      .post('/api/v1/auth/logout')
      .set('Cookie', loginCookie)
      .send({})
      .expect(204);
    // clearCookie emite un Set-Cookie con expiración en el pasado.
    const cleared = refreshCookie(out);
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);

    // Tras logout, la cookie ya no sirve para refrescar.
    await http().post('/api/v1/auth/refresh').set('Cookie', loginCookie).send({}).expect(401);
  });
});
