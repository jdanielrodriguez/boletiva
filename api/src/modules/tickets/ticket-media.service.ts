import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { EncryptionService } from '../../infra/crypto/encryption.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { TicketCryptoService } from './ticket-crypto.service';

/** Paleta de marca del PDF (coincide con la plantilla de correo). */
const INK = '#1a1a2e';
const BRAND = '#7c3aed';
const MUTED = '#6b6b76';
const LINE = '#e6e6ea';
const DANGER = '#c0392b';

/** Plan de render del boleto según su estado (puro y testeable). */
export interface TicketPdfPlan {
  /** El QR solo es visible/embebido si el boleto está vigente. */
  qrVisible: boolean;
  /** Etiqueta de estado que se muestra cuando el QR va oculto. */
  statusLabel: string;
}

/**
 * Generación de media del boleto (QR PNG + PDF con diseño de boleto) como job de la
 * cola MEDIA — trabajo pesado fuera del camino crítico del pago (condición del
 * arquitecto). Sube ambos objetos al storage y marca el boleto como listo.
 *
 * El PDF luce como un boleto (marca, datos del evento en hora de Guatemala,
 * localidad/asiento, comprador y serial) con el banner del evento arriba y una zona
 * de QR destacada. Cuando el QR va OCULTO (boleto usado/transferido/anulado) esa
 * zona muestra el banner del evento completo con la etiqueta de estado. El QR
 * embebido es una instantánea del valor rotativo; la validación dinámica vive en la
 * app (`GET /tickets/:id/qr`) y, offline, en el manifiesto SafeTix.
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

  /** Decide qué mostrar según el estado del boleto (puro). */
  static planFor(status: TicketStatus): TicketPdfPlan {
    switch (status) {
      case TicketStatus.valid:
        return { qrVisible: true, statusLabel: 'Válido' };
      case TicketStatus.used:
        return { qrVisible: false, statusLabel: 'Boleto ya utilizado' };
      case TicketStatus.transferred:
        return { qrVisible: false, statusLabel: 'Boleto transferido' };
      case TicketStatus.revoked:
      default:
        return { qrVisible: false, statusLabel: 'Boleto anulado' };
    }
  }

  /** Genera QR PNG + PDF y los sube al storage; idempotente por boleto. */
  async generate(ticketId: string): Promise<void> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          select: {
            name: true,
            startsAt: true,
            address: true,
            media: {
              where: { kind: 'cover' as const },
              orderBy: { position: 'asc' as const },
              take: 1,
              select: { key: true },
            },
          },
        },
        seat: { select: { label: true, section: true, row: true } },
        locality: { select: { name: true } },
        owner: { select: { firstName: true, lastName: true, email: true } },
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

    const plan = TicketMediaService.planFor(ticket.status);
    const bannerKey = ticket.event.media?.[0]?.key ?? null;
    const banner = bannerKey ? await this.loadBanner(bannerKey) : null;

    const base = `tickets/${ticket.eventId}/${ticket.id}`;
    const qrKey = `${base}/qr.png`;
    const pdfKey = `${base}/ticket.pdf`;

    const buyer =
      [ticket.owner.firstName, ticket.owner.lastName].filter(Boolean).join(' ').trim() ||
      ticket.owner.email;

    const pdf = await this.buildPdf({
      eventName: ticket.event.name,
      startsAt: ticket.event.startsAt,
      address: ticket.event.address,
      localityName: ticket.locality?.name ?? null,
      seatLabel: ticket.seat?.label ?? 'Admisión general',
      buyer,
      serial: ticket.serial,
      qrPng,
      banner,
      plan,
    });

    // El QR PNG independiente se sube siempre (contrato de `GET /tickets/:id/media`).
    await this.storage.putObject(qrKey, qrPng, 'image/png');
    await this.storage.putObject(pdfKey, pdf, 'application/pdf');
    await this.prisma.ticket.update({
      where: { id: ticket.id },
      data: { qrKey, pdfKey, mediaReadyAt: new Date() },
    });
  }

  /** Descarga el banner del evento; degrada a null ante cualquier fallo. */
  private async loadBanner(key: string): Promise<Buffer | null> {
    try {
      return await this.storage.getObject(key);
    } catch (err) {
      this.logger.warn(`No se pudo cargar el banner ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Fecha/hora en zona horaria de Guatemala, legible en español. */
  private formatGt(d: Date): string {
    const fmt = new Intl.DateTimeFormat('es-GT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Guatemala',
    });
    return `${fmt.format(d)} (hora de Guatemala)`;
  }

  private buildPdf(t: {
    eventName: string;
    startsAt: Date;
    address: string | null;
    localityName: string | null;
    seatLabel: string;
    buyer: string;
    serial: string;
    qrPng: Buffer;
    banner: Buffer | null;
    plan: TicketPdfPlan;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const M = 48; // margen del contenido
      const heroH = 190;

      // --- Hero / banner arriba ---------------------------------------------
      if (t.banner) {
        try {
          // `cover` no recorta el desborde por sí solo → clip al rectángulo del hero.
          doc.save();
          doc.rect(0, 0, pageW, heroH).clip();
          doc.image(t.banner, 0, 0, { cover: [pageW, heroH], align: 'center', valign: 'center' });
          doc.restore();
        } catch {
          doc.rect(0, 0, pageW, heroH).fill(INK);
        }
        // Velo oscuro para legibilidad del wordmark sobre la foto.
        doc.save().rect(0, 0, pageW, heroH).fillOpacity(0.5).fill('#000000').restore();
      } else {
        doc.rect(0, 0, pageW, heroH).fill(INK);
      }
      // Wordmark de marca sobre el hero.
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(26)
        .text('pasa', M, heroH - 52, { continued: true })
        .fillColor('#c4b5fd')
        .text('eventos');
      doc
        .fillColor('#ffffff')
        .font('Helvetica')
        .fontSize(11)
        .text('Boleto electrónico', M, heroH - 20);
      // Banda de acento bajo el hero.
      doc.rect(0, heroH, pageW, 5).fill(BRAND);

      // --- Nombre del evento -------------------------------------------------
      let y = heroH + 28;
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(24)
        .text(t.eventName, M, y, { width: pageW - M * 2 });
      y = doc.y + 14;

      // --- Datos del evento --------------------------------------------------
      const rows: Array<[string, string]> = [
        ['Fecha y hora', this.formatGt(t.startsAt)],
      ];
      if (t.address) rows.push(['Lugar', t.address]);
      rows.push(['Localidad', t.localityName ?? '—']);
      rows.push(['Asiento', t.seatLabel]);
      rows.push(['Comprador', t.buyer]);

      for (const [label, value] of rows) {
        doc
          .fillColor(MUTED)
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(label.toUpperCase(), M, y, { characterSpacing: 0.5 });
        doc
          .fillColor(INK)
          .font('Helvetica')
          .fontSize(13)
          .text(value, M, doc.y + 2, { width: pageW - M * 2 });
        y = doc.y + 12;
      }

      // Serial destacado.
      doc.moveTo(M, y).lineTo(pageW - M, y).lineWidth(1).strokeColor(LINE).stroke();
      y += 14;
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('SERIAL', M, y, { characterSpacing: 0.5 });
      doc.fillColor(INK).font('Courier-Bold').fontSize(15).text(t.serial, M, doc.y + 2);
      y = doc.y + 20;

      // --- Zona de QR (o banner si el QR va oculto) --------------------------
      const boxSize = 210;
      const boxX = (pageW - boxSize) / 2;
      const boxY = y;
      doc
        .roundedRect(boxX, boxY, boxSize, boxSize, 12)
        .lineWidth(1.5)
        .strokeColor(LINE)
        .stroke();

      if (t.plan.qrVisible) {
        const qrSize = 176;
        try {
          doc.image(t.qrPng, boxX + (boxSize - qrSize) / 2, boxY + (boxSize - qrSize) / 2, {
            fit: [qrSize, qrSize],
          });
        } catch {
          /* si el QR fallara, se deja el recuadro vacío */
        }
        doc
          .fillColor('#1e874b')
          .font('Helvetica-Bold')
          .fontSize(12)
          .text('Código válido — se refresca cada 30s', M, boxY + boxSize + 12, {
            width: pageW - M * 2,
            align: 'center',
          });
      } else {
        // QR oculto → banner del evento completo dentro del recuadro (o marca).
        if (t.banner) {
          try {
            doc.save();
            doc.roundedRect(boxX + 1, boxY + 1, boxSize - 2, boxSize - 2, 11).clip();
            doc.image(t.banner, boxX, boxY, {
              cover: [boxSize, boxSize],
              align: 'center',
              valign: 'center',
            });
            doc.restore();
          } catch {
            doc.roundedRect(boxX + 1, boxY + 1, boxSize - 2, boxSize - 2, 11).fill(INK);
          }
        } else {
          doc.roundedRect(boxX + 1, boxY + 1, boxSize - 2, boxSize - 2, 11).fill(INK);
        }
        doc
          .fillColor(DANGER)
          .font('Helvetica-Bold')
          .fontSize(13)
          .text(t.plan.statusLabel, M, boxY + boxSize + 12, {
            width: pageW - M * 2,
            align: 'center',
          });
      }

      // --- Pie ---------------------------------------------------------------
      const footY = doc.page.height - 56;
      doc.moveTo(M, footY - 12).lineTo(pageW - M, footY - 12).lineWidth(1).strokeColor(LINE).stroke();
      doc
        .fillColor(MUTED)
        .font('Helvetica')
        .fontSize(9)
        .text(
          'El código QR es dinámico (rota cada 30s): un screenshot no sirve. Presenta el boleto desde la app para validarlo en puerta.',
          M,
          footY,
          { width: pageW - M * 2, align: 'center' },
        );

      doc.end();
    });
  }
}
