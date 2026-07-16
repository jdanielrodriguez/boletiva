import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 5 · Ticket 1 — Cadena de custodia (hash-chain por boleto). Cubre: génesis en
 * la emisión, append en check-in y revocación, endpoint /custody (dueño/admin +
 * IDOR), verificación de integridad y detección de manipulación.
 */
describe('Boletos: cadena de custodia (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let buyerBToken: string;
  let operatorToken: string;
  let adminToken: string;
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
        name: 'CUST Event',
        slug: `cust-${stamp}`,
        startsAt: new Date('2028-01-01T20:00:00-06:00'),
        endsAt: new Date('2028-01-01T23:00:00-06:00'),
        status: 'published', // ventas abiertas (fecha futura) para poder comprar
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'C', slug: 'c', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: loc.id, label: `C${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    buyerToken = await loginTrusted(SEED.buyer, 'cust-A');
    const emailB = `cust_b_${stamp}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({ where: { id: sB.body.user.id }, data: { emailVerifiedAt: new Date() } });
    buyerBToken = await loginTrusted(emailB, 'cust-B');

    const emailOp = `cust_op_${stamp}@test.com`;
    const sOp = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailOp, password: 'Password123', firstName: 'Op' });
    await prisma.user.update({
      where: { id: sOp.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['gate_operator'] },
    });
    // 8.1: el operador valida en puerta solo si está asignado al evento.
    await prisma.gateAssignment.create({ data: { eventId, operatorId: sOp.body.user.id } });
    operatorToken = await loginTrusted(emailOp, 'cust-Op');
    adminToken = await loginTrusted(SEED.admin, 'cust-Admin');
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
    await prisma.ticketCustodyEvent.deleteMany({ where: { ticket: { eventId } } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    // Borrar también las cuentas: dejarlas con saldo cacheado (sin asientos) rompe
    // el verifyChain GLOBAL de otras suites (balance ≠ suma de asientos).
    await prisma.ledgerAccount.deleteMany({});
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function buyAndPay(seatIdx: number): Promise<string> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${created.body.id}/pay`).set(bearer(buyerToken)).expect(201);
    const evt = `evt_cust_${seatIdx}_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    return created.body.id;
  }

  it('la emisión crea el génesis de la cadena (seq 1 = issued)', async () => {
    const orderId = await buyAndPay(0);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    const res = await http().get(`/api/v1/tickets/${ticket.id}/custody`).set(bearer(buyerToken)).expect(200);
    expect(res.body.integrity.ok).toBe(true);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({ seq: 1, type: 'issued', prevHash: '' });
    expect(res.body.events[0].hash.length).toBeGreaterThan(0);
  });

  it('el check-in y la revocación agregan eslabones encadenados', async () => {
    const orderId = await buyAndPay(1);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    const qr = await http().get(`/api/v1/tickets/${ticket.id}/qr`).set(bearer(buyerToken)).expect(200);
    await http().post('/api/v1/tickets/verify').set(bearer(operatorToken)).send({ payload: qr.body.payload }).expect(200);

    // Revocar vía reembolso.
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(`evt_cust_rev_${stamp}`, 'payment.refunded', payment.providerRef))
      .send({ id: `evt_cust_rev_${stamp}`, type: 'payment.refunded', providerRef: payment.providerRef })
      .expect(200);

    const res = await http().get(`/api/v1/tickets/${ticket.id}/custody`).set(bearer(buyerToken)).expect(200);
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(['issued', 'checked_in', 'revoked']);
    expect(res.body.integrity.ok).toBe(true);
    // Encadenamiento: cada prevHash = hash del anterior.
    const [a, b, c] = res.body.events;
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
  });

  it('IDOR: la cadena de un boleto ajeno → 404', async () => {
    const orderId = await buyAndPay(2);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    await http().get(`/api/v1/tickets/${ticket.id}/custody`).set(bearer(buyerBToken)).expect(404);
  });

  it('detecta manipulación: alterar un hash rompe la integridad', async () => {
    const orderId = await buyAndPay(3);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    const ev = await prisma.ticketCustodyEvent.findFirstOrThrow({ where: { ticketId: ticket.id, seq: 1 } });
    await prisma.ticketCustodyEvent.update({
      where: { id: ev.id },
      data: { toOwnerId: '00000000-0000-0000-0000-000000000000' }, // altera un campo firmado
    });
    const res = await http().get(`/api/v1/tickets/${ticket.id}/custody`).set(bearer(buyerToken)).expect(200);
    expect(res.body.integrity.ok).toBe(false);
    expect(res.body.integrity.brokenAt).toBe(1);
  });

  // ---- Cobertura adicional (auditoría QA) ----

  it('un admin puede ver la cadena de un boleto ajeno (escalada legítima)', async () => {
    const orderId = await buyAndPay(4);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    const res = await http().get(`/api/v1/tickets/${ticket.id}/custody`).set(bearer(adminToken)).expect(200);
    expect(res.body.events.length).toBeGreaterThanOrEqual(1);
    expect(res.body.integrity.ok).toBe(true);
  });

  it('sin token → 401; UUID inválido → 400; boleto inexistente → 404', async () => {
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { eventId } });
    await http().get(`/api/v1/tickets/${ticket.id}/custody`).expect(401);
    await http().get('/api/v1/tickets/no-uuid/custody').set(bearer(buyerToken)).expect(400);
    await http()
      .get('/api/v1/tickets/00000000-0000-0000-0000-000000000000/custody')
      .set(bearer(buyerToken))
      .expect(404);
  });
});
