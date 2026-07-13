import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 5 · Ticket 2 — Transferencia (regalo) con handshake de código compartido.
 * Cubre: canje feliz (cambio de dueño + re-emisión que invalida el QR anterior),
 * límite por evento (default 1 + override), auto-transferencia, código inválido/
 * expirado, IDOR, una sola pendiente, cancelación, y boleto no vigente.
 */
describe('Boletos: transferencia (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let aToken: string; // remitente (seed buyer)
  let bToken: string;
  let bId: string;
  let cToken: string;
  let cId: string;
  let operatorToken: string;
  let eventId: string;
  let seatIds: string[];
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'XFER Event',
        slug: `xfer-${stamp}`,
        startsAt: new Date('2028-02-01T20:00:00-06:00'),
        endsAt: new Date('2028-02-01T23:00:00-06:00'),
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'X', slug: 'x', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 16 }, (_, i) => ({ localityId: loc.id, label: `X${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    aToken = await loginTrusted(SEED.buyer, 'xfer-A');
    bId = (await mkUser('xferb')).id;
    bToken = await loginTrusted(`xferb_${stamp}@test.com`, 'xfer-B');
    cId = (await mkUser('xferc')).id;
    cToken = await loginTrusted(`xferc_${stamp}@test.com`, 'xfer-C');
    const op = await mkUser('xferop', { roles: ['gate_operator'] });
    void op;
    operatorToken = await loginTrusted(`xferop_${stamp}@test.com`, 'xfer-Op');
  });

  async function mkUser(tag: string, extra: Record<string, unknown> = {}) {
    const email = `${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    return prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), ...extra },
    });
  }

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
    await prisma.ticketTransfer.deleteMany({ where: { ticket: { eventId } } });
    await prisma.ticketCustodyEvent.deleteMany({ where: { ticket: { eventId } } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    // Borrar también las cuentas: dejarlas con su saldo cacheado (sin asientos) rompe
    // el verifyChain GLOBAL de otras suites (balance ≠ suma de asientos).
    await prisma.ledgerAccount.deleteMany({});
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function buyTicket(seatIdx: number, token = aToken): Promise<string> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(token))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${created.body.id}/pay`).set(bearer(token)).expect(201);
    const evt = `evt_xfer_${seatIdx}_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    return (await prisma.ticket.findFirstOrThrow({ where: { orderId: created.body.id } })).id;
  }

  it('canje feliz: cambia de dueño, re-emite y el QR anterior deja de servir', async () => {
    const ticketId = await buyTicket(0);
    const oldQr = await http().get(`/api/v1/tickets/${ticketId}/qr`).set(bearer(aToken)).expect(200);

    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    expect(init.body.code).toMatch(/^[A-Z2-9]{8}$/);

    const claim = await http()
      .post('/api/v1/tickets/transfers/claim')
      .set(bearer(bToken))
      .send({ code: init.body.code })
      .expect(200);
    expect(claim.body.ticketId).toBe(ticketId);

    // El boleto ahora es de B; A ya no puede verlo.
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.ownerId).toBe(bId);
    expect(t.transferCount).toBe(1);
    await http().get(`/api/v1/tickets/${ticketId}/qr`).set(bearer(aToken)).expect(404);
    await http().get(`/api/v1/tickets/${ticketId}/qr`).set(bearer(bToken)).expect(200);

    // El QR anterior (de A) ya no valida: el secreto rotó al re-emitir.
    const gate = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: oldQr.body.payload, checkIn: false })
      .expect(200);
    expect(gate.body).toMatchObject({ valid: false, reason: 'expired_or_invalid_code' });

    // Cadena de custodia registró la transferencia.
    const custody = await http().get(`/api/v1/tickets/${ticketId}/custody`).set(bearer(bToken)).expect(200);
    expect(custody.body.events.map((e: { type: string }) => e.type)).toEqual(['issued', 'transferred']);
    expect(custody.body.integrity.ok).toBe(true);
  });

  it('respeta el límite por defecto (1): el nuevo dueño ya no puede re-transferir', async () => {
    // Reusa el boleto del test anterior (ya transferido 1 vez, ahora de B).
    const t = await prisma.ticket.findFirstOrThrow({ where: { eventId, ownerId: bId } });
    await http().post(`/api/v1/tickets/${t.id}/transfer`).set(bearer(bToken)).expect(400);
  });

  it('el promotor puede subir el máximo por evento (override)', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { maxTransfers: 2 } });
    const t = await prisma.ticket.findFirstOrThrow({ where: { eventId, ownerId: bId } });
    const init = await http().post(`/api/v1/tickets/${t.id}/transfer`).set(bearer(bToken)).expect(200);
    await http()
      .post('/api/v1/tickets/transfers/claim')
      .set(bearer(cToken))
      .send({ code: init.body.code })
      .expect(200);
    await prisma.event.update({ where: { id: eventId }, data: { maxTransfers: null } });
  });

  it('no puedes transferirte el boleto a ti mismo → 400', async () => {
    const ticketId = await buyTicket(1);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http()
      .post('/api/v1/tickets/transfers/claim')
      .set(bearer(aToken))
      .send({ code: init.body.code })
      .expect(400);
  });

  it('código inválido → 404; código expirado → 400', async () => {
    await http()
      .post('/api/v1/tickets/transfers/claim')
      .set(bearer(bToken))
      .send({ code: 'NOEXISTE9' })
      .expect(404);

    const ticketId = await buyTicket(2);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await prisma.ticketTransfer.update({
      where: { id: init.body.transferId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http()
      .post('/api/v1/tickets/transfers/claim')
      .set(bearer(bToken))
      .send({ code: init.body.code })
      .expect(400);
  });

  it('IDOR: iniciar transferencia de un boleto ajeno → 404', async () => {
    const ticketId = await buyTicket(3);
    await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(bToken)).expect(404);
  });

  it('solo una transferencia pendiente por boleto; cancelar libera y anula el código', async () => {
    const ticketId = await buyTicket(4);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(409); // ya pendiente

    await http().delete(`/api/v1/tickets/transfers/${init.body.transferId}`).set(bearer(aToken)).expect(200);
    await http()
      .post('/api/v1/tickets/transfers/claim')
      .set(bearer(bToken))
      .send({ code: init.body.code })
      .expect(404); // cancelada → ya no es pendiente

    // Cancelar una transferencia ajena → 404 (IDOR).
    const init2 = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().delete(`/api/v1/tickets/transfers/${init2.body.transferId}`).set(bearer(bToken)).expect(404);
  });

  it('un boleto revocado no se puede transferir → 400', async () => {
    const ticketId = await buyTicket(5);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'revoked' } });
    await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(400);
  });

  // ---- Cobertura adicional (auditoría QA) ----

  it('GET /tickets/transfers/outgoing lista solo mis pendientes y se vacía al canjear', async () => {
    const ticketId = await buyTicket(6);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    const mine = await http().get('/api/v1/tickets/transfers/outgoing').set(bearer(aToken)).expect(200);
    expect(mine.body.some((t: { id: string }) => t.id === init.body.transferId)).toBe(true);
    // El destinatario no ve las transferencias del remitente.
    const other = await http().get('/api/v1/tickets/transfers/outgoing').set(bearer(bToken)).expect(200);
    expect(other.body.some((t: { id: string }) => t.id === init.body.transferId)).toBe(false);
    // Al canjear, deja de estar pendiente.
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(200);
    const after = await http().get('/api/v1/tickets/transfers/outgoing').set(bearer(aToken)).expect(200);
    expect(after.body.some((t: { id: string }) => t.id === init.body.transferId)).toBe(false);
  });

  it('canjear un código ya canjeado → 404 (no reutilizable)', async () => {
    const ticketId = await buyTicket(7);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(cToken)).send({ code: init.body.code }).expect(404);
  });

  it('si el boleto alcanzó el límite entre iniciar y canjear → 400', async () => {
    const ticketId = await buyTicket(8);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await prisma.ticket.update({ where: { id: ticketId }, data: { transferCount: 1 } }); // ya en el límite (default 1)
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(400);
  });

  it('si el boleto cambió de dueño tras iniciar → 409 al canjear', async () => {
    const ticketId = await buyTicket(9);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await prisma.ticket.update({ where: { id: ticketId }, data: { ownerId: cId } }); // dueño distinto al remitente
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(409);
  });

  it('cancelar una transferencia ya canjeada → 400', async () => {
    const ticketId = await buyTicket(10);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(200);
    await http().delete(`/api/v1/tickets/transfers/${init.body.transferId}`).set(bearer(aToken)).expect(400);
  });

  it('el nuevo dueño recibe media regenerada tras el canje', async () => {
    const ticketId = await buyTicket(11);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(200);
    // La media se regeneró para B (inline): sus URLs firmadas responden.
    const media = await http().get(`/api/v1/tickets/${ticketId}/media`).set(bearer(bToken)).expect(200);
    expect(media.body.pdfUrl).toContain('/ticket.pdf');
  });

  it('canje CONCURRENTE del mismo código: exactamente uno gana', async () => {
    const ticketId = await buyTicket(12);
    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    const claim = (tok: string) =>
      http().post('/api/v1/tickets/transfers/claim').set(bearer(tok)).send({ code: init.body.code });
    const [r1, r2] = await Promise.all([claim(bToken), claim(cToken)]);
    expect([r1.status, r2.status].filter((s) => s === 200)).toHaveLength(1);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.transferCount).toBe(1); // un solo incremento
  });

  it('validación y auth: code faltante → 400; UUID inválido → 400; sin token → 401', async () => {
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({}).expect(400);
    await http().post('/api/v1/tickets/no-uuid/transfer').set(bearer(aToken)).expect(400);
    await http().delete('/api/v1/tickets/transfers/no-uuid').set(bearer(aToken)).expect(400);
    const ticketId = await buyTicket(13);
    await http().post(`/api/v1/tickets/${ticketId}/transfer`).expect(401);
    await http().post('/api/v1/tickets/transfers/claim').send({ code: 'X' }).expect(401);
    await http().get('/api/v1/tickets/transfers/outgoing').expect(401);
  });

  it('cadena de custodia con dos transferencias encadenadas + check-in (integridad)', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { maxTransfers: 2 } });
    const ticketId = await buyTicket(14);
    // A → B
    const t1 = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: t1.body.code }).expect(200);
    // B → C
    const t2 = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(bToken)).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(cToken)).send({ code: t2.body.code }).expect(200);
    // Check-in por el operador (C es el dueño).
    const qr = await http().get(`/api/v1/tickets/${ticketId}/qr`).set(bearer(cToken)).expect(200);
    await http().post('/api/v1/tickets/verify').set(bearer(operatorToken)).send({ payload: qr.body.payload }).expect(200);

    const custody = await http().get(`/api/v1/tickets/${ticketId}/custody`).set(bearer(cToken)).expect(200);
    expect(custody.body.events.map((e: { type: string }) => e.type)).toEqual([
      'issued',
      'transferred',
      'transferred',
      'checked_in',
    ]);
    expect(custody.body.integrity.ok).toBe(true);
    await prisma.event.update({ where: { id: eventId }, data: { maxTransfers: null } });
  });
});
