import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OrdersSweeperService } from '../../modules/orders/orders-sweeper.service';
import { createTestApp, SEED } from './utils';

/**
 * Sweeper de órdenes pending vencidas (2.1): una orden `pending` cuyo `expiresAt` ya
 * pasó libera sus asientos (`available`), desactiva sus ítems y queda `expired`. NO
 * toca una pending aún vigente ni una ya pagada (idempotente / seguro ante carrera).
 */
describe('Sweeper de órdenes pending vencidas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sweeper: OrdersSweeperService;
  let eventId: string;
  let buyerId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    sweeper = app.get(OrdersSweeperService);
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: `SWEEP ${stamp}`,
        slug: `sweep-${stamp}`,
        startsAt: new Date('2029-03-01T20:00:00-06:00'),
        endsAt: new Date('2029-03-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { order: { eventId } } });
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await app.close();
  });

  /** Crea una localidad + N asientos `sold` + una orden pending con el `expiresAt` dado. */
  async function makePendingOrder(tag: string, expiresAt: Date) {
    const loc = await prisma.locality.create({
      data: { eventId, name: tag, slug: `${tag}-${stamp}`, kind: 'general', desiredNet: 100, capacity: 2 },
    });
    const seats = await Promise.all([
      prisma.seat.create({ data: { localityId: loc.id, label: `${tag}-1`, status: 'sold' } }),
      prisma.seat.create({ data: { localityId: loc.id, label: `${tag}-2`, status: 'sold' } }),
    ]);
    const order = await prisma.order.create({
      data: {
        buyerId,
        eventId,
        status: 'pending',
        net: '200.00',
        platformFee: '20.00',
        fixedFees: '0.00',
        taxableBase: '220.00',
        iva: '26.40',
        gatewayFee: '13.60',
        total: '259.36',
        expiresAt,
      },
    });
    for (const s of seats) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          seatId: s.id,
          localityId: loc.id,
          net: '100.00',
          total: '129.68',
          quote: {},
          quoteHash: `${tag}-${s.id}`,
          active: true,
        },
      });
    }
    return { orderId: order.id, seatIds: seats.map((s) => s.id) };
  }

  it('libera una orden pending VENCIDA (expired + asientos available + ítems inactivos)', async () => {
    const past = new Date(Date.now() - 60_000); // venció hace 1 min
    const { orderId, seatIds } = await makePendingOrder('exp', past);

    const res = await sweeper.sweepExpired(new Date());
    expect(res.orders).toBeGreaterThanOrEqual(1);
    expect(res.seats).toBeGreaterThanOrEqual(2);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('expired');
    for (const id of seatIds) {
      expect((await prisma.seat.findUniqueOrThrow({ where: { id } })).status).toBe('available');
    }
    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items.every((i) => !i.active)).toBe(true);
  });

  it('NO toca una pending aún vigente', async () => {
    const future = new Date(Date.now() + 10 * 60_000);
    const { orderId, seatIds } = await makePendingOrder('viva', future);
    await sweeper.sweepExpired(new Date());
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending');
    for (const id of seatIds) {
      expect((await prisma.seat.findUniqueOrThrow({ where: { id } })).status).toBe('sold');
    }
  });

  it('NO revive una orden ya pagada (aunque tuviera expiresAt pasado)', async () => {
    const past = new Date(Date.now() - 60_000);
    const { orderId, seatIds } = await makePendingOrder('pagada', past);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'paid', paidAt: new Date() } });
    await sweeper.sweepExpired(new Date());
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('paid');
    for (const id of seatIds) {
      // los asientos siguen vendidos (no se liberan de una orden pagada)
      expect((await prisma.seat.findUniqueOrThrow({ where: { id } })).status).toBe('sold');
    }
  });
});
