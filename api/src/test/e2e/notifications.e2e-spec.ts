import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { EventRemindersService } from '../../modules/notifications/event-reminders.service';
import { PromotersService } from '../../modules/promoters/promoters.service';
import { NotificationType } from '../../modules/notifications/notification.types';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * T5 · Notificaciones. Cubre: emisión + listado + no-leídos + marcar leído/todo, IDOR,
 * preferencias (canal in-app OFF no crea), envío del admin (a uno / a todos / RBAC /
 * 404), y disparadores (promotor aprobado; recordatorio de evento por empezar idempotente).
 */
describe('Notificaciones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let reminders: EventRemindersService;
  let promoters: PromotersService;
  let adminToken: string;
  let promoterToken: string;
  let promoterId: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    reminders = app.get(EventRemindersService);
    promoters = app.get(PromotersService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'notif-admin');
    const p = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter.toLowerCase().trim() } });
    promoterId = p.id;
    await prisma.user.update({ where: { id: promoterId }, data: { emailVerifiedAt: new Date() } });
    promoterToken = await loginTrusted(SEED.promoter, 'notif-prom');
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: promoterId } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
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

  it('emitir → aparece en la lista, cuenta no-leídos, marcar leído y marcar todo', async () => {
    await notifications.emit(promoterId, { type: 'test_x', title: 'Hola', body: 'mundo' });
    const list = await http().get('/api/v1/notifications').set(bearer(promoterToken)).expect(200);
    const mine = list.body.items.find((n: { title: string }) => n.title === 'Hola');
    expect(mine).toBeTruthy();
    const unread = await http().get('/api/v1/notifications/unread-count').set(bearer(promoterToken)).expect(200);
    expect(unread.body.count).toBeGreaterThanOrEqual(1);
    const read = await http().post(`/api/v1/notifications/read/${mine.id}`).set(bearer(promoterToken)).expect(200);
    expect(read.body.ok).toBe(true);
    await http().post('/api/v1/notifications/read-all').set(bearer(promoterToken)).expect(200);
    const after = await http().get('/api/v1/notifications/unread-count').set(bearer(promoterToken)).expect(200);
    expect(after.body.count).toBe(0);
  });

  it('IDOR: no puedo marcar leída una notificación ajena (404)', async () => {
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin.toLowerCase().trim() } });
    await notifications.emit(adminUser.id, { type: 'test_x', title: 'Del admin' });
    const adminNotif = await prisma.notification.findFirstOrThrow({ where: { userId: adminUser.id, title: 'Del admin' } });
    await http().post(`/api/v1/notifications/read/${adminNotif.id}`).set(bearer(promoterToken)).expect(404);
    await prisma.notification.deleteMany({ where: { userId: adminUser.id, title: 'Del admin' } });
  });

  it('preferencias: canal in-app OFF para un tipo → emit NO crea la notificación', async () => {
    await http().patch('/api/v1/notifications/preferences').set(bearer(promoterToken)).send({ type: 'muted_type', channel: 'inapp', enabled: false }).expect(200);
    await notifications.emit(promoterId, { type: 'muted_type', title: 'No debería verse' });
    const exists = await prisma.notification.findFirst({ where: { userId: promoterId, type: 'muted_type' } });
    expect(exists).toBeNull();
  });

  it('envío del admin: a un promotor (201), a todos, RBAC (promotor 403) y 404', async () => {
    await http().post('/api/v1/notifications/admin/send').set(bearer(promoterToken)).send({ promoterId, title: 'x', body: 'y' }).expect(403);
    const one = await http().post('/api/v1/notifications/admin/send').set(bearer(adminToken)).send({ promoterId, title: 'Aviso', body: 'Para ti' }).expect(201);
    expect(one.body.sent).toBe(1);
    const all = await http().post('/api/v1/notifications/admin/send').set(bearer(adminToken)).send({ all: true, title: 'Global', body: 'A todos' }).expect(201);
    expect(all.body.sent).toBeGreaterThanOrEqual(1);
    await http().post('/api/v1/notifications/admin/send').set(bearer(adminToken)).send({ promoterId: '11111111-1111-4111-8111-111111111111', title: 'Prueba', body: 'y' }).expect(404);
  });

  it('disparador: aprobar a un promotor genera notificación PROMOTER_APPROVED', async () => {
    const email = `notifapprove_${stamp}@test.com`;
    const res = await http().post('/api/v1/auth/signup').send({ email, password: 'Password123', firstName: 'Aprob' });
    const uid = res.body.user.id;
    await prisma.user.update({ where: { id: uid }, data: { emailVerifiedAt: new Date(), promoterStatus: 'pending' } });
    await promoters.approve(uid);
    const n = await prisma.notification.findFirst({ where: { userId: uid, type: NotificationType.PROMOTER_APPROVED } });
    expect(n).toBeTruthy();
    await prisma.notification.deleteMany({ where: { userId: uid } });
    await prisma.user.deleteMany({ where: { email } });
  });

  it('disparador: recordatorio de evento por empezar (idempotente)', async () => {
    const cat = await prisma.category.findFirst();
    const ev = await prisma.event.create({
      data: {
        promoterId,
        name: `Evento recordatorio ${stamp}`,
        slug: `ev-rem-${stamp}`,
        status: 'published',
        startsAt: new Date(Date.now() + 2 * 3_600_000),
        endsAt: new Date(Date.now() + 5 * 3_600_000),
        categoryId: cat?.id ?? null,
      },
    });
    const sent1 = await reminders.runReminders();
    expect(sent1).toBeGreaterThanOrEqual(1);
    const n = await prisma.notification.findFirst({ where: { userId: promoterId, type: NotificationType.EVENT_STARTING, resourceId: ev.id } });
    expect(n).toBeTruthy();
    // Idempotente: 2ª pasada no vuelve a notificar ESTE evento.
    const before = await prisma.notification.count({ where: { type: NotificationType.EVENT_STARTING, resourceId: ev.id } });
    await reminders.runReminders();
    const afterCount = await prisma.notification.count({ where: { type: NotificationType.EVENT_STARTING, resourceId: ev.id } });
    expect(afterCount).toBe(before);
    await prisma.event.deleteMany({ where: { id: ev.id } });
  });
});
