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

  it('POST /auth/signup con email duplicado → 409', async () => {
    await http()
      .post('/api/v1/auth/signup')
      .send({ email, password, firstName: 'Dup' })
      .expect(409);
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
});
