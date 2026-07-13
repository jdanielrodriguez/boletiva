import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 6 · Ticket 2 — Ingest masivo de validación (RabbitMQ, modo inline en test).
 * Cubre: reconciliación de un lote de check-ins offline, idempotencia + detección
 * de DOBLE check-in (conflicto persistido), serial inexistente, boleto revocado,
 * conteos del resumen, endpoint de conflictos y RBAC.
 */
describe('Ingest de validación offline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
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
        name: 'INGEST Event',
        slug: `ingest-${stamp}`,
        startsAt: new Date('2028-04-01T20:00:00-06:00'),
        endsAt: new Date('2028-04-01T23:00:00-06:00'),
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'I', slug: 'i', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ localityId: loc.id, label: `I${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    buyerToken = await loginTrusted(SEED.buyer, 'ing-A');
    const emailOp = `ing_op_${stamp}@test.com`;
    const sOp = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailOp, password: 'Password123', firstName: 'Op' });
    await prisma.user.update({
      where: { id: sOp.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['gate_operator'] },
    });
    operatorToken = await loginTrusted(emailOp, 'ing-Op');
    adminToken = await loginTrusted(SEED.admin, 'ing-Admin');
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
    await prisma.checkinConflict.deleteMany({ where: { eventId } });
    await prisma.ticketCustodyEvent.deleteMany({ where: { ticket: { eventId } } });
    await prisma.ticketSyncEntry.deleteMany({ where: { eventId } });
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

  async function issue(seatIdx: number): Promise<string> {
    const created = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${created.body.id}/pay`).set(bearer(buyerToken)).expect(201);
    const evt = `evt_ing_${seatIdx}_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);
    return (await prisma.ticket.findFirstOrThrow({ where: { orderId: created.body.id } })).serial;
  }

  const batch = (items: unknown[], token = operatorToken, gateId?: string) =>
    http().post('/api/v1/checkins/batch').set(bearer(token)).send({ items, gateId });

  it('ingesta un lote de check-ins válidos → todos checked_in (modo inline)', async () => {
    const s0 = await issue(0);
    const s1 = await issue(1);
    const res = await batch([{ serial: s0 }, { serial: s1 }], operatorToken, 'gate-1').expect(200);
    expect(res.body.mode).toBe('inline');
    expect(res.body).toMatchObject({ total: 2, checkedIn: 2, alreadyUsed: 0, notFound: 0, invalid: 0 });

    const t0 = await prisma.ticket.findUniqueOrThrow({ where: { serial: s0 } });
    expect(t0.status).toBe('used');
    // La custodia registró el check-in por ingest.
    const chain = await prisma.ticketCustodyEvent.findMany({ where: { ticketId: t0.id } });
    expect(chain.some((e) => e.type === 'checked_in')).toBe(true);
  });

  it('doble check-in: re-ingerir un serial ya usado → already_used + conflicto persistido', async () => {
    const s0 = (await prisma.ticket.findFirstOrThrow({ where: { eventId, status: 'used' } })).serial;
    const res = await batch([{ serial: s0, gateId: 'gate-2' }]).expect(200);
    expect(res.body).toMatchObject({ total: 1, checkedIn: 0, alreadyUsed: 1 });

    const conflicts = await http()
      .get(`/api/v1/events/${eventId}/checkins/conflicts`)
      .set(bearer(operatorToken))
      .expect(200);
    expect(conflicts.body.some((c: { serial: string; reason: string }) => c.serial === s0 && c.reason === 'already_used')).toBe(true);
  });

  it('serial inexistente → notFound; boleto revocado → invalid + conflicto', async () => {
    const notFound = await batch([{ serial: 'PENOEXISTE' }]).expect(200);
    expect(notFound.body).toMatchObject({ total: 1, notFound: 1 });

    const s2 = await issue(2);
    await prisma.ticket.update({ where: { serial: s2 }, data: { status: 'revoked' } });
    const invalid = await batch([{ serial: s2, gateId: 'gate-3' }]).expect(200);
    expect(invalid.body).toMatchObject({ total: 1, invalid: 1 });
    const conflicts = await prisma.checkinConflict.findMany({ where: { serial: s2 } });
    expect(conflicts[0].reason).toContain('invalid_state');
  });

  it('resumen de un lote mixto', async () => {
    const s3 = await issue(3);
    const usedSerial = (await prisma.ticket.findFirstOrThrow({ where: { eventId, status: 'used' } })).serial;
    const res = await batch([{ serial: s3 }, { serial: usedSerial }, { serial: 'PENADA' }]).expect(200);
    expect(res.body).toMatchObject({ total: 3, checkedIn: 1, alreadyUsed: 1, notFound: 1 });
  });

  it('RBAC: un comprador no ingesta ni ve conflictos (403); sin token → 401', async () => {
    await batch([{ serial: 'x' }], buyerToken).expect(403);
    await http().get(`/api/v1/events/${eventId}/checkins/conflicts`).set(bearer(buyerToken)).expect(403);
    await http().post('/api/v1/checkins/batch').send({ items: [] }).expect(401);
  });

  // ---- Cobertura adicional (auditoría QA) ----

  it('lote vacío (con auth) → resumen en cero; el admin también puede ingerir', async () => {
    const res = await batch([]).expect(200);
    expect(res.body).toMatchObject({ mode: 'inline', total: 0, checkedIn: 0 });
    // Un admin (no solo gate_operator) puede ingerir.
    const s6 = await issue(6);
    const asAdmin = await http()
      .post('/api/v1/checkins/batch')
      .set(bearer(adminToken))
      .send({ items: [{ serial: s6 }] })
      .expect(200);
    expect(asAdmin.body.checkedIn).toBe(1);
  });

  it('boleto transferido → invalid_state:transferred + conflicto', async () => {
    const s7 = await issue(7);
    await prisma.ticket.update({ where: { serial: s7 }, data: { status: 'transferred' } });
    const res = await batch([{ serial: s7, gateId: 'gate-t' }]).expect(200);
    expect(res.body).toMatchObject({ total: 1, invalid: 1 });
    const conflict = await prisma.checkinConflict.findFirstOrThrow({ where: { serial: s7 } });
    expect(conflict.reason).toBe('invalid_state:transferred');
    expect(conflict.gateId).toBe('gate-t'); // guarda la puerta correcta
  });

  it('gateId por-item sobrescribe el default del lote (y se persiste en el conflicto)', async () => {
    const used = (await prisma.ticket.findFirstOrThrow({ where: { eventId, status: 'used' } })).serial;
    // default del lote 'lote-def', pero el ítem trae 'item-especifico'.
    await batch([{ serial: used, gateId: 'item-especifico' }], operatorToken, 'lote-def').expect(200);
    const conflict = await prisma.checkinConflict.findFirstOrThrow({
      where: { serial: used, gateId: 'item-especifico' },
    });
    expect(conflict.gateId).toBe('item-especifico');
  });

  it('checkedInAt inválido no persiste Invalid Date (usa "ahora")', async () => {
    const s = await issue(8); // asiento fresco
    const res = await batch([{ serial: s, checkedInAt: 'no-es-fecha' }]).expect(200);
    expect(res.body.checkedIn).toBe(1);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { serial: s } });
    expect(t.usedAt).not.toBeNull();
    const usedAt = t.usedAt as Date;
    expect(Number.isNaN(usedAt.getTime())).toBe(false); // fecha válida, no "Invalid Date"
  });

  it('checkedInAt VÁLIDO se persiste como usedAt del check-in', async () => {
    const s = await issue(9); // asiento fresco
    const when = '2028-04-01T21:30:00.000Z';
    const res = await batch([{ serial: s, checkedInAt: when }]).expect(200);
    expect(res.body.checkedIn).toBe(1);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { serial: s } });
    expect((t.usedAt as Date).toISOString()).toBe(when); // usa la fecha offline provista
  });

  it('validación: item sin serial → 400; lote >5000 → 400; conflicts sin token → 401', async () => {
    await batch([{ checkedInAt: '2028-01-01' } as unknown]).expect(400); // falta serial
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({ serial: `S${i}` }));
    await batch(tooMany).expect(400); // ArrayMaxSize 5000
    await http().get(`/api/v1/events/${eventId}/checkins/conflicts`).expect(401);
  });
});
