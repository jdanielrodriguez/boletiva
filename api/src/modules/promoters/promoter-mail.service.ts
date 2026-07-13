import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { MailService } from '../../infra/mail/mail.service';
import { escapeHtml, type RenderInput } from '../../infra/mail/email-template';
import { mailStrings, resolveMailLocale, type MailLocale } from '../../infra/mail/mail-i18n';
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
      select: { email: true, firstName: true, language: true },
    });
    if (!user) {
      this.logger.warn(`promoter-status: usuario ${job.userId} inexistente`);
      return;
    }
    // F3 (v3.11): en el idioma del destinatario (fallback es).
    const locale = resolveMailLocale(user.language);
    const { subject, input } = this.compose(job.status, user.firstName, job.note ?? null, locale);
    await this.mail.sendTemplated(user.email, subject, input);
  }

  /** Construye asunto + contenido del correo según el estado y el locale. */
  private compose(
    status: PromoterMailStatus,
    firstName: string,
    note: string | null,
    locale: MailLocale,
  ): { subject: string; input: RenderInput } {
    const t = mailStrings(locale).promoter;
    const hi = `${mailStrings(locale).greeting(escapeHtml(firstName))}`;
    const noteHtml = note
      ? `<p class="pe-muted" style="margin:12px 0 0 0;font-size:14px;color:#6b6b76;">${t.teamNote} ${escapeHtml(note)}</p>`
      : '';
    const copy = t[status] ?? t.suspended;
    return {
      subject: copy.subject,
      input: {
        title: copy.title,
        preheader: copy.preheader,
        bodyHtml: `${copy.body(hi)}${noteHtml}`,
      },
    };
  }
}
