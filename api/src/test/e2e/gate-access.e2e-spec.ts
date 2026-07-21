import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 6.5 · Ticket 5 — Endurecimiento SafeTix (AMBOS: token de puerta corto +
 * asignación persistida). Cubre: CRUD de asignación (admin/promotor dueño),
 * emisión del gate-token (asignado/admin sí, no-asignado 403), y enforcement del
 * manifiesto (token de puerta del evento ok; token normal 403; token de otro
 * evento 403; expirado 401; admin exento) + expiración firmada del manifiesto.
 */
describe('SafeTix: acceso de operadores de puerta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let secret: string;
  let promoterToken: string; // dueño del evento
  let adminToken: string;
  let buyerToken: string;
  let opAccess: string; // token de acceso NORMAL del operador
  let opId: string;
  let eventId: string;
  let otherEventId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    secret = app.get(ConfigService).getOrThrow<string>('jwt.accessSecret');
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const mk = async (tag: string) =>
      (
        await prisma.event.create({
          data: {
            promoterId: promoter.id,
            name: `GATE ${tag} ${stamp}`,
            slug: `gate-${tag}-${stamp}`,
            startsAt: new Date('2028-08-01T20:00:00-06:00'),
            endsAt: new Date('2028-08-01T23:00:00-06:00'),
            status: 'published',
          },
        })
      ).id;
    eventId = await mk('main');
    otherEventId = await mk('other');

    promoterToken = await login(SEED.promoter, 'gate-promo');
    adminToken = await login(SEED.admin, 'gate-admin');
    buyerToken = await login(SEED.buyer, 'gate-buyer');

    const emailOp = `gate_op_${stamp}@test.com`;
    const s = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailOp, password: 'Password123', firstName: 'Op' });
    opId = s.body.user.id;
    await prisma.user.update({
      where: { id: opId },
      data: { emailVerifiedAt: new Date(), roles: ['gate_operator'] },
    });
    opAccess = await login(emailOp, 'gate-op');
  });

  async function login(rawEmail: string, deviceId: string): Promise<string> {
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
    await prisma.gateAssignment.deleteMany({ where: { eventId: { in: [eventId, otherEventId] } } });
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `gate_op_${stamp}` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const assignEndpoint = () => `/api/v1/events/${eventId}/gate-operators`;

  // Firma un token de puerta arbitrario (para probar expiración / otro evento).
  // `expiresIn` se castea porque @types/jsonwebtoken v9 endureció el tipo (ya no acepta
  // `string` plano, sino `number | ms.StringValue`); en el test pasamos ambos.
  const gateJwt = (gateEventId: string, expiresIn: string | number) =>
    jwt.sign(
      { sub: opId, email: `gate_op_${stamp}@test.com`, roles: ['gate_operator'], gateEventId },
      secret,
      { expiresIn } as jwt.SignOptions,
    );

  // ---- Asignación (CRUD) ----

  it('promotor dueño asigna un operador → 201; buyer (no dueño) → 403', async () => {
    await http().post(assignEndpoint()).set(bearer(buyerToken)).send({ operatorId: opId }).expect(403);
    const res = await http().post(assignEndpoint()).set(bearer(promoterToken)).send({ operatorId: opId }).expect(201);
    expect(res.body.eventId).toBe(eventId);
    expect(res.body.operatorId).toBe(opId);
  });

  it('asignar de nuevo el mismo operador → 409', async () => {
    await http().post(assignEndpoint()).set(bearer(promoterToken)).send({ operatorId: opId }).expect(409);
  });

  it('asignar un usuario SIN rol gate_operator → 400', async () => {
    const buyer = await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } });
    await http().post(assignEndpoint()).set(bearer(promoterToken)).send({ operatorId: buyer.id }).expect(400);
  });

  it('listar asignados (admin) incluye al operador', async () => {
    const res = await http().get(assignEndpoint()).set(bearer(adminToken)).expect(200);
    expect(res.body.some((a: { operatorId: string }) => a.operatorId === opId)).toBe(true);
  });

  // ---- gate-token ----

  it('operador ASIGNADO emite gate-token → 201 (token + gateEventId + expiresIn)', async () => {
    const res = await http().post(`/api/v1/events/${eventId}/gate-token`).set(bearer(opAccess)).expect(201);
    expect(res.body.gateEventId).toBe(eventId);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresIn).toBeGreaterThan(0);
  });

  it('operador NO asignado (a otherEvent) no puede emitir gate-token de ese evento → 403', async () => {
    await http().post(`/api/v1/events/${otherEventId}/gate-token`).set(bearer(opAccess)).expect(403);
  });

  it('admin emite gate-token de cualquier evento sin asignación → 201', async () => {
    await http().post(`/api/v1/events/${otherEventId}/gate-token`).set(bearer(adminToken)).expect(201);
  });

  // ---- manifiesto: enforcement + expiración ----

  it('con gate-token del evento → 200 + expiresAt firmado en el futuro', async () => {
    const gt = (await http().post(`/api/v1/events/${eventId}/gate-token`).set(bearer(opAccess)).expect(201)).body.token;
    const res = await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(gt)).expect(200);
    expect(res.body.signature).toBeTruthy();
    expect(res.body.expiresAt).toBeTruthy();
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Endurecimiento QA (M4): el token en la QUERY ya NO autentica (se filtra por logs);
    // el validador manda el gate-token por header Authorization. Sin header → 401.
    await http().get(`/api/v1/events/${eventId}/manifest?access_token=${gt}`).expect(401);
  });

  it('con token de acceso NORMAL (sin gateEventId) → 403', async () => {
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(opAccess)).expect(403);
  });

  it('con gate-token de OTRO evento → 403', async () => {
    const wrong = gateJwt(otherEventId, '30m');
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(wrong)).expect(403);
  });

  it('con gate-token EXPIRADO → 401', async () => {
    const expired = gateJwt(eventId, '-10s');
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(expired)).expect(401);
  });

  it('admin (token normal) accede al manifiesto (exento) → 200', async () => {
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(adminToken)).expect(200);
  });

  it('revocar la asignación corta el acceso: gate-token vigente pero manifiesto → 403', async () => {
    // Emite un gate-token válido AHORA (asignación viva).
    const gt = (await http().post(`/api/v1/events/${eventId}/gate-token`).set(bearer(opAccess)).expect(201)).body.token;
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(gt)).expect(200);
    // Revoca la asignación; el token corto sigue vigente pero el manifiesto lo rechaza.
    await http().delete(`${assignEndpoint()}/${opId}`).set(bearer(promoterToken)).expect(200);
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(gt)).expect(403);
    // Y ya no puede re-emitir gate-token (no asignado).
    await http().post(`/api/v1/events/${eventId}/gate-token`).set(bearer(opAccess)).expect(403);
  });
});
