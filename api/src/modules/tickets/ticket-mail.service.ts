import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { escapeHtml } from '../../infra/mail/email-template';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';

/**
 * Correos transaccionales de boletos (handler de la cola MAIL) — envío async para
 * no bloquear el fulfillment del pago. Hoy: confirmación de compra con la lista de
 * boletos emitidos y el enlace para verlos.
 */
@Injectable()
export class TicketMailService implements OnModuleInit {
  private readonly logger = new Logger(TicketMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly queue: QueueService,
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

  async sendOrderConfirmation(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: { select: { email: true, firstName: true } },
        event: { select: { name: true, startsAt: true } },
        tickets: { select: { serial: true } },
      },
    });
    if (!order) {
      this.logger.warn(`order-confirmation: orden ${orderId} inexistente`);
      return;
    }

    const eventName = escapeHtml(order.event.name);
    const rows = order.tickets
      .map((t) => `<li style="margin:0 0 4px 0;"><strong>${escapeHtml(t.serial)}</strong></li>`)
      .join('');
    const bodyHtml = `
      <p style="margin:0 0 12px 0;">Hola ${escapeHtml(order.buyer.firstName)}, tu pago del evento <strong>${eventName}</strong> fue confirmado.</p>
      <p style="margin:0 0 12px 0;">Total: <strong>Q${order.total.toFixed(2)}</strong></p>
      <p style="margin:0 0 6px 0;">Tus boletos (${order.tickets.length}):</p>
      <ul style="margin:0 0 12px 0;padding-left:20px;">${rows}</ul>
      <p class="pe-muted" style="margin:0;font-size:14px;color:#6b6b76;">Ábrelos desde la app para ver el código QR dinámico de validación (un screenshot no sirve).</p>`;

    await this.mail.sendTemplated(order.buyer.email, `Boletos confirmados — ${order.event.name}`, {
      title: '¡Compra confirmada!',
      preheader: `Tus ${order.tickets.length} boleto(s) para ${order.event.name} están listos.`,
      bodyHtml,
      bodyText: `Compra confirmada de ${order.event.name}. ${order.tickets.length} boleto(s): ${order.tickets
        .map((t) => t.serial)
        .join(', ')}`,
    });
  }
}
