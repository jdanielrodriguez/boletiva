import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, login, SEED } from './utils';

/**
 * Lookup de nombre por NIT (autollenar facturación). Config-gated por FEL: en test la
 * integración FEL está desactivada → `available:false` y `name:null` (el frontend deja
 * escribir el nombre a mano). Requiere sesión verificada.
 */
describe('Billing NIT → nombre (e2e)', () => {
  let app: INestApplication;
  let buyerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    buyerToken = await login(app, SEED.buyer);
  });
  afterAll(async () => app.close());

  const http = () => request(app.getHttpServer());

  it('sin sesión → 401', async () => {
    await http().get('/api/v1/billing/nit-name?nit=1234567').expect(401);
  });

  it('FEL desactivado (test) → { available:false, name:null } (nombre editable)', async () => {
    const res = await http()
      .get('/api/v1/billing/nit-name?nit=1234567-8')
      .set({ Authorization: `Bearer ${buyerToken}` })
      .expect(200);
    expect(res.body).toEqual({ available: false, name: null });
  });

  it('NIT = CF → no busca (name null)', async () => {
    const res = await http()
      .get('/api/v1/billing/nit-name?nit=CF')
      .set({ Authorization: `Bearer ${buyerToken}` })
      .expect(200);
    expect(res.body.name).toBeNull();
  });
});
