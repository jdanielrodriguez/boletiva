import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_EMAIL_PALETTE,
  EMAIL_THEMES,
  renderEmail,
  type EmailPalette,
  type RenderInput,
} from './email-template';

/**
 * Servicio de correo (Nodemailer). MailHog en local; SMTP/SES/SendGrid en prod.
 * El envío transaccional real se agrega en olas posteriores (vía cola).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;
  private from!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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
  }

  async send(options: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...options });
  }

  /**
   * Envía un correo usando la plantilla base profesional (marca + footer + CTA).
   * Envuelve el contenido específico y produce multipart (HTML + texto plano).
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
