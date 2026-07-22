import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login, SEED } from './utils';

/**
 * Regla de negocio: el ADMINISTRADOR ve todo lo del cliente pero NO actúa como
 * comprador real (no crea órdenes, no paga, no registra tarjetas). El promotor, el
 * asesor y el comprador SÍ pueden comprar. Verificamos que el guard corta al admin
 * (403) ANTES del servicio, y que un no-admin lo atraviesa (llega al servicio → 404
 * por orden inexistente, no 403).
 */
describe('El admin no compra como cliente (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let buyerToken: string;
  const randomUuid = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    app = await createTestApp();
    adminToken = await login(app, SEED.admin);
    buyerToken = await login(app, SEED.buyer);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('ADMIN → 403 en pagar, registrar tarjeta y crear orden', async () => {
    await http().post(`/api/v1/orders/${randomUuid}/pay`).set(bearer(adminToken)).send({}).expect(403);
    await http()
      .post('/api/v1/payment-methods')
      .set(bearer(adminToken))
      .send({ nonce: 'tok_test', brand: 'visa', last4: '4242' })
      .expect(403);
    await http()
      .post(`/api/v1/events/${randomUuid}/orders`)
      .set(bearer(adminToken))
      .send({ seatIds: [randomUuid] })
      .expect(403);
  });

  it('COMPRADOR atraviesa el guard (no 403): pagar orden inexistente → 404', async () => {
    const res = await http().post(`/api/v1/orders/${randomUuid}/pay`).set(bearer(buyerToken)).send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });
});
