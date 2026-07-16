import { createPublicKey, verify as edVerify } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);
// Mismo TOTP que usa el boleto (step 30, 6 dígitos): simula al validador offline.
const totp = authenticator.clone({ step: 30, digits: 6, window: 1 });

/**
 * Ola 5 · Tickets 3-4 — Manifiesto de validación offline (SafeTix) + propagación
 * de revocaciones. Cubre: manifiesto completo firmado con secretos TOTP, validación
 * offline con el secreto sincronizado, delta incremental (?since), propagación de
 * transferencia/revocación/check-in, autenticidad de la firma Ed25519 y RBAC.
 */
describe('Boletos: manifiesto offline + propagación (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let aToken: string;
  let bToken: string;
  let operatorToken: string;
  let buyerToken2: string; // buyer sin rol de puerta (para RBAC)
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
        name: 'MAN Event',
        slug: `man-${stamp}`,
        startsAt: new Date('2028-03-01T20:00:00-06:00'),
        endsAt: new Date('2028-03-01T23:00:00-06:00'),
        status: 'published', // ventas abiertas (fecha futura) para poder comprar
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'M', slug: 'm', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: loc.id, label: `M${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    aToken = await loginTrusted(SEED.buyer, 'man-A');
    bToken = await loginTrusted(`man_b_${stamp}@test.com`, 'man-B', true);
    buyerToken2 = await loginTrusted(`man_c_${stamp}@test.com`, 'man-C', true);
    // Operador de puerta: se asigna al evento y se emite un TOKEN DE PUERTA corto
    // (SafeTix). El manifiesto ahora exige ese token acotado al evento + asignación.
    const opAccess = await loginTrusted(`man_op_${stamp}@test.com`, 'man-Op', true, ['gate_operator']);
    const opUser = await prisma.user.findUniqueOrThrow({
      where: { email: `man_op_${stamp}@test.com` },
    });
    await prisma.gateAssignment.create({ data: { eventId, operatorId: opUser.id } });
    const gt = await request(app.getHttpServer())
      .post(`/api/v1/events/${eventId}/gate-token`)
      .set({ Authorization: `Bearer ${opAccess}` })
      .expect(201);
    operatorToken = gt.body.token; // token de puerta (roles gate_operator + claim gateEventId)
  });

  async function loginTrusted(rawEmail: string, deviceId: string, create = false, roles?: string[]) {
    const email = rawEmail.toLowerCase().trim();
    if (create) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: 'Password123', firstName: 'U' });
      await prisma.user.update({
        where: { id: res.body.user.id },
        data: { emailVerifiedAt: new Date(), ...(roles ? { roles: roles as never } : {}) },
      });
    }
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
    await prisma.ticketSyncEntry.deleteMany({ where: { eventId } });
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

  async function buyTicket(seatIdx: number): Promise<string> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(aToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${created.body.id}/pay`).set(bearer(aToken)).expect(201);
    const evt = `evt_man_${seatIdx}_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    return (await prisma.ticket.findFirstOrThrow({ where: { orderId: created.body.id } })).id;
  }

  const manifest = (since?: number, token = operatorToken) =>
    http()
      .get(`/api/v1/events/${eventId}/manifest${since != null ? `?since=${since}` : ''}`)
      .set(bearer(token));

  it('manifiesto completo: trae secretos TOTP + firma Ed25519 verificable offline', async () => {
    const ticketId = await buyTicket(0);
    const res = await manifest(0).expect(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    const entry = res.body.tickets.find((t: { ticketId: string }) => t.ticketId === ticketId);
    expect(entry).toBeDefined();
    expect(entry.status).toBe('valid');
    expect(entry.totpSecret).toMatch(/^[A-Z2-7]+$/); // base32 en claro (SafeTix)
    expect(entry.reason).toBe('issued');

    // Autenticidad: la firma valida contra la llave pública del manifiesto (offline).
    const pub = createPublicKey(res.body.publicKeyPem);
    const ok = edVerify(null, Buffer.from(res.body.contentHash), pub, Buffer.from(res.body.signature, 'base64'));
    expect(ok).toBe(true);
    // Un contenido alterado NO valida con esa firma.
    const bad = edVerify(null, Buffer.from(sha256('tampered')), pub, Buffer.from(res.body.signature, 'base64'));
    expect(bad).toBe(false);
  });

  it('validación offline: el secreto del manifiesto recomputa un QR que la puerta acepta', async () => {
    const res = await manifest(0).expect(200);
    const entry = res.body.tickets[0];
    const code = totp.generate(entry.totpSecret); // el dispositivo lo hace sin red
    const payload = `PE1.${entry.serial}.${code}`;
    const gate = await http()
      .post('/api/v1/tickets/verify')
      .set(bearer(operatorToken))
      .send({ payload, checkIn: false })
      .expect(200);
    expect(gate.body.valid).toBe(true);
  });

  it('delta ?since: una transferencia propaga el NUEVO secreto del boleto', async () => {
    const ticketId = await buyTicket(1);
    const before = await manifest(0).expect(200);
    const oldSecret = before.body.tickets.find((t: { ticketId: string }) => t.ticketId === ticketId).totpSecret;
    const sinceSeq = before.body.maxSeq;

    const init = await http().post(`/api/v1/tickets/${ticketId}/transfer`).set(bearer(aToken)).expect(200);
    await http().post('/api/v1/tickets/transfers/claim').set(bearer(bToken)).send({ code: init.body.code }).expect(200);

    const delta = await manifest(sinceSeq).expect(200);
    const changed = delta.body.tickets.find((t: { ticketId: string }) => t.ticketId === ticketId);
    expect(changed).toBeDefined();
    expect(changed.reason).toBe('transferred');
    expect(changed.status).toBe('valid');
    expect(changed.totpSecret).not.toBe(oldSecret); // secreto rotado → el device lo refresca
  });

  it('propagación de revocación: el delta marca el boleto como revoked', async () => {
    const orderRes = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(aToken))
      .send({ seatIds: [seatIds[2]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${orderRes.body.id}/pay`).set(bearer(aToken)).expect(201);
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(`evt_man_2_${stamp}`, 'payment.succeeded', p.body.providerRef))
      .send({ id: `evt_man_2_${stamp}`, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    const ticketId = (await prisma.ticket.findFirstOrThrow({ where: { orderId: orderRes.body.id } })).id;

    const sinceSeq = (await manifest(0).expect(200)).body.maxSeq;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(`evt_man_rev_${stamp}`, 'payment.refunded', p.body.providerRef))
      .send({ id: `evt_man_rev_${stamp}`, type: 'payment.refunded', providerRef: p.body.providerRef })
      .expect(200);

    const delta = await manifest(sinceSeq).expect(200);
    const revoked = delta.body.tickets.find((t: { ticketId: string }) => t.ticketId === ticketId);
    expect(revoked).toMatchObject({ status: 'revoked', reason: 'revoked' });
  });

  it('propagación de check-in: el delta refleja el estado used', async () => {
    const ticketId = await buyTicket(3);
    const qr = await http().get(`/api/v1/tickets/${ticketId}/qr`).set(bearer(aToken)).expect(200);
    const sinceSeq = (await manifest(0).expect(200)).body.maxSeq;
    await http().post('/api/v1/tickets/verify').set(bearer(operatorToken)).send({ payload: qr.body.payload }).expect(200);

    const delta = await manifest(sinceSeq).expect(200);
    const used = delta.body.tickets.find((t: { ticketId: string }) => t.ticketId === ticketId);
    expect(used).toMatchObject({ status: 'used', reason: 'checked_in' });
  });

  it('RBAC: un comprador no accede al manifiesto (403); sin token → 401', async () => {
    await manifest(0, buyerToken2).expect(403);
    await http().get(`/api/v1/events/${eventId}/manifest`).expect(401);
  });

  // ---- Cobertura adicional (auditoría QA) ----

  it('?since > maxSeq → delta vacío (count 0, maxSeq === since)', async () => {
    const full = await manifest(0).expect(200);
    const beyond = full.body.maxSeq + 1000;
    const empty = await manifest(beyond).expect(200);
    expect(empty.body.count).toBe(0);
    expect(empty.body.tickets).toHaveLength(0);
    expect(empty.body.maxSeq).toBe(beyond); // el cursor no retrocede
  });

  it('?since negativo o no-numérico se normaliza a 0 (manifiesto completo)', async () => {
    const neg = await manifest(-5).expect(200);
    expect(neg.body.count).toBeGreaterThanOrEqual(1);
    const nan = await http()
      .get(`/api/v1/events/${eventId}/manifest?since=abc`)
      .set(bearer(operatorToken))
      .expect(200);
    expect(nan.body.count).toBeGreaterThanOrEqual(1); // parseInt('abc')→NaN→0
  });

  it('eventId con UUID inválido → 400', async () => {
    await http().get('/api/v1/events/no-uuid/manifest').set(bearer(operatorToken)).expect(400);
  });
});
