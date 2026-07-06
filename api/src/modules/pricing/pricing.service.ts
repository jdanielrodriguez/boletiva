import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeeParams, PriceQuote, PricingEngine } from './pricing.engine';

/** Llaves de configuración de precios heredadas (tabla `settings`, fallback). */
const KEYS = {
  platform: 'pricing.platform_fee_pct',
  gateway: 'pricing.gateway_fee_pct',
  iva: 'pricing.iva_pct',
} as const;

const DEFAULTS = { platformFeePct: 0.1, gatewayFeePct: 0.05, ivaPct: 0.12 };

/** Datos de evento necesarios para resolver comisiones (pasarela + IVA). */
export interface EventFeeContext {
  gatewayId: string | null;
  frozenGatewayId: string | null;
  ivaOnNet: boolean;
}

export interface ResolvedFees {
  params: FeeParams;
  scheduleId: string | null;
  version: number | null;
  /** Pasarela usada para la comisión (null si no hay ninguna configurada). */
  gatewayId: string | null;
}

export interface CreateFeeScheduleInput {
  platformFeePct: number;
  gatewayFeePct: number;
  ivaPct: number;
  fixedFees?: number;
  label?: string;
}

/**
 * Fuente server-authoritative de las comisiones. Plataforma + IVA vienen del
 * fee_schedule ACTIVO; la comisión de PASARELA viene del método (gateway) del
 * evento (o de la default de plataforma). El IVA sobre el neto es configurable
 * por evento. El cliente nunca envía montos: se recalculan aquí.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Comisiones globales (preview): plataforma + IVA del schedule, pasarela default. */
  async resolveFees(): Promise<ResolvedFees> {
    const base = await this.platformFees();
    const gw = await this.resolveGateway(null, null);
    return {
      params: { ...base.params, gatewayFeePct: gw.pct, ivaOnNet: true },
      scheduleId: base.scheduleId,
      version: base.version,
      gatewayId: gw.id,
    };
  }

  /** Comisiones para un evento: pasarela del evento (o default) + IVA del evento. */
  async resolveFeesForEvent(event: EventFeeContext): Promise<ResolvedFees> {
    const base = await this.platformFees();
    const gw = await this.resolveGateway(event.gatewayId, event.frozenGatewayId);
    return {
      params: { ...base.params, gatewayFeePct: gw.pct, ivaOnNet: event.ivaOnNet },
      scheduleId: base.scheduleId,
      version: base.version,
      gatewayId: gw.id,
    };
  }

  async currentFeeParams(): Promise<FeeParams> {
    return (await this.resolveFees()).params;
  }

  /** Cotización global (preview) para un neto con las comisiones vigentes. */
  async quote(net: number | string): Promise<PriceQuote> {
    return PricingEngine.quote(net, await this.currentFeeParams());
  }

  /** Cotización para un neto en el contexto de un evento (pasarela + IVA del evento). */
  async quoteForEvent(net: number | string, event: EventFeeContext): Promise<PriceQuote> {
    return PricingEngine.quote(net, (await this.resolveFeesForEvent(event)).params);
  }

  /**
   * Pasarela efectiva: congelada (si el evento ya tuvo compra) → elegida por el
   * promotor → default de plataforma. Si la referida no existe (anulada), cae a
   * la default. Devuelve su comisión y su id.
   */
  private async resolveGateway(
    gatewayId: string | null,
    frozenGatewayId: string | null,
  ): Promise<{ pct: number; id: string | null }> {
    const id = frozenGatewayId ?? gatewayId;
    let gw = id ? await this.prisma.paymentGateway.findUnique({ where: { id } }) : null;
    if (!gw)
      gw = await this.prisma.paymentGateway.findFirst({ where: { isPlatformDefault: true } });
    if (!gw) return { pct: DEFAULTS.gatewayFeePct, id: null };
    return { pct: gw.feePct.toNumber(), id: gw.id };
  }

  /** Plataforma + IVA (+ fijos) del fee_schedule activo (fallback settings/defaults). */
  private async platformFees(): Promise<{
    params: FeeParams;
    scheduleId: string | null;
    version: number | null;
  }> {
    const active = await this.prisma.feeSchedule.findFirst({ where: { active: true } });
    if (active) {
      return {
        params: {
          platformFeePct: active.platformFeePct.toNumber(),
          gatewayFeePct: DEFAULTS.gatewayFeePct, // se sobrescribe con la pasarela
          ivaPct: active.ivaPct.toNumber(),
          fixedFees: active.fixedFees.toNumber(),
        },
        scheduleId: active.id,
        version: active.version,
      };
    }
    return { params: await this.fromSettings(), scheduleId: null, version: null };
  }

  /** Listado de todas las versiones de comisiones (auditoría admin). */
  listSchedules() {
    return this.prisma.feeSchedule.findMany({ orderBy: { version: 'desc' } });
  }

  /** Tabla de comisiones activa. */
  async activeSchedule() {
    const active = await this.prisma.feeSchedule.findFirst({ where: { active: true } });
    if (!active) throw new NotFoundException('No hay una tabla de comisiones activa');
    return active;
  }

  /**
   * Crea una versión nueva de comisiones y la activa (desactivando la anterior).
   * Valida los porcentajes con el PricingEngine (una cotización de prueba).
   */
  async createSchedule(input: CreateFeeScheduleInput, createdById: string | null) {
    PricingEngine.quote(100, {
      platformFeePct: input.platformFeePct,
      gatewayFeePct: input.gatewayFeePct,
      ivaPct: input.ivaPct,
      fixedFees: input.fixedFees ?? 0,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.feeSchedule.updateMany({ where: { active: true }, data: { active: false } });
        const last = await tx.feeSchedule.findFirst({ orderBy: { version: 'desc' } });
        const version = (last?.version ?? 0) + 1;
        return tx.feeSchedule.create({
          data: {
            version,
            label: input.label,
            platformFeePct: new Prisma.Decimal(input.platformFeePct),
            gatewayFeePct: new Prisma.Decimal(input.gatewayFeePct),
            ivaPct: new Prisma.Decimal(input.ivaPct),
            fixedFees: new Prisma.Decimal(input.fixedFees ?? 0),
            active: true,
            createdById,
          },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Conflicto al versionar comisiones, reintenta');
      }
      throw e;
    }
  }

  /** Fallback: comisiones desde `settings` o defaults. */
  private async fromSettings(): Promise<FeeParams> {
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
}
