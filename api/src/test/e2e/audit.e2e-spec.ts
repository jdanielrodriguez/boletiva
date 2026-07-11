import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.8 · Bitácora de auditoría (no-repudio). `POST /audit/confirm` registra un
 * click de confirmación capturando IP y user-agent SERVER-SIDE; `GET /audit` (admin,
 * keyset) lista; `GET /audit/verify` valida la cadena hash. Cubre: registro y captura
 * de contexto, validación, RBAC, cadena íntegra, detección de manipulación y keyset.
 * Limpia la tabla al inicio y al final (idempotente en BD compartida).
 */
describe('Bitácora de auditoría (audit) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;
  let buyerId: string;

  const clearAudit = () => prisma.auditEvent.deleteMany({});

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    buyerToken = await login(app, SEED.buyer);
    buyerId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } })).id;
    await clearAudit();
  });

  afterAll(async () => {
    await clearAudit();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('anónimo no puede registrar (401)', async () => {
    await http().post('/api/v1/audit/confirm').send({ action: 'test.x' }).expect(401);
  });

  it('validación: action requerida (400)', async () => {
    await http().post('/api/v1/audit/confirm').set(bearer(buyerToken)).send({}).expect(400);
  });

  it('registra un click de confirmación y captura IP/user-agent SERVER-SIDE', async () => {
    await http()
      .post('/api/v1/audit/confirm')
      .set(bearer(buyerToken))
      .set('User-Agent', 'JestTest/1.0')
      .send({ action: 'promoter.approve', resource: 'promo-123', payload: { note: 'ok' } })
      .expect(200);

    const list = await http().get('/api/v1/audit').set(bearer(adminToken)).expect(200);
    const rec = list.body.items[0];
    expect(rec.action).toBe('promoter.approve');
    expect(rec.resource).toBe('promo-123');
    expect(rec.userId).toBe(buyerId);
    expect(rec.userAgent).toBe('JestTest/1.0'); // capturado server-side, no del body
    expect(rec.ip).toBeTruthy();
    expect(rec.payload).toEqual({ note: 'ok' });
    expect(typeof rec.seq).toBe('string'); // BigInt serializado como string
    expect(rec.hash).toBeTruthy();
  });

  it('RBAC del listado: anónimo 401, buyer 403, admin 200', async () => {
    await http().get('/api/v1/audit').expect(401);
    await http().get('/api/v1/audit').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/audit').set(bearer(adminToken)).expect(200);
  });

  it('la cadena queda íntegra tras varios registros (verify ok)', async () => {
    for (const a of ['event.publish', 'event.cancel', 'gateway.default']) {
      await http().post('/api/v1/audit/confirm').set(bearer(adminToken)).send({ action: a }).expect(200);
    }
    const res = await http().get('/api/v1/audit/verify').set(bearer(adminToken)).expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('keyset: pagina por cursor', async () => {
    await clearAudit();
    for (const a of ['a.1', 'a.2', 'a.3']) {
      await http().post('/api/v1/audit/confirm').set(bearer(buyerToken)).send({ action: a }).expect(200);
    }
    const p1 = await http().get('/api/v1/audit?limit=2').set(bearer(adminToken)).expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await http()
      .get(`/api/v1/audit?limit=2&cursor=${p1.body.nextCursor}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(p2.body.items.length).toBe(1);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('detecta manipulación de la cadena (verify ok:false + brokenAt)', async () => {
    const target = await prisma.auditEvent.findFirstOrThrow({ orderBy: { seq: 'asc' } });
    await prisma.auditEvent.update({
      where: { id: target.id },
      data: { action: 'a.HACKEADO' },
    });
    const res = await http().get('/api/v1/audit/verify').set(bearer(adminToken)).expect(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.brokenAt).toBe(target.seq.toString());
  });
});
