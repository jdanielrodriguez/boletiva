import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { RetentionService } from '../../modules/retention/retention.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 6 · Ticket 3 — Privacidad/retención. Cubre: anonimización bajo demanda
 * (seudonimiza PII, borra accesos, depura facturación) PRESERVANDO el ledger;
 * idempotencia, no-anonimizar-admin, 404, RBAC; y la lógica de elegibilidad del
 * job programado (incluye a un usuario concluido, excluye a uno con evento futuro).
 * Nota: no se ejecuta el `run` global (mutaría la BD compartida); se prueba la
 * selección (eligibleUserIds) + la acción (anonymizeUser) por separado.
 */
describe('Privacidad / retención (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let retention: RetentionService;
  let adminToken: string;
  let adminId: string;
  let stamp: number;
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    retention = app.get(RetentionService);
    stamp = Date.now();
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin } })).id;
    adminToken = await loginTrusted(SEED.admin, 'ret-admin');
  });

  async function mkUser(tag: string, login = false): Promise<string> {
    const email = `ret_${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    const id = res.body.user.id;
    await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    createdUserIds.push(id);
    if (login) await loginTrusted(email, `ret-${tag}`);
    return id;
  }

  async function mkEvent(endsAt: Date): Promise<string> {
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const ev = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'RET Ev',
        slug: `ret-ev-${stamp}-${createdEventIds.length}`,
        startsAt: new Date(endsAt.getTime() - 3600 * 1000),
        endsAt,
      },
    });
    createdEventIds.push(ev.id);
    return ev.id;
  }

  async function mkOrder(buyerId: string, eventId: string) {
    return prisma.order.create({
      data: {
        buyerId,
        eventId,
        net: '0.00',
        platformFee: '0.00',
        taxableBase: '0.00',
        iva: '0.00',
        gatewayFee: '0.00',
        total: '0.00',
        billingName: 'Juan Pérez',
        billingAddress: 'Zona 10, Guatemala',
      },
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
    await prisma.order.deleteMany({ where: { buyerId: { in: createdUserIds } } });
    await prisma.event.deleteMany({ where: { id: { in: createdEventIds } } });
    await prisma.device.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('anonimiza un usuario: seudonimiza PII, borra accesos y depura facturación', async () => {
    const uid = await mkUser('anon', true);
    const eventId = await mkEvent(new Date('2028-05-01T23:00:00-06:00'));
    await mkOrder(uid, eventId);

    const res = await http().post(`/api/v1/admin/users/${uid}/anonymize`).set(bearer(adminToken)).expect(200);
    expect(res.body).toMatchObject({ id: uid, anonymized: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    expect(user.email).toBe(`anon_${uid}@anonimizado.local`);
    expect(user.firstName).toBe('Usuario anonimizado');
    expect(user.phone).toBeNull();
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe('inactive');
    expect(user.anonymizedAt).not.toBeNull();
    expect(await prisma.device.count({ where: { userId: uid } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { buyerId: uid } });
    expect(order.billingName).toBeNull();
    expect(order.billingAddress).toBeNull();
  });

  it('preserva el ledger: el saldo del usuario anonimizado sigue intacto', async () => {
    const uid = await mkUser('ledger');
    await ledger.post({
      kind: 'seed_wallet',
      entries: [
        { type: 'user_wallet', ownerId: uid, amount: '50.00' },
        { type: 'platform_revenue', amount: '-50.00' },
      ],
    });
    await http().post(`/api/v1/admin/users/${uid}/anonymize`).set(bearer(adminToken)).expect(200);
    expect((await ledger.walletBalance(uid)).toFixed(2)).toBe('50.00'); // ledger intacto
  });

  it('es idempotente; no anonimiza admins (400); usuario inexistente (404)', async () => {
    const uid = await mkUser('idem');
    await http().post(`/api/v1/admin/users/${uid}/anonymize`).set(bearer(adminToken)).expect(200);
    const again = await http().post(`/api/v1/admin/users/${uid}/anonymize`).set(bearer(adminToken)).expect(200);
    expect(again.body.anonymized).toBe(true); // idempotente

    await http().post(`/api/v1/admin/users/${adminId}/anonymize`).set(bearer(adminToken)).expect(400);
    await http()
      .post('/api/v1/admin/users/00000000-0000-0000-0000-000000000000/anonymize')
      .set(bearer(adminToken))
      .expect(404);
  });

  it('RBAC: un no-admin no puede anonimizar ni correr la retención (403)', async () => {
    const buyerToken = await loginTrusted(SEED.buyer, 'ret-buyer');
    const uid = await mkUser('rbac');
    await http().post(`/api/v1/admin/users/${uid}/anonymize`).set(bearer(buyerToken)).expect(403);
    await http().post('/api/v1/admin/retention/run').set(bearer(buyerToken)).send({ days: 365 }).expect(403);
  });

  it('elegibilidad del job: incluye a usuarios concluidos, excluye a los de evento futuro', async () => {
    const concluded = await mkUser('concluded'); // sin login, sin órdenes → elegible
    const future = await mkUser('future', true);
    const futureEvent = await mkEvent(new Date('2029-01-01T23:00:00-06:00'));
    await mkOrder(future, futureEvent); // tiene un evento que aún no concluye

    const eligible = await retention.eligibleUserIds(365);
    expect(eligible).toContain(concluded);
    expect(eligible).not.toContain(future);
  });

  // ---- Cobertura adicional (auditoría QA) ----

  it('preserva los boletos del usuario anonimizado (no solo el ledger)', async () => {
    const uid = await mkUser('tickets');
    const eventId = await mkEvent(new Date('2028-06-01T23:00:00-06:00'));
    const loc = await prisma.locality.create({
      data: { eventId, name: 'R', slug: `r-${stamp}`, kind: 'seated', desiredNet: 100 },
    });
    const order = await mkOrder(uid, eventId);
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        localityId: loc.id,
        net: '0.00',
        total: '0.00',
        quote: {},
        quoteHash: 'h',
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        orderItemId: item.id,
        orderId: order.id,
        eventId,
        localityId: loc.id,
        ownerId: uid,
        serial: `PERET${stamp}`,
        signature: 'sig',
        signingKeyId: 'dev-ed25519-1',
        totpSecret: 'enc',
      },
    });

    await http().post(`/api/v1/admin/users/${uid}/anonymize`).set(bearer(adminToken)).expect(200);

    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.ownerId).toBe(uid); // el boleto sobrevive intacto
    expect(after.status).toBe('valid');
  });

  it('validación del run: days fuera de rango → 400 (no ejecuta nada)', async () => {
    await http().post('/api/v1/admin/retention/run').set(bearer(adminToken)).send({ days: 40000 }).expect(400);
    await http().post('/api/v1/admin/retention/run').set(bearer(adminToken)).send({ days: -5 }).expect(400);
  });

  it('401 sin token; id no-UUID → 400', async () => {
    await http().post('/api/v1/admin/users/00000000-0000-0000-0000-000000000000/anonymize').expect(401);
    await http().post('/api/v1/admin/retention/run').send({ days: 365 }).expect(401);
    await http().post('/api/v1/admin/users/no-uuid/anonymize').set(bearer(adminToken)).expect(400);
  });
});
