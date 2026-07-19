/**
 * Paleta de gráficas derivada de los tokens del rebranding (`--pe-*`) → colores CONSISTENTES
 * con el resto de la UI y THEME-AWARE (día/noche): se leen las CSS custom properties reales.
 * SSR-safe: sin `document` devuelve los hex de respaldo (idénticos a los tokens por defecto),
 * así las gráficas nunca dependen de valores hardcodeados que se desincronizan del tema.
 */
export interface ChartPalette {
  accent: string;
  accent2: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
}

/** Respaldo = valores por defecto de los tokens en styles.scss (tema noche). */
const FALLBACK: ChartPalette = {
  accent: '#e14eca', // --pe-accent
  accent2: '#2f6bff', // --pe-primary (hue distinto para 2ª serie)
  success: '#35d07f', // --pe-success
  warning: '#f5a524', // --pe-warning
  danger: '#ff6b81', // --pe-danger
  muted: '#94a3b8',
};

/** Lee la paleta de gráficas de los tokens `--pe-*` vigentes (o respaldo en SSR). */
export function chartPalette(): ChartPalette {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return { ...FALLBACK };
  }
  const s = getComputedStyle(document.documentElement);
  const read = (name: string, fb: string): string => s.getPropertyValue(name).trim() || fb;
  return {
    accent: read('--pe-accent', FALLBACK.accent),
    accent2: read('--pe-primary', FALLBACK.accent2),
    success: read('--pe-success', FALLBACK.success),
    warning: read('--pe-warning', FALLBACK.warning),
    danger: read('--pe-danger', FALLBACK.danger),
    muted: read('--pe-muted', FALLBACK.muted),
  };
}
