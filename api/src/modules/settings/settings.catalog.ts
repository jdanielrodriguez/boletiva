/**
 * Catálogo AUTORITATIVO de configuraciones del sistema (v3.5). Centraliza cada
 * clave admin-editable con su default, tipo y validación. Es la fuente de verdad
 * para el seed, el panel admin (GET/PATCH /settings) y la validación de valores.
 * NOTA: los porcentajes de PRECIO (`pricing.*`) son un FALLBACK — el motor usa el
 * `fee_schedule` activo (versionado) cuando existe; editarlos aquí solo aplica sin
 * schedule. Los demás knobs (cost-share, wallet, promotores, transferencias,
 * cuotas) SÍ se leen en vivo de aquí.
 */
import { GATEWAY_FEE_PCT, IVA_PCT, PLATFORM_FEE_PCT } from '../../config/pricing-defaults';

export type SettingType = 'pct' | 'int' | 'bool' | 'enum';

export interface SettingDef {
  key: string;
  type: SettingType;
  default: number | boolean | string;
  description: string;
  min?: number;
  max?: number;
  /** Valores permitidos para `type: 'enum'` (string). */
  options?: string[];
  /** true = fallback informativo (el motor de precios prioriza el fee_schedule). */
  fallbackOnly?: boolean;
}

/** Temas de UI disponibles (rebranding Boletiva). Extensible: agregar aquí + su bloque de tokens en styles.scss. */
export const THEME_KEYS = ['pulso', 'marquesina'] as const;
/** Franjas horarias a las que el admin asigna un tema. */
export const THEME_FRANJAS = ['dia', 'noche'] as const;

export const SETTINGS_CATALOG: SettingDef[] = [
  {
    key: 'pricing.platform_fee_pct',
    type: 'pct',
    default: PLATFORM_FEE_PCT, // ÚNICA perilla (pricing-defaults.ts). El seed la usa.
    description: 'Comisión de plataforma sobre el neto del promotor (fallback; el motor usa el fee_schedule activo)',
    fallbackOnly: true,
  },
  {
    key: 'pricing.gateway_fee_pct',
    type: 'pct',
    default: GATEWAY_FEE_PCT,
    description: 'Comisión de la pasarela sobre el total cobrado (fallback; el motor usa el fee_schedule activo)',
    fallbackOnly: true,
  },
  {
    key: 'pricing.iva_pct',
    type: 'pct',
    default: IVA_PCT,
    description: 'IVA Guatemala sobre la base gravable (fallback; el motor usa el fee_schedule activo)',
    fallbackOnly: true,
  },
  {
    key: 'wallet.withdraw_fee_promoter_pct',
    type: 'pct',
    default: 0.05,
    description: 'Comisión de retiro de saldo interno para promotores',
  },
  {
    key: 'wallet.withdraw_fee_user_pct',
    type: 'pct',
    default: 0,
    description: 'Comisión de retiro para usuarios (0 = el cliente no retira, no aplica comisión)',
  },
  {
    key: 'wallet.pass_fee',
    type: 'pct',
    default: 0,
    description: 'Cargo EXTRA por generar un pase de wallet (0 = sin cargo). Se reparte prom↔plataforma',
  },
  {
    key: 'transfer.max_per_ticket_default',
    type: 'int',
    default: 1,
    min: 0,
    max: 100,
    description: 'Máximo de transferencias (regalo) por boleto por defecto (override por evento)',
  },
  {
    key: 'costshare.default_pct',
    type: 'pct',
    default: 0,
    description: 'Colaboración por defecto del promotor con gastos EXTRA (0 = no colabora; habilita cuotas/pasarelas premium al subirla)',
  },
  {
    key: 'installments.min_cost_share_pct',
    type: 'pct',
    default: 0.3,
    description: 'Cost-share mínimo del promotor para habilitar CUOTAS a sus compradores',
  },
  {
    key: 'promoters.require_approval',
    type: 'bool',
    default: true,
    description: 'Exigir autorización de admin para operar como promotor (false = modo pruebas, auto-aprueba)',
  },
  {
    key: 'i18n.allow_visitor_switch',
    type: 'bool',
    default: false,
    description:
      'Permitir que un VISITANTE (sin sesión) cambie el idioma con la barrita superior. ' +
      'false = el visitante solo ve español. Un usuario logueado siempre ve su idioma.',
  },
  {
    key: 'home.show_categories',
    type: 'bool',
    default: false,
    description: 'Mostrar las categorías en la página principal (inicio).',
  },
  {
    key: 'reports.maintenance',
    type: 'bool',
    default: false,
    description:
      'Mantenimiento de REPORTES: bloquea los dashboards/reportes de eventos, promotores y ' +
      'chequeo de boletos mostrando un aviso (sin tirar el sitio). Úsalo si hay descuadre contable.',
  },
  {
    key: 'theme.slot.noche',
    type: 'enum',
    default: 'pulso',
    options: [...THEME_KEYS],
    description: 'Tema asignado a la franja NOCHE (el admin puede voltear día↔noche).',
  },
  {
    key: 'theme.slot.dia',
    type: 'enum',
    default: 'marquesina',
    options: [...THEME_KEYS],
    description: 'Tema asignado a la franja DÍA (el admin puede voltear día↔noche).',
  },
  {
    key: 'theme.default_franja',
    type: 'enum',
    default: 'dia',
    options: [...THEME_FRANJAS],
    description: 'Franja por defecto de la plataforma (la que ve un visitante o un usuario sin preferencia).',
  },
  {
    key: 'theme.allow_visitor_switch',
    type: 'bool',
    default: false,
    description:
      'Mostrar el botón de cambio de tema (día/noche) a todos. ' +
      'false = solo el admin define el tema y nadie más lo cambia.',
  },
  {
    key: 'theme.auto_by_hour',
    type: 'bool',
    default: false,
    description:
      'Cambiar el tema AUTOMÁTICAMENTE según la hora del día (zona America/Guatemala). ' +
      'Si está activo, el botón de cambio de tema se DESACTIVA para todos (el reloj manda).',
  },
  {
    key: 'theme.day_start_hour',
    type: 'int',
    default: 6,
    min: 0,
    max: 23,
    description: 'Hora (0–23, GT) en que empieza la franja DÍA cuando el tema es automático.',
  },
  {
    key: 'theme.day_end_hour',
    type: 'int',
    default: 18,
    min: 1,
    max: 24,
    description: 'Hora (1–24, GT) en que termina la franja DÍA (a partir de ahí es NOCHE) con tema automático.',
  },
];

/** Claves expuestas al frontend SIN login (config pública). */
export const PUBLIC_CONFIG_KEYS = {
  allowVisitorLangSwitch: 'i18n.allow_visitor_switch',
  showHomeCategories: 'home.show_categories',
  reportsMaintenance: 'reports.maintenance',
  themeSlotNoche: 'theme.slot.noche',
  themeSlotDia: 'theme.slot.dia',
  themeDefaultFranja: 'theme.default_franja',
  themeAllowVisitorSwitch: 'theme.allow_visitor_switch',
  themeAutoByHour: 'theme.auto_by_hour',
  themeDayStartHour: 'theme.day_start_hour',
  themeDayEndHour: 'theme.day_end_hour',
} as const;

export const SETTINGS_BY_KEY: Map<string, SettingDef> = new Map(
  SETTINGS_CATALOG.map((s) => [s.key, s]),
);
