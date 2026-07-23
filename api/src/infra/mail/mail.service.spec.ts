import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';
import { QUEUES } from '../queue/queue.constants';

// Mock del módulo: createTransport es un espía (no crea transporte real).
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({})) }));
const createTransport = nodemailer.createTransport as unknown as jest.Mock;

/**
 * Selección de TRANSPORTE (config `mail.transport`): 'smtp' (default, MailHog/SMTP) vs
 * 'ses' (AWS SES vía SDK). Solo verificamos qué opciones recibe `nodemailer.createTransport`
 * en cada modo; el envío real no se ejerce aquí.
 */
describe('MailService · selección de transporte', () => {
  const baseMail = {
    region: 'us-east-1',
    host: 'mailhog',
    port: 1025,
    user: '',
    pass: '',
    secure: false,
    from: 'no-reply@boletiva.com',
  };

  function build(transport: string) {
    const config = { getOrThrow: jest.fn().mockReturnValue({ ...baseMail, transport }) };
    const prisma = {} as never;
    const queue = { registerHandler: jest.fn() };
    const svc = new MailService(config as never, prisma, queue as never);
    return { svc, queue };
  }

  beforeEach(() => createTransport.mockClear());

  it("transport='smtp' → createTransport con host/puerto (SMTP)", () => {
    const { svc, queue } = build('smtp');
    svc.onModuleInit();
    const opts = createTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.host).toBe('mailhog');
    expect(opts.port).toBe(1025);
    expect(opts.SES).toBeUndefined();
    // Registra el handler de la cola MAIL en ambos modos.
    expect(queue.registerHandler).toHaveBeenCalledWith(QUEUES.MAIL, expect.any(Function));
  });

  it("transport='ses' → createTransport con la opción SES (SDK), sin host SMTP", () => {
    const { svc } = build('ses');
    svc.onModuleInit();
    const opts = createTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.SES).toBeDefined();
    expect(opts.host).toBeUndefined();
  });
});
