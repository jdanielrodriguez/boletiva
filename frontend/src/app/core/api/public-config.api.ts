import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Asignación de temas a franjas + control del switch (rebranding Boletiva). */
export interface ThemeConfig {
  /** Tema (clave de bloque de tokens) por franja. */
  slots: { dia: string; noche: string };
  /** Franja por defecto (visitante o usuario sin preferencia). */
  defaultFranja: string;
  /** Si false, solo el admin define el tema y nadie ve el botón de cambio. */
  allowVisitorSwitch: boolean;
  /** Tema AUTOMÁTICO por hora (GT): el reloj elige la franja y desactiva el botón. */
  autoByHour?: boolean;
  /** Hora (0–23, GT) en que empieza la franja DÍA (tema automático). */
  dayStartHour?: number;
  /** Hora (1–24, GT) en que termina la franja DÍA (tema automático). */
  dayEndHour?: number;
}

/** Config pública de la plataforma (contrato del backend, SIN login). */
export interface PublicConfig {
  /** ¿Puede un visitante SIN sesión cambiar el idioma con la barra superior? */
  allowVisitorLangSwitch: boolean;
  /** ¿Se muestran las categorías en la página principal? */
  showHomeCategories: boolean;
  /** ¿Reportes/dashboards (eventos, promotores, chequeo de boletos) en mantenimiento? */
  reportsMaintenance?: boolean;
  /** ¿El tour de onboarding guiado está habilitado globalmente? (default true) */
  tourEnabled?: boolean;
  /** Asignación de tema por franja + switch (para resolver el tema en el cliente). */
  theme?: ThemeConfig;
  /** Site key pública de reCAPTCHA v3 (vacía = deshabilitado, no se carga). */
  recaptchaSiteKey?: string;
  /** Perfil premium: interruptor maestro + prueba gratis + días (gating de UI del plan). */
  premium?: { enabled: boolean; trialEnabled: boolean; trialDays: number };
  /** ¿El chat de soporte está habilitado? */
  chatEnabled?: boolean;
  /** ¿Los promotores pueden destacar sus eventos en el inicio? */
  canFeatureEvents?: boolean;
  /** ¿El slider del inicio está habilitado? (false = siempre oculto). */
  homeSliderEnabled?: boolean;
  /** ¿El mapa de asientos está habilitado? */
  seatmapEnabled?: boolean;
  /** ¿La creación de eventos está habilitada? */
  eventsCreationEnabled?: boolean;
  /** Mantenimiento solo para asesores. */
  advisorsMaintenance?: boolean;
  /** Mantenimiento de facturación. */
  billingMaintenance?: boolean;
}

/**
 * SDK de la config pública. `GET /public/config` es abierto (lo consulta cualquiera
 * al arrancar en el navegador). Silencioso: sondeo de fondo, no debe oscurecer la
 * pantalla con el overlay de carga.
 */
@Injectable({ providedIn: 'root' })
export class PublicConfigApi {
  private readonly api = inject(ApiClient);

  get(): Observable<PublicConfig> {
    return this.api.get<PublicConfig>('/public/config', undefined, { silent: true });
  }
}
