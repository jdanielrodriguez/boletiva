import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Servicio de correo (Nodemailer). MailHog en local; SMTP/SES/SendGrid en prod.
 * El envío transaccional real se agrega en olas posteriores (vía cola).
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;
  private from!: string;

  constructor(private readonly config: ConfigService) {}

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

  /** Verificación de conectividad SMTP para el health-check. */
  async ping(): Promise<boolean> {
    await this.transporter.verify();
    return true;
  }
}
