/**
 * ÚNICA PERILLA de las comisiones base de la plataforma. El catálogo de settings, el
 * seed del `fee_schedule` v1 y el helper de tests (`canon`) leen de aquí → cambiar el
 * porcentaje de plataforma es UNA sola línea y todo (incluidos los e2e) queda coherente.
 *
 * Para volver a 10%: `PLATFORM_FEE_PCT = 0.1`. Nada más.
 */
export const PLATFORM_FEE_PCT = 0.05;
export const GATEWAY_FEE_PCT = 0.05;
export const IVA_PCT = 0.12;
export const BASE_FIXED_FEES = 0;

/** Formatea un pct como string decimal(5) para las columnas del `fee_schedule`. */
export const toFeeString = (pct: number): string => pct.toFixed(5);
