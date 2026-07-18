import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Validadores de boletos (Fase 1): el promotor invita por email → se crea un User
 * ligero (gate_operator) + gate_assignment + invitación (código + magic-link). El
 * canje del link emite un token de PUERTA que sirve para el manifiesto (reusa
 * SafeTix). Deshabilitar corta el acceso. Cubre happy path, authz, IDOR y contratos.
 */
describe('Validadores de boletos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string;
  let adminToken: string;
  let buyerToken: string;
  let eventId: string; // de SEED.promoter
  let otherEventId: string; // de OTRO promotor (para authz/IDOR)

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const emailFor = () => `val_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    promoterToken = await login(app, SEED.promoter);
    adminToken = await login(app, SEED.admin);
    buyerToken = await login(app, SEED.buyer);
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const stamp = Date.now();
    const ev = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `VAL ${stamp}`,
        slug: `val-${stamp}`,
        startsAt: new Date('2028-05-01T20:00:00-06:00'),
        endsAt: new Date('2028-05-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = ev.id;
    const other = await prisma.user.create({
      data: { email: `otherprom_${stamp}@test.com`, firstName: 'Otro', roles: ['promoter'] },
    });
    const ev2 = await prisma.event.create({
      data: {
        promoterId: other.id,
        name: `VAL other ${stamp}`,
        slug: `val-other-${stamp}`,
        startsAt: new Date('2028-06-01T20:00:00-06:00'),
        endsAt: new Date('2028-06-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    otherEventId = ev2.id;
  });

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    await app.close();
  });

  it('invitar valida el correo (email inválido → 400)', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/validators`)
      .set(bearer(promoterToken))
      .send({ email: 'no-es-correo' })
      .expect(400);
  });

  it('flujo completo: invitar → listar → canjear → manifiesto → deshabilitar → canje 403 → re-habilitar', async () => {
    const email = emailFor();
    // Invitar
    const inv = await http()
      .post(`/api/v1/events/${eventId}/validators`)
      .set(bearer(promoterToken))
      .send({ email })
      .expect(201);
    expect(inv.body.status).toBe('active');
    expect(inv.body.url).toContain('/validar/');
    expect(inv.body.code).toMatch(/^\d{6}$/);
    const token = inv.body.url.split('/validar/')[1] as string;

    // Se creó el User ligero con rol gate_operator + su asignación.
    const op = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(op.roles).toContain('gate_operator');
    const assigned = await prisma.gateAssignment.findFirst({
      where: { eventId, operatorId: op.id },
    });
    expect(assigned).not.toBeNull();

    // Listar
    const list = await http()
      .get(`/api/v1/events/${eventId}/validators`)
      .set(bearer(promoterToken))
      .expect(200);
    expect(list.body.some((v: { email: string }) => v.email === email)).toBe(true);

    // Peek público
    const peek = await http().get(`/api/v1/validators/${token}`).expect(200);
    expect(peek.body.email).toBe(email);
    expect(peek.body.valid).toBe(true);

    // Canjear el magic-link → token de puerta
    const claim = await http().post('/api/v1/validators/claim').send({ token }).expect(200);
    expect(claim.body.gateEventId).toBe(eventId);
    expect(typeof claim.body.gateToken).toBe('string');
    const gateToken = claim.body.gateToken as string;

    // El token de puerta abre el MANIFIESTO (reusa SafeTix end-to-end).
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(gateToken)).expect(200);

    // Deshabilitar → corta el acceso: canje 403 y manifiesto cortado.
    const disabled = await http()
      .delete(`/api/v1/events/${eventId}/validators/${inv.body.id}`)
      .set(bearer(promoterToken))
      .expect(200);
    expect(disabled.body.disabled).toBe(true);
    await http().post('/api/v1/validators/claim').send({ token }).expect(403);
    // La asignación se revocó → un nuevo gate-token ni siquiera se puede canjear;
    // y el gate-token viejo pierde acceso al manifiesto (asignación viva requerida).
    await http().get(`/api/v1/events/${eventId}/manifest`).set(bearer(gateToken)).expect(403);

    // Re-habilitar → nuevo enlace, canje vuelve a funcionar.
    const reenabled = await http()
      .post(`/api/v1/events/${eventId}/validators/${inv.body.id}/enable`)
      .set(bearer(promoterToken))
      .expect(200);
    expect(reenabled.body.status).toBe('active');
    const newToken = reenabled.body.url.split('/validar/')[1] as string;
    await http().post('/api/v1/validators/claim').send({ token: newToken }).expect(200);
    // El token viejo ya no sirve (fue rotado).
    await http().post('/api/v1/validators/claim').send({ token }).expect(404);
  });

  it('deshabilitar TODOS de una vez', async () => {
    await http().post(`/api/v1/events/${eventId}/validators`).set(bearer(promoterToken)).send({ email: emailFor() }).expect(201);
    await http().post(`/api/v1/events/${eventId}/validators`).set(bearer(promoterToken)).send({ email: emailFor() }).expect(201);
    const res = await http()
      .delete(`/api/v1/events/${eventId}/validators`)
      .set(bearer(promoterToken))
      .expect(200);
    expect(res.body.disabled).toBeGreaterThanOrEqual(2);
    const list = await http().get(`/api/v1/events/${eventId}/validators`).set(bearer(promoterToken)).expect(200);
    expect(list.body.every((v: { status: string }) => v.status === 'disabled')).toBe(true);
  });

  it('admin puede gestionar validadores de cualquier evento', async () => {
    await http()
      .post(`/api/v1/events/${otherEventId}/validators`)
      .set(bearer(adminToken))
      .send({ email: emailFor() })
      .expect(201);
  });

  it('authz: un comprador no puede invitar validadores → 403', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/validators`)
      .set(bearer(buyerToken))
      .send({ email: emailFor() })
      .expect(403);
  });

  it('authz: un promotor NO puede gestionar validadores de un evento ajeno → 403', async () => {
    await http()
      .post(`/api/v1/events/${otherEventId}/validators`)
      .set(bearer(promoterToken))
      .send({ email: emailFor() })
      .expect(403);
  });

  it('claim con token inválido → 404', async () => {
    await http().post('/api/v1/validators/claim').send({ token: 'token-que-no-existe-1234567890' }).expect(404);
  });

  it('IDOR: deshabilitar un validador con id de OTRO evento → 404', async () => {
    // Un validador del otro evento (creado por admin arriba) no se puede tocar desde eventId.
    const otherList = await http()
      .get(`/api/v1/events/${otherEventId}/validators`)
      .set(bearer(adminToken))
      .expect(200);
    const otherValidatorId = otherList.body[0]?.id as string;
    await http()
      .delete(`/api/v1/events/${eventId}/validators/${otherValidatorId}`)
      .set(bearer(promoterToken))
      .expect(404);
  });
});
