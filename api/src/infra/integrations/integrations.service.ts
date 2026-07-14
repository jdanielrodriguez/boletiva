import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';

/** Servicios externos que se activan por configuración (env). */
export type IntegrationService =
  | 'recurrente'
  | 'pagalo'
  | 'fel'
  | 'appleWallet'
  | 'googleWallet'
  | 'googleOAuth'
  | 'recaptcha';

/** Nombre legible por servicio (para el mensaje de "no disponible"). */
const LABELS: Record<IntegrationService, string> = {
  recurrente: 'la pasarela Recurrente',
  pagalo: 'la pasarela Pagalo',
  fel: 'la facturación electrónica (FEL)',
  appleWallet: 'Apple Wallet',
  googleWallet: 'Google Wallet',
  googleOAuth: 'el login con Google',
  recaptcha: 'la verificación reCAPTCHA',
};

/**
 * Registro central de capacidades: un servicio externo está DISPONIBLE solo si sus
 * credenciales están configuradas por env. Filosofía pedida por el usuario:
 *  - variable vacía → el servicio se IGNORA (no se activa).
 *  - se pide usar un servicio no configurado → 503 "servicio no disponible".
 *
 * Todo lo relacionado con dinero (Recurrente/FEL/Apple) queda env-only por ahora;
 * Google Wallet, reCAPTCHA y Pagalo quedan "value-ready" (solo poner los valores).
 */
@Injectable()
export class IntegrationsService {
  constructor(private readonly config: ConfigService) {}

  private get<T extends keyof AppConfig>(key: T): AppConfig[T] {
    return this.config.getOrThrow<AppConfig[T]>(key as string);
  }

  /** ¿El servicio tiene todas sus credenciales mínimas configuradas? */
  available(service: IntegrationService): boolean {
    switch (service) {
      case 'recurrente': {
        const r = this.get('recurrente');
        return !!(r.apiKey && r.apiSecret);
      }
      case 'pagalo': {
        const p = this.get('pagalo');
        // Mínimo para cobrar: credencial (URL) + dominio + llaves de empresa.
        return !!(p.credencial && p.dominio && p.keyPublic && p.keySecret && p.idenEmpresa);
      }
      case 'fel': {
        const f = this.get('fel');
        return !!(f.certifier && f.apiKey && f.baseUrl && f.requestorNit);
      }
      case 'appleWallet': {
        const a = this.get('wallet').apple;
        return !!(a.passTypeId && a.teamId && a.certP12Base64 && a.wwdrBase64);
      }
      case 'googleWallet': {
        const g = this.get('wallet').google;
        return !!(g.issuerId && g.serviceAccountJson);
      }
      case 'googleOAuth': {
        const o = this.get('oauth').google;
        return !!(o.clientId && o.clientSecret);
      }
      case 'recaptcha': {
        const c = this.get('recaptcha');
        // Disponible = hay secret y NO está desactivado. Desactivado (o sin secret)
        // = las verificaciones se OMITEN (no bloquea pruebas), no es un fallo.
        return !!c.secretKey && !c.disabled;
      }
    }
  }

  /**
   * Exige que el servicio esté disponible; si no, 503 con mensaje claro. Úsalo justo
   * antes de invocar la integración real (p.ej. cobrar con una pasarela concreta).
   */
  assertAvailable(service: IntegrationService): void {
    if (!this.available(service)) {
      throw new ServiceUnavailableException(
        `Servicio no disponible: ${LABELS[service]} no está configurada. Contacta al administrador.`,
      );
    }
  }

  /** Mapa de capacidades (para health/config y decisiones del frontend). */
  capabilities(): Record<IntegrationService, boolean> {
    return {
      recurrente: this.available('recurrente'),
      pagalo: this.available('pagalo'),
      fel: this.available('fel'),
      appleWallet: this.available('appleWallet'),
      googleWallet: this.available('googleWallet'),
      googleOAuth: this.available('googleOAuth'),
      recaptcha: this.available('recaptcha'),
    };
  }
}
