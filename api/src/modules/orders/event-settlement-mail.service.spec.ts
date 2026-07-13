import { EventSettlementMailService } from './event-settlement-mail.service';

/**
 * F4 (v3.11) — Estado de cuentas al promotor al finalizar el evento. Cubre: el
 * filtrado de la cola MAIL compartida, promotor inexistente (no envía), el resumen
 * con los montos del settlement y el idioma del destinatario (F3).
 */
describe('EventSettlementMailService (F4)', () => {
  const summary = {
    eventId: 'e1',
    eventName: 'Gran Show',
    currency: 'GTQ',
    paidOrders: 3,
    ticketsSold: 3,
    gross: '389.04',
    net: '200.00',
    platformFee: '30.00',
    gatewayFee: '19.44',
    fixedFees: '6.00',
    serviceFee: '55.44',
    iva: '39.60',
    refundsIssued: '100.00',
  };

  const make = (user: unknown) => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const mail = { sendTemplated: jest.fn().mockResolvedValue(undefined) };
    const queue = { registerHandler: jest.fn() };
    const settlement = { summaryForEvent: jest.fn().mockResolvedValue(summary) };
    const service = new EventSettlementMailService(
      prisma as never,
      mail as never,
      queue as never,
      settlement as never,
    );
    return { service, prisma, mail, queue, settlement };
  };

  const job = { eventId: 'e1', promoterId: 'p1', transferred: '200.00' };

  it('onModuleInit registra el handler en la cola MAIL', () => {
    const { service, queue } = make(null);
    service.onModuleInit();
    expect(queue.registerHandler).toHaveBeenCalledWith('mail', expect.any(Function));
  });

  it('handle ignora jobs ajenos (otro nombre)', async () => {
    const { service, queue, settlement } = make({ email: 'p@x.com', firstName: 'Pro', language: 'es' });
    service.onModuleInit();
    const handler = queue.registerHandler.mock.calls[0][1] as (n: string, d: unknown) => Promise<void>;
    await handler('order-confirmation', job);
    expect(settlement.summaryForEvent).not.toHaveBeenCalled();
  });

  it('promotor inexistente → no envía ni lanza', async () => {
    const { service, mail } = make(null);
    await expect(service.send(job)).resolves.toBeUndefined();
    expect(mail.sendTemplated).not.toHaveBeenCalled();
  });

  it('envía el estado de cuentas (es) con montos del settlement + transferido', async () => {
    const { service, mail } = make({ email: 'p@x.com', firstName: 'Pro', language: 'es' });
    await service.send(job);
    expect(mail.sendTemplated).toHaveBeenCalledTimes(1);
    const [to, subject, input] = mail.sendTemplated.mock.calls[0];
    expect(to).toBe('p@x.com');
    expect(subject).toContain('Gran Show');
    expect(input.title).toContain('estado de cuentas');
    // Montos del settlement + devoluciones + transferido.
    expect(input.bodyHtml).toContain('Q389.04'); // bruto
    expect(input.bodyHtml).toContain('Q200.00'); // neto / transferido
    expect(input.bodyHtml).toContain('Q100.00'); // devoluciones
    // Notifica el próximo paso (pago al promotor).
    expect(input.bodyHtml).toContain('pago al promotor');
    expect(input.bodyText).toContain('Q200.00');
  });

  it('F3: promotor con language="en" → correo en inglés', async () => {
    const { service, mail } = make({ email: 'en@x.com', firstName: 'Sam', language: 'en' });
    await service.send(job);
    const [, subject, input] = mail.sendTemplated.mock.calls[0];
    expect(subject).toContain('Account statement');
    expect(input.title).toContain('account statement');
    expect(input.bodyHtml).toContain('promoter payout');
  });
});
