import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { ChatService } from '../../modules/chat/chat.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * B3 · Chat de soporte. Cubre: gating (chat.enabled + premium), apertura de hilo,
 * historial, respuesta de agente (marca respondido), acceso/IDOR, cierre, reasignación
 * admin y el fallback por correo (respondido → NO envía; sin responder → envía).
 */
describe('Chat de soporte (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let chatService: ChatService;
  let adminToken: string;
  let promoterToken: string;
  let promoterId: string;
  let otherPromoterToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    chatService = app.get(ChatService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'chat-admin');
    // Promotor seed (aprobado) verificado.
    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter.toLowerCase().trim() } });
    promoterId = promoter.id;
    await prisma.user.update({ where: { id: promoterId }, data: { emailVerifiedAt: new Date() } });
    promoterToken = await loginTrusted(SEED.promoter, 'chat-prom');
    // Segundo promotor (para IDOR).
    const email = `chatprom_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: 'Otro' });
    await prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), roles: ['buyer', 'promoter'], promoterStatus: 'approved' },
    });
    otherPromoterToken = await loginTrusted(email, 'chat-prom2');
    await setChat(true);
  });

  afterAll(async () => {
    await setChat(false);
    await prisma.chatMessage.deleteMany({ where: { thread: { promoterId } } });
    await prisma.chatThread.deleteMany({ where: { promoterId } });
    await prisma.user.deleteMany({ where: { email: { contains: `chatprom_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setChat(v: boolean) {
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
    const res = await http().post('/api/v1/auth/login').set('X-Device-Id', deviceId).send({ email, password: 'Password123' }).expect(200);
    return res.body.tokens.accessToken;
  }

  it('chat DESHABILITADO → 403 al abrir hilo', async () => {
    await setChat(false);
    try {
      await http()
        .post('/api/v1/chat/threads')
        .set(bearer(promoterToken))
        .send({ subject: 'Deshabilitado', message: 'hola' })
        .expect(403);
    } finally {
      await setChat(true);
    }
  });

  it('promotor premium abre hilo, lo lista y ve el primer mensaje', async () => {
    const created = await http().post('/api/v1/chat/threads').set(bearer(promoterToken)).send({ subject: 'Duda comisiones', message: 'Hola' }).expect(201);
    expect(created.body.status).toBe('open');
    expect(created.body.answered).toBe(false);
    const list = await http().get('/api/v1/chat/threads').set(bearer(promoterToken)).expect(200);
    expect(list.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const msgs = await http().get(`/api/v1/chat/threads/${created.body.id}/messages`).set(bearer(promoterToken)).expect(200);
    expect(msgs.body.messages.length).toBe(1);
    expect(msgs.body.messages[0].body).toBe('Hola');
    expect(msgs.body.messages[0].senderRole).toBe('promoter');
  });

  it('agente responde → el hilo queda respondido; el agente ve todos los hilos', async () => {
    const created = await http().post('/api/v1/chat/threads').set(bearer(promoterToken)).send({ subject: 'Otra', message: '¿Cómo cobro?' }).expect(201);
    // El admin (agente) ve el hilo aunque no sea suyo.
    const agentList = await http().get('/api/v1/chat/threads').set(bearer(adminToken)).expect(200);
    expect(agentList.body.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const reply = await http().post(`/api/v1/chat/threads/${created.body.id}/messages`).set(bearer(adminToken)).send({ body: 'Con gusto te explico' }).expect(201);
    expect(reply.body.senderRole).toBe('admin');
    const msgs = await http().get(`/api/v1/chat/threads/${created.body.id}/messages`).set(bearer(promoterToken)).expect(200);
    expect(msgs.body.thread.answered).toBe(true);
    expect(msgs.body.messages.length).toBe(2);
  });

  it('IDOR: otro promotor NO ve ni escribe en un hilo ajeno (404)', async () => {
    const created = await http().post('/api/v1/chat/threads').set(bearer(promoterToken)).send({ subject: 'Privado', message: 'secreto' }).expect(201);
    await http().get(`/api/v1/chat/threads/${created.body.id}/messages`).set(bearer(otherPromoterToken)).expect(404);
    await http().post(`/api/v1/chat/threads/${created.body.id}/messages`).set(bearer(otherPromoterToken)).send({ body: 'intruso' }).expect(404);
  });

  it('cerrar un hilo impide escribir; el admin reasigna (handoff)', async () => {
    const created = await http().post('/api/v1/chat/threads').set(bearer(promoterToken)).send({ subject: 'Cerrar', message: 'hola' }).expect(201);
    await http().post(`/api/v1/chat/threads/${created.body.id}/close`).set(bearer(promoterToken)).expect(200);
    await http().post(`/api/v1/chat/threads/${created.body.id}/messages`).set(bearer(promoterToken)).send({ body: 'tarde' }).expect(403);
    // Admin reasigna a sí mismo (agente válido).
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin.toLowerCase().trim() } })).id;
    const assigned = await http().post(`/api/v1/chat/threads/${created.body.id}/assign`).set(bearer(adminToken)).send({ assignedToId: adminId }).expect(200);
    expect(assigned.body.assignedToId).toBe(adminId);
  });

  it('fallback: hilo respondido NO dispara correo; sin responder SÍ', async () => {
    const spy = jest.spyOn(mail, 'send').mockResolvedValue(undefined);
    try {
      // Sin responder → envía a los admins.
      const t1 = await prisma.chatThread.create({ data: { promoterId, subject: 'sin responder', answered: false } });
      spy.mockClear();
      await chatService.emailFallback(t1.id);
      expect(spy).toHaveBeenCalled();
      // Respondido → NO envía.
      const t2 = await prisma.chatThread.create({ data: { promoterId, subject: 'respondido', answered: true } });
      spy.mockClear();
      await chatService.emailFallback(t2.id);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('un comprador (no promotor, no agente) NO puede usar el chat (403)', async () => {
    const email = `chatbuyer_${stamp}@test.com`;
    const res = await http().post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: 'Buyer' });
    await prisma.user.update({ where: { id: res.body.user.id }, data: { emailVerifiedAt: new Date() } });
    const token = await loginTrusted(email, 'chat-buyer');
    await http().post('/api/v1/chat/threads').set(bearer(token)).send({ subject: 'Comprador', message: 'hola' }).expect(403);
    await prisma.user.deleteMany({ where: { email } });
  });
});
