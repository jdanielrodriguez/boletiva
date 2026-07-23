import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * B2 · Rol ASESOR. Cubre: herencia de permisos de admin (lectura de área admin →
 * 200), exclusión de la tab "Sistema" y ops de sistema (`@AdminOnly` → 403), gating
 * de MUTACIONES por ventana de desbloqueo (403 sin desbloqueo → 200 tras aprobar),
 * lectura libre sin desbloqueo, `advisor.lock_enabled=false` (muta sin desbloqueo) y
 * el flujo request→approve (RBAC + errores de token).
 */
describe('Rol asesor (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let advisorToken: string;
  let advisorId: string;
  let promoterId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'adv-admin');
    await setLock(true);

    const email = `advisor_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Aso' });
    advisorId = res.body.user.id;
    await prisma.user.update({
      where: { id: advisorId },
      data: { emailVerifiedAt: new Date(), roles: ['advisor'] },
    });
    advisorToken = await loginTrusted(email, 'adv-dev');
    promoterId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter.toLowerCase().trim() } })).id;
  });

  afterAll(async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    await prisma.user.deleteMany({ where: { email: { contains: `advisor_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setLock(v: boolean) {
    await prisma.setting.upsert({
      where: { key: 'advisor.lock_enabled' },
      update: { value: v },
      create: { key: 'advisor.lock_enabled', value: v, description: 'test' },
    });
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

  /** Pide desbloqueo (devuelve devToken en no-prod) y lo aprueba como admin. */
  async function unlock(): Promise<void> {
    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    const token = req.body.devToken as string;
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token }).expect(200);
  }

  it('LECTURA de área admin: el asesor hereda permisos (GET /promoters → 200)', async () => {
    await http().get('/api/v1/promoters').set(bearer(advisorToken)).expect(200);
    await http().get('/api/v1/events/all').set(bearer(advisorToken)).expect(200);
  });

  it('B1: el asesor VE el detalle de gestión de un evento de OTRO promotor (read-only, no 403)', async () => {
    // Evento sembrado propiedad del promotor semilla (no del asesor).
    const event = await prisma.event.findFirstOrThrow({ where: { promoterId } });
    await http().get(`/api/v1/events/${event.id}/manage`).set(bearer(advisorToken)).expect(200);
  });

  it('BUG destacar: el asesor (con desbloqueo) puede ACTIVAR y desactivar el destacado de un evento', async () => {
    await setLock(true);
    await unlock(); // ventana aprobada vigente
    const event = await prisma.event.findFirstOrThrow({ where: { promoterId } });
    // Activar destacado (antes fallaba por la gobernanza de promotor can_feature_events/premium).
    await http()
      .patch(`/api/v1/events/${event.id}/promote`)
      .set(bearer(advisorToken))
      .send({ featured: true })
      .expect(200);
    // Desactivar.
    await http()
      .patch(`/api/v1/events/${event.id}/promote`)
      .set(bearer(advisorToken))
      .send({ featured: false })
      .expect(200);
    // Limpieza: cierra la ventana de desbloqueo para no filtrar estado a otros tests.
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
  });

  it('tab SISTEMA excluida: GET /settings, GET /payment-gateways y PATCH /maintenance → 403 para el asesor', async () => {
    await http().get('/api/v1/settings').set(bearer(advisorToken)).expect(403);
    await http().get('/api/v1/payment-gateways').set(bearer(advisorToken)).expect(403);
    await http().patch('/api/v1/admin/maintenance').set(bearer(advisorToken)).send({ enabled: true }).expect(403);
    // Pero el admin sí puede (control).
    await http().get('/api/v1/settings').set(bearer(adminToken)).expect(200);
  });

  it('QA escalada: otorgar Premium (tier) y "activar pruebas" son @AdminOnly → 403 al asesor aun con desbloqueo', async () => {
    await unlock(); // ventana de desbloqueo VIGENTE: aun así, @AdminOnly corta al asesor
    await http()
      .patch(`/api/v1/promoters/${promoterId}/tier`)
      .set(bearer(advisorToken))
      .send({ tier: 'premium' })
      .expect(403);
    await http()
      .patch('/api/v1/promoters/settings')
      .set(bearer(advisorToken))
      .send({ requireApproval: false })
      .expect(403);
    // El admin real sí puede accionar la perilla de gobernanza (control).
    await http()
      .patch('/api/v1/promoters/settings')
      .set(bearer(adminToken))
      .send({ requireApproval: true })
      .expect(200);
    // Limpia la ventana de desbloqueo que abrió unlock() para no filtrarla al siguiente test.
    await prisma.advisorUnlock.deleteMany({});
  });

  it('QA: el enlace de desbloqueo PENDIENTE caduca (token viejo → 400)', async () => {
    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    const token = req.body.devToken as string;
    // Envejece el pendiente más allá del TTL (30 min) → approve debe rechazarlo.
    await prisma.advisorUnlock.updateMany({
      where: { approved: false },
      data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token }).expect(400);
    await prisma.advisorUnlock.deleteMany({});
  });

  it('MUTACIÓN de área admin SIN desbloqueo → 403; tras aprobar el desbloqueo → 200', async () => {
    await setLock(true);
    // Sin ventana → bloqueado.
    await http()
      .patch(`/api/v1/promoters/${promoterId}/note`)
      .set(bearer(advisorToken))
      .send({ note: 'nota del asesor' })
      .expect(403);
    // Solicita + admin aprueba → ventana abierta.
    await unlock();
    await http()
      .patch(`/api/v1/promoters/${promoterId}/note`)
      .set(bearer(advisorToken))
      .send({ note: 'nota del asesor' })
      .expect(200);
  });

  it('LIBRE sin desbloqueo: el asesor CREA/EDITA salones, plantillas y KB; PUBLICAR sí exige desbloqueo', async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } }); // sin ventana

    // Crear KB (draft) SIN desbloqueo → permitido (labor del asesor).
    const kb = await http()
      .post('/api/v1/kb')
      .set(bearer(advisorToken))
      .send({ question: `Asesor libre ${stamp}?`, answerHtml: '<p>Contenido</p>' })
      .expect((r) => {
        if (![200, 201].includes(r.status)) throw new Error(`KB create → ${r.status}`);
      });
    const kbId = kb.body.id as string;
    // Editar KB SIN desbloqueo → permitido.
    await http().patch(`/api/v1/kb/${kbId}`).set(bearer(advisorToken)).send({ question: `Editado ${stamp}?` }).expect(200);
    // PUBLICAR KB SIN desbloqueo → bloqueado (publicación gobernada por el candado).
    await http().post(`/api/v1/kb/${kbId}/publish`).set(bearer(advisorToken)).expect(403);

    // Crear salón SIN desbloqueo → permitido; publicarlo → bloqueado.
    const hall = await http()
      .post('/api/v1/halls')
      .set(bearer(advisorToken))
      .send({ name: `Salón asesor ${stamp}` })
      .expect((r) => {
        if (![200, 201].includes(r.status)) throw new Error(`Hall create → ${r.status}`);
      });
    await http().post(`/api/v1/halls/${hall.body.id}/publish`).set(bearer(advisorToken)).expect(403);

    // Limpieza.
    await prisma.kbArticle.deleteMany({ where: { id: kbId } });
    await prisma.hall.deleteMany({ where: { id: hall.body.id } });
  });

  it('con advisor.lock_enabled=false el asesor MUTA sin desbloqueo', async () => {
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } }); // sin ventana
    await setLock(false);
    try {
      await http()
        .patch(`/api/v1/promoters/${promoterId}/note`)
        .set(bearer(advisorToken))
        .send({ note: 'sin candado' })
        .expect(200);
    } finally {
      await setLock(true);
    }
  });

  it('status refleja el flujo: pendiente → desbloqueado tras aprobar', async () => {
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    await setLock(true);
    let st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body).toMatchObject({ lockEnabled: true, unlocked: false });

    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body.pending).toBe(true);

    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: req.body.devToken }).expect(200);
    st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body.unlocked).toBe(true);
    expect(st.body.expiresAt).toBeTruthy();
  });

  it('approve: token inválido → 404; token ya aprobado → 400', async () => {
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: 'x'.repeat(20) }).expect(404);
    const req = await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: req.body.devToken }).expect(200);
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(adminToken)).send({ token: req.body.devToken }).expect(400);
  });

  it('RBAC: request exige rol asesor (admin 403); approve exige admin (asesor 403)', async () => {
    await http().post('/api/v1/advisor/unlock/request').set(bearer(adminToken)).expect(403);
    await http().post('/api/v1/advisor/unlock/approve').set(bearer(advisorToken)).send({ token: 'y'.repeat(20) }).expect(403);
  });

  // --- Seguridad QA (verificación final) ---

  it('C-1: el asesor, AUN DESBLOQUEADO, NO puede asignar roles ni estado (@AdminOnly) → 403', async () => {
    await setLock(true);
    await unlock(); // ventana aprobada vigente
    // Escalada de privilegios: intentar auto-ascenderse a admin o tocar roles/estado ajenos.
    await http()
      .patch(`/api/v1/users/${advisorId}/roles`)
      .set(bearer(advisorToken))
      .send({ roles: ['admin'] })
      .expect(403);
    await http()
      .patch(`/api/v1/users/${promoterId}/roles`)
      .set(bearer(advisorToken))
      .send({ roles: ['admin'] })
      .expect(403);
    await http()
      .patch(`/api/v1/users/${promoterId}/status`)
      .set(bearer(advisorToken))
      .send({ status: 'inactive' })
      .expect(403);
  });

  it('C-1: ni el admin puede modificar SUS PROPIOS roles/estado (auto-bloqueo) → 403', async () => {
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin.toLowerCase().trim() } })).id;
    await http()
      .patch(`/api/v1/users/${adminId}/roles`)
      .set(bearer(adminToken))
      .send({ roles: ['admin', 'promoter'] })
      .expect(403);
    await http()
      .patch(`/api/v1/users/${adminId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'inactive' })
      .expect(403);
  });

  it('ESCALADA: el asesor, aun DESBLOQUEADO, NO accede a tesorería/comisiones/enumeración (@AdminOnly) → 403', async () => {
    await setLock(true);
    await unlock(); // ventana aprobada vigente
    const dummy = '00000000-0000-0000-0000-000000000000';
    // Retiros de wallet (tesorería), liquidación, tabla de comisiones y enumeración de
    // usuarios son admin-only REAL: el @AdminOnly corta ANTES del servicio → 403 (no 404).
    await http().get('/api/v1/users').set(bearer(advisorToken)).expect(403);
    await http().get(`/api/v1/users/${dummy}`).set(bearer(advisorToken)).expect(403);
    await http().get('/api/v1/wallet/withdrawals/all').set(bearer(advisorToken)).expect(403);
    await http().post(`/api/v1/wallet/withdrawals/${dummy}/approve`).set(bearer(advisorToken)).expect(403);
    await http().post(`/api/v1/wallet/withdrawals/${dummy}/pay`).set(bearer(advisorToken)).send({}).expect(403);
    await http().post(`/api/v1/events/${dummy}/settlement/finalize`).set(bearer(advisorToken)).expect(403);
    await http().post('/api/v1/pricing/schedules').set(bearer(advisorToken)).send({ platformPct: 0.1 }).expect(403);
    // G1.2: LEER el historial de comisiones también es @AdminOnly (antes lo veía el asesor).
    await http().get('/api/v1/pricing/schedules').set(bearer(advisorToken)).expect(403);
  });

  it('A-1: el candado NO bloquea la bandeja de soporte del asesor (take pasa el guard → 404 por ticket inexistente, no 403)', async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } }); // sin ventana
    // Con el fix @SkipAdvisorUnlock, el guard deja pasar → el servicio responde 404
    // (ticket inexistente), NO 403 de desbloqueo. Antes del fix era 403.
    await http()
      .post(`/api/v1/support/00000000-0000-0000-0000-000000000000/take`)
      .set(bearer(advisorToken))
      .expect(404);
  });

  // --- F3: desbloqueo desde el panel admin (sin depender del correo) ---

  it('F3: GET /advisor/unlock/pending lista al asesor con solicitud pendiente (@AdminOnly; asesor 403)', async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    // Sin solicitudes: el asesor NO aparece.
    let list = await http().get('/api/v1/advisor/unlock/pending').set(bearer(adminToken)).expect(200);
    expect((list.body as Array<{ advisorId: string }>).find((r) => r.advisorId === advisorId)).toBeUndefined();
    // El asesor solicita → aparece con pending:true.
    await http().post('/api/v1/advisor/unlock/request').set(bearer(advisorToken)).expect(200);
    list = await http().get('/api/v1/advisor/unlock/pending').set(bearer(adminToken)).expect(200);
    const row = (list.body as Array<{ advisorId: string; pending: boolean; unlocked: boolean }>).find(
      (r) => r.advisorId === advisorId,
    );
    expect(row).toBeDefined();
    expect(row?.pending).toBe(true);
    expect(row?.unlocked).toBe(false);
    // Un ASESOR NO puede listar los desbloqueos (@AdminOnly) → 403.
    await http().get('/api/v1/advisor/unlock/pending').set(bearer(advisorToken)).expect(403);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
  });

  it('F3: POST /advisor/unlock/grant concede el desbloqueo directo (sin token); abre la ventana', async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    // Sin ventana: mutar área admin → 403.
    await http()
      .patch(`/api/v1/promoters/${promoterId}/note`)
      .set(bearer(advisorToken))
      .send({ note: 'antes del grant' })
      .expect(403);
    // El admin concede directamente (sin el token del correo).
    const g = await http().post(`/api/v1/advisor/unlock/grant/${advisorId}`).set(bearer(adminToken)).expect(200);
    expect(g.body).toMatchObject({ granted: true, advisorId });
    expect(g.body.expiresAt).toBeTruthy();
    // Ahora la ventana está abierta → el asesor muta.
    await http()
      .patch(`/api/v1/promoters/${promoterId}/note`)
      .set(bearer(advisorToken))
      .send({ note: 'tras el grant' })
      .expect(200);
    // El status del asesor lo refleja.
    const st = await http().get('/api/v1/advisor/unlock/status').set(bearer(advisorToken)).expect(200);
    expect(st.body.unlocked).toBe(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
  });

  it('F3: grant es @AdminOnly (asesor 403) y valida que el destino sea asesor (404)', async () => {
    // Un asesor (aunque hereda admin) NO puede conceder desbloqueos.
    await http().post(`/api/v1/advisor/unlock/grant/${advisorId}`).set(bearer(advisorToken)).expect(403);
    // Conceder a un usuario que NO es asesor (el promotor semilla) → 404.
    await http().post(`/api/v1/advisor/unlock/grant/${promoterId}`).set(bearer(adminToken)).expect(404);
  });

  it('G5.1 (auditoría 4): el asesor NO edita un KB PUBLICADO (ni su slug) sin ventana → 403; con ventana sí', async () => {
    await setLock(true);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } }); // sin ventana
    // Admin real crea + PUBLICA un artículo (queda como contenido público en vivo).
    const created = await http()
      .post('/api/v1/kb')
      .set(bearer(adminToken))
      .send({ question: `G51 ${stamp}?`, answerHtml: '<p>v1</p>' })
      .expect((r) => {
        if (![200, 201].includes(r.status)) throw new Error(`KB create → ${r.status}`);
      });
    const kbId = created.body.id as string;
    await http()
      .post(`/api/v1/kb/${kbId}/publish`)
      .set(bearer(adminToken))
      .expect((r) => {
        if (![200, 201].includes(r.status)) throw new Error(`KB publish → ${r.status}`);
      });
    // Asesor SIN ventana editando contenido PUBLICADO → 403 (antes del fix era 200 y salía en vivo).
    await http().patch(`/api/v1/kb/${kbId}`).set(bearer(advisorToken)).send({ answerHtml: '<p>editado sin permiso</p>' }).expect(403);
    // Cambiar el slug (aunque siguiera en draft) también es gobernado → 403.
    await http().patch(`/api/v1/kb/${kbId}`).set(bearer(advisorToken)).send({ slug: `secuestro-${stamp}` }).expect(403);
    // Con ventana de desbloqueo aprobada → permitido.
    await unlock();
    await http().patch(`/api/v1/kb/${kbId}`).set(bearer(advisorToken)).send({ answerHtml: '<p>editado con permiso</p>' }).expect(200);
    // Limpieza.
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
    await prisma.kbArticle.deleteMany({ where: { id: kbId } });
  });

  it('G7 (arquitecto): el asesor NO puede CANCELAR ni ELIMINAR eventos, aun DESBLOQUEADO → 403', async () => {
    await setLock(true);
    await unlock(); // ventana vigente: aun así, cancelar/eliminar es exclusivo del admin
    const event = await prisma.event.findFirstOrThrow({ where: { promoterId } });
    await http().post(`/api/v1/events/${event.id}/cancel`).set(bearer(advisorToken)).expect(403);
    await http().delete(`/api/v1/events/${event.id}`).set(bearer(advisorToken)).expect(403);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
  });

  it('G7 (arquitecto): el asesor NO puede solicitar retiros de wallet, aun DESBLOQUEADO → 403', async () => {
    await setLock(true);
    await unlock();
    await http().post('/api/v1/wallet/withdrawals').set(bearer(advisorToken)).send({ amount: 100 }).expect(403);
    await prisma.advisorUnlock.deleteMany({ where: { advisorId } });
  });
});
