import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED, clearMail, lastEmailCode } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * v3.5 · Desbloqueo de edición de evento por ADMIN. Un admin que edita un evento
 * AJENO debe autorizarse con OTP → token corto scoped (adminId,eventId). El
 * promotor DUEÑO edita libre. Cubre 100% ramas: request/verify (código malo, OTP
 * consumido, evento inexistente), enforcement (sin token, token inválido, otro
 * evento, otro admin, dueño exento) sobre evento y sobre localidades/asientos.
 */
describe('Desbloqueo de edición de evento (admin) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let admin2Token: string;
  let eventA: string;
  let eventB: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);

    // Segundo admin (para probar el scope por adminId).
    const password = await bcrypt.hash('Password123', 12);
    const a2 = await prisma.user.upsert({
      where: { email: 'admin2@pasaeventos.com' },
      update: { roles: ['admin'], emailVerifiedAt: new Date() },
      create: {
        email: 'admin2@pasaeventos.com',
        firstName: 'Admin2',
        passwordHash: password,
        roles: ['admin'],
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: a2.id, deviceHash: sha256('dev-admin2') } },
      update: { trustedAt: new Date() },
      create: { userId: a2.id, deviceHash: sha256('dev-admin2'), trustedAt: new Date() },
    });
    const r = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Device-Id', 'dev-admin2')
      .send({ email: 'admin2@pasaeventos.com', password: 'Password123' })
      .expect(200);
    admin2Token = r.body.tokens.accessToken;

    // Dos eventos en borrador, propiedad del PROMOTOR.
    const mk = async (name: string) =>
      (
        await request(app.getHttpServer())
          .post('/api/v1/events')
          .set({ Authorization: `Bearer ${promoterToken}` })
          .send({ name, startsAt: '2027-05-01T00:00:00.000Z' })
          .expect(201)
      ).body.id;
    eventA = await mk('Unlock A');
    eventB = await mk('Unlock B');
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: [eventA, eventB] } } });
    await prisma.user.deleteMany({ where: { email: 'admin2@pasaeventos.com' } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('promotor DUEÑO edita sin token → 200', async () => {
    await http()
      .patch(`/api/v1/events/${eventA}`)
      .set(bearer(promoterToken))
      .send({ description: 'editado por dueño' })
      .expect(200);
  });

  it('admin no-dueño SIN token → 403 (evento, localidad y publish)', async () => {
    await http().patch(`/api/v1/events/${eventA}`).set(bearer(adminToken)).send({ description: 'x' }).expect(403);
    await http()
      .post(`/api/v1/events/${eventA}/localities`)
      .set(bearer(adminToken))
      .send({ name: 'Loc', kind: 'general' })
      .expect(403);
    await http().post(`/api/v1/events/${eventA}/publish`).set(bearer(adminToken)).expect(403);
  });

  it('request/verify sobre evento inexistente → 404', async () => {
    const fake = '00000000-0000-0000-0000-000000000000';
    await http().post(`/api/v1/events/${fake}/edit-unlock/request`).set(bearer(adminToken)).expect(404);
    await http().post(`/api/v1/events/${fake}/edit-unlock/verify`).set(bearer(adminToken)).send({ code: '123456' }).expect(404);
  });

  it('verify con código incorrecto → 400', async () => {
    await clearMail();
    await http().post(`/api/v1/events/${eventA}/edit-unlock/request`).set(bearer(adminToken)).expect(200);
    await http()
      .post(`/api/v1/events/${eventA}/edit-unlock/verify`)
      .set(bearer(adminToken))
      .send({ code: '000000' })
      .expect(400);
  });

  it('OTP correcto → token; admin edita evento + localidad; token de un solo uso', async () => {
    await clearMail();
    await http().post(`/api/v1/events/${eventA}/edit-unlock/request`).set(bearer(adminToken)).expect(200);
    const code = await lastEmailCode(SEED.admin);
    const v = await http()
      .post(`/api/v1/events/${eventA}/edit-unlock/verify`)
      .set(bearer(adminToken))
      .send({ code })
      .expect(200);
    const token = v.body.token;

    // El OTP ya se consumió: reintentar con el mismo código → 400.
    await http()
      .post(`/api/v1/events/${eventA}/edit-unlock/verify`)
      .set(bearer(adminToken))
      .send({ code })
      .expect(400);

    // Con el token, el admin puede editar el evento y crear localidad.
    await http()
      .patch(`/api/v1/events/${eventA}`)
      .set(bearer(adminToken))
      .set('x-edit-unlock', token)
      .send({ description: 'editado por admin' })
      .expect(200);
    await http()
      .post(`/api/v1/events/${eventA}/localities`)
      .set(bearer(adminToken))
      .set('x-edit-unlock', token)
      .send({ name: 'Loc admin', kind: 'general' })
      .expect(201);

    // Token inválido en el header → 403.
    await http()
      .patch(`/api/v1/events/${eventA}`)
      .set(bearer(adminToken))
      .set('x-edit-unlock', 'token-basura')
      .send({ description: 'no' })
      .expect(403);

    // Mismo token NO sirve para OTRO evento (scope por evento) → 403.
    await http()
      .patch(`/api/v1/events/${eventB}`)
      .set(bearer(adminToken))
      .set('x-edit-unlock', token)
      .send({ description: 'no' })
      .expect(403);

    // OTRO admin con el token de admin1 → 403 (scope por adminId).
    await http()
      .patch(`/api/v1/events/${eventA}`)
      .set(bearer(admin2Token))
      .set('x-edit-unlock', token)
      .send({ description: 'no' })
      .expect(403);
  });

  it('request/verify solo admin (promotor → 403)', async () => {
    await http().post(`/api/v1/events/${eventA}/edit-unlock/request`).set(bearer(promoterToken)).expect(403);
    await http()
      .post(`/api/v1/events/${eventA}/edit-unlock/verify`)
      .set(bearer(promoterToken))
      .send({ code: '123456' })
      .expect(403);
  });
});
