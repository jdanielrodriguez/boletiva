import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * Registro de correos (email log): el admin lista con filtros + búsqueda (server-side,
 * keyset); un no-admin no accede (@AdminOnly). Verifica también que el hook de MailService
 * registra los correos con `type` (invitación de promotor) y NO los sensibles (OTP).
 */
describe('Email log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  const stamp = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    await prisma.emailLog.createMany({
      data: [
        { recipient: `a_${stamp}@test.com`, type: 'promoter_invite', subject: 'Invitación', status: 'sent', sentAt: new Date() },
        { recipient: `b_${stamp}@test.com`, type: 'notification:SUPPORT_ACTIVITY', subject: 'Nuevo ticket', status: 'queued' },
        { recipient: `mal_${stamp}`, type: 'promoter_invite', subject: 'Fallida', status: 'failed', error: 'invalid_address' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.emailLog.deleteMany({ where: { subject: { in: ['Invitación', 'Nuevo ticket', 'Fallida'] } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('admin lista el registro; keyset { items, nextCursor }', async () => {
    const res = await http().get('/api/v1/admin/email-log').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect('nextCursor' in res.body).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it('filtra por estado y por búsqueda de destinatario (server-side)', async () => {
    const failed = await http().get('/api/v1/admin/email-log?status=failed').set(bearer(adminToken)).expect(200);
    expect(failed.body.items.every((r: { status: string }) => r.status === 'failed')).toBe(true);

    const byRecipient = await http()
      .get(`/api/v1/admin/email-log?search=a_${stamp}`)
      .set(bearer(adminToken))
      .expect(200);
    expect(byRecipient.body.items.some((r: { recipient: string }) => r.recipient === `a_${stamp}@test.com`)).toBe(true);

    const byType = await http()
      .get('/api/v1/admin/email-log?type=promoter_invite')
      .set(bearer(adminToken))
      .expect(200);
    expect(byType.body.items.every((r: { type: string }) => r.type.includes('promoter_invite'))).toBe(true);
  });

  it('un no-admin (promotor) NO accede al registro → 403', async () => {
    await http().get('/api/v1/admin/email-log').set(bearer(promoterToken)).expect(403);
  });

  it('MailService registra los correos con type y NO los sensibles: invitar promotor deja rastro', async () => {
    const email = `inv_${stamp}@test.com`;
    await http()
      .post('/api/v1/promoters/invitations')
      .set(bearer(adminToken))
      .send({ emails: [email] })
      .expect((r) => {
        if (![200, 201].includes(r.status)) throw new Error(`invite → ${r.status}`);
      });
    // El correo de invitación (type 'promoter_invite') quedó registrado.
    const log = await prisma.emailLog.findFirst({ where: { recipient: email, type: 'promoter_invite' } });
    expect(log).not.toBeNull();
    // No hay registros de OTP/verificación (esos NO pasan `type` → no se loggean nunca).
    const otp = await prisma.emailLog.findFirst({ where: { type: { contains: 'otp' } } });
    expect(otp).toBeNull();
    await prisma.emailLog.deleteMany({ where: { recipient: email } });
    await prisma.promoterInvitation.deleteMany({ where: { email } });
  });
});
