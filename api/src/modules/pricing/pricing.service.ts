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

/** Valores por defecto si no hay fee_schedule ni settings. */
const DEFAULTS: FeeParams = {
  platformFeePct: 0.1,
  gatewayFeePct: 0.05,
  ivaPct: 0.12,
  fixedFees: 0,
};

export interface ResolvedFees {
  params: FeeParams;
  /** Versión de comisiones usada (null si vino de settings/defaults). */
  scheduleId: string | null;
  version: number | null;
}

export interface CreateFeeScheduleInput {
  platformFeePct: number;
  gatewayFeePct: number;
  ivaPct: number;
  fixedFees?: number;
  label?: string;
}

/**
 * Fuente server-authoritative de las comisiones. Prioridad:
 *   1) fee_schedule ACTIVO (versionado e inmutable) — lo normal.
 *   2) tabla settings (compatibilidad) → 3) defaults.
 * Produce cotizaciones exactas con el PricingEngine puro. El cliente nunca envía
 * montos: se recalculan aquí.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Comisiones vigentes + versión, para estampar la orden de forma auditable. */
  async resolveFees(): Promise<ResolvedFees> {
    const active = await this.prisma.feeSchedule.findFirst({ where: { active: true } });
    if (active) {
      return {
        params: {
          platformFeePct: active.platformFeePct.toNumber(),
          gatewayFeePct: active.gatewayFeePct.toNumber(),
          ivaPct: active.ivaPct.toNumber(),
          fixedFees: active.fixedFees.toNumber(),
        },
        scheduleId: active.id,
        version: active.version,
      };
    }
    return { params: await this.fromSettings(), scheduleId: null, version: null };
  }

  /** Solo los parámetros vigentes (sin la versión). */
  async currentFeeParams(): Promise<FeeParams> {
    return (await this.resolveFees()).params;
  }

  /** Cotización para un neto de promotor con las comisiones vigentes. */
  async quote(net: number | string): Promise<PriceQuote> {
    return PricingEngine.quote(net, await this.currentFeeParams());
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
   * Crea una versión nueva de comisiones y la activa (desactivando la anterior),
   * dentro de una transacción. Valida los porcentajes con el PricingEngine (una
   * cotización de prueba) para rechazar valores fuera de [0, 1) antes de persistir.
   */
  async createSchedule(input: CreateFeeScheduleInput, createdById: string | null) {
    // Validación server-authoritative: reutiliza las reglas del motor.
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
        // Carrera al crear dos versiones activas a la vez → reintentar.
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
