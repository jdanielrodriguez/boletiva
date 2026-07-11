import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { escapeHtml, type RenderInput } from '../../infra/mail/email-template';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';

/** Estados que disparan un correo al promotor. */
export type PromoterMailStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

/** Payload del job MAIL de avisos de promotor. */
export interface PromoterMailJob {
  userId: string;
  status: PromoterMailStatus;
  note?: string | null;
}

/**
 * Correos del ciclo de autorización de promotores (handler de la cola MAIL, async
 * para no bloquear la request de solicitar/decidir). La cola MAIL la comparten
 * varios emisores; este handler procesa solo `promoter-status` e ignora el resto.
 *
 * - `pending`   → "recibimos tu solicitud, pronto te contactarán" (al aplicar).
 * - `approved`  → "tu cuenta fue aprobada, ya puedes crear eventos".
 * - `rejected`  → "tu solicitud no fue aprobada" (+ nota opcional).
 * - `suspended` → "tu cuenta fue suspendida" (+ nota opcional).
 */
@Injectable()
export class PromoterMailService implements OnModuleInit {
  private readonly logger = new Logger(PromoterMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.MAIL, (name, data) => this.handle(name, data));
  }

  private async handle(name: string, data: unknown): Promise<void> {
    if (name !== 'promoter-status') return; // cola compartida: ignora lo ajeno
    const job = data as PromoterMailJob;
    if (job?.userId && job.status) await this.sendStatus(job);
  }

  /** Envía el correo correspondiente al estado del promotor. */
  async sendStatus(job: PromoterMailJob): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: job.userId },
      select: { email: true, firstName: true },
    });
    if (!user) {
      this.logger.warn(`promoter-status: usuario ${job.userId} inexistente`);
      return;
    }
    const { subject, input } = this.compose(job.status, user.firstName, job.note ?? null);
    await this.mail.sendTemplated(user.email, subject, input);
  }

  /** Construye asunto + contenido del correo según el estado. */
  private compose(
    status: PromoterMailStatus,
    firstName: string,
    note: string | null,
  ): { subject: string; input: RenderInput } {
    const hi = `Hola ${escapeHtml(firstName)},`;
    const noteHtml = note
      ? `<p class="pe-muted" style="margin:12px 0 0 0;font-size:14px;color:#6b6b76;">Nota del equipo: ${escapeHtml(note)}</p>`
      : '';

    switch (status) {
      case 'pending':
        return {
          subject: 'Recibimos tu solicitud de promotor — Pasa Eventos',
          input: {
            title: 'Recibimos tu solicitud',
            preheader: 'Tu solicitud para ser promotor está en revisión.',
            bodyHtml: `<p style="margin:0 0 12px 0;">${hi} recibimos tu solicitud para operar como <strong>promotor</strong> en Pasa Eventos.</p>
              <p style="margin:0 0 12px 0;">Nuestro equipo la revisará y <strong>te contactará pronto</strong> con el resultado. No necesitas hacer nada más por ahora.</p>`,
          },
        };
      case 'approved':
        return {
          subject: '¡Tu cuenta de promotor fue aprobada! — Pasa Eventos',
          input: {
            title: '¡Cuenta de promotor aprobada!',
            preheader: 'Ya puedes crear y publicar tus eventos.',
            bodyHtml: `<p style="margin:0 0 12px 0;">${hi} ¡buenas noticias! Tu cuenta de promotor fue <strong>aprobada</strong>.</p>
              <p style="margin:0 0 12px 0;">Ya puedes crear y publicar eventos, cargar tu mapa de asientos y empezar a vender. Si ya habías iniciado sesión, cierra sesión y vuelve a entrar para refrescar tus permisos.</p>${noteHtml}`,
          },
        };
      case 'rejected':
        return {
          subject: 'Sobre tu solicitud de promotor — Pasa Eventos',
          input: {
            title: 'Sobre tu solicitud de promotor',
            preheader: 'Novedades sobre tu solicitud de promotor.',
            bodyHtml: `<p style="margin:0 0 12px 0;">${hi} revisamos tu solicitud para operar como promotor y, por ahora, <strong>no fue aprobada</strong>.</p>
              <p style="margin:0 0 12px 0;">Si crees que se trata de un error o quieres más información, contáctanos y con gusto te ayudamos.</p>${noteHtml}`,
          },
        };
      case 'suspended':
      default:
        return {
          subject: 'Tu cuenta de promotor fue suspendida — Pasa Eventos',
          input: {
            title: 'Cuenta de promotor suspendida',
            preheader: 'Tu cuenta de promotor fue suspendida.',
            bodyHtml: `<p style="margin:0 0 12px 0;">${hi} tu cuenta de promotor fue <strong>suspendida</strong> temporalmente, por lo que no podrás crear ni publicar eventos.</p>
              <p style="margin:0 0 12px 0;">Si tienes dudas sobre el motivo, contáctanos para revisar tu caso.</p>${noteHtml}`,
          },
        };
    }
  }
}
