import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';
import { PLATFORM_FEE_PCT, toFeeString } from '../../config/pricing-defaults';

const money = (v: unknown) => new Decimal(v as string).toFixed(2);
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 6.5 · Pagos en cuotas (Recurrente/Visacuotas).
 * El comprador paga SIEMPRE el precio de 1 pago (recargo directo prohibido en GT);
 * el costo de financiamiento (gn% + fijo) lo absorbe la PLATAFORMA (default) o el
 * PROMOTOR (flag del evento). Cubre: recotización a cuotas, desglose de
 * transparencia, exactitud de dinero (Banker's), IVA/gateway visibles para la
 * plataforma, ledger balanceado, override del promotor, y validación/errores.
 */
describe('Pagos en cuotas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let token: string;
  let buyerBToken: string;
  let promoterId: string;
  let platEventId: string; // evento con plataforma absorbe (default)
  let promEventId: string; // evento con promotor absorbe
  let recurrenteId: string;
  let noCuotasGwId: string;
  let platSeats: string[];
  let promSeats: string[];
  let stamp: number;

  async function wipeLedger() {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.ledgerAccount.deleteMany({});
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    stamp = Date.now();
    await wipeLedger();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    // Ola 6.6: las cuotas se habilitan si el promotor colabora ≥ umbral (0.3). Se
    // fija su cost-share por encima para que el suite sea determinista sin depender
    // del default global (que puede ser 0). Se restaura en afterAll.
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: '0.50000' } });
    // Esta suite prueba la ABSORCIÓN del financiamiento (cuotas), que necesita un margen
    // de plataforma amplio; se fija el schedule activo a 10% durante la suite para que su
    // lógica sea estable e INDEPENDIENTE de la perilla global (pricing-defaults). Se restaura.
    await prisma.feeSchedule.updateMany({ where: { active: true }, data: { platformFeePct: '0.10000' } });
    token = await loginTrusted(SEED.buyer, 'inst-buyer');

    const emailB = `inst_b_${stamp}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({ where: { id: sB.body.user.id }, data: { emailVerifiedAt: new Date() } });
    buyerBToken = await loginTrusted(emailB, 'inst-buyerB');

    // Pasarela con cuotas (Recurrente): 3→8% · 6→9% · 12→10% · 18→14% + Q2 FIJO POR
    // TRANSACCIÓN (Ola 6.6: aplica a 1 pago y cuotas; sube el precio base a 131.79).
    const recu = await prisma.paymentGateway.create({
      data: {
        name: `INST_recu_${stamp}`,
        provider: 'simulator',
        feePct: '0.05000',
        transactionFixedFee: '2.00',
        installmentRates: { '3': 0.08, '6': 0.09, '12': 0.1, '18': 0.14 },
        status: 'active',
      },
    });
    recurrenteId = recu.id;
    // Pasarela SIN cuotas (para probar el rechazo).
    const noc = await prisma.paymentGateway.create({
      data: { name: `INST_noc_${stamp}`, provider: 'simulator', feePct: '0.05000', status: 'active' },
    });
    noCuotasGwId = noc.id;

    platEventId = await makeEvent('plat', false);
    platSeats = await makeSeats(platEventId);
    promEventId = await makeEvent('prom', true);
    promSeats = await makeSeats(promEventId);
  });

  async function makeEvent(tag: string, absorbInstallmentCost: boolean): Promise<string> {
    const ev = await prisma.event.create({
      data: {
        promoterId,
        name: `INST ${tag} ${stamp}`,
        slug: `inst-${tag}-${stamp}`,
        startsAt: new Date('2028-06-01T20:00:00-06:00'),
        endsAt: new Date('2028-06-01T23:00:00-06:00'),
        status: 'published',
        gatewayId: recurrenteId,
        absorbInstallmentCost,
      },
    });
    return ev.id;
  }

  async function makeSeats(eventId: string): Promise<string[]> {
    const loc = await prisma.locality.create({
      data: { eventId, name: 'I', slug: `i-${eventId.slice(0, 6)}`, kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ localityId: loc.id, label: `S${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    return seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);
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
    await prisma.user.update({ where: { id: promoterId }, data: { costSharePct: null } });
    await prisma.feeSchedule.updateMany({ where: { active: true }, data: { platformFeePct: toFeeString(PLATFORM_FEE_PCT) } });
    const ids = [platEventId, promEventId];
    await prisma.payment.deleteMany({ where: { order: { eventId: { in: ids } } } });
    await prisma.webhookEvent.deleteMany({});
    await wipeLedger();
    await prisma.order.deleteMany({ where: { eventId: { in: ids } } });
    await prisma.event.deleteMany({ where: { id: { in: ids } } });
    await prisma.paymentGateway.deleteMany({ where: { name: { startsWith: 'INST_' } } });
    await prisma.user.deleteMany({ where: { email: { contains: `inst_b_${stamp}` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string = token) => ({ Authorization: `Bearer ${t}` });
  const order = async (eventId: string, seatId: string) =>
    (await http().post(`/api/v1/events/${eventId}/orders`).set(bearer()).send({ seatIds: [seatId] }).expect(201))
      .body;
  const pay = (orderId: string, body: object) =>
    http().post(`/api/v1/orders/${orderId}/pay`).set(bearer()).send(body);
  const itemQuote = async (orderId: string) =>
    (await prisma.orderItem.findFirstOrThrow({ where: { orderId } })).quote as Record<string, unknown>;

  it('base: sin cuotas el precio es el de 1 pago (Recurrente 131.79 con Q2) — el catálogo no cambia', async () => {
    const o = await order(platEventId, platSeats[0]);
    expect(money(o.total)).toBe('131.79'); // incluye el Q2 fijo por transacción
    expect(money(o.gatewayFee)).toBe('8.59'); // 131.79*0.05 + 2
    expect(money(o.platformFee)).toBe('10.00');
    expect(money(o.iva)).toBe('13.20');
  });

  it('plataforma absorbe (3 cuotas): comprador paga IGUAL; sube gatewayFee, baja platformFee', async () => {
    const o = await order(platEventId, platSeats[1]);
    const res = await pay(o.id, { installments: 3 }).expect(201);
    expect(res.body.installments).toBe(3);
    expect(money(res.body.amount)).toBe('131.79'); // el comprador paga lo mismo

    const up = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(money(up.total)).toBe('131.79'); // total intacto
    expect(money(up.net)).toBe('100.00'); //  promotor intacto
    expect(money(up.iva)).toBe('13.20'); //   IVA intacto (no subdeclara)
    expect(money(up.gatewayFee)).toBe('12.54'); // 131.79*0.08 + 2
    expect(money(up.platformFee)).toBe('6.05'); //  10 − (12.54 − 8.59); el fijo se cancela
    // Suma exacta: net + platform + iva + gateway = total.
    const sum = new Decimal(up.net.toString())
      .add(up.platformFee.toString())
      .add(up.iva.toString())
      .add(up.gatewayFee.toString());
    expect(sum.toFixed(2)).toBe('131.79');

    // Desglose de transparencia en el snapshot del ítem.
    const q = await itemQuote(o.id);
    expect(q.installments).toBe(3);
    expect(q.installmentFeePct).toBe(0.08);
    expect(money(q.installmentFixedFee)).toBe('2.00');
    expect(money(q.installmentSurcharge)).toBe('3.95'); // solo el %-extra
    expect(q.installmentAbsorbedBy).toBe('platform');
    expect(money(q.basePrice)).toBe('131.79');
    // Vista comprador: cuota de servicio fusionada (plataforma+pasarela) estable e igual a 1 pago.
    expect(money(q.serviceFee)).toBe('18.59');
  });

  it('promotor absorbe (flag del evento, 3 cuotas): baja el NETO del promotor, platform intacto', async () => {
    const o = await order(promEventId, promSeats[0]);
    await pay(o.id, { installments: 3 }).expect(201);
    const up = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(money(up.total)).toBe('131.79'); // comprador paga igual
    expect(money(up.net)).toBe('96.05'); //   100 − 3.95 (promotor absorbe el %-extra)
    expect(money(up.platformFee)).toBe('10.00'); // plataforma intacta
    expect(money(up.iva)).toBe('13.20');
    expect(money(up.gatewayFee)).toBe('12.54');
    const q = await itemQuote(o.id);
    expect(q.installmentAbsorbedBy).toBe('promoter');
    expect(money(q.installmentSurcharge)).toBe('3.95');
  });

  it('H2: 18 cuotas dejaría a la plataforma en margen NEGATIVO y la absorbe ella → 400 (no vende a pérdida)', async () => {
    // Antes se pagaba y la plataforma comía la pérdida (-1.86). Ahora `/pay` reaplica el
    // mismo filtro que oculta el plazo en payment-options: plazo negativo no absorbido
    // por el promotor → 400. La orden sigue pendiente (no se cobró).
    const o = await order(platEventId, platSeats[2]);
    await pay(o.id, { installments: 18 }).expect(400);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('pending');
  });

  it('18 cuotas SÍ se permiten si las absorbe el PROMOTOR (su neto baja, plataforma intacta)', async () => {
    const o = await order(promEventId, promSeats[3]);
    await pay(o.id, { installments: 18 }).expect(201);
    const up = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(money(up.platformFee)).toBe('10.00'); // plataforma intacta
    expect(money(up.total)).toBe('131.79');
  });

  it('ledger balanceado tras confirmar el pago en cuotas (webhook succeeded)', async () => {
    const o = await order(platEventId, platSeats[3]);
    const p = await pay(o.id, { installments: 12 }).expect(201);
    // 12 cuotas (10%): gateway = 131.79*0.10 + 2 = 15.18 ; platform = 10 − 6.59 = 3.41.
    const up = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(money(up.gatewayFee)).toBe('15.18');
    expect(money(up.platformFee)).toBe('3.41');

    const evt = `evt_inst_${stamp}`;
    await http()
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', sign(evt, 'payment.succeeded', p.body.providerRef))
      .send({ id: evt, type: 'payment.succeeded', providerRef: p.body.providerRef })
      .expect(200);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(paid.status).toBe('paid');
    // El ledger cuadra (cada tx suma 0) e íntegro: prueba la partida doble.
    const chain = await ledger.verifyChain();
    expect(chain.ok).toBe(true);
    // La plataforma ve su impuesto (IVA) y su costo real de pasarela por separado.
    expect(money(paid.iva)).toBe('13.20');
    expect(money(paid.gatewayFee)).toBe('15.18');
  });

  it('elegir cuotas en una pasarela SIN tarifario de cuotas → 400', async () => {
    const o = await order(platEventId, platSeats[4]);
    await pay(o.id, { gatewayId: noCuotasGwId, installments: 3 }).expect(400);
    // La orden sigue pendiente (no se cobró).
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('pending');
  });

  it('plazo no soportado por la pasarela (p.ej. 9 cuotas) → 400', async () => {
    const o = await order(platEventId, platSeats[5]);
    await pay(o.id, { installments: 9 }).expect(400);
  });

  it('validación: installments 0 → 400; > 48 → 400', async () => {
    const o = await order(promEventId, promSeats[1]);
    await pay(o.id, { installments: 0 }).expect(400);
    await pay(o.id, { installments: 49 }).expect(400);
  });

  // ---- payment-options: filtro dinámico de plazos por margen (regla del arquitecto) ----

  const optionsFor = async (orderId: string) =>
    (await http().get(`/api/v1/orders/${orderId}/payment-options`).set(bearer()).expect(200)).body;

  it('plataforma absorbe: oculta 18 cuotas (margen negativo), ofrece 1/3/6/12', async () => {
    const o = await order(platEventId, platSeats[6]);
    const opts = await optionsFor(o.id);
    expect(opts.absorbedByPromoter).toBe(false);
    const recu = opts.gateways.find((g: { gatewayId: string }) => g.gatewayId === recurrenteId);
    expect(recu).toBeDefined();
    const counts = recu.installmentOptions.map((x: { installments: number }) => x.installments).sort((a: number, b: number) => a - b);
    expect(counts).toEqual([1, 3, 6, 12]); // 18 oculto (10 − 11.86 < 0)
    // El comprador paga lo mismo en todos los plazos ofrecidos.
    for (const opt of recu.installmentOptions) {
      expect(money(opt.total)).toBe('131.79');
      expect(money(opt.serviceFee)).toBe('18.59');
    }
  });

  it('promotor absorbe: libera TODO el abanico (incluye 18 cuotas)', async () => {
    const o = await order(promEventId, promSeats[2]);
    const opts = await optionsFor(o.id);
    expect(opts.absorbedByPromoter).toBe(true);
    const recu = opts.gateways.find((g: { gatewayId: string }) => g.gatewayId === recurrenteId);
    const counts = recu.installmentOptions.map((x: { installments: number }) => x.installments).sort((a: number, b: number) => a - b);
    expect(counts).toEqual([1, 3, 6, 12, 18]); // el promotor asume el margen negativo
  });

  it('una pasarela sin tarifario de cuotas solo ofrece 1 pago', async () => {
    const o = await order(platEventId, platSeats[7]);
    const opts = await optionsFor(o.id);
    const noc = opts.gateways.find((g: { gatewayId: string }) => g.gatewayId === noCuotasGwId);
    expect(noc.installmentOptions).toHaveLength(1);
    expect(noc.installmentOptions[0].installments).toBe(1);
  });

  it('payment-options IDOR: orden ajena → 404; sin token → 401', async () => {
    const o = await order(platEventId, platSeats[8]);
    await http().get(`/api/v1/orders/${o.id}/payment-options`).set(bearer(buyerBToken)).expect(404);
    await http().get(`/api/v1/orders/${o.id}/payment-options`).expect(401);
  });
});
