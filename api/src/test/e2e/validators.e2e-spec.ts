import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const signWebhook = (id: string, type: string, ref: string) => hmacSha256(WEBHOOK_SECRET, `${id}.${type}.${ref}`);

/**
 * Validadores de boletos. Fase 1: el promotor invita por email → User ligero
 * (gate_operator) + gate_assignment + invitación (código + magic-link). El canje del
 * link emite un token de PUERTA que sirve para el manifiesto (reusa SafeTix).
 * Deshabilitar corta el acceso. Fase 2: dashboard de check-ins (totales, avance %,
 * por localidad, por validador, conflictos) con check-ins REALES. Cubre happy path,
 * authz, IDOR y contratos.
 */
describe('Validadores de boletos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string;
  let adminToken: string;
  let buyerToken: string;
  let eventId: string; // de SEED.promoter
  let otherEventId: string; // de OTRO promotor (para authz/IDOR)
  // Fase 2 (dashboard): localidad + asientos + operador con password (para batch).
  let localityId: string;
  let seatIds: string[];
  let operatorId: string;
  let operatorToken: string;
  let stamp = 0;

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
    stamp = Date.now();
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

    // Fase 2: localidad + asientos para poder emitir boletos y validarlos.
    const loc = await prisma.locality.create({
      data: { eventId, name: 'General', slug: 'general', kind: 'seated', desiredNet: 100 },
    });
    localityId = loc.id;
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: loc.id, label: `G${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    // Operador con password (signup) → puede loguearse y ejecutar el batch; se le
    // asigna al evento (como haría la invitación). Su userId es el actor de los check-ins.
    const sOp = await http()
      .post('/api/v1/auth/signup')
      .send({ email: `val_op_${stamp}@test.com`, password: 'Password123', firstName: 'Op' });
    operatorId = sOp.body.user.id;
    await prisma.user.update({
      where: { id: operatorId },
      data: { emailVerifiedAt: new Date(), roles: ['gate_operator'] },
    });
    await prisma.gateAssignment.create({ data: { eventId, operatorId } });
    operatorToken = await loginTrusted(`val_op_${stamp}@test.com`, 'val-op');
    buyerToken = await loginTrusted(SEED.buyer, 'val-buyer'); // token confiable para comprar
  });

  // Login con dispositivo confiable (sin 2FA) — necesario para el buyer que compra
  // y el operador que valida.
  async function loginTrusted(rawEmail: string, deviceId: string): Promise<string> {
    const email = rawEmail.toLowerCase().trim();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: user.id, deviceHash: sha256(deviceId) } },
      update: { trustedAt: new Date() },
      create: { userId: user.id, deviceHash: sha256(deviceId), trustedAt: new Date() },
    });
    const res = await http()
      .post('/api/v1/auth/login')
      .set('X-Device-Id', deviceId)
      .send({ email, password: 'Password123' })
      .expect(200);
    return res.body.tokens.accessToken;
  }

  async function issue(seatIdx: number): Promise<string> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${created.body.id}/pay`).set(bearer(buyerToken)).expect(201);
    const evt = `evt_val_${seatIdx}_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signWebhook(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    return (await prisma.ticket.findFirstOrThrow({ where: { orderId: created.body.id } })).serial;
  }

  const batchCheckin = (items: unknown[], token = operatorToken, gateId?: string) =>
    http().post(`/api/v1/events/${eventId}/checkins/batch`).set(bearer(token)).send({ items, gateId });

  afterAll(async () => {
    await prisma.validatorInvitation.deleteMany({ where: { eventId: { in: [eventId, otherEventId] } } });
    await prisma.gateAssignment.deleteMany({ where: { eventId: { in: [eventId, otherEventId] } } });
    await prisma.checkinConflict.deleteMany({ where: { eventId } });
    await prisma.ticketCustodyEvent.deleteMany({ where: { ticket: { eventId } } });
    await prisma.ticketSyncEntry.deleteMany({ where: { eventId } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: { in: [eventId, otherEventId] } } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
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

  // ---- Fase 2: dashboard de check-ins ----

  it('dashboard refleja check-ins reales: totales, avance %, por localidad y por validador', async () => {
    const s0 = await issue(0);
    const s1 = await issue(1);
    await issue(2); // s2 queda SIN validar (pending)

    // Check-in de 2 boletos con el operador → custody checked_in (actor = operador).
    const b = await batchCheckin([{ serial: s0 }, { serial: s1 }], operatorToken, 'gate-A').expect(200);
    expect(b.body.checkedIn).toBe(2);
    // Doble check-in de s0 → conflicto persistido.
    await batchCheckin([{ serial: s0, gateId: 'gate-B' }], operatorToken).expect(200);

    const res = await http()
      .get(`/api/v1/events/${eventId}/validators/checkin-stats`)
      .set(bearer(promoterToken))
      .expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.checkedIn).toBe(2);
    expect(res.body.pending).toBe(1);
    expect(res.body.conflicts).toBeGreaterThanOrEqual(1);
    expect(res.body.percent).toBeCloseTo(66.7, 0);

    // Por localidad: la General con 3 vigentes y 2 validados.
    const loc = res.body.byLocality.find((l: { localityId: string }) => l.localityId === localityId);
    expect(loc).toMatchObject({ total: 3, checkedIn: 2 });

    // Por validador: el operador con 2 check-ins atribuidos (+ su email).
    const mine = res.body.byValidator.find((v: { operatorId: string }) => v.operatorId === operatorId);
    expect(mine).toBeTruthy();
    expect(mine.count).toBe(2);
    expect(mine.email).toBe(`val_op_${stamp}@test.com`);

    // Timeline: los últimos escaneos incluyen los seriales validados.
    const serials = res.body.recent.map((r: { serial: string }) => r.serial);
    expect(serials).toEqual(expect.arrayContaining([s0, s1]));
  });

  it('authz: un comprador NO puede ver el dashboard de check-ins → 403', async () => {
    await http()
      .get(`/api/v1/events/${eventId}/validators/checkin-stats`)
      .set(bearer(buyerToken))
      .expect(403);
  });

  it('SSE checkin-stream: rechaza sin abrir el stream (buyer por rol; promotor ajeno por ownership)', async () => {
    // Auth por ?access_token (EventSource no manda headers). El guard/ownership rechaza
    // ANTES de abrir el text/event-stream → responde y no cuelga.
    await http().get(`/api/v1/events/${eventId}/validators/checkin-stream?access_token=${buyerToken}`).expect(403);
    await http()
      .get(`/api/v1/events/${otherEventId}/validators/checkin-stream?access_token=${promoterToken}`)
      .expect(403);
  });

  it('evento sin boletos → dashboard en cero', async () => {
    const res = await http()
      .get(`/api/v1/events/${otherEventId}/validators/checkin-stats`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({ total: 0, checkedIn: 0, pending: 0, conflicts: 0, percent: 0 });
    expect(res.body.byValidator).toEqual([]);
    expect(res.body.byLocality).toEqual([]);
  });
});
