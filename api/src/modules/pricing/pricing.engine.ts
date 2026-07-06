import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { sha256 } from '../../common/utils/crypto';

// Banker's rounding (Round Half to Even) a 2 decimales para dinero GTQ.
Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

export interface FeeParams {
  /** Comisión de plataforma sobre el NETO del promotor (0.10 = 10%). */
  platformFeePct: number;
  /** Comisión de la pasarela sobre el TOTAL cobrado (0.05 = 5%). */
  gatewayFeePct: number;
  /** IVA sobre la base gravable = neto + comisión plataforma (0.12 = 12% GT). */
  ivaPct: number;
  /** Cargos fijos opcionales (se suman a la base gravable). */
  fixedFees?: number;
}

export interface PriceQuote {
  currency: 'GTQ';
  /** Neto que recibe el promotor (exacto, no absorbe redondeo). */
  net: string;
  fixedFees: string;
  /** Comisión de plataforma; absorbe el residuo de redondeo (margen del negocio). */
  platformFee: string;
  /** Base gravable = net + platformFee + fixedFees. */
  taxableBase: string;
  /** IVA declarado (12% de la base gravable). */
  iva: string;
  /** Comisión de la pasarela (% del total cobrado). */
  gatewayFee: string;
  /** Precio final all-in que paga el comprador. */
  total: string;
  totalCents: number;
  params: FeeParams;
  /** SHA-256 de params + resultado: detecta manipulación antes de persistir. */
  hash: string;
}

const TWO = 2;
const round = (d: Decimal): Decimal => d.toDecimalPlaces(TWO, Decimal.ROUND_HALF_EVEN);
const pct = (v: number, name: string): Decimal => {
  const d = new Decimal(v);
  if (d.isNaN() || d.lt(0) || d.gte(1)) {
    throw new BadRequestException(`${name} debe estar en el rango [0, 1)`);
  }
  return d;
};

/**
 * Motor de precios: gross-up de 2 capas + IVA sobre base gravable.
 * Server-authoritative y puro (sin dependencias de infraestructura).
 *
 *   comision_plataforma = net * %plataforma
 *   base_gravable       = net + comision_plataforma + fijos
 *   iva                 = base_gravable * IVA           (NO aplica a la pasarela)
 *   total               = (base_gravable + iva) / (1 - %pasarela)
 *
 * El total se redondea a 2 decimales (lo cobrado). Los componentes se reconstruyen
 * de modo que sumen EXACTAMENTE el total; el residuo de redondeo se absorbe en la
 * comisión de plataforma (el neto del promotor y el IVA declarado quedan exactos).
 */
export class PricingEngine {
  static quote(net: number | string, params: FeeParams): PriceQuote {
    const N = new Decimal(net);
    if (N.isNaN() || N.lte(0)) {
      throw new BadRequestException('El neto del promotor debe ser mayor que 0');
    }
    const fixed = new Decimal(params.fixedFees ?? 0);
    if (fixed.isNaN() || fixed.lt(0)) {
      throw new BadRequestException('Los cargos fijos no pueden ser negativos');
    }
    const platformPct = pct(params.platformFeePct, 'platformFeePct');
    const gatewayPct = pct(params.gatewayFeePct, 'gatewayFeePct');
    const ivaPct = pct(params.ivaPct, 'ivaPct');

    // Cálculo forward con precisión completa.
    const platformFeeRaw = N.mul(platformPct);
    const taxableBaseRaw = N.add(platformFeeRaw).add(fixed);
    const ivaRaw = taxableBaseRaw.mul(ivaPct);
    const prePasarelaRaw = taxableBaseRaw.add(ivaRaw);
    const totalRaw = prePasarelaRaw.div(new Decimal(1).sub(gatewayPct));

    // El total es lo cobrado (redondeado). Reconstruimos para que todo cuadre.
    const total = round(totalRaw);
    const netR = round(N);
    const fixedR = round(fixed);
    const iva = round(ivaRaw);
    const gatewayFee = round(total.mul(gatewayPct));
    // La comisión de plataforma absorbe el residuo de redondeo (margen del negocio).
    const platformFee = total.sub(gatewayFee).sub(iva).sub(netR).sub(fixedR);
    const taxableBase = netR.add(platformFee).add(fixedR);

    const result: PriceQuote = {
      currency: 'GTQ',
      net: netR.toFixed(TWO),
      fixedFees: fixedR.toFixed(TWO),
      platformFee: platformFee.toFixed(TWO),
      taxableBase: taxableBase.toFixed(TWO),
      iva: iva.toFixed(TWO),
      gatewayFee: gatewayFee.toFixed(TWO),
      total: total.toFixed(TWO),
      totalCents: total.mul(100).toNumber(),
      params: {
        platformFeePct: params.platformFeePct,
        gatewayFeePct: params.gatewayFeePct,
        ivaPct: params.ivaPct,
        fixedFees: params.fixedFees ?? 0,
      },
      hash: '',
    };
    result.hash = PricingEngine.hashOf(result);
    return result;
  }

  /** Hash canónico del quote (sin el propio hash) para detectar manipulación. */
  static hashOf(q: Omit<PriceQuote, 'hash'> & { hash?: string }): string {
    const canonical = JSON.stringify({
      currency: q.currency,
      net: q.net,
      fixedFees: q.fixedFees,
      platformFee: q.platformFee,
      taxableBase: q.taxableBase,
      iva: q.iva,
      gatewayFee: q.gatewayFee,
      total: q.total,
      params: q.params,
    });
    return sha256(canonical);
  }

  /** Verifica que un quote no haya sido manipulado. */
  static verify(q: PriceQuote): boolean {
    return q.hash === PricingEngine.hashOf(q);
  }
}
