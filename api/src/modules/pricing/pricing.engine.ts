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
  /** IVA sobre la base gravable (0.12 = 12% GT). */
  ivaPct: number;
  /**
   * Si el IVA aplica al neto del promotor. true (default): base = neto + comisión
   * plataforma. false (el promotor ya pagó IVA del boleto): base = solo comisión
   * plataforma. La comisión de pasarela NUNCA lleva IVA (tributa en la pasarela).
   */
  ivaOnNet?: boolean;
  /** Cargos fijos opcionales (lado plataforma; se suman a la base gravable). */
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
  /**
   * IVA declarado (12% de la base gravable de la VENTA). En cuotas NO baja aunque
   * la plataforma/promotor absorban costo: la obligación fiscal es sobre la
   * comisión bruta, no sobre el margen neto (evita subdeclarar impuestos).
   */
  iva: string;
  /**
   * Comisión REAL que la plataforma paga a la pasarela. En 1 pago = feePct·total;
   * en cuotas = gn·total + fijo (lo que efectivamente cobra la pasarela). Es la
   * cifra de "cuánto paga de pasarela" para la contabilidad de la plataforma.
   */
  gatewayFee: string;
  /** Precio final all-in que paga el comprador. */
  total: string;
  totalCents: number;
  params: FeeParams;
  // --- Pago en cuotas (Ola 6.5). Ausentes en pago único (retrocompatibilidad). ---
  // El COMPRADOR paga lo mismo que en 1 pago (recargo directo prohibido por ley GT
  // desde 2024); el costo extra de financiamiento (gn% + fijo) lo absorbe la
  // PLATAFORMA (default) o el PROMOTOR (override del evento). Solo cambian
  // gatewayFee y quién baja su margen; net/iva/total/base gravable no varían.
  /** Número de cuotas seleccionadas (>= 2). */
  installments?: number;
  /** Comisión de pasarela aplicada por las cuotas (gn). */
  installmentFeePct?: number;
  /** Cargo fijo de la pasarela por transacción en cuotas (p.ej. Q2 de Recurrente). */
  installmentFixedFee?: string;
  /** Precio de referencia en 1 pago (P1) = total (el comprador paga igual). */
  basePrice?: string;
  /** Costo de financiamiento absorbido (gn·total + fijo − comisión de 1 pago). */
  installmentSurcharge?: string;
  /** Quién absorbe el costo de las cuotas (nunca el comprador). */
  installmentAbsorbedBy?: 'platform' | 'promoter';
  /** SHA-256 de params + resultado: detecta manipulación antes de persistir. */
  hash: string;
}

/** Selección de pago en cuotas (se resuelve en el checkout, no en el catálogo). */
export interface InstallmentPlan {
  /** Número de cuotas. <= 1 se trata como pago único (sin recargo). */
  count: number;
  /** Comisión efectiva de la pasarela para esas cuotas (gn), en [0, 1). */
  ratePct: number;
  /** Cargo fijo de la pasarela por transacción en cuotas (GTQ, p.ej. Q2). */
  fixedFee?: number;
  /** true = el PROMOTOR absorbe el costo; false/undefined = lo absorbe la PLATAFORMA. */
  absorbedByPromoter?: boolean;
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
  /**
   * Cotiza un neto con las comisiones dadas. Si `plan` indica cuotas (count >= 2),
   * aplica el recargo por financiamiento de la pasarela (gross-up con la tasa de
   * cuotas). El neto del promotor y el IVA se preservan cuando el recargo lo paga
   * el comprador; si el promotor lo absorbe, se descuenta de su neto (el comprador
   * paga el precio de 1 pago). Sin `plan` (o count <= 1) el resultado es idéntico
   * al de siempre (retrocompatible).
   */
  static quote(net: number | string, params: FeeParams, plan?: InstallmentPlan): PriceQuote {
    const base = PricingEngine.baseQuote(net, params);
    if (!plan || plan.count <= 1) return base;

    // Cuotas: el COMPRADOR paga lo mismo que en 1 pago (base.total). La pasarela
    // cobra gn% del total + un fijo; el diferencial vs la comisión de 1 pago lo
    // absorbe la PLATAFORMA (default) o el PROMOTOR (override), sin tocar el neto
    // del otro, el IVA, la base gravable ni el total. El ledger cuadra igual:
    //   net + platformFee + iva + gatewayFee = total.
    const gn = pct(plan.ratePct, 'installmentRatePct');
    const fixedFee = new Decimal(plan.fixedFee ?? 0);
    if (fixedFee.isNaN() || fixedFee.lt(0)) {
      throw new BadRequestException('El cargo fijo de cuotas no puede ser negativo');
    }
    const total = new Decimal(base.total);
    const gatewayFee = round(total.mul(gn).add(fixedFee));
    const cost = gatewayFee.sub(new Decimal(base.gatewayFee)); // extra vs 1 pago
    const byPromoter = plan.absorbedByPromoter === true;

    const net0 = new Decimal(base.net);
    const platform0 = new Decimal(base.platformFee);
    // El absorbedor baja su margen en `cost`; el otro queda intacto.
    const netR = byPromoter ? net0.sub(cost) : net0;
    const platformFee = byPromoter ? platform0 : platform0.sub(cost);
    if (byPromoter && netR.lt(0)) {
      throw new BadRequestException(
        'El costo por cuotas supera el neto del promotor; no puede absorberse',
      );
    }

    const q: PriceQuote = {
      ...base,
      net: netR.toFixed(TWO),
      platformFee: platformFee.toFixed(TWO),
      gatewayFee: gatewayFee.toFixed(TWO),
      // total, iva, taxableBase (venta declarada) y params NO cambian: el comprador
      // paga igual y el IVA/FEL reflejan la venta real de 1 pago.
      hash: '',
    };
    return PricingEngine.withInstallments(q, {
      installments: plan.count,
      installmentFeePct: plan.ratePct,
      installmentFixedFee: fixedFee.toFixed(TWO),
      basePrice: base.total,
      installmentSurcharge: cost.toFixed(TWO),
      installmentAbsorbedBy: byPromoter ? 'promoter' : 'platform',
    });
  }

  /** Fija los campos de cuotas y recalcula el hash anti-manipulación. */
  private static withInstallments(
    q: PriceQuote,
    extra: Pick<
      PriceQuote,
      | 'installments'
      | 'installmentFeePct'
      | 'installmentFixedFee'
      | 'basePrice'
      | 'installmentSurcharge'
      | 'installmentAbsorbedBy'
    >,
  ): PriceQuote {
    const result: PriceQuote = { ...q, ...extra, hash: '' };
    result.hash = PricingEngine.hashOf(result);
    return result;
  }

  private static baseQuote(net: number | string, params: FeeParams): PriceQuote {
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
    const ivaOnNet = params.ivaOnNet ?? true;

    // Cálculo forward con precisión completa. Si ivaOnNet=false el IVA aplica solo
    // a la comisión de plataforma (+fijos); el neto igual se cobra, pero sin IVA.
    const platformFeeRaw = N.mul(platformPct);
    const ivaBaseRaw = (ivaOnNet ? N.add(platformFeeRaw) : platformFeeRaw).add(fixed);
    const ivaRaw = ivaBaseRaw.mul(ivaPct);
    const prePasarelaRaw = N.add(platformFeeRaw).add(fixed).add(ivaRaw);
    const totalRaw = prePasarelaRaw.div(new Decimal(1).sub(gatewayPct));

    // El total es lo cobrado (redondeado). Reconstruimos para que todo cuadre.
    const total = round(totalRaw);
    const netR = round(N);
    const fixedR = round(fixed);
    const iva = round(ivaRaw);
    const gatewayFee = round(total.mul(gatewayPct));
    // La comisión de plataforma absorbe el residuo de redondeo (margen del negocio).
    const platformFee = total.sub(gatewayFee).sub(iva).sub(netR).sub(fixedR);
    // Base gravable declarada = lo que efectivamente tributa IVA.
    const taxableBase = (ivaOnNet ? netR.add(platformFee) : platformFee).add(fixedR);

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
        ivaOnNet,
        fixedFees: params.fixedFees ?? 0,
      },
      hash: '',
    };
    result.hash = PricingEngine.hashOf(result);
    return result;
  }

  /** Hash canónico del quote (sin el propio hash) para detectar manipulación. */
  static hashOf(q: Omit<PriceQuote, 'hash'> & { hash?: string }): string {
    // Los campos de cuotas van al FINAL: cuando están ausentes (pago único),
    // JSON.stringify los omite y el hash es idéntico al de siempre (retrocompat).
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
      installments: q.installments,
      installmentFeePct: q.installmentFeePct,
      installmentFixedFee: q.installmentFixedFee,
      basePrice: q.basePrice,
      installmentSurcharge: q.installmentSurcharge,
      installmentAbsorbedBy: q.installmentAbsorbedBy,
    });
    return sha256(canonical);
  }

  /** Verifica que un quote no haya sido manipulado. */
  static verify(q: PriceQuote): boolean {
    return q.hash === PricingEngine.hashOf(q);
  }
}
