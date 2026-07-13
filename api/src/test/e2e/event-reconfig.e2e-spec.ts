import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.10 · GIV — Reconfiguración de evento: cambio de salón, pasarela en suspendido
 * y borrado seguro de localidades con ventas.
 *  - Cambiar salón de un evento PUBLICADO → 409 con mensaje que informa boletos
 *    vendidos (no un error espurio de "fecha de inicio").
 *  - Suspendido → SÍ permite cambiar salón (los boletos vendidos se conservan, no
 *    quedan huérfanos).
 *  - Pasarela: bloqueada en un evento congelado a la venta, editable si suspendido.
 *  - Localidad con boletos vendidos → no se puede eliminar (409), evita huérfanos.
 */
describe('Reconfiguración de evento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let promoterToken: string;
  let promoterId: string;
  let buyerId: string;
  let sandboxId: string;
  let pagaloId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    promoterToken = await login(app, SEED.promoter);
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    sandboxId = (await prisma.paymentGateway.findUniqueOrThrow({ where: { name: 'Sandbox' } })).id;
    pagaloId = (await prisma.paymentGateway.findUniqueOrThrow({ where: { name: 'Pagalo' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function makeEvent(overrides: Record<string, unknown> = {}): Promise<string> {
    const e = await prisma.event.create({
      data: {
        promoterId,
        name: `Reconfig ${Date.now()}`,
        slug: `reconfig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        startsAt: new Date('2027-07-01T00:00:00Z'),
        endsAt: new Date('2027-07-01T12:00:00Z'),
        status: 'draft',
        ...overrides,
      },
    });
    return e.id;
  }

  /** Crea una localidad con un boleto vendido (orden pagada + ítem activo). */
  async function sellSeatIn(eventId: string): Promise<string> {
    const loc = await prisma.locality.create({
      data: { eventId, name: 'Loc', slug: `loc-${Date.now()}`, kind: 'seated', desiredNet: 100 },
    });
    const order = await prisma.order.create({
      data: {
        buyerId,
        eventId,
        status: 'paid',
        net: '100.00',
        platformFee: '0.00',
        taxableBase: '100.00',
        iva: '0.00',
        gatewayFee: '0.00',
        total: '100.00',
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        localityId: loc.id,
        net: '100.00',
        total: '100.00',
        quote: {},
        quoteHash: 'x',
        active: true,
      },
    });
    return loc.id;
  }

  async function makeHall(): Promise<string> {
    const h = await prisma.hall.create({
      data: { name: `Salón ${Date.now()}`, address: 'Zona 1', status: 'published' },
    });
    return h.id;
  }

  it('cambiar salón de un evento PUBLICADO con ventas → 409 que informa boletos vendidos', async () => {
    const eventId = await makeEvent({ status: 'published' });
    await sellSeatIn(eventId);
    const hallId = await makeHall();
    const res = await http()
      .patch(`/api/v1/events/${eventId}`)
      .set(bearer(promoterToken))
      .send({ hallId })
      .expect(409);
    expect(res.body.message).toContain('salón');
    expect(res.body.message).toContain('boleto'); // informa ventas, no "fecha de inicio"
    expect(res.body.message).not.toContain('fecha de inicio');
  });

  it('cambiar salón SIN enviar startsAt en un evento DRAFT → 200 (no exige fecha)', async () => {
    const eventId = await makeEvent();
    const hallId = await makeHall();
    const res = await http()
      .patch(`/api/v1/events/${eventId}`)
      .set(bearer(promoterToken))
      .send({ hallId })
      .expect(200);
    expect(res.body.hallId).toBe(hallId);
  });

  it('cambiar salón en un evento SUSPENDIDO con ventas → 200 y los boletos NO quedan huérfanos', async () => {
    const eventId = await makeEvent({ status: 'suspended' });
    const locId = await sellSeatIn(eventId);
    const hallId = await makeHall();
    await http().patch(`/api/v1/events/${eventId}`).set(bearer(promoterToken)).send({ hallId }).expect(200);
    // El boleto vendido conserva su localidad (no se orfanó al cambiar el salón).
    const items = await prisma.orderItem.count({ where: { localityId: locId, active: true } });
    expect(items).toBe(1);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(ev.hallId).toBe(hallId);
  });

  it('pasarela CONGELADA a la venta (published) → 409; SUSPENDIDO → 200 y re-congela', async () => {
    // Evento publicado con pasarela ya congelada por una compra.
    const publishedFrozen = await makeEvent({
      status: 'published',
      gatewayId: sandboxId,
      frozenGatewayId: sandboxId,
    });
    await http()
      .patch(`/api/v1/events/${publishedFrozen}`)
      .set(bearer(promoterToken))
      .send({ gatewayId: pagaloId })
      .expect(409);

    // Mismo caso pero SUSPENDIDO → editable, y re-congela a la nueva pasarela.
    const suspendedFrozen = await makeEvent({
      status: 'suspended',
      gatewayId: sandboxId,
      frozenGatewayId: sandboxId,
    });
    await http()
      .patch(`/api/v1/events/${suspendedFrozen}`)
      .set(bearer(promoterToken))
      .send({ gatewayId: pagaloId })
      .expect(200);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: suspendedFrozen } });
    expect(ev.gatewayId).toBe(pagaloId);
    expect(ev.frozenGatewayId).toBe(pagaloId); // re-congelada
  });

  it('no se elimina una localidad con boletos vendidos (evita huérfanos) → 409', async () => {
    const eventId = await makeEvent({ status: 'suspended' });
    const locId = await sellSeatIn(eventId);
    const res = await http()
      .delete(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .expect(409);
    expect(res.body.message).toContain('boleto');
  });
});
