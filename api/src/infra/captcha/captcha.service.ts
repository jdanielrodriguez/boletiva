import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../integrations/integrations.service';
import type { AppConfig } from '../../config/configuration';

/** Respuesta de la API de verificación de reCAPTCHA (campos que usamos). */
interface SiteVerifyResponse {
  success: boolean;
  score?: number; // v3: 0.0 (bot) … 1.0 (humano)
  action?: string;
  'error-codes'?: string[];
}

const SITE_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/**
 * Verificación server-side de reCAPTCHA v3 (anti-abuso en signup/login).
 *
 * Filosofía del proyecto (ver [[integrations.service]]): si la integración NO está
 * disponible (sin secretKey o `disabled=true`) la verificación se OMITE y devuelve
 * `true` → NO bloquea pruebas/dev/E2E. Solo cuando hay credenciales se llama a
 * Google y se exige `success && score >= minScore` (+ acción si se pasó).
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
  ) {}

  /**
   * Verifica un token de reCAPTCHA. Devuelve `true` si el token es válido O si la
   * integración no está configurada (omisión intencional). Devuelve `false` solo
   * cuando, estando configurada, Google rechaza el token (fallo, score bajo o
   * acción distinta).
   */
  async verify(token: string, action?: string, ip?: string): Promise<boolean> {
    // Integración desactivada / sin secret → OMITE la verificación (no bloquea).
    if (!this.integrations.available('recaptcha')) return true;

    if (!token) return false;

    const cfg = this.config.getOrThrow<AppConfig['recaptcha']>('recaptcha');
    try {
      const body = new URLSearchParams({ secret: cfg.secretKey, response: token });
      if (ip) body.set('remoteip', ip);

      const res = await fetch(SITE_VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data = (await res.json()) as SiteVerifyResponse;

      if (!data.success) return false;
      if (typeof data.score === 'number' && data.score < cfg.minScore) return false;
      if (action && data.action && data.action !== action) return false;
      return true;
    } catch (err) {
      // Un fallo de red al verificar NO debe abrir la puerta: si el servicio está
      // configurado (se espera verificar) y no podemos, rechazamos.
      this.logger.warn(`Fallo al verificar reCAPTCHA: ${(err as Error).message}`);
      return false;
    }
  }
}
