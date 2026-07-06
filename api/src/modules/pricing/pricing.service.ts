import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeeParams, PriceQuote, PricingEngine } from './pricing.engine';

/** Llaves de configuración de precios (tabla `settings`). */
const KEYS = {
  platform: 'pricing.platform_fee_pct',
  gateway: 'pricing.gateway_fee_pct',
  iva: 'pricing.iva_pct',
} as const;

/** Valores por defecto si falta la configuración (deben coincidir con el seed). */
const DEFAULTS: FeeParams = {
  platformFeePct: 0.1,
  gatewayFeePct: 0.05,
  ivaPct: 0.12,
  fixedFees: 0,
};

/**
 * Fuente server-authoritative de los parámetros de comisión. Lee la config
 * editable por el admin (tabla `settings`) y produce cotizaciones exactas con el
 * PricingEngine puro. El cliente nunca envía montos: se recalculan aquí.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Parámetros de comisión vigentes (admin-configurables, con fallback seguro). */
  async currentFeeParams(): Promise<FeeParams> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [KEYS.platform, KEYS.gateway, KEYS.iva] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const num = (key: string, fallback: number): number => {
      const v = map.get(key);
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      platformFeePct: num(KEYS.platform, DEFAULTS.platformFeePct),
      gatewayFeePct: num(KEYS.gateway, DEFAULTS.gatewayFeePct),
      ivaPct: num(KEYS.iva, DEFAULTS.ivaPct),
      fixedFees: 0,
    };
  }

  /** Cotización para un neto de promotor con las comisiones vigentes. */
  async quote(net: number | string): Promise<PriceQuote> {
    const params = await this.currentFeeParams();
    return PricingEngine.quote(net, params);
  }
}
