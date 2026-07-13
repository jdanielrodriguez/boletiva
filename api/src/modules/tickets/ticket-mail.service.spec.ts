import { TicketMailService } from './ticket-mail.service';

/**
 * Correo de confirmación de compra (v3.10 · bonito). Cubre los bordes que no
 * ejerce el flujo e2e: orden inexistente (job huérfano → no envía, no lanza), el
 * filtrado de la cola MAIL compartida (ignora jobs ajenos) y el armado de la
 * tarjeta con banner/QR/asiento. El happy path e2e lo cubre el spec de tickets.
 */
describe('TicketMailService (bordes)', () => {
  const makeService = (order: unknown) => {
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
    const mail = { sendTemplated: jest.fn().mockResolvedValue(undefined) };
    const queue = { registerHandler: jest.fn() };
    const storage = {
      signedGetUrl: jest.fn().mockImplementation((key: string) => Promise.resolve(`https://cdn/${key}`)),
    };
    const service = new TicketMailService(
      prisma as never,
      mail as never,
      queue as never,
      storage as never,
    );
    return { service, prisma, mail, queue, storage };
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

  it('handle order-confirmation → correo con banner, QR firmado, asiento y serial', async () => {
    const order = {
      total: { toFixed: (n: number) => (123.45).toFixed(n) },
      buyer: { email: 'buyer@test.com', firstName: 'Ana' },
      event: {
        name: 'Concierto <b>',
        startsAt: new Date('2026-08-15T02:00:00.000Z'),
        address: 'Estadio Nacional',
        media: [{ key: 'events/banner.png' }],
      },
      tickets: [
        {
          serial: 'PE1.abc.def',
          qrKey: 'tickets/qr1.png',
          locality: { name: 'Platea' },
          seat: { label: 'A-12' },
        },
      ],
    };
    const { service, mail, storage, queue } = makeService(order);
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
    // Banner firmado + QR firmado presentes.
    expect(storage.signedGetUrl).toHaveBeenCalledWith('events/banner.png', expect.any(Number));
    expect(storage.signedGetUrl).toHaveBeenCalledWith('tickets/qr1.png', expect.any(Number));
    expect(input.bodyHtml).toContain('https://cdn/events/banner.png');
    expect(input.bodyHtml).toContain('https://cdn/tickets/qr1.png');
    // Localidad/asiento y serial en la tarjeta.
    expect(input.bodyHtml).toContain('Platea');
    expect(input.bodyHtml).toContain('A-12');
    expect(input.bodyHtml).toContain('PE1.abc.def');
    // Hora de Guatemala en el texto plano.
    expect(input.bodyText).toContain('hora de Guatemala');
    expect(input.bodyText).toContain('PE1.abc.def');
  });

  it('sin media/QR listos → sin imágenes, serial destacado y "Admisión general"', async () => {
    const order = {
      total: { toFixed: (n: number) => (50).toFixed(n) },
      buyer: { email: 'ga@test.com', firstName: 'Leo' },
      event: { name: 'Feria', startsAt: new Date('2026-09-01T00:00:00.000Z'), address: null, media: [] },
      tickets: [{ serial: 'PE1.ga.001', qrKey: null, locality: null, seat: null }],
    };
    const { service, mail, storage } = makeService(order);
    await service.sendOrderConfirmation('o2');
    const input = mail.sendTemplated.mock.calls[0][2];
    // No hay claves que firmar (ni banner ni QR).
    expect(storage.signedGetUrl).not.toHaveBeenCalled();
    expect(input.bodyHtml).not.toContain('<img');
    expect(input.bodyHtml).toContain('PE1.ga.001');
    expect(input.bodyHtml).toContain('Admisión general');
  });
});
