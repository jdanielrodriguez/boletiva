import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.10 · GVI — Finalizar evento y transferir saldos de caja (SOLO ADMIN).
 * Traslada el neto acumulado (promoter_payable) del evento al wallet del promotor,
 * asentado en el ledger inmutable. Cubre: happy (admin), idempotencia/doble
 * transferencia (409), RBAC (promotor→403), evento no elegible (409) y 404.
 */
describe('Finalizar evento y transferir caja (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let adminToken: string;
  let promoterToken: string;
  let promoterId: string;
  let buyerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const bal = async (type: string, ownerId: string) =>
    Number(
      (
        await prisma.ledgerAccount.findUnique({
          where: { type_ownerId_currency: { type: type as never, ownerId, currency: 'GTQ' } },
        })
      )?.balance.toString() ?? '0',
    );

  /**
   * Crea un evento con una orden pagada (net) y acredita el promoter_payable como
   * lo haría el fulfillment de un pago real (para que el traslado cuadre y el
   * verifyChain siga válido). `status` define la elegibilidad.
   */
  async function seedEventWithNet(
    status: 'draft' | 'published' | 'suspended' | 'finished',
    net: number,
    endsAt = new Date('2027-06-01T00:00:00Z'),
  ): Promise<string> {
    const event = await prisma.event.create({
      data: {
        promoterId,
        name: `Cash ${status} ${Date.now()}`,
        slug: `cash-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        startsAt: new Date('2027-05-01T00:00:00Z'),
        endsAt,
        status,
      },
    });
    if (net > 0) {
      await prisma.order.create({
        data: {
          buyerId,
          eventId: event.id,
          status: 'paid',
          net: net.toFixed(2),
          platformFee: '0.00',
          taxableBase: net.toFixed(2),
          iva: '0.00',
          gatewayFee: '0.00',
          total: net.toFixed(2),
        },
      });
      // Fulfillment simulado: acredita el neto al promoter_payable del promotor.
      await ledger.post({
        kind: 'order_payment',
        refType: 'order',
        refId: event.id,
        entries: [
          { type: 'promoter_payable', ownerId: promoterId, amount: net.toFixed(2) },
          { type: 'gateway_clearing', amount: (-net).toFixed(2) },
        ],
      });
    }
    return event.id;
  }

  it('admin finaliza un evento suspendido: transfiere el neto a wallet y asienta en el ledger', async () => {
    const eventId = await seedEventWithNet('suspended', 100);
    const payableBefore = await bal('promoter_payable', promoterId);
    const walletBefore = await bal('user_wallet', promoterId);

    const res = await http()
      .post(`/api/v1/events/${eventId}/settlement/finalize`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body).toMatchObject({
      eventId,
      promoterId,
      transferred: '100.00',
      status: 'finished',
    });
    expect(res.body.transferredAt).toBeDefined();

    expect(await bal('promoter_payable', promoterId)).toBeCloseTo(payableBefore - 100, 2);
    expect(await bal('user_wallet', promoterId)).toBeCloseTo(walletBefore + 100, 2);

    const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(ev.status).toBe('finished');
    expect(ev.cashTransferredAt).not.toBeNull();
    expect((await ledger.verifyChain()).ok).toBe(true);

    // La liquidación aparece en el historial del promotor (kind=settlement + monto).
    const hist = await http()
      .get(`/api/v1/promoters/${promoterId}/history`)
      .set(bearer(adminToken))
      .expect(200);
    const settle = hist.body.find((h: { kind: string }) => h.kind === 'settlement');
    expect(settle).toBeDefined();
    expect(settle.amount).toBe('100.00');
  });

  it('idempotente: transferir dos veces el mismo evento → 409', async () => {
    const eventId = await seedEventWithNet('finished', 50);
    await http().post(`/api/v1/events/${eventId}/settlement/finalize`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/events/${eventId}/settlement/finalize`).set(bearer(adminToken)).expect(409);
  });

  it('RBAC: un promotor NO puede finalizar la caja (403), aunque sea su evento', async () => {
    const eventId = await seedEventWithNet('suspended', 30);
    await http().post(`/api/v1/events/${eventId}/settlement/finalize`).set(bearer(promoterToken)).expect(403);
    // No se tocó nada (sigue transferible por admin).
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(ev.cashTransferredAt).toBeNull();
  });

  it('evento no elegible (draft con fecha futura) → 409', async () => {
    const eventId = await seedEventWithNet('draft', 10, new Date('2099-01-01T00:00:00Z'));
    await http().post(`/api/v1/events/${eventId}/settlement/finalize`).set(bearer(adminToken)).expect(409);
  });

  it('evento publicado pero ya PASADO (endsAt en el pasado) → elegible', async () => {
    const eventId = await seedEventWithNet('published', 20, new Date('2020-01-01T00:00:00Z'));
    const res = await http()
      .post(`/api/v1/events/${eventId}/settlement/finalize`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body.transferred).toBe('20.00');
  });

  it('neto 0 (sin órdenes pagadas) igual cierra la caja (transferred 0.00), idempotente', async () => {
    const eventId = await seedEventWithNet('finished', 0);
    const res = await http()
      .post(`/api/v1/events/${eventId}/settlement/finalize`)
      .set(bearer(adminToken))
      .expect(200);
    expect(res.body.transferred).toBe('0.00');
    await http().post(`/api/v1/events/${eventId}/settlement/finalize`).set(bearer(adminToken)).expect(409);
  });

  it('404 con evento inexistente; 401 sin token', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http().post(`/api/v1/events/${ghost}/settlement/finalize`).set(bearer(adminToken)).expect(404);
    await http().post(`/api/v1/events/${ghost}/settlement/finalize`).expect(401);
  });
});
