import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { EncryptionService } from '../../infra/crypto/encryption.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { TicketCryptoService } from './ticket-crypto.service';

/**
 * Generación de media del boleto (QR PNG + PDF) como job de la cola MEDIA —
 * trabajo pesado fuera del camino crítico del pago (condición del arquitecto).
 * Sube ambos objetos al storage y marca el boleto como listo. El QR embebido es
 * una instantánea del valor rotativo; la validación dinámica vive en la app
 * (`GET /tickets/:id/qr`) y, offline con manifiesto, en la Ola 5.
 */
@Injectable()
export class TicketMediaService implements OnModuleInit {
  private readonly logger = new Logger(TicketMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly encryption: EncryptionService,
    private readonly crypto: TicketCryptoService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.MEDIA, (name, data) => this.handle(name, data));
  }

  private async handle(name: string, data: unknown): Promise<void> {
    const payload = data as { ticketId?: string };
    if (name === 'generate' && payload.ticketId) {
      await this.generate(payload.ticketId);
    } else {
      this.logger.warn(`Job de media no reconocido: ${name}`);
    }
  }

  /** Genera QR PNG + PDF y los sube al storage; idempotente por boleto. */
  async generate(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: { select: { name: true, startsAt: true, address: true } },
        seat: { select: { label: true, section: true, row: true } },
      },
    });
    if (!ticket) {
      this.logger.warn(`media.generate: boleto ${ticketId} inexistente`);
      return;
    }
    if (ticket.mediaReadyAt) return; // ya generado

    const secret = this.encryption.decrypt(ticket.totpSecret);
    const payload = this.crypto.qrPayload(ticket.serial, this.crypto.rotatingCode(secret));
    const qrPng = await QRCode.toBuffer(payload, { type: 'png', width: 420, margin: 1 });

    const base = `tickets/${ticket.eventId}/${ticket.id}`;
    const qrKey = `${base}/qr.png`;
    const pdfKey = `${base}/ticket.pdf`;

    const pdf = await this.buildPdf({
      eventName: ticket.event.name,
      startsAt: ticket.event.startsAt,
      address: ticket.event.address,
      serial: ticket.serial,
      seatLabel: ticket.seat?.label ?? 'Admisión general',
      qrPng,
    });

    await this.storage.putObject(qrKey, qrPng, 'image/png');
    await this.storage.putObject(pdfKey, pdf, 'application/pdf');
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { qrKey, pdfKey, mediaReadyAt: new Date() },
    });
  }

  private buildPdf(t: {
    eventName: string;
    startsAt: Date;
    address: string | null;
    serial: string;
    seatLabel: string;
    qrPng: Buffer;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(24).text('Pasa Eventos', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(18).text(t.eventName, { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(12).text(`Fecha: ${t.startsAt.toISOString()}`);
      if (t.address) doc.text(`Lugar: ${t.address}`);
      doc.text(`Localidad/Asiento: ${t.seatLabel}`);
      doc.text(`Serial: ${t.serial}`);
      doc.moveDown(1.5);
      doc.image(t.qrPng, doc.page.width / 2 - 105, doc.y, { fit: [210, 210] });
      doc.moveDown(12);
      doc
        .fontSize(9)
        .fillColor('#666')
        .text(
          'El código QR es dinámico (rota cada 30s). Presente el boleto desde la app para validación en puerta.',
          { align: 'center' },
        );
      doc.end();
    });
  }
}
