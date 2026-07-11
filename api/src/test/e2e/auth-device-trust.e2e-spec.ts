import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, clearMail, lastEmailCode, lastEmailFor, subjectsFor } from './utils';

/**
 * v3.9 · Grupo E (auth):
 *  - E1: dispositivo confiable por COOKIE estable `device_id`. Sin enviar el header
 *    X-Device-Id (como hace el navegador), el backend fija una cookie httpOnly y el
 *    MISMO navegador (mismo cookie jar) NO repite 2FA en el siguiente login. Un
 *    navegador distinto (otro jar) sí exige 2FA. Antes se derivaba de UA+IP → la IP
 *    volátil hacía que el mismo navegador se viera nuevo y pidiera 2FA siempre.
 *  - E2: el correo de "Nuevo inicio de sesión" se envía DESPUÉS de validar el 2FA,
 *    no en el paso `login` (no avisar de un intento aún sin autenticar).
 */
describe('Auth · dispositivo confiable por cookie + timing del aviso (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `devtrust_${Date.now()}@test.com`;
  const password = 'Password123';
  // Los asuntos de MailHog vienen MIME/Q-encoded (el acento de "sesión" fuerza la
  // codificación), así que buscamos un fragmento ASCII estable del asunto.
  const NEW_DEVICE_SUBJECT = 'Nuevo';

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    // Alta + correo verificado (para llegar al gate de 2FA).
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password, firstName: 'DevTrust' })
      .expect(201);
    await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: 'devtrust_' } } });
    await app.close();
  });

  /** Cookie `device_id` presente en la cabecera Set-Cookie de una respuesta. */
  const deviceCookieSet = (res: request.Response): boolean =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.some((c) =>
      c.startsWith('device_id='),
    ) ?? false;

  it('E1: navegador nuevo (sin X-Device-Id) → 2fa_required y set-cookie device_id', async () => {
    await clearMail();
    const agent = request.agent(app.getHttpServer());
    const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    expect(login.body.status).toBe('2fa_required');
    expect(deviceCookieSet(login)).toBe(true);

    // E2: en el paso login NO se envió el aviso de nuevo dispositivo.
    const afterLogin = await subjectsFor(email);
    expect(afterLogin.some((s) => s.includes(NEW_DEVICE_SUBJECT))).toBe(false);

    // Verifica el 2FA con la MISMA sesión (el jar reenvía la cookie device_id).
    const code = await lastEmailCode(email);
    const verify = await agent
      .post('/api/v1/auth/2fa/verify')
      .send({ preauthToken: login.body.preauthToken, code })
      .expect(200);
    expect(verify.body.status).toBe('ok');

    // E2: AHORA sí llegó el aviso de nuevo dispositivo (correo más reciente; con polling).
    const latest = await lastEmailFor(email);
    expect(latest.subject).toContain(NEW_DEVICE_SUBJECT);

    // E1: segundo login en el MISMO navegador (misma cookie) → sin 2FA.
    const relog = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    expect(relog.body.status).toBe('ok');
    expect(relog.body.tokens.accessToken).toBeDefined();
  });

  it('E1: navegador DISTINTO (otro cookie jar) → vuelve a exigir 2FA', async () => {
    const otherAgent = request.agent(app.getHttpServer());
    const login = await otherAgent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    expect(login.body.status).toBe('2fa_required');
  });

  it('E1: la IP volátil NO rompe la confianza (mismo navegador, distinto X-Forwarded-For)', async () => {
    await clearMail();
    const agent = request.agent(app.getHttpServer());
    // 1er login + 2FA desde una IP.
    const l1 = await agent
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ email, password })
      .expect(200);
    expect(l1.body.status).toBe('2fa_required');
    const code = await lastEmailCode(email);
    await agent
      .post('/api/v1/auth/2fa/verify')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ preauthToken: l1.body.preauthToken, code })
      .expect(200);
    // 2º login desde OTRA IP pero mismo navegador → sin 2FA (la huella es la cookie).
    const l2 = await agent
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.9')
      .send({ email, password })
      .expect(200);
    expect(l2.body.status).toBe('ok');
  });
});
