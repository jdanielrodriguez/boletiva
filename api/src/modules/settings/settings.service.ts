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

/** Config pública (sin login) que el frontend lee para render anónimo. */
export interface PublicConfig {
  allowVisitorLangSwitch: boolean;
  showHomeCategories: boolean;
  /** Qué integraciones externas están configuradas (para gating de UI). */
  capabilities: Record<IntegrationService, boolean>;
  /** Site key pública de reCAPTCHA (vacía si no está configurada). */
  recaptchaSiteKey: string;
}

export interface SettingView {
  key: string;
  value: number | boolean;
  default: number | boolean;
  type: string;
  description: string;
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
    return {
      allowVisitorLangSwitch: resolveBool(PUBLIC_CONFIG_KEYS.allowVisitorLangSwitch),
      showHomeCategories: resolveBool(PUBLIC_CONFIG_KEYS.showHomeCategories),
      capabilities: this.integrations.capabilities(),
      recaptchaSiteKey: this.config.get<string>('recaptcha.siteKey') ?? '',
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
      value === undefined || value === null ? def.default : (value as number | boolean);
    return {
      key: def.key,
      value: resolved,
      default: def.default,
      type: def.type,
      description: def.description,
      fallbackOnly: def.fallbackOnly ?? false,
    };
  }

  /** Valida el valor según el tipo del catálogo; lanza 400 con mensaje claro. */
  private validate(def: SettingDef, raw: unknown): number | boolean {
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
