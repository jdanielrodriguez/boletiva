import http from 'http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { hmacSha256, sha256 } from '../../common/utils/crypto';

const SECRET = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me';
const sign = (id: string, type: string, ref: string) => hmacSha256(SECRET, `${id}.${type}.${ref}`);

/**
 * Ola 6.5 · Ticket 4 — SSE del checkout (`GET /orders/:id/stream`).
 * Cubre: auth por ?access_token= (EventSource no envía headers), IDOR→404,
 * apertura del stream (text/event-stream) con snapshot inicial, y recepción del
 * evento `order` (status=paid) cuando llega el webhook — push sin polling.
 */
describe('SSE del checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port: number;
  let token: string;
  let bToken: string;
  let eventId: string;
  let seatIds: string[];
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await app.listen(0); // necesitamos un puerto real para leer el stream con http crudo
    port = (app.getHttpServer().address() as { port: number }).port;
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    const event = await prisma.event.create({
      data: {
        promoterId: promoter.id,
        name: 'SSE Event',
        slug: `sse-${stamp}`,
        startsAt: new Date('2028-07-01T20:00:00-06:00'),
        endsAt: new Date('2028-07-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    eventId = event.id;
    const loc = await prisma.locality.create({
      data: { eventId, name: 'S', slug: `s-${stamp}`, kind: 'seated', desiredNet: 100 },
    });
    await prisma.seat.createMany({
      data: Array.from({ length: 4 }, (_, i) => ({ localityId: loc.id, label: `S${i + 1}` })),
    });
    const seats = await prisma.seat.findMany({ where: { localityId: loc.id } });
    seatIds = seats.sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1))).map((s) => s.id);

    token = await loginTrusted(SEED.buyer, 'sse-A');
    const emailB = `sse_b_${stamp}@test.com`;
    const sB = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: emailB, password: 'Password123', firstName: 'B' });
    await prisma.user.update({ where: { id: sB.body.user.id }, data: { emailVerifiedAt: new Date() } });
    bToken = await loginTrusted(emailB, 'sse-B');
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
    await prisma.payment.deleteMany({ where: { order: { eventId } } });
    await prisma.webhookEvent.deleteMany({});
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
    await prisma.order.deleteMany({ where: { eventId } });
    await prisma.ticket.deleteMany({ where: { eventId } });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.user.deleteMany({ where: { email: { contains: `sse_b_${stamp}` } } });
    await app.close();
  });

  const http2 = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const buy = async (seatIdx: number) =>
    (await http2().post(`/api/v1/events/${eventId}/orders`).set(bearer(token)).send({ seatIds: [seatIds[seatIdx]] }).expect(201)).body;

  it('sin token → 401', async () => {
    const o = await buy(0);
    await http2().get(`/api/v1/orders/${o.id}/stream`).expect(401);
  });

  it('IDOR: otro usuario (por ?access_token) → 404', async () => {
    const o = await buy(1);
    await http2().get(`/api/v1/orders/${o.id}/stream?access_token=${bToken}`).expect(404);
  });

  it('dueño: abre el stream (text/event-stream + snapshot) y recibe `order` paid al pagar', async () => {
    const o = await buy(2);

    const events = await openSse(`/api/v1/orders/${o.id}/stream?access_token=${token}`, async () => {
      // Tras abrir el stream, dispara el pago + webhook → emite `order` paid.
      const pay = await http2().post(`/api/v1/orders/${o.id}/pay`).set(bearer(token)).expect(201);
      const evt = `sse_evt_${stamp}`;
      await http2()
        .post('/api/v1/payments/webhook')
        .set('x-webhook-signature', sign(evt, 'payment.succeeded', pay.body.providerRef))
        .send({ id: evt, type: 'payment.succeeded', providerRef: pay.body.providerRef })
        .expect(200);
    });

    // El primer evento es el snapshot (estado actual pending).
    expect(events[0]?.type).toBe('snapshot');
    // Y llega el evento `order` con status paid (push, sin polling).
    const order = events.find((e) => e.type === 'order');
    expect(order?.data).toMatchObject({ status: 'paid' });
  }, 15000);

  /**
   * Abre el SSE con http crudo (supertest cuelga en streams que no cierran),
   * ejecuta `afterOpen` al recibir la respuesta, acumula eventos y resuelve al ver
   * un `order` (o al vencer un timeout de seguridad). Parsea el formato SSE de Nest.
   */
  function openSse(
    path: string,
    afterOpen: () => Promise<void>,
  ): Promise<Array<{ type: string; data: unknown }>> {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`status ${res.statusCode}`));
          return;
        }
        expect(res.headers['content-type']).toContain('text/event-stream');
        const events: Array<{ type: string; data: unknown }> = [];
        let buf = '';
        const done = () => {
          clearTimeout(timer);
          req.destroy();
          resolve(events);
        };
        const timer = setTimeout(done, 8000); // red de seguridad
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const typeMatch = raw.match(/^event:\s*(.*)$/m);
            const dataMatch = raw.match(/^data:\s*(.*)$/m);
            if (dataMatch) {
              events.push({
                type: typeMatch ? typeMatch[1].trim() : 'message',
                data: JSON.parse(dataMatch[1]),
              });
              if (typeMatch && typeMatch[1].trim() === 'order') done();
            }
          }
        });
        res.on('error', reject);
        afterOpen().catch(reject);
      });
      req.on('error', reject);
    });
  }
});
