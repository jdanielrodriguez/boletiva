import { TicketMailService } from './ticket-mail.service';

/**
 * Correo de confirmación de compra. Cubre los bordes que no ejerce el flujo e2e:
 * orden inexistente (job huérfano → no envía, no lanza) y el filtrado de la cola
 * MAIL compartida (ignora jobs ajenos). El happy path lo cubre el e2e de tickets.
 */
describe('TicketMailService (bordes)', () => {
  const makeService = (order: unknown) => {
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
    const mail = { sendTemplated: jest.fn().mockResolvedValue(undefined) };
    const queue = { registerHandler: jest.fn() };
    const service = new TicketMailService(
      prisma as never,
      mail as never,
      queue as never,
    );
    return { service, prisma, mail, queue };
  };

  it('orden inexistente → no envía correo ni lanza (job huérfano)', async () => {
    const { service, mail } = makeService(null);
    await expect(service.sendOrderConfirmation('missing-id')).resolves.toBeUndefined();
    expect(mail.sendTemplated).not.toHaveBeenCalled();
  });

  it('onModuleInit registra el handler en la cola MAIL', () => {
    const { service, queue } = makeService(null);
    service.onModuleInit();
    expect(queue.registerHandler).toHaveBeenCalledWith('mail', expect.any(Function));
  });

  it('handle ignora jobs ajenos (otro nombre) sin consultar la orden', async () => {
    const { service, prisma, queue } = makeService(null);
    service.onModuleInit();
    const handler = queue.registerHandler.mock.calls[0][1] as (
      name: string,
      data: unknown,
    ) => Promise<void>;
    await handler('promoter-status', { userId: 'x' });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('handle order-confirmation con orden válida → envía correo con serial y total', async () => {
    const order = {
      total: { toFixed: (n: number) => (123.45).toFixed(n) },
      buyer: { email: 'buyer@test.com', firstName: 'Ana' },
      event: { name: 'Concierto <b>', startsAt: new Date() },
      tickets: [{ serial: 'PE1.abc.def' }],
    };
    const { service, mail, queue } = makeService(order);
    service.onModuleInit();
    const handler = queue.registerHandler.mock.calls[0][1] as (
      name: string,
      data: unknown,
    ) => Promise<void>;
    await handler('order-confirmation', { orderId: 'o1' });
    expect(mail.sendTemplated).toHaveBeenCalledTimes(1);
    const [to, subject, input] = mail.sendTemplated.mock.calls[0];
    expect(to).toBe('buyer@test.com');
    expect(subject).toContain('Concierto');
    // El nombre del evento va escapado en el HTML (anti-inyección).
    expect(input.bodyHtml).toContain('Concierto &lt;b&gt;');
    expect(input.bodyHtml).toContain('PE1.abc.def');
    expect(input.bodyText).toContain('PE1.abc.def');
  });
});
