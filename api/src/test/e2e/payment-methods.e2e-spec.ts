import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Métodos de pago tokenizados (PCI-DSS). Cubre: alta (tokeniza el nonce, la primera
 * tarjeta queda default), listado sin datos sensibles (nunca token/PAN),
 * marcar/quitar default, borrado con promoción del default, IDOR→404, validación
 * (last4/nonce/marca) y que el PAN NUNCA se persiste.
 */
describe('Métodos de pago tokenizados (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let buyerToken: string;
  let buyerId: string;
  let otherToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    await prisma.savedCard.deleteMany({ where: { userId: buyerId } });
    buyerToken = await loginTrusted(SEED.buyer, 'pm-buyer');
    otherToken = await loginTrusted(SEED.promoter, 'pm-other');
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
    await prisma.savedCard.deleteMany({ where: { userId: buyerId } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  let firstId: string;
  let secondId: string;

  it('sin sesión → 401', async () => {
    await http().get('/api/v1/payment-methods').expect(401);
  });

  it('la primera tarjeta se guarda tokenizada y queda por defecto', async () => {
    const res = await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ nonce: 'nonce-from-gateway-sdk-1', brand: 'visa', last4: '4242' })
      .expect(201);
    expect(res.body).toMatchObject({ brand: 'visa', last4: '4242', isDefault: true });
    expect(res.body.token).toBeUndefined(); // nunca se expone el token
    expect(res.body.nonce).toBeUndefined();
    firstId = res.body.id;

    // Persistió un token opaco (no el nonce ni un PAN).
    const row = await prisma.savedCard.findUniqueOrThrow({ where: { id: firstId } });
    expect(row.token).toMatch(/^tok_/);
    expect(row.token).not.toContain('4242');
  });

  it('la segunda tarjeta no es default salvo que se pida', async () => {
    const res = await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ nonce: 'nonce-2', brand: 'mastercard', last4: '5555' })
      .expect(201);
    expect(res.body.isDefault).toBe(false);
    secondId = res.body.id;
  });

  it('lista los métodos (default primero) sin datos sensibles', async () => {
    const res = await http().get('/api/v1/payment-methods').set(bearer(buyerToken)).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].isDefault).toBe(true); // default primero
    expect(JSON.stringify(res.body)).not.toContain('tok_'); // sin token
  });

  it('marca la segunda como default y desmarca la primera', async () => {
    const res = await http()
      .post(`/api/v1/payment-methods/${secondId}/default`)
      .set(bearer(buyerToken))
      .expect(201);
    expect(res.body.isDefault).toBe(true);
    const first = await prisma.savedCard.findUniqueOrThrow({ where: { id: firstId } });
    expect(first.isDefault).toBe(false);
  });

  it('IDOR: no puedo marcar como default una tarjeta ajena → 404', async () => {
    await http().post(`/api/v1/payment-methods/${firstId}/default`).set(bearer(otherToken)).expect(404);
  });

  it('IDOR: no puedo borrar una tarjeta ajena → 404', async () => {
    await http().delete(`/api/v1/payment-methods/${firstId}`).set(bearer(otherToken)).expect(404);
  });

  it('borra la default y promueve la otra a default', async () => {
    await http().delete(`/api/v1/payment-methods/${secondId}`).set(bearer(buyerToken)).expect(200);
    const remaining = await prisma.savedCard.findMany({ where: { userId: buyerId } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(firstId);
    expect(remaining[0].isDefault).toBe(true); // promovida
  });

  it('validación: last4 no numérico → 400', async () => {
    await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ nonce: 'n', brand: 'visa', last4: 'abcd' })
      .expect(400);
  });

  it('validación: marca no soportada → 400', async () => {
    await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ nonce: 'nonce-x', brand: 'hackcoin', last4: '1234' })
      .expect(400);
  });

  it('validación: nonce ausente → 400 (PCI: sin nonce no hay tokenización)', async () => {
    await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ brand: 'visa', last4: '4242' })
      .expect(400);
  });

  it('PCI: mandar un campo pan es rechazado por el whitelist → 400 (el PAN no entra)', async () => {
    await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ nonce: 'nonce-3', brand: 'amex', last4: '0005', pan: '378282246310005' })
      .expect(400);
  });

  it('borrar una tarjeta NO default no cambia cuál es la default', async () => {
    // firstId es la default; añadimos una segunda (no default) y la borramos.
    const added = await http()
      .post('/api/v1/payment-methods')
      .set(bearer(buyerToken))
      .send({ nonce: 'nonce-4', brand: 'discover', last4: '1117' })
      .expect(201);
    expect(added.body.isDefault).toBe(false);
    await http().delete(`/api/v1/payment-methods/${added.body.id}`).set(bearer(buyerToken)).expect(200);
    const first = await prisma.savedCard.findUniqueOrThrow({ where: { id: firstId } });
    expect(first.isDefault).toBe(true); // sigue siendo default
  });
});
