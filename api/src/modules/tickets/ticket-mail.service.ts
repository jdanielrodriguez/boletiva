import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { StorageService } from '../../infra/storage/storage.service';
import { escapeHtml } from '../../infra/mail/email-template';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';

/** URL firmada de media del correo: holgada para sobrevivir a la bandeja del cliente. */
const MAIL_MEDIA_URL_TTL = 7 * 24 * 3600;

/**
 * Correos transaccionales de boletos (handler de la cola MAIL) — envío async para
 * no bloquear el fulfillment del pago. Confirmación de compra BONITA (v3.10): banner
 * del evento + tarjeta por boleto con evento, fecha/hora GT, localidad/asiento,
 * serial y QR (imagen si la media ya está lista; si no, el serial destacado). SIN
 * iconos de acción — es un correo de referencia, la validación se hace en la app.
 */
@Injectable()
export class TicketMailService implements OnModuleInit {
  private readonly logger = new Logger(TicketMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.MAIL, (name, data) => this.handle(name, data));
  }

  private async handle(name: string, data: unknown): Promise<void> {
    const payload = data as { orderId?: string };
    // La cola MAIL la comparten varios emisores; ignora en silencio lo que no sea suyo.
    if (name === 'order-confirmation' && payload.orderId) {
      await this.sendOrderConfirmation(payload.orderId);
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

  /** URL firmada de una clave de bucket (o null si no hay clave o falla la firma). */
  private async signOrNull(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;
    try {
      return await this.storage.signedGetUrl(key, MAIL_MEDIA_URL_TTL);
    } catch (err) {
      this.logger.warn(`No se pudo firmar la media ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  async sendOrderConfirmation(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: { select: { email: true, firstName: true } },
        event: {
          select: {
            name: true,
            startsAt: true,
            address: true,
            media: { where: { kind: 'cover' }, orderBy: { position: 'asc' }, take: 1 },
          },
        },
        tickets: {
          select: {
            serial: true,
            qrKey: true,
            locality: { select: { name: true } },
            seat: { select: { label: true } },
          },
          orderBy: { serial: 'asc' },
        },
      },
    });
    if (!order) {
      this.logger.warn(`order-confirmation: orden ${orderId} inexistente`);
      return;
    }

    const eventName = escapeHtml(order.event.name);
    const dateGt = escapeHtml(this.formatGt(order.event.startsAt));
    const address = order.event.address ? escapeHtml(order.event.address) : null;
    const bannerUrl = await this.signOrNull(order.event.media[0]?.key);

    // Banner del evento (si hay), en la cabecera del cuerpo.
    const bannerHtml = bannerUrl
      ? `<img src="${escapeHtml(bannerUrl)}" alt="${eventName}" width="520" style="width:100%;max-width:520px;height:auto;border-radius:10px;display:block;margin:0 0 20px 0;" />`
      : '';

    // Una tarjeta por boleto: datos + QR (imagen si la media está lista, si no serial).
    const cards = await Promise.all(
      order.tickets.map(async (t) => {
        const qrUrl = await this.signOrNull(t.qrKey);
        const serial = escapeHtml(t.serial);
        const locality = t.locality?.name ? escapeHtml(t.locality.name) : null;
        const seat = t.seat?.label ? escapeHtml(t.seat.label) : null;
        const seatLine = [locality, seat].filter(Boolean).join(' · ') || 'Admisión general';
        const qrBlock = qrUrl
          ? `<img src="${escapeHtml(qrUrl)}" alt="Código QR del boleto ${serial}" width="150" height="150" style="width:150px;height:150px;display:block;margin:0 auto 8px auto;background:#ffffff;border-radius:8px;" />`
          : '';
        return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border:1px solid #e6e6ea;border-radius:10px;">
        <tr><td style="padding:18px 20px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div class="pe-text" style="font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:#7c3aed;margin:0 0 4px 0;">${seatLine}</div>
          ${qrBlock}
          <div class="pe-muted" style="font-size:13px;color:#6b6b76;text-align:center;margin:0;">Serial del boleto</div>
          <div class="pe-text" style="font-size:16px;font-weight:700;color:#1a1a2e;text-align:center;letter-spacing:0.5px;margin:2px 0 0 0;word-break:break-all;">${serial}</div>
        </td></tr>
      </table>`;
      }),
    );

    const addressHtml = address
      ? `<p class="pe-muted" style="margin:0 0 4px 0;font-size:14px;color:#6b6b76;">${address}</p>`
      : '';

    const bodyHtml = `
      ${bannerHtml}
      <p style="margin:0 0 4px 0;">Hola ${escapeHtml(order.buyer.firstName)}, tu compra del evento <strong>${eventName}</strong> fue confirmada.</p>
      <p class="pe-muted" style="margin:0 0 2px 0;font-size:14px;color:#6b6b76;">${dateGt}</p>
      ${addressHtml}
      <p style="margin:16px 0 12px 0;">Total: <strong>Q${order.total.toFixed(2)}</strong></p>
      <p style="margin:0 0 12px 0;">Tus boletos (${order.tickets.length}):</p>
      ${cards.join('')}
      <p class="pe-muted" style="margin:8px 0 0 0;font-size:14px;color:#6b6b76;">Ábrelos desde la app para ver el código QR dinámico de validación (un screenshot no sirve).</p>`;

    const seatSummary = order.tickets
      .map((t) => {
        const loc = [t.locality?.name, t.seat?.label].filter(Boolean).join(' ');
        return `${t.serial}${loc ? ` (${loc})` : ''}`;
      })
      .join(', ');

    await this.mail.sendTemplated(order.buyer.email, `Boletos confirmados — ${order.event.name}`, {
      title: '¡Compra confirmada!',
      preheader: `Tus ${order.tickets.length} boleto(s) para ${order.event.name} están listos.`,
      bodyHtml,
      bodyText: `Compra confirmada de ${order.event.name}. ${this.formatGt(
        order.event.startsAt,
      )}. ${order.tickets.length} boleto(s): ${seatSummary}`,
    });
  }
}
