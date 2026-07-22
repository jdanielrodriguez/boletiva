import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Venues (Ola 1) — mapas de asiento VERSIONADOS (invariante: solo uno activo) y
 * CRUD de localidades/asientos con recálculo de aforo. Cubre ownership 403.
 */
describe('Venues: seat-maps versionados + localities/seats (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string;
  let promoterBToken: string;
  let eventId: string;
  let localityId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterToken = await loginTrusted(SEED.promoter, 'venue-prom');

    const email = `venueb_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'B' });
    await prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['promoter'], promoterStatus: 'approved' },
    });
    promoterBToken = await loginTrusted(email, 'venue-promb');

    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'VENUE Event',
        slug: `venue-${stamp}`,
        startsAt: new Date('2027-11-15T20:00:00-06:00'),
        endsAt: new Date('2027-11-15T23:00:00-06:00'),
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
    await prisma.seat.deleteMany({ where: { locality: { eventId } } });
    await prisma.seatMap.deleteMany({ where: { eventId } });
    await prisma.locality.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const activeCount = () => prisma.seatMap.count({ where: { eventId, active: true } });

  it('crea localidad y ajusta el aforo al generar/borrar asientos', async () => {
    const loc = await http()
      .post(`/api/v1/events/${eventId}/localities`)
      .set(bearer(promoterToken))
      .send({ name: 'Platea', kind: 'seated', desiredNet: 100 })
      .expect(201);
    localityId = loc.body.id;

    const gen = await http()
      .post(`/api/v1/localities/${localityId}/seats/generate`)
      .set(bearer(promoterToken))
      .send({ count: 10, labelPrefix: 'A' })
      .expect(201);
    expect(gen.body).toMatchObject({ created: 10, capacity: 10 });

    const seats = await prisma.seat.findMany({ where: { localityId }, take: 3 });
    const del = await http()
      .delete(`/api/v1/localities/${localityId}/seats`)
      .set(bearer(promoterToken))
      .send({ ids: seats.map((s) => s.id) })
      .expect(200);
    expect(del.body).toMatchObject({ deleted: 3, capacity: 7 }); // aforo recalculado
  });

  it('bulk de asientos con coordenadas + listado', async () => {
    const bulk = await http()
      .post(`/api/v1/localities/${localityId}/seats`)
      .set(bearer(promoterToken))
      .send({ seats: [{ label: 'Z1', x: 1, y: 2 }, { label: 'Z2', x: 3, y: 4 }] })
      .expect(201);
    expect(bulk.body.created).toBe(2);
    const list = await http().get(`/api/v1/localities/${localityId}/seats`).set(bearer(promoterToken)).expect(200);
    expect(list.body.some((s: { label: string }) => s.label === 'Z1')).toBe(true);
  });

  it('actualizar y (luego) el CRUD respeta ownership (promotor ajeno → 403)', async () => {
    const upd = await http()
      .patch(`/api/v1/localities/${localityId}`)
      .set(bearer(promoterToken))
      .send({ name: 'Platea Alta' })
      .expect(200);
    expect(upd.body.name).toBe('Platea Alta');
    await http()
      .post(`/api/v1/events/${eventId}/localities`)
      .set(bearer(promoterBToken))
      .send({ name: 'Hack' })
      .expect(403);
  });

  it('seat-maps versionados: crear v1 y v2 deja solo el último activo', async () => {
    const v1 = await http()
      .post(`/api/v1/events/${eventId}/seat-maps`)
      .set(bearer(promoterToken))
      .send({ name: 'v1' })
      .expect(201);
    expect(v1.body).toMatchObject({ version: 1, active: true });

    const v2 = await http()
      .post(`/api/v1/events/${eventId}/seat-maps`)
      .set(bearer(promoterToken))
      .send({ name: 'v2' })
      .expect(201);
    expect(v2.body).toMatchObject({ version: 2, active: true });
    expect(await activeCount()).toBe(1); // invariante: uno solo activo

    // Publica el evento: el endpoint público de mapa solo sirve eventos PUBLICADOS
    // (QA promotores-H7). Persiste para el siguiente test (activar versión previa).
    await prisma.event.update({ where: { id: eventId }, data: { status: 'published' } });
    // El público ve el activo (v2).
    const pub = await http().get(`/api/v1/events/${eventId}/seat-map`).expect(200);
    expect(pub.body.version).toBe(2);
  });

  it('activar una versión anterior mueve el "activo" (sigue habiendo uno solo)', async () => {
    const maps = await http().get(`/api/v1/events/${eventId}/seat-maps`).set(bearer(promoterToken)).expect(200);
    const v1 = maps.body.find((m: { version: number }) => m.version === 1);
    const res = await http().post(`/api/v1/seat-maps/${v1.id}/activate`).set(bearer(promoterToken)).expect(200);
    expect(res.body.active).toBe(true);
    expect(await activeCount()).toBe(1);
    const pub = await http().get(`/api/v1/events/${eventId}/seat-map`).expect(200);
    expect(pub.body.version).toBe(1);
  });

  it('evento sin mapa activo → 404 en el endpoint público', async () => {
    const ev2 = await prisma.event.create({
      data: {
        promoterId: (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id,
        name: 'Sin mapa',
        slug: `venue-nomap-${stamp}`,
        status: 'published', // publicado pero SIN mapa → 404 por falta de mapa (no por borrador)
        startsAt: new Date('2027-11-16T20:00:00-06:00'),
        endsAt: new Date('2027-11-16T23:00:00-06:00'),
      },
    });
    await http().get(`/api/v1/events/${ev2.id}/seat-map`).expect(404);
    await prisma.event.delete({ where: { id: ev2.id } });
  });
});
