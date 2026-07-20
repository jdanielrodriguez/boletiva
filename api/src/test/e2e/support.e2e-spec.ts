import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { SupportService } from '../../modules/support/support.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * T1 · Tickets de soporte. Cubre: gating (chat.enabled + premium), ciclo de vida por
 * ESTADOS (new→open→awaiting_*→resolved→closed + suspended/reopened), transiciones
 * ilegales (409), RBAC (agente vs promotor, admin-only assign), IDOR (404), notas
 * internas (invisibles al promotor), archivar (no borra), CSAT y SLA (breach + pausa).
 */
describe('Tickets de soporte (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let support: SupportService;
  let adminToken: string;
  let adminId: string;
  let promoterToken: string;
  let promoterId: string;
  let otherPromoterToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    support = app.get(SupportService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'sup-admin');
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin.toLowerCase().trim() } })).id;
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter.toLowerCase().trim() } });
    promoterId = promoter.id;
    await prisma.user.update({ where: { id: promoterId }, data: { emailVerifiedAt: new Date() } });
    promoterToken = await loginTrusted(SEED.promoter, 'sup-prom');
    const email = `supprom_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Otro' });
    await prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['buyer', 'promoter'], promoterStatus: 'approved' },
    });
    otherPromoterToken = await loginTrusted(email, 'sup-prom2');
    await setSupport(true);
  });

  afterAll(async () => {
    await setSupport(false);
    await prisma.supportMessage.deleteMany({ where: { ticket: { promoterId } } });
    await prisma.supportTicket.deleteMany({ where: { promoterId } });
    await prisma.user.deleteMany({ where: { email: { contains: `supprom_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setSupport(v: boolean) {
    await prisma.setting.upsert({
      where: { key: 'chat.enabled' },
      update: { value: v },
      create: { key: 'chat.enabled', value: v, description: 'test' },
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
    const res = await http()
      .post('/api/v1/auth/login')
      .set('X-Device-Id', deviceId)
      .send({ email, password: 'Password123' })
      .expect(200);
    return res.body.tokens.accessToken;
  }
  const open = (subject: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/v1/support/tickets').set(bearer(promoterToken)).send({ subject, message: 'hola', ...extra });

  it('soporte DESHABILITADO → 403 al abrir ticket', async () => {
    await setSupport(false);
    try {
      await open('Deshabilitado').expect(403);
    } finally {
      await setSupport(true);
    }
  });

  it('promotor abre ticket (estado new, defaults), lo lista y ve el 1er mensaje', async () => {
    const created = await open('Duda comisiones', { category: 'billing', priority: 'high' }).expect(201);
    expect(created.body.status).toBe('new');
    expect(created.body.category).toBe('billing');
    expect(created.body.priority).toBe('high');
    expect(created.body.firstResponseDueAt).toBeDefined();
    const list = await http().get('/api/v1/support/tickets').set(bearer(promoterToken)).expect(200);
    expect(list.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const msgs = await http().get(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).expect(200);
    expect(msgs.body.messages.length).toBe(1);
    expect(msgs.body.messages[0].senderRole).toBe('promoter');
  });

  it('agente toma el ticket (open+assignee) y su 1ª respuesta pasa a awaiting_promoter (SLA marca)', async () => {
    const created = await open('Otra').expect(201);
    const agentList = await http().get('/api/v1/support/tickets').set(bearer(adminToken)).expect(200);
    expect(agentList.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const taken = await http().post(`/api/v1/support/tickets/${created.body.id}/take`).set(bearer(adminToken)).expect(200);
    expect(taken.body.status).toBe('open');
    expect(taken.body.assignedToId).toBe(adminId);
    const reply = await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(adminToken)).send({ body: 'Con gusto' }).expect(201);
    expect(reply.body.senderRole).toBe('admin');
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(t.status).toBe('awaiting_promoter');
    expect(t.firstRespondedAt).not.toBeNull();
    expect(t.slaPausedAt).not.toBeNull(); // awaiting_promoter pausa el reloj
  });

  it('el promotor responde → awaiting_support (reanuda el reloj)', async () => {
    const created = await open('Ida y vuelta').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(adminToken)).send({ body: 'hola' }).expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'gracias' }).expect(201);
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(t.status).toBe('awaiting_support');
    expect(t.slaPausedAt).toBeNull();
  });

  it('notas internas: el agente las escribe, el promotor NO las ve y NO las puede escribir', async () => {
    const created = await open('Con nota').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(adminToken)).send({ body: 'nota secreta', internalNote: true }).expect(201);
    // promotor NO puede escribir nota interna
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'x', internalNote: true }).expect(403);
    const promoView = await http().get(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).expect(200);
    expect(promoView.body.messages.some((m: { body: string }) => m.body === 'nota secreta')).toBe(false);
    const agentView = await http().get(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(adminToken)).expect(200);
    expect(agentView.body.messages.some((m: { body: string }) => m.body === 'nota secreta')).toBe(true);
  });

  it('IDOR: otro promotor NO ve ni escribe en un ticket ajeno (404)', async () => {
    const created = await open('Privado').expect(201);
    await http().get(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(otherPromoterToken)).expect(404);
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(otherPromoterToken)).send({ body: 'intruso' }).expect(404);
  });

  it('resolver (agente) → resolved; el promotor califica 1..5; fuera de rango 400; ajeno 403', async () => {
    const created = await open('Resolver').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/resolve`).set(bearer(adminToken)).expect(200);
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(t.status).toBe('resolved');
    expect(t.resolvedAt).not.toBeNull();
    await http().post(`/api/v1/support/tickets/${created.body.id}/rate`).set(bearer(promoterToken)).send({ score: 6 }).expect(400);
    await http().post(`/api/v1/support/tickets/${created.body.id}/rate`).set(bearer(otherPromoterToken)).send({ score: 5 }).expect(404);
    const rated = await http().post(`/api/v1/support/tickets/${created.body.id}/rate`).set(bearer(promoterToken)).send({ score: 5 }).expect(200);
    expect(rated.body.csatScore).toBe(5);
  });

  it('el promotor responde un ticket resuelto → lo REABRE (reopened→awaiting_support)', async () => {
    const created = await open('Reabrir').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/resolve`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'aún tengo dudas' }).expect(201);
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(t.status).toBe('awaiting_support');
    expect(t.resolvedAt).toBeNull();
  });

  it('cerrar impide escribir (403); reabrir (agente) → reopened; resolver un cerrado es transición ilegal (409)', async () => {
    const created = await open('Cerrar').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/close`).set(bearer(promoterToken)).expect(200);
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'tarde' }).expect(403);
    // resolver un cerrado: transición closed→resolved no permitida → 409
    await http().post(`/api/v1/support/tickets/${created.body.id}/resolve`).set(bearer(adminToken)).expect(409);
    const reopened = await http().post(`/api/v1/support/tickets/${created.body.id}/reopen`).set(bearer(adminToken)).expect(200);
    expect(reopened.body.status).toBe('reopened');
  });

  it('suspender (agente) congela el reloj SLA; reanudar → awaiting_support', async () => {
    const created = await open('Suspender').expect(201);
    const susp = await http().post(`/api/v1/support/tickets/${created.body.id}/suspend`).set(bearer(adminToken)).expect(200);
    expect(susp.body.status).toBe('suspended');
    const st = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(st.slaPausedAt).not.toBeNull();
    const res = await http().post(`/api/v1/support/tickets/${created.body.id}/resume`).set(bearer(adminToken)).expect(200);
    expect(res.body.status).toBe('awaiting_support');
    const rt = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(rt.slaPausedAt).toBeNull();
  });

  it('RBAC: un promotor NO puede resolver/suspender/reasignar; un asesor NO puede reasignar (admin-only)', async () => {
    const created = await open('RBAC').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/resolve`).set(bearer(promoterToken)).expect(403);
    await http().post(`/api/v1/support/tickets/${created.body.id}/suspend`).set(bearer(promoterToken)).expect(403);
    await http().post(`/api/v1/support/tickets/${created.body.id}/assign`).set(bearer(promoterToken)).send({ assignedToId: adminId }).expect(403);
    // asignar a un NO agente → 403
    await http().post(`/api/v1/support/tickets/${created.body.id}/assign`).set(bearer(adminToken)).send({ assignedToId: promoterId }).expect(403);
    // admin asigna a un agente válido (él mismo) → 200
    const ok = await http().post(`/api/v1/support/tickets/${created.body.id}/assign`).set(bearer(adminToken)).send({ assignedToId: adminId }).expect(200);
    expect(ok.body.assignedToId).toBe(adminId);
  });

  it('cambiar prioridad recalcula el SLA pendiente; cambiar categoría', async () => {
    const created = await open('Prioridad', { priority: 'low' }).expect(201);
    const before = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    const up = await http().post(`/api/v1/support/tickets/${created.body.id}/priority`).set(bearer(adminToken)).send({ priority: 'urgent' }).expect(200);
    expect(up.body.priority).toBe('urgent');
    const after = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    // urgent (15 min) vence mucho antes que low (120 min)
    expect(after.firstResponseDueAt).toBeTruthy();
    expect(before.firstResponseDueAt).toBeTruthy();
    expect((after.firstResponseDueAt as Date).getTime()).toBeLessThan((before.firstResponseDueAt as Date).getTime());
    const cat = await http().post(`/api/v1/support/tickets/${created.body.id}/category`).set(bearer(adminToken)).send({ category: 'event' }).expect(200);
    expect(cat.body.category).toBe('event');
  });

  it('archivar oculta el ticket del promotor (no borra); agente lo sigue viendo; ?archived=true lo muestra', async () => {
    const created = await open('Archivar').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/archive`).set(bearer(promoterToken)).expect(200);
    const list = await http().get('/api/v1/support/tickets').set(bearer(promoterToken)).expect(200);
    expect(list.body.some((t: { id: string }) => t.id === created.body.id)).toBe(false);
    const withArchived = await http().get('/api/v1/support/tickets?archived=true').set(bearer(promoterToken)).expect(200);
    expect(withArchived.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    // el agente lo sigue viendo (no se borró)
    const agentList = await http().get('/api/v1/support/tickets').set(bearer(adminToken)).expect(200);
    expect(agentList.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const still = await prisma.supportTicket.findUnique({ where: { id: created.body.id } });
    expect(still).not.toBeNull();
  });

  it('SLA breach: vencido y corriendo → correo a agentes + marca; ya respondido/pausado → NO', async () => {
    const spy = jest.spyOn(mail, 'send').mockResolvedValue(undefined);
    try {
      // 1) Corriendo y vencido → alerta.
      const t1 = await prisma.supportTicket.create({
        data: { promoterId, subject: 'sla', status: 'new', firstResponseDueAt: new Date(Date.now() - 1000), resolveDueAt: new Date(Date.now() + 3_600_000) },
      });
      spy.mockClear();
      await support.checkSlaBreach({ ticketId: t1.id, kind: 'first_response' });
      expect(spy).toHaveBeenCalled();
      const b1 = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t1.id } });
      expect(b1.firstResponseBreachedAt).not.toBeNull();
      // idempotente: no vuelve a alertar
      spy.mockClear();
      await support.checkSlaBreach({ ticketId: t1.id, kind: 'first_response' });
      expect(spy).not.toHaveBeenCalled();

      // 2) Ya respondido → no alerta.
      const t2 = await prisma.supportTicket.create({
        data: { promoterId, subject: 'sla2', status: 'awaiting_support', firstResponseDueAt: new Date(Date.now() - 1000), firstRespondedAt: new Date() },
      });
      spy.mockClear();
      await support.checkSlaBreach({ ticketId: t2.id, kind: 'first_response' });
      expect(spy).not.toHaveBeenCalled();

      // 3) Pausado (suspendido) → no alerta.
      const t3 = await prisma.supportTicket.create({
        data: { promoterId, subject: 'sla3', status: 'suspended', firstResponseDueAt: new Date(Date.now() - 1000), slaPausedAt: new Date() },
      });
      spy.mockClear();
      await support.checkSlaBreach({ ticketId: t3.id, kind: 'first_response' });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('un comprador (no promotor, no agente) NO puede usar soporte (403)', async () => {
    const email = `supbuyer_${stamp}@test.com`;
    const res = await http().post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: 'Buyer' });
    await prisma.user.update({ where: { id: res.body.user.id }, data: { emailVerifiedAt: new Date() } });
    const token = await loginTrusted(email, 'sup-buyer');
    await http().post('/api/v1/support/tickets').set(bearer(token)).send({ subject: 'Comprador', message: 'hola' }).expect(403);
    await prisma.user.deleteMany({ where: { email } });
  });

  // --- T2: cola (filtros + keyset), macros y SLA configurable ---

  it('cola: solo agentes; filtra por sin-asignar y por estado; pagina por cursor', async () => {
    // El promotor NO accede a la cola.
    await http().get('/api/v1/support/queue').set(bearer(promoterToken)).expect(403);
    // Crea 3 tickets nuevos (sin asignar).
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await open(`Cola ${i}`).expect(201)).body.id);
    // unassigned=true los incluye.
    const unassigned = await http().get('/api/v1/support/queue?unassigned=true&status=new').set(bearer(adminToken)).expect(200);
    expect(unassigned.body.items.length).toBeGreaterThanOrEqual(3);
    expect(unassigned.body.items.every((t: { status: string }) => t.status === 'new')).toBe(true);
    // keyset: limit=2 → 2 items + nextCursor; 2ª página trae el resto.
    const p1 = await http().get('/api/v1/support/queue?unassigned=true&limit=2').set(bearer(adminToken)).expect(200);
    expect(p1.body.items.length).toBe(2);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await http().get(`/api/v1/support/queue?unassigned=true&limit=2&cursor=${p1.body.nextCursor}`).set(bearer(adminToken)).expect(200);
    const idsP1 = p1.body.items.map((t: { id: string }) => t.id);
    expect(p2.body.items.every((t: { id: string }) => !idsP1.includes(t.id))).toBe(true);
    // Al tomar uno, 'mine' del admin lo incluye.
    await http().post(`/api/v1/support/tickets/${ids[0]}/take`).set(bearer(adminToken)).expect(200);
    const mine = await http().get('/api/v1/support/queue?mine=true').set(bearer(adminToken)).expect(200);
    expect(mine.body.items.some((t: { id: string }) => t.id === ids[0])).toBe(true);
  });

  it('macros: agente crea/lista/edita/borra; el promotor NO (403)', async () => {
    await http().post('/api/v1/support/macros').set(bearer(promoterToken)).send({ title: 'x', body: 'y' }).expect(403);
    const created = await http().post('/api/v1/support/macros').set(bearer(adminToken)).send({ title: 'Saludo', body: 'Hola, reviso tu caso', lang: 'es', category: 'billing' }).expect(201);
    const list = await http().get('/api/v1/support/macros?lang=es').set(bearer(adminToken)).expect(200);
    expect(list.body.some((m: { id: string }) => m.id === created.body.id)).toBe(true);
    // filtro por idioma distinto NO lo trae
    const en = await http().get('/api/v1/support/macros?lang=en').set(bearer(adminToken)).expect(200);
    expect(en.body.some((m: { id: string }) => m.id === created.body.id)).toBe(false);
    const upd = await http().patch(`/api/v1/support/macros/${created.body.id}`).set(bearer(adminToken)).send({ body: 'Actualizado' }).expect(200);
    expect(upd.body.body).toBe('Actualizado');
    await http().delete(`/api/v1/support/macros/${created.body.id}`).set(bearer(adminToken)).expect(200);
    const gone = await http().get('/api/v1/support/macros').set(bearer(adminToken)).expect(200);
    expect(gone.body.some((m: { id: string }) => m.id === created.body.id)).toBe(false);
  });

  it('SLA configurable: el admin ajusta los objetivos y un ticket nuevo los usa; el promotor no puede ajustar', async () => {
    await http().patch('/api/v1/support/sla').set(bearer(promoterToken)).send({ targets: {} }).expect(403);
    // Ajusta urgent a 10 min de 1ª respuesta.
    const cfg = await http().patch('/api/v1/support/sla').set(bearer(adminToken)).send({ targets: { urgent: { firstResponseMins: 10 } } }).expect(200);
    expect(cfg.body.urgent.firstResponseMins).toBe(10);
    // Un ticket urgent nuevo debe vencer ~10 min después (no el default 15).
    const created = await open('SLA cfg', { priority: 'urgent' }).expect(201);
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    const mins = ((t.firstResponseDueAt as Date).getTime() - t.createdAt.getTime()) / 60_000;
    expect(Math.round(mins)).toBe(10);
    // Limpia el override para no afectar otras corridas.
    await prisma.setting.deleteMany({ where: { key: 'support.sla' } });
  });

  // --- T4: adjuntos, métricas y auto-cierre ---

  it('adjuntos: presign valida el tipo; el mensaje guarda el adjunto y se devuelve con URL firmada', async () => {
    const created = await open('Con adjunto').expect(201);
    // Tipo no permitido → 400.
    await http().post(`/api/v1/support/tickets/${created.body.id}/attachments/presign`).set(bearer(promoterToken)).send({ filename: 'x.exe', mime: 'application/x-msdownload' }).expect(400);
    // Tipo permitido → { key, uploadUrl }.
    const pre = await http().post(`/api/v1/support/tickets/${created.body.id}/attachments/presign`).set(bearer(promoterToken)).send({ filename: 'captura.png', mime: 'image/png' }).expect(200);
    expect(pre.body.key).toContain(`support/${created.body.id}/`);
    expect(typeof pre.body.uploadUrl).toBe('string');
    // Adjunto con key ajena → 400 (no puede referenciar otro ticket).
    await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'malicioso', attachments: [{ key: 'support/otro/abc.png', filename: 'a.png', mime: 'image/png', size: 10 }] }).expect(400);
    // Mensaje con adjunto válido → 201 y el historial lo muestra con URL.
    const msg = await http().post(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'aquí va', attachments: [{ key: pre.body.key, filename: 'captura.png', mime: 'image/png', size: 1234 }] }).expect(201);
    expect(msg.body.attachments.length).toBe(1);
    expect(msg.body.attachments[0].url).toContain('http');
    const hist = await http().get(`/api/v1/support/tickets/${created.body.id}/messages`).set(bearer(promoterToken)).expect(200);
    const withAtt = hist.body.messages.find((m: { attachments?: unknown[] }) => (m.attachments?.length ?? 0) > 0);
    expect(withAtt.attachments[0].filename).toBe('captura.png');
  });

  it('métricas: solo agentes; devuelve volumen por estado + SLA + CSAT', async () => {
    await http().get('/api/v1/support/metrics').set(bearer(promoterToken)).expect(403);
    const m = await http().get('/api/v1/support/metrics').set(bearer(adminToken)).expect(200);
    expect(m.body.byStatus).toBeDefined();
    expect(m.body.byCategory).toBeDefined();
    expect(m.body.slaBreach).toHaveProperty('firstResponse');
    expect(m.body.csat).toHaveProperty('avg');
    expect(typeof m.body.unassigned).toBe('number');
  });

  it('auto-cierre: cierra tickets resueltos cuya resolución superó el umbral (idempotente)', async () => {
    const created = await open('Auto cierre').expect(201);
    await http().post(`/api/v1/support/tickets/${created.body.id}/resolve`).set(bearer(adminToken)).expect(200);
    // Antigüedad artificial: resuelto hace 10 días.
    await prisma.supportTicket.update({ where: { id: created.body.id }, data: { resolvedAt: new Date(Date.now() - 10 * 24 * 3_600_000) } });
    const closed = await support.autoCloseResolved(7);
    expect(closed).toBeGreaterThanOrEqual(1);
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(t.status).toBe('closed');
    // Idempotente: una 2ª pasada no vuelve a cerrarlo.
    const again = await support.autoCloseResolved(7);
    expect(again).toBe(0);
  });
});
