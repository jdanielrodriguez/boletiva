import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { QUEUES } from '../queue/queue.constants';
import {
  DEFAULT_EMAIL_PALETTE,
  EMAIL_THEMES,
  renderEmail,
  type EmailPalette,
  type RenderInput,
} from './email-template';

/** Nombre del job genérico de la cola MAIL (envío de una plantilla ya resuelta). */
const SEND_TEMPLATED_JOB = 'send-templated';

/**
 * Servicio de correo (Nodemailer). MailHog en local; SMTP/SES/SendGrid en prod.
 *
 * TODO correo transaccional sale ENCOLADO (cola MAIL / BullMQ): `enqueueTemplated`
 * empuja el job y retorna al instante — el envío SMTP real ocurre en el worker.
 * Así el flujo que dispara el correo (signup, login, reset, invitación…) no se
 * bloquea por el SMTP, se reintenta ante fallos, y se suaviza el ritmo para no
 * saturar al proveedor ni caer en filtros de spam. `send`/`sendTemplated` (envío
 * directo) quedan para el worker y el health-check; NO llamarlos desde el request.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;
  private from!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Resuelve la paleta de correo del TEMA POR DEFECTO de la plataforma: lee la franja
   * por defecto (`theme.default_franja`) y el tema asignado a esa franja
   * (`theme.slot.<franja>`), y mapea a la paleta email-safe. Fallback: Pulso (noche).
   * Nunca lanza (un fallo de lectura no debe impedir enviar el correo).
   */
  private async resolvePalette(): Promise<EmailPalette> {
    try {
      const rows = await this.prisma.setting.findMany({
        where: { key: { in: ['theme.default_franja', 'theme.slot.dia', 'theme.slot.noche'] } },
      });
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      const franja = byKey.get('theme.default_franja') === 'dia' ? 'dia' : 'noche';
      const themeKey = byKey.get(`theme.slot.${franja}`);
      return (typeof themeKey === 'string' && EMAIL_THEMES[themeKey]) || DEFAULT_EMAIL_PALETTE;
    } catch {
      return DEFAULT_EMAIL_PALETTE;
    }
  }

  onModuleInit(): void {
    const mail = this.config.getOrThrow<{
      host: string;
      port: number;
      user: string;
      pass: string;
      secure: boolean;
      from: string;
    }>('mail');
    this.from = mail.from;
    this.transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      secure: mail.secure,
      auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
    });
    // Consumidor de la cola MAIL para los correos genéricos ya plantillados
    // (auth, invitaciones…). Otros emisores (confirmación de compra, avisos de
    // promotor, liquidación) registran su propio handler y filtran por `name`.
    this.queue.registerHandler(QUEUES.MAIL, (name, data) => this.handleQueue(name, data));
  }

  /**
   * Encola el envío de un correo plantillado (cola MAIL). Retorna al instante:
   * el SMTP real corre en el worker. Es la vía por defecto desde cualquier request
   * (signup, login, reset, 2FA, invitaciones…) para no bloquear ni saturar el SMTP.
   */
  async enqueueTemplated(to: string, subject: string, input: RenderInput): Promise<void> {
    await this.queue.enqueue(QUEUES.MAIL, SEND_TEMPLATED_JOB, { to, subject, input });
  }

  /** Handler de la cola MAIL: solo procesa el job genérico `send-templated`. */
  private async handleQueue(name: string, data: unknown): Promise<void> {
    if (name !== SEND_TEMPLATED_JOB) return; // ignora jobs de otros emisores
    const { to, subject, input } = data as { to: string; subject: string; input: RenderInput };
    await this.sendTemplated(to, subject, input);
  }

  async send(options: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...options });
  }

  /**
   * Envía un correo usando la plantilla base profesional (marca + footer + CTA).
   * Envuelve el contenido específico y produce multipart (HTML + texto plano).
   * Envío DIRECTO (SMTP): lo usa el worker de la cola; desde un request usar
   * `enqueueTemplated` para no bloquear.
   */
  async sendTemplated(to: string, subject: string, input: RenderInput): Promise<void> {
    const { html, text } = renderEmail(input, await this.resolvePalette());
    await this.send({ to, subject, html, text });
  }

  /** Verificación de conectividad SMTP para el health-check. */
  async ping(): Promise<boolean> {
    await this.transporter.verify();
    return true;
  }
}
