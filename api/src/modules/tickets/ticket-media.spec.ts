import { TicketStatus } from '@prisma/client';
import * as QRCode from 'qrcode';
import { TicketMediaService } from './ticket-media.service';

/**
 * Ola v3.8 · PDF de boleto bonito. Cubre la decisión de render (QR visible cuando
 * el boleto está vigente; banner cuando el QR va oculto) y la generación real de
 * media (QR PNG + PDF no vacíos) subida al storage, con degradación sin banner.
 */
describe('TicketMediaService (PDF de boleto)', () => {
  let pngBanner: Buffer;

  beforeAll(async () => {
    // Un PNG real para simular el banner del evento (pdfkit exige imagen válida).
    pngBanner = await QRCode.toBuffer('banner', { type: 'png', width: 64 });
  });

  function build() {
    const store: Record<string, { body: Buffer; contentType?: string }> = {};
    const storage = {
      putObject: jest.fn(async (key: string, body: Buffer, contentType?: string) => {
        store[key] = { body, contentType };
        return key;
      }),
      getObject: jest.fn(async () => pngBanner),
    };
    const prisma = {
      ticket: { findUnique: jest.fn(), update: jest.fn(async () => ({})) },
    };
    const encryption = { decrypt: jest.fn(() => 'JBSWY3DPEHPK3PXP') };
    const crypto = {
      qrPayload: (serial: string, code: string) => `PE1.${serial}.${code}`,
      rotatingCode: () => '123456',
    };
    const queue = { registerHandler: jest.fn() };
    const svc = new TicketMediaService(
      prisma as never,
      storage as never,
      encryption as never,
      crypto as never,
      queue as never,
    );
    return { svc, storage, prisma, store };
  }

  function ticket(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 't-1',
      eventId: 'ev-1',
      serial: 'PE1ABC',
      status: TicketStatus.valid,
      totpSecret: 'enc',
      mediaReadyAt: null,
      event: {
        name: 'Concierto de Prueba',
        startsAt: new Date('2027-09-01T02:00:00.000Z'), // 20:00 del 31/08 en GT
        address: 'Estadio Nacional',
        media: [],
      },
      seat: { label: 'A-12', section: 'VIP', row: 'A' },
      locality: { name: 'VIP' },
      owner: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@test.com' },
      ...overrides,
    };
  }

  it('planFor: QR visible solo cuando el boleto está vigente', () => {
    expect(TicketMediaService.planFor(TicketStatus.valid)).toEqual({
      qrVisible: true,
      statusLabel: 'Válido',
    });
    expect(TicketMediaService.planFor(TicketStatus.used).qrVisible).toBe(false);
    expect(TicketMediaService.planFor(TicketStatus.transferred).qrVisible).toBe(false);
    expect(TicketMediaService.planFor(TicketStatus.revoked).qrVisible).toBe(false);
    expect(TicketMediaService.planFor(TicketStatus.used).statusLabel).toMatch(/utilizado/i);
    expect(TicketMediaService.planFor(TicketStatus.transferred).statusLabel).toMatch(/transferido/i);
    expect(TicketMediaService.planFor(TicketStatus.revoked).statusLabel).toMatch(/anulado/i);
  });

  it('vigente sin banner: sube QR PNG + PDF no vacíos y marca la media lista', async () => {
    const { svc, storage, prisma, store } = build();
    prisma.ticket.findUnique.mockResolvedValue(ticket());

    await svc.generate('t-1');

    expect(storage.getObject).not.toHaveBeenCalled(); // sin cover no descarga banner
    const qr = store['tickets/ev-1/t-1/qr.png'];
    const pdf = store['tickets/ev-1/t-1/ticket.pdf'];
    expect(qr.contentType).toBe('image/png');
    expect(qr.body.length).toBeGreaterThan(100);
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.body.length).toBeGreaterThan(1000);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qrKey: 'tickets/ev-1/t-1/qr.png',
          pdfKey: 'tickets/ev-1/t-1/ticket.pdf',
          mediaReadyAt: expect.any(Date),
        }),
      }),
    );
  });

  it('vigente con banner: descarga el cover y genera un PDF válido con QR', async () => {
    const { svc, storage, prisma, store } = build();
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({ event: { ...ticket().event, media: [{ key: 'events/ev-1/cover.png' }] } }),
    );

    await svc.generate('t-1');

    expect(storage.getObject).toHaveBeenCalledWith('events/ev-1/cover.png');
    expect(store['tickets/ev-1/t-1/ticket.pdf'].body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('QR oculto (usado) con banner: usa el banner en lugar del QR y genera PDF', async () => {
    const { svc, storage, prisma, store } = build();
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({
        status: TicketStatus.used,
        event: { ...ticket().event, media: [{ key: 'events/ev-1/cover.png' }] },
      }),
    );

    await svc.generate('t-1');

    expect(storage.getObject).toHaveBeenCalledWith('events/ev-1/cover.png');
    expect(store['tickets/ev-1/t-1/ticket.pdf'].body.length).toBeGreaterThan(1000);
  });

  it('QR oculto sin banner: degrada con elegancia (PDF válido igualmente)', async () => {
    const { svc, prisma, store } = build();
    prisma.ticket.findUnique.mockResolvedValue(ticket({ status: TicketStatus.revoked }));

    await svc.generate('t-1');

    expect(store['tickets/ev-1/t-1/ticket.pdf'].body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('idempotente: si la media ya está lista no vuelve a generar', async () => {
    const { svc, storage, prisma } = build();
    prisma.ticket.findUnique.mockResolvedValue(ticket({ mediaReadyAt: new Date() }));

    await svc.generate('t-1');

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  it('boleto inexistente: no lanza y no sube nada', async () => {
    const { svc, storage, prisma } = build();
    prisma.ticket.findUnique.mockResolvedValue(null);

    await expect(svc.generate('nope')).resolves.toBeUndefined();
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
