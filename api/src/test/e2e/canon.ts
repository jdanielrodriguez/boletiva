import { PricingEngine } from '../../modules/pricing/pricing.engine';
import {
  BASE_FIXED_FEES,
  GATEWAY_FEE_PCT,
  IVA_PCT,
  PLATFORM_FEE_PCT,
} from '../../config/pricing-defaults';

/**
 * Precio CANÓNICO derivado de la perilla única (pricing-defaults.ts) con el MISMO motor
 * que usa producción → los e2e no hardcodean 129.68. Flip plataforma 5%↔10% = 1 línea en
 * pricing-defaults y todos los e2e se ajustan solos. `net` base = 100 (el usado en la suite).
 */
const q = PricingEngine.quote(100, {
  platformFeePct: PLATFORM_FEE_PCT,
  gatewayFeePct: GATEWAY_FEE_PCT,
  ivaPct: IVA_PCT,
  fixedFees: BASE_FIXED_FEES,
});

/** Suma dos strings decimal(2) y devuelve decimal(2) (para múltiplos, p.ej. 2 boletos). */
const times = (v: string, n: number): string => (Math.round(parseFloat(v) * 100 * n) / 100).toFixed(2);

export const CANON = {
  net: q.net, //            '100.00'
  total: q.total, //        precio all-in de 1 boleto de neto 100
  platformFee: q.platformFee,
  gatewayFee: q.gatewayFee,
  iva: q.iva,
  serviceFee: q.serviceFee, // plataforma + pasarela fusionadas (vista comprador)
  taxableBase: q.taxableBase,
  /** Lo que ENTRA a la plataforma tras la pasarela = total − gatewayFee (inflow). */
  inflow: (Math.round((parseFloat(q.total) - parseFloat(q.gatewayFee)) * 100) / 100).toFixed(2),
  /** Total de N boletos iguales. */
  x: (n: number): string => times(q.total, n),
  /** N× un campo (el checkout cotiza cada ítem y suma → lineal por asiento). */
  mul: (value: string, n: number): string => times(value, n),
};
