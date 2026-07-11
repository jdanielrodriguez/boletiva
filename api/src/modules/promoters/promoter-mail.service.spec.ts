import { PromoterMailService, PromoterMailStatus } from './promoter-mail.service';

/**
 * Correos del ciclo de autorización de promotores. Cubre los bordes que no ejerce
 * el flujo e2e: usuario inexistente (job huérfano → no envía), filtrado de la cola
 * MAIL compartida (ignora jobs ajenos / sin datos) y el asunto de CADA estado.
 */
describe('PromoterMailService (estados y bordes)', () => {
  const makeService = (user: unknown) => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const mail = { sendTemplated: jest.fn().mockResolvedValue(undefined) };
    const queue = { registerHandler: jest.fn() };
    const service = new PromoterMailService(
      prisma as never,
      mail as never,
      queue as never,
    );
    return { service, prisma, mail, queue };
  };

  const getHandler = (service: PromoterMailService, queue: { registerHandler: jest.Mock }) => {
    service.onModuleInit();
    return queue.registerHandler.mock.calls[0][1] as (name: string, data: unknown) => Promise<void>;
  };

  it('usuario inexistente → no envía correo ni lanza (job huérfano)', async () => {
    const { service, mail } = makeService(null);
    await expect(
      service.sendStatus({ userId: 'missing', status: 'approved' }),
    ).resolves.toBeUndefined();
    expect(mail.sendTemplated).not.toHaveBeenCalled();
  });

  it('handle ignora jobs de otra procedencia (nombre distinto)', async () => {
    const { service, prisma, queue } = makeService({ email: 'a@b.com', firstName: 'A' });
    const handler = getHandler(service, queue);
    await handler('order-confirmation', { userId: 'x', status: 'approved' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('handle promoter-status sin userId/status → no consulta ni envía', async () => {
    const { service, prisma, queue } = makeService({ email: 'a@b.com', firstName: 'A' });
    const handler = getHandler(service, queue);
    await handler('promoter-status', {}); // falta userId y status
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  const cases: Array<{ status: PromoterMailStatus; subject: RegExp }> = [
    { status: 'pending', subject: /Recibimos tu solicitud/i },
    { status: 'approved', subject: /aprobada/i },
    { status: 'rejected', subject: /Sobre tu solicitud/i },
    { status: 'suspended', subject: /suspendida/i },
  ];

  it.each(cases)('estado %s → asunto correcto y correo al usuario', async ({ status, subject }) => {
    const { service, mail } = makeService({ email: 'prom@test.com', firstName: 'Pro' });
    await service.sendStatus({ userId: 'u1', status });
    expect(mail.sendTemplated).toHaveBeenCalledTimes(1);
    const [to, sentSubject] = mail.sendTemplated.mock.calls[0];
    expect(to).toBe('prom@test.com');
    expect(sentSubject).toMatch(subject);
  });

  it('la nota del equipo se incluye (escapada) en approved/rejected/suspended', async () => {
    const { service, mail } = makeService({ email: 'prom@test.com', firstName: 'Pro' });
    await service.sendStatus({ userId: 'u1', status: 'rejected', note: 'faltan <docs>' });
    const input = mail.sendTemplated.mock.calls[0][2];
    expect(input.bodyHtml).toContain('faltan &lt;docs&gt;');
  });
});
