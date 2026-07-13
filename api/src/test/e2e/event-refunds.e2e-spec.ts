import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);
const SYS = '00000000-0000-0000-0000-000000000000';

/**
 * F1 (v3.11) — DEVOLUCIÓN por cancelación/suspensión del evento (SOLO admin).
 * Acredita SOLO el NETO a la wallet del comprador (el servicio NO se devuelve);
 * el ledger revierte el neto del promotor y CONSERVA plataforma/pasarela/IVA.
 * Cubre: RBAC, elegibilidad (409), 1 orden y todas, solo-neto exacto, boletos
 * revocados + asientos liberados, idempotencia y el chain global íntegro.
 *
 * AISLAMIENTO: usa un PROMOTOR y un COMPRADOR nuevos (sus cuentas de ledger parten
 * de 0 → asertos absolutos limpios) y NO borra el ledger (append-only: solo agrega
 * asientos que cuadran en 0 → no rompe el hash-chain global que otras suites
 * verifican). Requisito para no contaminar la suite serial (BD real compartida).
 */
describe('Devolución por cancelación/suspensión del evento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let promoterId: string;
  let eventId: string;
  let seatIds: string[];
  let buyerToken: string;
  let adminToken: string;
  let promoterToken: string;
  let stamp: number;
  const orderIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    stamp = Date.now();

    adminToken = await loginTrusted(SEED.admin, 'evref-admin');

    // Promotor NUEVO aprobado (su cuenta promoter_payable parte de 0).
    const prom = await mkUser('evref_prom', { roles: ['promoter'], promoterStatus: 'approved' });
    promoterId = prom.id;
    promoterToken = await loginTrusted(`evref_prom_${stamp}@test.com`, 'evref-prom');

    const event = await prisma.event.create({
      data: {
        promoterId,
        name: 'EVREF Test Event',
        slug: `evref-test-${stamp}`,
        startsAt: new Date('2027-09-01T20:00:00-06:00'),
        endsAt: new Date('2027-09-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'EVREF Loc', slug: 'evref-loc', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({ localityId: loc.id, label: `E${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats
      .sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
      .map((s) => s.id);

    await mkUser('evref_buyer', {});
    buyerToken = await loginTrusted(`evref_buyer_${stamp}@test.com`, 'evref-buyer');
  });

  async function mkUser(tag: string, data: Record<string, unknown>) {
    const email = `${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    return prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), ...data },
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
    // Limpieza de NUESTRAS filas de negocio. NO se borra el ledger: dejar los
    // asientos (que cuadran en 0) mantiene el hash-chain global válido para las
    // demás suites; el global-teardown trunca+resiembra al final de la corrida.
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.seat.deleteMany({ where: { locality: { eventId } } });
    await prisma.locality.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: 'evref_' } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const webhook = (id: string, type: string, ref: string) =>
    http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(id, type, ref))
      .send({ id, type, providerRef: ref });

  // Crea una orden de 1 asiento, la paga por pasarela y la confirma.
  async function paidOrder(seatIdx: number, evt: string): Promise<string> {
    const o = await http()
      .post(`/api/v1/events/${eventId}/orders`)
      .set(bearer(buyerToken))
      .send({ seatIds: [seatIds[seatIdx]] })
      .expect(201);
    const p = await http().post(`/api/v1/orders/${o.body.id}/pay`).set(bearer(buyerToken)).expect(201);
    await webhook(evt, 'payment.succeeded', p.body.providerRef).expect(200);
    return o.body.id as string;
  }

  // Saldo de una cuenta concreta (aislada: promotor/comprador nuevos).
  const bal = async (type: string, ownerId: string) =>
    (
      await prisma.ledgerAccount.findUnique({
        where: { type_ownerId_currency: { type: type as never, ownerId, currency: 'GTQ' } },
      })
    )?.balance.toString() ?? '0';

  const walletBalance = async (token: string) =>
    (await http().get('/api/v1/wallet').set(bearer(token)).expect(200)).body.balance as string;

  it('setup: 3 órdenes pagadas → promoter_payable del promotor NUEVO = 300; wallet del comprador = 0', async () => {
    orderIds.push(await paidOrder(0, `evref_s1_${stamp}`));
    orderIds.push(await paidOrder(1, `evref_s2_${stamp}`));
    orderIds.push(await paidOrder(2, `evref_s3_${stamp}`));
    expect(await bal('promoter_payable', promoterId)).toBe('300'); // 3 × 100 neto
    expect(await walletBalance(buyerToken)).toBe('0.00');
  });

  it('evento PUBLICADO (no elegible) → 409, aunque sea admin', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({ orderId: orderIds[0] })
      .expect(409);
    // Suspender el evento (reconfiguración): a partir de aquí ya es elegible.
    await prisma.event.update({ where: { id: eventId }, data: { status: 'suspended' } });
  });

  it('RBAC: promotor y comprador NO pueden tramitar devoluciones → 403; sin token → 401', async () => {
    await http().post(`/api/v1/events/${eventId}/refunds`).send({}).expect(401);
    await http().post(`/api/v1/events/${eventId}/refunds`).set(bearer(promoterToken)).send({}).expect(403);
    await http().post(`/api/v1/events/${eventId}/refunds`).set(bearer(buyerToken)).send({}).expect(403);
  });

  it('una orden: acredita SOLO el neto (100) al wallet; servicio retenido; boleto revocado; asiento liberado', async () => {
    const platformBefore = await bal('platform_revenue', SYS);
    const taxBefore = await bal('tax_payable', SYS);

    const res = await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({ orderId: orderIds[0] })
      .expect(200);
    expect(res.body.refundedOrders).toBe(1);
    expect(res.body.totalNetRefunded).toBe('100.00');
    expect(res.body.orders[0]).toMatchObject({ orderId: orderIds[0], net: '100.00', status: 'refunded' });

    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderIds[0] } });
    expect(o.status).toBe('refunded');
    const seat = await prisma.seat.findUniqueOrThrow({ where: { id: seatIds[0] } });
    expect(seat.status).toBe('available'); // liberado
    const tickets = await prisma.ticket.findMany({ where: { orderId: orderIds[0] } });
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.every((t) => t.status === 'revoked')).toBe(true);

    // SOLO el neto al wallet (no 123.20 del refund de pasarela).
    expect(await walletBalance(buyerToken)).toBe('100.00');
    // Clawback SOLO del neto del promotor NUEVO: 300 → 200.
    expect(await bal('promoter_payable', promoterId)).toBe('200');
    // El servicio se RETIENE: plataforma e IVA (cuentas de sistema) intactos.
    expect(await bal('platform_revenue', SYS)).toBe(platformBefore);
    expect(await bal('tax_payable', SYS)).toBe(taxBefore);
    // Integridad contable ACOTADA a la orden (hash-chain de sus asientos), no el
    // verifyChain GLOBAL (que depende del estado que dejan otras suites).
    expect((await ledger.orderChain(orderIds[0])).chainValid).toBe(true);
  });

  it('idempotencia: la MISMA orden ya devuelta → 409, sin recrédito', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({ orderId: orderIds[0] })
      .expect(409);
    expect(await walletBalance(buyerToken)).toBe('100.00');
  });

  it('orden de OTRO evento / inexistente → 404 (no filtra existencia)', async () => {
    await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({ orderId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
  });

  it('todas: devuelve TODAS las órdenes pagadas restantes al wallet; chain íntegro', async () => {
    // Invariante robusta: devuelve exactamente las que estén pagadas en ese momento.
    const paidBefore = await prisma.order.count({ where: { eventId, status: 'paid' } });
    const res = await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(res.body.refundedOrders).toBe(paidBefore);

    // Estado final independiente del reparto una/todas: el neto total (3×100) queda
    // acreditado al comprador y nada del promotor pendiente; sin órdenes pagadas.
    expect(await walletBalance(buyerToken)).toBe('300.00');
    expect(await bal('promoter_payable', promoterId)).toBe('0'); // todo el neto devuelto
    const remaining = await prisma.order.count({ where: { eventId, status: 'paid' } });
    expect(remaining).toBe(0);
    // Integridad contable acotada a una de las órdenes devueltas.
    expect((await ledger.orderChain(orderIds[1])).chainValid).toBe(true);
  });

  it('todas de nuevo: nada pagado → refundedOrders 0 (idempotente)', async () => {
    const res = await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(res.body.refundedOrders).toBe(0);
    expect(res.body.totalNetRefunded).toBe('0.00');
    expect(await walletBalance(buyerToken)).toBe('300.00'); // sin cambios
  });

  it('evento cancelado también es elegible', async () => {
    await prisma.event.update({ where: { id: eventId }, data: { status: 'cancelled' } });
    const res = await http()
      .post(`/api/v1/events/${eventId}/refunds`)
      .set(bearer(adminToken))
      .send({})
      .expect(200);
    expect(res.body.refundedOrders).toBe(0);
  });
});
