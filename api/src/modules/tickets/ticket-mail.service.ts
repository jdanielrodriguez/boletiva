import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
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
    if (name === 'order-confirmation' && payload.orderId) {
      await this.sendOrderConfirmation(payload.orderId);
    } else {
      this.logger.warn(`Job de correo no reconocido: ${name}`);
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

    const rows = order.tickets
      .map((t) => `<li><strong>${t.serial}</strong></li>`)
      .join('');
    const html = `
      <h2>¡Compra confirmada!</h2>
      <p>Hola ${order.buyer.firstName}, tu pago del evento <strong>${order.event.name}</strong> fue confirmado.</p>
      <p>Total: <strong>Q${order.total.toFixed(2)}</strong></p>
      <p>Tus boletos (${order.tickets.length}):</p>
      <ul>${rows}</ul>
      <p>Ábrelos desde la app para ver el código QR dinámico de validación.</p>
    `;

    await this.mail.send({
      to: order.buyer.email,
      subject: `Boletos confirmados — ${order.event.name}`,
      html,
      text: `Compra confirmada de ${order.event.name}. ${order.tickets.length} boleto(s): ${order.tickets
        .map((t) => t.serial)
        .join(', ')}`,
    });
  }
}
