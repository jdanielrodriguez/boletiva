import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import axios from 'axios';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EncryptionService } from '../../infra/crypto/encryption.service';
import { TicketsService } from '../../modules/tickets/tickets.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);
const MAILHOG = process.env.MAILHOG_URL ?? 'http://pasaeventos_mailhog:8025';

/**
 * Ola 4 · Tickets 1-3 — Emisión de boletos (Ed25519 + TOTP), media (QR/PDF) y
 * correo, todo disparado async tras el pago (inline en test). Cubre: emisión
 * idempotente, firma/secreto cifrado, media generada, listado/detalle + IDOR,
 * QR rotativo, validación en puerta (happy, doble check-in, código inválido,
 * firma corrupta, RBAC) y revocación por reembolso.
 */
describe('Boletos: emisión + media + validación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let encryption: EncryptionService;
  let ticketsSvc: TicketsService;
  let buyerToken: string;
  let buyerBToken: string;
  let operatorToken: string;
  let eventId: string;
  let seatIds: string[];
  let evStamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    encryption = app.get(EncryptionService);
    ticketsSvc = app.get(TicketsService);
    evStamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'TKT Test Event',
        slug: `tkt-test-${evStamp}`,
        startsAt: new Date('2027-06-01T20:00:00-06:00'),
        endsAt: new Date('2027-06-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'TKT Loc', slug: 'tkt-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ localityId: loc.id, label: `T${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    buyerToken = await loginTrusted(SEED.buyer, 'tkt-devA');

    const emailB = `tkt_b_${evStamp}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({ where: { id: sB.body.user.id }, data: { emailVerifiedAt: new Date() } });
    buyerBToken = await loginTrusted(emailB, 'tkt-devB');

    // Operador de puerta.
    const emailOp = `tkt_op_${evStamp}@test.com`;
    const sOp = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailOp, password: 'Password123', firstName: 'Op' });
    await prisma.user.update({
      where: { id: sOp.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['gate_operator'] },
    });
    operatorToken = await loginTrusted(emailOp, 'tkt-devOp');
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
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${evStamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Compra + paga + webhook succeeded (inline emite boletos + media + correo). */
  async function buyAndPay(seatIdx: number): Promise<{ orderId: string }> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const orderId = created.body.id;
    const p = await http().post(`/api/v1/orders/${orderId}/pay`).set(bearer(buyerToken)).expect(201);
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(`evt_tkt_${seatIdx}_${evStamp}`, 'payment.succeeded', p.body.providerRef))
      .send({ id: `evt_tkt_${seatIdx}_${evStamp}`, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    return { orderId };
  }

  it('emite un boleto por asiento tras el pago, firmado y con secreto cifrado', async () => {
    const { orderId } = await buyAndPay(0);
    const tickets = await prisma.ticket.findMany({ where: { orderId } });
    expect(tickets).toHaveLength(1);
    const t = tickets[0];
    expect(t.status).toBe('valid');
    expect(t.serial).toMatch(/^PE[0-9A-F]+$/);
    expect(t.signature.length).toBeGreaterThan(0);
    expect(t.signingKeyId).toBe('dev-ed25519-1');
    // El secreto TOTP está CIFRADO en reposo (no es base32 en claro) y se descifra.
    expect(t.totpSecret).not.toMatch(/^[A-Z2-7]+$/);
    const secret = encryption.decrypt(t.totpSecret);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('genera la media (QR PNG + PDF) de forma async y la deja lista', async () => {
    const t = await prisma.ticket.findFirstOrThrow({ where: { eventId }, orderBy: { issuedAt: 'asc' } });
    expect(t.mediaReadyAt).not.toBeNull();
    expect(t.qrKey).toMatch(/\/qr\.png$/);
    expect(t.pdfKey).toMatch(/\/ticket\.pdf$/);
  });

  it('la emisión es idempotente (no duplica boletos al re-ejecutar)', async () => {
    const t = await prisma.ticket.findFirstOrThrow({ where: { eventId } });
    const res = await ticketsSvc.issue(t.orderId);
    expect(res.issued).toBe(0);
    expect(await prisma.ticket.count({ where: { orderId: t.orderId } })).toBe(1);
  });

  it('envía el correo de confirmación con los seriales', async () => {
    const t = await prisma.ticket.findFirstOrThrow({ where: { eventId }, orderBy: { issuedAt: 'asc' } });
    const { data } = await axios.get(`${MAILHOG}/api/v2/messages`);
    const found = (data.items ?? []).some((m: { Content?: { Body?: string } }) =>
      String(m.Content?.Body ?? '').replace(/=\r?\n/g, '').includes(t.serial),
    );
    expect(found).toBe(true);
  });

  it('GET /tickets lista los míos; el detalle ajeno da 404 (IDOR)', async () => {
    const mine = await http().get('/api/v1/tickets').set(bearer(buyerToken)).expect(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(1);
    const id = mine.body[0].id;
    await http().get(`/api/v1/tickets/${id}`).set(bearer(buyerToken)).expect(200);
    await http().get(`/api/v1/tickets/${id}`).set(bearer(buyerBToken)).expect(404);
  });

  it('GET /tickets/:id/qr entrega un valor rotativo bien formado', async () => {
    const mine = await http().get('/api/v1/tickets').set(bearer(buyerToken)).expect(200);
    const id = mine.body[0].id;
    const qr = await http().get(`/api/v1/tickets/${id}/qr`).set(bearer(buyerToken)).expect(200);
    expect(qr.body.payload).toMatch(/^PE1\.PE[0-9A-F]+\.\d{6}$/);
    expect(qr.body.refreshInSeconds).toBe(30);
  });

  it('GET /tickets/:id/media entrega URLs firmadas de QR y PDF', async () => {
    const mine = await http().get('/api/v1/tickets').set(bearer(buyerToken)).expect(200);
    const id = mine.body[0].id;
    const media = await http().get(`/api/v1/tickets/${id}/media`).set(bearer(buyerToken)).expect(200);
    expect(media.body.pdfUrl).toContain('/ticket.pdf');
    expect(media.body.qrUrl).toContain('/qr.png');
  });

  it('valida en puerta (operador): primer escaneo OK + check-in; segundo → ya usado', async () => {
    const { orderId } = await buyAndPay(1);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    const qr = await http().get(`/api/v1/tickets/${ticket.id}/qr`).set(bearer(buyerToken)).expect(200);

    const ok = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: qr.body.payload })
      .expect(200);
    expect(ok.body).toMatchObject({ valid: true, checkedIn: true, serial: ticket.serial });

    // Segundo escaneo del mismo boleto → ya usado (anti doble check-in).
    const qr2 = await http().get(`/api/v1/tickets/${ticket.id}/qr`).set(bearer(buyerToken)).expect(200);
    const again = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: qr2.body.payload })
      .expect(200);
    expect(again.body).toMatchObject({ valid: false, reason: 'already_used' });
  });

  it('rechaza QR malformado y código inválido (anti-screenshot)', async () => {
    const { orderId } = await buyAndPay(2);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });

    const bad = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: 'no-es-un-qr' })
      .expect(200);
    expect(bad.body).toMatchObject({ valid: false, reason: 'malformed' });

    const wrongCode = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: `PE1.${ticket.serial}.000000`, checkIn: false })
      .expect(200);
    expect(wrongCode.body).toMatchObject({ valid: false, reason: 'expired_or_invalid_code' });
  });

  it('rechaza firma corrupta (anti-falsificación)', async () => {
    const { orderId } = await buyAndPay(3);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { signature: Buffer.from('firma-falsa').toString('base64') },
    });
    const qr = await http().get(`/api/v1/tickets/${ticket.id}/qr`).set(bearer(buyerToken)).expect(200);
    const res = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: qr.body.payload, checkIn: false })
      .expect(200);
    expect(res.body).toMatchObject({ valid: false, reason: 'bad_signature' });
  });

  it('RBAC: un comprador no puede validar en puerta (403); sin token 401', async () => {
    await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(buyerToken))
      .send({ payload: 'x' })
      .expect(403);
    await http().post('/api/v1/tickets/verify').send({ payload: 'x' }).expect(401);
  });

  it('reembolso revoca los boletos; la puerta los rechaza (revoked)', async () => {
    const { orderId } = await buyAndPay(4);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId } });
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    const qr = await http().get(`/api/v1/tickets/${ticket.id}/qr`).set(bearer(buyerToken)).expect(200);

    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(`evt_refund_${evStamp}`, 'payment.refunded', payment.providerRef))
      .send({ id: `evt_refund_${evStamp}`, type: 'payment.refunded', providerRef: payment.providerRef })
      .expect(200);

    const revoked = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(revoked.status).toBe('revoked');
    const res = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload: qr.body.payload, checkIn: false })
      .expect(200);
    expect(res.body).toMatchObject({ valid: false, reason: 'revoked' });
  });
});
