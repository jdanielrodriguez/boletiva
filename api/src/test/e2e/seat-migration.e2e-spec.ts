import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../../modules/ledger/ledger.service';
import { createTestApp, login, SEED } from './utils';

/**
 * P2 · Migración/re-mapeo SEGURO de boletos vendidos al reconfigurar el mapa de
 * asientos de una localidad (aplicar otra plantilla) en un evento draft/suspended.
 *
 * Contrato: PUT /localities/:id/seats  { seats: [...] }  reemplaza el layout.
 * Invariantes: 0 huérfanos (jamás borra un asiento ocupado), 0 doble-venta (una
 * sola línea activa por asiento), LEDGER intacto (no se toca dinero). Las
 * localidades SIN vendidos se comportan como delete-all + insert (histórico).
 */
describe('Migración de asientos vendidos al reconfigurar mapa (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: LedgerService;
  let promoterToken: string;
  let promoterId: string;
  let buyerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ledger = app.get(LedgerService);
    promoterToken = await login(app, SEED.promoter);
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } })).id;
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  let seq = 0;
  async function makeEvent(status = 'draft'): Promise<string> {
    seq++;
    const e = await prisma.event.create({
      data: {
        promoterId,
        name: `Migra ${Date.now()}-${seq}`,
        slug: `migra-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
        startsAt: new Date('2028-09-01T00:00:00Z'),
        endsAt: new Date('2028-09-01T12:00:00Z'),
        status: status as never,
      },
    });
    return e.id;
  }

  async function makeSeatedLocality(eventId: string): Promise<string> {
    const loc = await prisma.locality.create({
      data: {
        eventId,
        name: 'Platea',
        slug: `platea-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'seated',
        desiredNet: 100,
      },
    });
    return loc.id;
  }

  async function seedSeats(localityId: string, labels: string[]): Promise<Record<string, string>> {
    const byLabel: Record<string, string> = {};
    for (const label of labels) {
      const s = await prisma.seat.create({
        data: { localityId, label, section: 'A', x: 0, y: 0 },
      });
      byLabel[label] = s.id;
    }
    return byLabel;
  }

  /** Vende un asiento: orden pagada + ítem activo + boleto + status sold. */
  async function sellSeat(
    eventId: string,
    localityId: string,
    seatId: string,
    label: string,
  ): Promise<{ orderId: string; ticketId: string }> {
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
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        localityId,
        seatId,
        label,
        net: '100.00',
        total: '100.00',
        quote: {},
        quoteHash: 'x',
        active: true,
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        orderItemId: item.id,
        orderId: order.id,
        eventId,
        localityId,
        seatId,
        ownerId: buyerId,
        serial: `PE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        signature: 'sig',
        signingKeyId: 'k1',
        totpSecret: 'enc',
        status: 'valid',
      },
    });
    await prisma.seat.update({ where: { id: seatId }, data: { status: 'sold' } });
    return { orderId: order.id, ticketId: ticket.id };
  }

  function put(localityId: string, seats: Array<Record<string, unknown>>) {
    return http()
      .put(`/api/v1/localities/${localityId}/seats`)
      .set(bearer(promoterToken))
      .send({ seats });
  }

  // -------------------------------------------------------------------------

  it('layout nuevo INCLUYE el label vendido → conserva seatId, nueva posición, 0 huérfanos', async () => {
    const eventId = await makeEvent('draft');
    const locId = await makeSeatedLocality(eventId);
    const ids = await seedSeats(locId, ['A1', 'A2', 'A3']);
    const sold = await sellSeat(eventId, locId, ids['A1'], 'A1');

    // Nuevo layout: mantiene A1 (vendido) con OTRA posición, cambia A2/A3 → B1/B2.
    const res = await put(locId, [
      { label: 'A1', section: 'VIP', x: 50, y: 60 },
      { label: 'B1', x: 10, y: 10 },
      { label: 'B2', x: 20, y: 20 },
    ]).expect(200);

    // A1 se ACTUALIZA (no se recrea): 1 update; B1/B2 nuevos; A2/A3 borrados.
    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(2);
    expect(res.body.deleted).toBe(2); // A2, A3 (disponibles)
    expect(res.body.preserved).toBe(0);
    expect(res.body.capacity).toBe(3); // A1 + B1 + B2

    // El boleto y el ítem conservan el MISMO seatId (mismo asiento lógico).
    const seatA1 = await prisma.seat.findUniqueOrThrow({ where: { id: ids['A1'] } });
    expect(seatA1.label).toBe('A1');
    expect(seatA1.status).toBe('sold');
    expect(seatA1.section).toBe('VIP'); // posición migrada
    expect(seatA1.x).toBe(50);
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: sold.orderId, active: true },
    });
    expect(item.seatId).toBe(ids['A1']); // 0 huérfanos
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: sold.ticketId } });
    expect(ticket.seatId).toBe(ids['A1']);
    expect(ticket.status).toBe('valid');

    // 0 doble-venta: exactamente 1 línea activa sobre el asiento vendido.
    const activeItems = await prisma.orderItem.count({
      where: { seatId: ids['A1'], active: true },
    });
    expect(activeItems).toBe(1);
  });

  it('layout nuevo NO incluye el label vendido → el asiento vendido se PRESERVA (arrastrado)', async () => {
    const eventId = await makeEvent('suspended');
    const locId = await makeSeatedLocality(eventId);
    const ids = await seedSeats(locId, ['A1', 'A2']);
    const sold = await sellSeat(eventId, locId, ids['A1'], 'A1');

    // Nuevo layout SIN A1: A1 (vendido) NO puede eliminarse → se conserva.
    const res = await put(locId, [{ label: 'C1', x: 1, y: 1 }, { label: 'C2', x: 2, y: 2 }]).expect(200);
    expect(res.body.preserved).toBe(1); // A1 arrastrado
    expect(res.body.created).toBe(2); // C1, C2
    expect(res.body.deleted).toBe(1); // A2 (disponible)
    // Capacidad = A1 (preservado) + C1 + C2.
    expect(res.body.capacity).toBe(3);

    const seatA1 = await prisma.seat.findUniqueOrThrow({ where: { id: ids['A1'] } });
    expect(seatA1.status).toBe('sold');
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: sold.ticketId } });
    expect(ticket.seatId).toBe(ids['A1']); // boleto sigue válido, sin huérfano
    expect(ticket.status).toBe('valid');
  });

  it('SEATED sin vendidos → delete-all + insert (comportamiento idéntico al actual)', async () => {
    const eventId = await makeEvent('draft');
    const locId = await makeSeatedLocality(eventId);
    await seedSeats(locId, ['A1', 'A2', 'A3']);

    const res = await put(locId, [{ label: 'X1' }, { label: 'X2' }]).expect(200);
    expect(res.body.deleted).toBe(3); // A1..A3 borrados
    expect(res.body.created).toBe(2); // X1, X2 nuevos
    expect(res.body.updated).toBe(0);
    expect(res.body.preserved).toBe(0);
    expect(res.body.capacity).toBe(2);
    const labels = (await prisma.seat.findMany({ where: { localityId: locId } })).map((s) => s.label);
    expect(labels.sort()).toEqual(['X1', 'X2']);
  });

  it('layout con labels duplicados → 400', async () => {
    const eventId = await makeEvent('draft');
    const locId = await makeSeatedLocality(eventId);
    await put(locId, [{ label: 'D1' }, { label: 'D1' }]).expect(400);
  });

  it('reemplazar el mapa de una localidad GA → 400 (usa el aforo)', async () => {
    const eventId = await makeEvent('draft');
    const loc = await prisma.locality.create({
      data: {
        eventId,
        name: 'GA',
        slug: `ga-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'general',
        desiredNet: 100,
      },
    });
    await put(loc.id, [{ label: 'Z1' }]).expect(400);
  });

  it('evento PUBLICADO (congelado) → 409 (no reconfigurable)', async () => {
    const eventId = await makeEvent('published');
    const locId = await makeSeatedLocality(eventId);
    await seedSeats(locId, ['A1']);
    await put(locId, [{ label: 'A1' }, { label: 'A2' }]).expect(409);
  });

  it('idempotente: re-aplicar el MISMO layout sobre una localidad con ventas no cambia nada', async () => {
    const eventId = await makeEvent('suspended');
    const locId = await makeSeatedLocality(eventId);
    const ids = await seedSeats(locId, ['A1', 'A2']);
    await sellSeat(eventId, locId, ids['A1'], 'A1');

    const layout = [
      { label: 'A1', section: 'VIP', x: 5, y: 5 },
      { label: 'A2', x: 6, y: 6 },
    ];
    const first = await put(locId, layout).expect(200);
    const second = await put(locId, layout).expect(200);
    expect(second.body.capacity).toBe(first.body.capacity);
    // A1 vendido conserva su id y estado en ambas pasadas.
    const seatA1 = await prisma.seat.findUniqueOrThrow({ where: { id: ids['A1'] } });
    expect(seatA1.status).toBe('sold');
    const active = await prisma.orderItem.count({ where: { seatId: ids['A1'], active: true } });
    expect(active).toBe(1); // sin doble-venta tras repetir
  });

  it('el LEDGER de la orden permanece íntegro tras migrar el mapa', async () => {
    const eventId = await makeEvent('suspended');
    const locId = await makeSeatedLocality(eventId);
    const ids = await seedSeats(locId, ['A1', 'A2']);
    const sold = await sellSeat(eventId, locId, ids['A1'], 'A1');
    // Asiento contable ligado a la orden (partida doble que cuadra en 0).
    await ledger.post({
      kind: 'sale.migration-fixture',
      refType: 'order',
      refId: sold.orderId,
      entries: [
        { type: 'gateway_clearing', amount: '100.00' },
        { type: 'promoter_payable', ownerId: promoterId, amount: '-100.00' },
      ],
    });
    const before = await ledger.orderChain(sold.orderId);
    expect(before.chainValid).toBe(true);

    await put(locId, [{ label: 'A1', x: 9, y: 9 }, { label: 'A2' }]).expect(200);

    const after = await ledger.orderChain(sold.orderId);
    expect(after.chainValid).toBe(true);
    expect(after.transactions.length).toBe(before.transactions.length); // no se tocó el ledger
  });

  // ---- GA: aforo ≥ vendidos ------------------------------------------------

  it('GA: bajar aforo < vendidos → 409; aforo ≥ vendidos → conserva vendidos + regenera available', async () => {
    const eventId = await makeEvent('draft');
    const res = await http()
      .post(`/api/v1/events/${eventId}/localities`)
      .set(bearer(promoterToken))
      .send({ name: `GA ${Date.now()}`, kind: 'general', capacity: 5, desiredNet: 100 })
      .expect(201);
    const locId = res.body.id;
    // Vender 3 de los 5 cupos.
    const seats = await prisma.seat.findMany({ where: { localityId: locId }, take: 3 });
    await prisma.seat.updateMany({
      where: { id: { in: seats.map((s) => s.id) } },
      data: { status: 'sold' },
    });
    // Bajar a 2 (< 3 vendidos) → 409.
    await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 2 })
      .expect(409);
    // Bajar a 3 (== vendidos) → 200: quedan exactamente los 3 vendidos.
    await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 3 })
      .expect(200);
    expect(await prisma.seat.count({ where: { localityId: locId } })).toBe(3);
    expect(await prisma.seat.count({ where: { localityId: locId, status: 'sold' } })).toBe(3);
    // Subir a 6 → regenera 3 cupos available conservando los vendidos.
    await http()
      .patch(`/api/v1/localities/${locId}`)
      .set(bearer(promoterToken))
      .send({ capacity: 6 })
      .expect(200);
    expect(await prisma.seat.count({ where: { localityId: locId, status: 'available' } })).toBe(3);
    expect(await prisma.seat.count({ where: { localityId: locId, status: 'sold' } })).toBe(3);
  });
});
