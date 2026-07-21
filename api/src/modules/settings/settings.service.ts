import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IntegrationsService, IntegrationService } from '../../infra/integrations/integrations.service';
import {
  PUBLIC_CONFIG_KEYS,
  SETTINGS_BY_KEY,
  SETTINGS_CATALOG,
  SettingDef,
} from './settings.catalog';

/** Asignación de temas a franjas + control del switch (rebranding Boletiva). */
export interface ThemeConfig {
  /** Tema (clave de bloque de tokens) por franja. */
  slots: { dia: string; noche: string };
  /** Franja por defecto (visitante / usuario sin preferencia). */
  defaultFranja: string;
  /** Si false, solo el admin define el tema y nadie ve el botón de cambio. */
  allowVisitorSwitch: boolean;
  /** Tema automático por hora (GT): el reloj elige la franja y desactiva el botón. */
  autoByHour: boolean;
  /** Hora (0–23, GT) en que empieza la franja DÍA (tema automático). */
  dayStartHour: number;
  /** Hora (1–24, GT) en que termina la franja DÍA (tema automático). */
  dayEndHour: number;
}

/** Config pública (sin login) que el frontend lee para render anónimo. */
export interface PublicConfig {
  allowVisitorLangSwitch: boolean;
  showHomeCategories: boolean;
  reportsMaintenance: boolean;
  tourEnabled: boolean;
  /** Temas por franja + switch, para resolver el tema en SSR sin parpadeo. */
  theme: ThemeConfig;
  /** Qué integraciones externas están configuradas (para gating de UI). */
  capabilities: Record<IntegrationService, boolean>;
  /** Site key pública de reCAPTCHA (vacía si no está configurada). */
  recaptchaSiteKey: string;
  /** Perfil premium / chat (para gating de UI: tarjeta de plan, CTA de chat). */
  premium: { enabled: boolean; trialEnabled: boolean; trialDays: number };
  chatEnabled: boolean;
  canFeatureEvents: boolean;
  homeSliderEnabled: boolean;
  seatmapEnabled: boolean;
  eventsCreationEnabled: boolean;
  advisorsMaintenance: boolean;
  billingMaintenance: boolean;
}

export interface SettingView {
  key: string;
  value: number | boolean | string;
  default: number | boolean | string;
  type: string;
  description: string;
  options?: string[];
  fallbackOnly: boolean;
}

/**
 * Configuraciones del sistema (v3.5). Panel admin sobre el catálogo autoritativo:
 * lista con valores actuales (o su default) y actualiza knobs validando tipo/rango.
 * Solo se aceptan claves del catálogo (evita claves basura y valores incoherentes).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    private readonly config: ConfigService,
  ) {}

  /** Lista el catálogo completo con el valor actual (default si no está en BD). */
  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: SETTINGS_CATALOG.map((s) => s.key) } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    return SETTINGS_CATALOG.map((def) => this.toView(def, byKey.get(def.key)));
  }

  /**
   * Config pública que el frontend lee SIN login (render anónimo cacheable): flags
   * booleanos de UI. Resuelve cada clave con su valor en BD o el default del catálogo.
   */
  async publicConfig(): Promise<PublicConfig> {
    const keys = Object.values(PUBLIC_CONFIG_KEYS);
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const resolveBool = (key: string): boolean => {
      const def = SETTINGS_BY_KEY.get(key);
      const raw = byKey.get(key);
      if (typeof raw === 'boolean') return raw;
      return Boolean(def?.default);
    };
    const resolveEnum = (key: string): string => {
      const def = SETTINGS_BY_KEY.get(key);
      const raw = byKey.get(key);
      if (typeof raw === 'string' && def?.options?.includes(raw)) return raw;
      return String(def?.default);
    };
    const resolveInt = (key: string): number => {
      const def = SETTINGS_BY_KEY.get(key);
      const raw = byKey.get(key);
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
      return Number(def?.default);
    };
    const caps = this.integrations.capabilities();
    return {
      allowVisitorLangSwitch: resolveBool(PUBLIC_CONFIG_KEYS.allowVisitorLangSwitch),
      showHomeCategories: resolveBool(PUBLIC_CONFIG_KEYS.showHomeCategories),
      reportsMaintenance: resolveBool(PUBLIC_CONFIG_KEYS.reportsMaintenance),
      tourEnabled: resolveBool(PUBLIC_CONFIG_KEYS.tourEnabled),
      theme: {
        slots: {
          dia: resolveEnum(PUBLIC_CONFIG_KEYS.themeSlotDia),
          noche: resolveEnum(PUBLIC_CONFIG_KEYS.themeSlotNoche),
        },
        defaultFranja: resolveEnum(PUBLIC_CONFIG_KEYS.themeDefaultFranja),
        allowVisitorSwitch: resolveBool(PUBLIC_CONFIG_KEYS.themeAllowVisitorSwitch),
        autoByHour: resolveBool(PUBLIC_CONFIG_KEYS.themeAutoByHour),
        dayStartHour: resolveInt(PUBLIC_CONFIG_KEYS.themeDayStartHour),
        dayEndHour: resolveInt(PUBLIC_CONFIG_KEYS.themeDayEndHour),
      },
      capabilities: caps,
      // Solo exponemos el site key si el captcha está REALMENTE habilitado. Si está
      // desactivado (dev/test/`RECAPTCHA_DISABLED`), devolvemos '' → el frontend no
      // intenta cargar el script de Google (evita error de CSP y llamadas inútiles).
      recaptchaSiteKey: caps.recaptcha ? (this.config.get<string>('recaptcha.siteKey') ?? '') : '',
      premium: {
        enabled: resolveBool(PUBLIC_CONFIG_KEYS.premiumEnabled),
        trialEnabled: resolveBool(PUBLIC_CONFIG_KEYS.premiumTrialEnabled),
        trialDays: resolveInt(PUBLIC_CONFIG_KEYS.premiumTrialDays),
      },
      chatEnabled: resolveBool(PUBLIC_CONFIG_KEYS.chatEnabled),
      canFeatureEvents: resolveBool(PUBLIC_CONFIG_KEYS.canFeatureEvents),
      homeSliderEnabled: resolveBool(PUBLIC_CONFIG_KEYS.homeSliderEnabled),
      seatmapEnabled: resolveBool(PUBLIC_CONFIG_KEYS.seatmapEnabled),
      eventsCreationEnabled: resolveBool(PUBLIC_CONFIG_KEYS.eventsCreationEnabled),
      advisorsMaintenance: resolveBool(PUBLIC_CONFIG_KEYS.advisorsMaintenance),
      billingMaintenance: resolveBool(PUBLIC_CONFIG_KEYS.billingMaintenance),
    };
  }

  async get(key: string): Promise<SettingView> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) throw new NotFoundException('Configuración desconocida');
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return this.toView(def, row?.value);
  }

  /** Actualiza (upsert) un knob del catálogo tras validar su tipo/rango. */
  async set(key: string, rawValue: unknown): Promise<SettingView> {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) throw new NotFoundException('Configuración desconocida');
    const value = this.validate(def, rawValue);
    await this.prisma.setting.upsert({
      where: { key },
      update: { value, description: def.description },
      create: { key, value, description: def.description },
    });
    return this.toView(def, value);
  }

  private toView(def: SettingDef, value: unknown): SettingView {
    const resolved =
      value === undefined || value === null ? def.default : (value as number | boolean | string);
    return {
      key: def.key,
      value: resolved,
      default: def.default,
      type: def.type,
      description: def.description,
      options: def.options,
      fallbackOnly: def.fallbackOnly ?? false,
    };
  }

  /** Valida el valor según el tipo del catálogo; lanza 400 con mensaje claro. */
  private validate(def: SettingDef, raw: unknown): number | boolean | string {
    if (def.type === 'enum') {
      if (typeof raw !== 'string' || !def.options?.includes(raw)) {
        throw new BadRequestException(
          `${def.key} debe ser uno de: ${(def.options ?? []).join(', ')}`,
        );
      }
      return raw;
    }
    if (def.type === 'bool') {
      if (typeof raw !== 'boolean') throw new BadRequestException(`${def.key} debe ser booleano`);
      return raw;
    }
    if (typeof raw !== 'number' || Number.isNaN(raw)) {
      throw new BadRequestException(`${def.key} debe ser numérico`);
    }
    if (def.type === 'pct') {
      // Porcentaje en [0, 1) (0.10 = 10%). Excluye 1 (evita dividir por cero en el gross-up).
      if (raw < 0 || raw >= 1) throw new BadRequestException(`${def.key} debe estar en [0, 1)`);
      return raw;
    }
    // int
    if (!Number.isInteger(raw)) throw new BadRequestException(`${def.key} debe ser entero`);
    if (def.min !== undefined && raw < def.min) {
      throw new BadRequestException(`${def.key} debe ser ≥ ${def.min}`);
    }
    if (def.max !== undefined && raw > def.max) {
      throw new BadRequestException(`${def.key} debe ser ≤ ${def.max}`);
    }
    return raw;
  }
}
