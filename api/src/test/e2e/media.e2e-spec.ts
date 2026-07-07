import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Módulo media (Ola 1) — presign de subida, registro, listado público con URLs
 * firmadas y borrado. Cubre ownership cross-promoter (403), RBAC, 401 y 404.
 */
describe('Media de eventos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string;
  let promoterBToken: string;
  let buyerToken: string;
  let eventId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterToken = await loginTrusted(SEED.promoter, 'media-prom');
    buyerToken = await loginTrusted(SEED.buyer, 'media-buyer');

    const email = `mediab_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'B' });
    await prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['promoter'], promoterStatus: 'approved' },
    });
    promoterBToken = await loginTrusted(email, 'media-promb');

    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'MEDIA Event',
        slug: `media-${stamp}`,
        startsAt: new Date('2027-11-01T20:00:00-06:00'),
        endsAt: new Date('2027-11-01T23:00:00-06:00'),
      },
    });
    eventId = event.id;
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
    await prisma.eventMedia.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('presign → key + uploadUrl firmada (promotor dueño)', async () => {
    const res = await http()
      .post(`/api/v1/events/${eventId}/media/presign`)
      .set(bearer(promoterToken))
      .send({ filename: 'portada.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(res.body.key).toMatch(new RegExp(`^events/${eventId}/`));
    expect(res.body.uploadUrl).toContain(res.body.key);
  });

  it('presign con contentType inválido → 400', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/media/presign`)
      .set(bearer(promoterToken))
      .send({ filename: 'x.exe', contentType: 'application/x-msdownload' })
      .expect(400);
  });

  it('registrar + listar (público, URLs firmadas) + borrar (204)', async () => {
    const reg = await http()
      .post(`/api/v1/events/${eventId}/media`)
      .set(bearer(promoterToken))
      .send({ key: `events/${eventId}/cover.jpg`, kind: 'cover' })
      .expect(201);

    const list = await http().get(`/api/v1/events/${eventId}/media`).expect(200); // público
    expect(list.body).toHaveLength(1);
    expect(list.body[0].url).toContain('cover.jpg');

    await http().delete(`/api/v1/media/${reg.body.id}`).set(bearer(promoterToken)).expect(204);
    const after = await http().get(`/api/v1/events/${eventId}/media`).expect(200);
    expect(after.body).toHaveLength(0);
  });

  it('ownership: otro promotor no gestiona media de un evento ajeno → 403', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/media/presign`)
      .set(bearer(promoterBToken))
      .send({ filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(403);
    await http()
      .post(`/api/v1/events/${eventId}/media`)
      .set(bearer(promoterBToken))
      .send({ key: `events/${eventId}/hack.jpg` })
      .expect(403);
  });

  it('RBAC: un buyer no puede gestionar media (403); sin token → 401', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/media/presign`)
      .set(bearer(buyerToken))
      .send({ filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(403);
    await http()
      .post(`/api/v1/events/${eventId}/media/presign`)
      .send({ filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('presign sobre evento inexistente → 404; borrar media inexistente → 404', async () => {
    await http()
      .post('/api/v1/events/00000000-0000-0000-0000-000000000000/media/presign')
      .set(bearer(promoterToken))
      .send({ filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(404);
    await http()
      .delete('/api/v1/media/00000000-0000-0000-0000-000000000000')
      .set(bearer(promoterToken))
      .expect(404);
  });
});
