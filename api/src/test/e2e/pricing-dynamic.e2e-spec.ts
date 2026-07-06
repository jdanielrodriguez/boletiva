import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PricingService } from '../../modules/pricing/pricing.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

const money = (v: unknown) => new Decimal(v as string).toFixed(2);

/**
 * Ola 3.5 · Tickets B+C — Pasarela por evento + PricingEngine v2 (IVA por evento).
 * Verifica: IVA sobre neto configurable, comisión de pasarela dinámica por evento,
 * congelado del precio en la primera compra, y migración al anular una pasarela.
 */
describe('Precios dinámicos: pasarela por evento + IVA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pricing: PricingService;
  let promoterId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    pricing = app.get(PricingService);
    // Sandbox activa y default.
    await prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true },
      data: { isPlatformDefault: false },
    });
    await prisma.paymentGateway.updateMany({
      where: { name: 'Sandbox' },
      data: { isPlatformDefault: true, status: 'active' },
    });
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { event: { slug: { startsWith: 'dyn-' } } } });
    await prisma.event.deleteMany({ where: { slug: { startsWith: 'dyn-' } } });
    await prisma.paymentGateway.deleteMany({ where: { name: { startsWith: 'DYN_' } } });
    await prisma.paymentGateway.updateMany({
      where: { isPlatformDefault: true },
      data: { isPlatformDefault: false },
    });
    await prisma.paymentGateway.updateMany({
      where: { name: 'Sandbox' },
      data: { isPlatformDefault: true, status: 'active' },
    });
    await app.close();
  });

  async function makeEvent(slug: string, opts: { gatewayId?: string; ivaOnNet?: boolean } = {}) {
    return prisma.event.create({
      data: {
        promoterId,
        name: `DYN ${slug}`,
        slug: `dyn-${slug}-${Date.now()}`,
        startsAt: new Date('2027-09-01T20:00:00-06:00'),
        endsAt: new Date('2027-09-01T23:00:00-06:00'),
        status: 'published',
        gatewayId: opts.gatewayId ?? null,
        ivaOnNet: opts.ivaOnNet ?? true,
      },
    });
  }

  it('IVA sobre el neto (default true): 100 → 129.68', async () => {
    const ev = await makeEvent('iva-on');
    const q = await pricing.quoteForEvent(100, ev);
    expect(money(q.total)).toBe('129.68');
    expect(money(q.iva)).toBe('13.20'); // (100+10) * 0.12
  });

  it('IVA solo sobre plataforma (ivaOnNet=false): el promotor ya pagó IVA', async () => {
    const ev = await makeEvent('iva-off', { ivaOnNet: false });
    const q = await pricing.quoteForEvent(100, ev);
    // base IVA = solo comisión plataforma (10) → iva 1.20; pre = 111.20; /0.95 = 117.05
    expect(money(q.iva)).toBe('1.20');
    expect(money(q.total)).toBe('117.05');
    expect(money(q.net)).toBe('100.00'); // el neto se conserva
  });

  it('comisión de pasarela dinámica: otra pasarela cambia el total', async () => {
    const gw = await prisma.paymentGateway.create({
      data: {
        name: `DYN_gw10_${Date.now()}`,
        provider: 'sim',
        feePct: '0.10000',
        status: 'active',
      },
    });
    const ev = await makeEvent('gw10', { gatewayId: gw.id });
    const q = await pricing.quoteForEvent(100, ev);
    // pre = 123.20; /(1-0.10) = 136.89
    expect(money(q.total)).toBe('136.89');
  });

  it('congelado: tras la primera compra el precio no cambia aunque cambie la default', async () => {
    const ev = await makeEvent('freeze');
    const loc = await prisma.locality.create({
      data: { eventId: ev.id, name: 'L', slug: 'l', kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({ data: [{ localityId: loc.id, label: 'S1' }] });
    const seat = await prisma.seat.findFirstOrThrow({ where: { localityId: loc.id } });

    // Comprador verificado.
    const token = await loginTrusted(SEED.buyer, 'dyn-buyer');
    const res = await request(app.getHttpServer())
      .post(`/api/v1/events/${ev.id}/orders`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ seatIds: [seat.id] })
      .expect(201);
    expect(money(res.body.total)).toBe('129.68');

    // El evento quedó congelado a la Sandbox (0.05).
    const frozen = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    expect(frozen.frozenGatewayId).not.toBeNull();

    // Cambiamos la default de plataforma a una de 0.20; el evento congelado NO cambia.
    const gw20 = await prisma.paymentGateway.create({
      data: {
        name: `DYN_gw20_${Date.now()}`,
        provider: 'sim',
        feePct: '0.20000',
        status: 'active',
      },
    });
    const q = await pricing.quoteForEvent(100, frozen);
    expect(money(q.total)).toBe('129.68'); // congelado (sigue 0.05)
    void gw20;
  });

  it('migración: anular una pasarela reasigna sus eventos a la default', async () => {
    const gw = await prisma.paymentGateway.create({
      data: {
        name: `DYN_gwdel_${Date.now()}`,
        provider: 'sim',
        feePct: '0.07000',
        status: 'active',
      },
    });
    const ev = await makeEvent('migrate', { gatewayId: gw.id });
    const adminToken = await loginTrusted(SEED.admin, 'dyn-admin');

    await request(app.getHttpServer())
      .delete(`/api/v1/payment-gateways/${gw.id}`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .expect(200);

    const migrated = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
    const sandbox = await prisma.paymentGateway.findUniqueOrThrow({ where: { name: 'Sandbox' } });
    expect(migrated.gatewayId).toBe(sandbox.id); // migrado a la default
    expect(await prisma.paymentGateway.findUnique({ where: { id: gw.id } })).toBeNull();
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
});
