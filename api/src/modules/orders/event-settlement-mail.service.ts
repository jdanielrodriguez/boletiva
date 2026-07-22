import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { escapeHtml } from '../../infra/mail/email-template';
import { mailStrings, resolveMailLocale } from '../../infra/mail/mail-i18n';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { SettlementService } from './settlement.service';

/** Payload del job MAIL 'event-settlement' (F4). */
export interface EventSettlementMailJob {
  eventId: string;
  promoterId: string;
  transferred: string;
}

/**
 * F4 (v3.11) — ESTADO DE CUENTAS al PROMOTOR al FINALIZAR el evento (handler de la
 * cola MAIL; la cola la comparten varios emisores → ignora lo que no es suyo).
 *
 * Al ejecutar el cierre de caja (F2), el promotor recibe (en su idioma, F3) el
 * resumen del evento = el settlement (`GET /events/:id/settlement`): recaudado,
 * neto, comisión de plataforma/pasarela, IVA, devoluciones realizadas y el total
 * transferido a su saldo, notificando que lo siguiente es el PAGO al promotor.
 */
@Injectable()
export class EventSettlementMailService implements OnModuleInit {
  private readonly logger = new Logger(EventSettlementMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly queue: QueueService,
    private readonly settlement: SettlementService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.MAIL, (name, data) => this.handle(name, data));
  }

  private async handle(name: string, data: unknown): Promise<void> {
    if (name !== 'event-settlement') return; // cola compartida: ignora lo ajeno
    const job = data as EventSettlementMailJob;
    if (job?.eventId && job.promoterId) await this.send(job);
  }

  async send(job: EventSettlementMailJob): Promise<void> {
    const promoter = await this.prisma.user.findUnique({
      where: { id: job.promoterId },
      select: { email: true, firstName: true, language: true },
    });
    if (!promoter) {
      this.logger.warn(`event-settlement: promotor ${job.promoterId} inexistente`);
      return;
    }
    // Resolvemos el NOMBRE real del evento (no el UUID) para asunto/cuerpo (D1 v3.11).
    const event = await this.prisma.event.findUnique({
      where: { id: job.eventId },
      select: { name: true },
    });
    const eventName = event?.name || job.eventId;
    const s = await this.settlement.summaryForEvent(job.eventId, eventName);
    const locale = resolveMailLocale(promoter.language);
    const t = mailStrings(locale).settlement;

    const row = (label: string, value: string, strong = false) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid {{border}};font-size:14px;color:{{text}};">${label}</td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid {{border}};font-size:14px;color:{{ink}};${
          strong ? 'font-weight:700;' : ''
        }">Q${escapeHtml(value)}</td>
      </tr>`;

    const bodyHtml = `
      <p style="margin:0 0 12px 0;">${t.greeting(escapeHtml(promoter.firstName), escapeHtml(eventName))}</p>
      <p class="pe-muted" style="margin:0 0 8px 0;font-size:14px;color:{{muted}};">${t.intro}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;">
        ${row(t.rows.gross, s.gross)}
        ${row(t.rows.platformFee, s.platformFee)}
        ${row(t.rows.gatewayFee, s.gatewayFee)}
        ${row(t.rows.iva, s.iva)}
        ${row(t.rows.refunds, s.refundsIssued)}
        ${row(t.rows.net, s.net)}
        ${row(t.rows.transferred, job.transferred, true)}
      </table>
      <p class="pe-muted" style="margin:0 0 12px 0;font-size:14px;color:{{muted}};">${t.ticketsSold}: <strong>${s.ticketsSold}</strong></p>
      <p style="margin:0;">${t.nextStep}</p>`;

    await this.mail.sendTemplated(promoter.email, t.subject(eventName), {
      title: t.title,
      preheader: t.preheader(eventName),
      bodyHtml,
      bodyText: t.textSummary(eventName, job.transferred),
    });
  }
}
