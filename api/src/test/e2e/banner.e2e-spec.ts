import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * F4 · Banner con IA (stub). Sólo el dueño (promotor) o un admin pueden generar el
 * banner de un evento; se registra como media `cover`. Cubre: generación + registro,
 * ownership (promotor ajeno → 403), RBAC (buyer → 403), evento inexistente → 404,
 * sin token → 401.
 */
describe('Banner con IA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string;
  let buyerToken: string;
  let promoterId: string;
  let eventId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    promoterToken = await loginTrusted(SEED.promoter, 'bn-promoter');
    buyerToken = await loginTrusted(SEED.buyer, 'bn-buyer');
    const ev = await prisma.event.create({
      data: {
        promoterId,
        name: `BN Fiesta ${stamp}`,
        slug: `bn-${stamp}`,
        startsAt: new Date('2028-10-01T20:00:00-06:00'),
        endsAt: new Date('2028-10-01T23:00:00-06:00'),
        status: 'draft',
      },
    });
    eventId = ev.id;
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
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('el promotor dueño genera el banner → 201, media cover con URL', async () => {
    const res = await http().post(`/api/v1/events/${eventId}/banner`).set(bearer(promoterToken)).expect(201);
    expect(res.body.kind).toBe('cover');
    expect(res.body.url).toContain('http');
    expect(res.body.provider).toBe('stub');
    const media = await prisma.eventMedia.findMany({ where: { eventId } });
    expect(media.length).toBeGreaterThanOrEqual(1);
    expect(media.some((m) => m.kind === 'cover')).toBe(true);
  });

  it('regenerar REEMPLAZA el cover (no acumula — H6)', async () => {
    await http().post(`/api/v1/events/${eventId}/banner`).set(bearer(promoterToken)).expect(201);
    // El cover previo se borra: siempre hay exactamente uno (no crece sin control).
    const covers = await prisma.eventMedia.findMany({ where: { eventId, kind: 'cover' } });
    expect(covers.length).toBe(1);
  });

  it('un comprador (buyer) no puede generar banner → 403 (RBAC)', async () => {
    await http().post(`/api/v1/events/${eventId}/banner`).set(bearer(buyerToken)).expect(403);
  });

  it('evento inexistente → 404', async () => {
    await http()
      .post('/api/v1/events/00000000-0000-0000-0000-000000000000/banner')
      .set(bearer(promoterToken))
      .expect(404);
  });

  it('sin token → 401', async () => {
    await http().post(`/api/v1/events/${eventId}/banner`).expect(401);
  });

  it('otro promotor (no dueño) → 403', async () => {
    const email = `bn_other_${stamp}@test.com`;
    const s = await http().post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: 'Otro' });
    await prisma.user.update({
      where: { id: s.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['buyer', 'promoter'], promoterStatus: 'approved' },
    });
    const otherToken = await loginTrusted(email, 'bn-other');
    await http().post(`/api/v1/events/${eventId}/banner`).set(bearer(otherToken)).expect(403);
    await prisma.user.deleteMany({ where: { email } });
  });
});
