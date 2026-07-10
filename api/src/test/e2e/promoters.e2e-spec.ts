import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 4 · Ticket 5 — Autorización de promotores + panel admin + "Activar pruebas".
 * Cubre: solicitud (pending), bloqueo de operación sin aprobar (RBAC + guard de
 * negocio), aprobación → puede operar, rechazo/suspensión quitan el rol, modo
 * pruebas auto-aprueba, y RBAC de los endpoints admin.
 */
describe('Autorización de promotores (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let stamp: number;

  const newEventBody = () => ({
    name: `Promo Ev ${Date.now()}`,
    startsAt: new Date('2027-09-01T20:00:00-06:00').toISOString(),
    endsAt: new Date('2027-09-01T23:00:00-06:00').toISOString(),
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    await ensureRequireApproval(true);
    adminToken = await loginTrusted(SEED.admin, 'promo-admin');
  });

  async function ensureRequireApproval(v: boolean) {
    await prisma.setting.upsert({
      where: { key: 'promoters.require_approval' },
      update: { value: v },
      create: { key: 'promoters.require_approval', value: v, description: 'test' },
    });
  }

  /** Crea un usuario verificado y devuelve { id, email }. */
  async function newVerifiedUser(tag: string): Promise<{ id: string; email: string }> {
    const email = `promo_${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    await prisma.user.update({ where: { id: res.body.user.id }, data: { emailVerifiedAt: new Date() } });
    return { id: res.body.user.id, email };
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
    await ensureRequireApproval(true);
    const users = await prisma.user.findMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    const ids = users.map((u) => u.id);
    await prisma.event.deleteMany({ where: { promoterId: { in: ids } } });
    await prisma.promoterStatusEvent.deleteMany({ where: { promoterId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('solicitar → pending; y sin aprobar no puede crear evento (RBAC 403)', async () => {
    const u = await newVerifiedUser('applicant');
    const token = await loginTrusted(u.email, 'promo-appl');

    const applied = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    expect(applied.body.promoterStatus).toBe('pending');

    const me = await http().get('/api/v1/promoters/me').set(bearer(token)).expect(200);
    expect(me.body).toMatchObject({ promoterStatus: 'pending', requireApproval: true });

    // Sin el rol promoter, el guard de roles bloquea la creación de eventos.
    await http().post('/api/v1/events').set(bearer(token)).send(newEventBody()).expect(403);
  });

  it('admin lista pendientes, aprueba, y entonces el promotor ya puede operar', async () => {
    const u = await newVerifiedUser('approve');
    let token = await loginTrusted(u.email, 'promo-appr');
    await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);

    const list = await http()
      .get('/api/v1/promoters?status=pending')
      .set(bearer(adminToken))
      .expect(200);
    expect(list.body.some((p: { id: string }) => p.id === u.id)).toBe(true);

    const approved = await http()
      .post(`/api/v1/promoters/${u.id}/approve`)
      .set(bearer(adminToken))
      .expect(200);
    expect(approved.body.promoterStatus).toBe('approved');

    // Re-login: el nuevo token ya trae el rol promoter.
    token = await loginTrusted(u.email, 'promo-appr');
    await http().post('/api/v1/events').set(bearer(token)).send(newEventBody()).expect(201);
  });

  it('con rol promoter pero estado no aprobado, el guard de negocio bloquea (403)', async () => {
    // Usuario con rol promoter en el token pero promoterStatus=pending.
    const u = await newVerifiedUser('roleonly');
    await prisma.user.update({
      where: { id: u.id },
      data: { roles: ['promoter'], promoterStatus: 'pending' },
    });
    const token = await loginTrusted(u.email, 'promo-roleonly');
    await http().post('/api/v1/events').set(bearer(token)).send(newEventBody()).expect(403);
  });

  it('rechazar guarda el motivo; suspender quita el rol y bloquea de nuevo', async () => {
    const rej = await newVerifiedUser('reject');
    await loginTrusted(rej.email, 'promo-rej').then((t) =>
      http().post('/api/v1/promoters/apply').set(bearer(t)),
    );
    const rejected = await http()
      .post(`/api/v1/promoters/${rej.id}/reject`)
      .set(bearer(adminToken))
      .send({ note: 'documentación incompleta' })
      .expect(200);
    expect(rejected.body).toMatchObject({ promoterStatus: 'rejected', promoterNote: 'documentación incompleta' });

    // Suspensión de un promotor aprobado: quita el rol → no puede operar.
    const sus = await newVerifiedUser('suspend');
    await http().post(`/api/v1/promoters/${sus.id}/approve`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/promoters/${sus.id}/suspend`).set(bearer(adminToken)).expect(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: sus.id } });
    expect(after.promoterStatus).toBe('suspended');
    expect(after.roles).not.toContain('promoter');
  });

  it('"Activar pruebas": con require_approval=false, solicitar auto-aprueba', async () => {
    await http()
      .patch('/api/v1/promoters/settings')
      .set(bearer(adminToken))
      .send({ requireApproval: false })
      .expect(200);

    const u = await newVerifiedUser('testmode');
    let token = await loginTrusted(u.email, 'promo-testmode');
    const applied = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    expect(applied.body.promoterStatus).toBe('approved'); // auto-aprobado

    token = await loginTrusted(u.email, 'promo-testmode');
    await http().post('/api/v1/events').set(bearer(token)).send(newEventBody()).expect(201);

    await http()
      .patch('/api/v1/promoters/settings')
      .set(bearer(adminToken))
      .send({ requireApproval: true })
      .expect(200);
  });

  it('RBAC: los endpoints admin rechazan a un no-admin (403)', async () => {
    const u = await newVerifiedUser('rbac');
    const token = await loginTrusted(u.email, 'promo-rbac');
    await http().get('/api/v1/promoters').set(bearer(token)).expect(403);
    await http().get('/api/v1/promoters/settings').set(bearer(token)).expect(403);
    await http().patch('/api/v1/promoters/settings').set(bearer(token)).send({ requireApproval: true }).expect(403);
    await http().post(`/api/v1/promoters/${u.id}/approve`).set(bearer(token)).expect(403);
  });

  it('solicitar con correo sin verificar → 403', async () => {
    const email = `promo_unverified_${stamp}@test.com`;
    const res = await http()
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'U' });
    await http().post('/api/v1/promoters/apply').set(bearer(res.body.tokens.accessToken)).expect(403);
  });

  // ---- Cobertura adicional (análisis QA) ----

  it('approve/reject/suspend sobre id inexistente → 404', async () => {
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http().post(`/api/v1/promoters/${ghost}/approve`).set(bearer(adminToken)).expect(404);
    await http().post(`/api/v1/promoters/${ghost}/reject`).set(bearer(adminToken)).send({}).expect(404);
    await http().post(`/api/v1/promoters/${ghost}/suspend`).set(bearer(adminToken)).send({}).expect(404);
  });

  it('GET /promoters con status inválido → 400', async () => {
    await http().get('/api/v1/promoters?status=inventado').set(bearer(adminToken)).expect(400);
  });

  it('apply es idempotente: doble apply sigue pending; estando approved no cambia', async () => {
    const u = await newVerifiedUser('idem');
    const token = await loginTrusted(u.email, 'promo-idem');
    const a1 = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    const a2 = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    expect(a1.body.promoterStatus).toBe('pending');
    expect(a2.body.promoterStatus).toBe('pending');
    expect(a2.body.promoterAppliedAt).toBe(a1.body.promoterAppliedAt); // conserva la fecha

    await http().post(`/api/v1/promoters/${u.id}/approve`).set(bearer(adminToken)).expect(200);
    const a3 = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    expect(a3.body.promoterStatus).toBe('approved'); // early-return, sin cambios
  });

  it('tras un rechazo, volver a solicitar regresa a pending (resetea el motivo)', async () => {
    const u = await newVerifiedUser('reapply');
    const token = await loginTrusted(u.email, 'promo-reapply');
    await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    await http().post(`/api/v1/promoters/${u.id}/reject`).set(bearer(adminToken)).send({ note: 'x' }).expect(200);
    const re = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    expect(re.body).toMatchObject({ promoterStatus: 'pending', promoterNote: null });
  });

  it('un admin puede crear y publicar eventos sin ser promotor (bypass)', async () => {
    const created = await http()
      .post('/api/v1/events')
      .set(bearer(adminToken))
      .send(newEventBody())
      .expect(201);
    await prisma.locality.create({
      data: { eventId: created.body.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 10 },
    });
    await http().post(`/api/v1/events/${created.body.id}/publish`).set(bearer(adminToken)).expect(200);
  });

  it('require_approval por defecto es true cuando el setting no existe', async () => {
    await prisma.setting.deleteMany({ where: { key: 'promoters.require_approval' } });
    const u = await newVerifiedUser('nosetting');
    const token = await loginTrusted(u.email, 'promo-nosetting');
    const applied = await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    expect(applied.body.promoterStatus).toBe('pending'); // default seguro = exige aprobación
    const me = await http().get('/api/v1/promoters/me').set(bearer(token)).expect(200);
    expect(me.body.requireApproval).toBe(true);
    await ensureRequireApproval(true); // restaurar
  });

  it('RBAC: reject/suspend también rechazan a no-admin (403); sin token → 401', async () => {
    const u = await newVerifiedUser('rbac2');
    const token = await loginTrusted(u.email, 'promo-rbac2');
    await http().post(`/api/v1/promoters/${u.id}/reject`).set(bearer(token)).send({}).expect(403);
    await http().post(`/api/v1/promoters/${u.id}/suspend`).set(bearer(token)).send({}).expect(403);
    await http().post('/api/v1/promoters/apply').expect(401);
    await http().get('/api/v1/promoters/me').expect(401);
  });

  it('historial append-only: registra cada transición; reactivar deja traza; RBAC', async () => {
    const u = await newVerifiedUser('hist');
    const token = await loginTrusted(u.email, 'promo-hist');
    await http().post('/api/v1/promoters/apply').set(bearer(token)).expect(200);
    await http()
      .post(`/api/v1/promoters/${u.id}/approve`)
      .set(bearer(adminToken))
      .expect(200);
    await http()
      .post(`/api/v1/promoters/${u.id}/suspend`)
      .set(bearer(adminToken))
      .send({ note: 'incumplimiento' })
      .expect(200);
    // Reactivar (aprobar de nuevo) conserva el historial.
    await http()
      .post(`/api/v1/promoters/${u.id}/approve`)
      .set(bearer(adminToken))
      .expect(200);

    const hist = await http()
      .get(`/api/v1/promoters/${u.id}/history`)
      .set(bearer(adminToken))
      .expect(200);
    // 3 transiciones: approved, suspended (con motivo), approved (reactivación). DESC.
    expect(hist.body.length).toBe(3);
    expect(hist.body[0].statusTo).toBe('approved');
    expect(hist.body[1]).toMatchObject({
      statusFrom: 'approved',
      statusTo: 'suspended',
      reason: 'incumplimiento',
    });
    expect(hist.body[1].adminId).toBeTruthy();

    // RBAC: no-admin no ve el historial; id inexistente → 404.
    await http().get(`/api/v1/promoters/${u.id}/history`).set(bearer(token)).expect(403);
    const ghost = '00000000-0000-0000-0000-000000000000';
    await http().get(`/api/v1/promoters/${ghost}/history`).set(bearer(adminToken)).expect(404);
  });

  it('validación: settings no booleano → 400; note >500 chars → 400', async () => {
    const u = await newVerifiedUser('val');
    await http()
      .patch('/api/v1/promoters/settings')
      .set(bearer(adminToken))
      .send({ requireApproval: 'sí' })
      .expect(400);
    await http()
      .post(`/api/v1/promoters/${u.id}/reject`)
      .set(bearer(adminToken))
      .send({ note: 'x'.repeat(501) })
      .expect(400);
  });
});
