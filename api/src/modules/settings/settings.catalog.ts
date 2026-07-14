/**
 * Catálogo AUTORITATIVO de configuraciones del sistema (v3.5). Centraliza cada
 * clave admin-editable con su default, tipo y validación. Es la fuente de verdad
 * para el seed, el panel admin (GET/PATCH /settings) y la validación de valores.
 * NOTA: los porcentajes de PRECIO (`pricing.*`) son un FALLBACK — el motor usa el
 * `fee_schedule` activo (versionado) cuando existe; editarlos aquí solo aplica sin
 * schedule. Los demás knobs (cost-share, wallet, promotores, transferencias,
 * cuotas) SÍ se leen en vivo de aquí.
 */
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
    default: 0.1,
    description: 'Comisión de plataforma sobre el neto del promotor (fallback; el motor usa el fee_schedule activo)',
    fallbackOnly: true,
  },
  {
    key: 'pricing.gateway_fee_pct',
    type: 'pct',
    default: 0.05,
    description: 'Comisión de la pasarela sobre el total cobrado (fallback; el motor usa el fee_schedule activo)',
    fallbackOnly: true,
  },
  {
    key: 'pricing.iva_pct',
    type: 'pct',
    default: 0.12,
    description: 'IVA Guatemala sobre la base gravable (fallback; el motor usa el fee_schedule activo)',
    fallbackOnly: true,
  },
  {
    key: 'wallet.withdraw_fee_promoter_pct',
    type: 'pct',
    default: 0.03,
    description: 'Comisión de retiro de saldo interno para promotores',
  },
  {
    key: 'wallet.withdraw_fee_user_pct',
    type: 'pct',
    default: 0.06,
    description: 'Comisión de retiro para usuarios (el doble que promotor)',
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
    default: true,
    description: 'Mostrar las categorías en la página principal (inicio).',
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
    default: 'noche',
    options: [...THEME_FRANJAS],
    description: 'Franja por defecto de la plataforma (la que ve un visitante o un usuario sin preferencia).',
  },
  {
    key: 'theme.allow_visitor_switch',
    type: 'bool',
    default: true,
    description:
      'Mostrar el botón de cambio de tema (día/noche) a todos. ' +
      'false = solo el admin define el tema y nadie más lo cambia.',
  },
];

/** Claves expuestas al frontend SIN login (config pública). */
export const PUBLIC_CONFIG_KEYS = {
  allowVisitorLangSwitch: 'i18n.allow_visitor_switch',
  showHomeCategories: 'home.show_categories',
  themeSlotNoche: 'theme.slot.noche',
  themeSlotDia: 'theme.slot.dia',
  themeDefaultFranja: 'theme.default_franja',
  themeAllowVisitorSwitch: 'theme.allow_visitor_switch',
} as const;

export const SETTINGS_BY_KEY: Map<string, SettingDef> = new Map(
  SETTINGS_CATALOG.map((s) => [s.key, s]),
);
