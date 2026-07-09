import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

const SETTING_KEY = 'costshare.default_pct';
/** Ola 6.6: el promotor por defecto NO ayuda con los gastos extra (0%). Sube su
 * % (a pedido) para habilitarle cuotas y pasarelas premium. */
const DEFAULT_PCT = 0;
/** Umbral configurable de cost-share para habilitar CUOTAS al promotor. */
const INSTALLMENTS_MIN_KEY = 'installments.min_cost_share_pct';
const INSTALLMENTS_MIN_DEFAULT = 0.3;

export interface ExtraCostInput {
  promoterId: string;
  /** Monto del gasto EXTRA (fuera del precio del boleto). */
  amount: Decimal.Value;
  kind: string; // p.ej. 'wallet_pass_fee'
  refType?: string;
  refId?: string;
}

/**
 * Reparto de gastos EXTRA (fuera del precio del boleto) entre promotor y
 * plataforma. El % lo define el admin: global por defecto (setting) con override
 * por promotor. 0% = la plataforma cubre todo. La parte del promotor se descuenta
 * de su liquidación (promoter_payable) en el ledger.
 */
@Injectable()
export class CostShareService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  private assertPct(v: number): void {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new BadRequestException('El porcentaje de reparto debe estar entre 0 y 1');
    }
  }

  /** Porcentaje global por defecto (setting; 0.5 si falta). */
  async getDefaultPct(): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const n = typeof s?.value === 'number' ? s.value : Number(s?.value);
    return Number.isFinite(n) ? n : DEFAULT_PCT;
  }

  async setDefaultPct(pct: number): Promise<{ defaultPct: number }> {
    this.assertPct(pct);
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: pct },
      create: { key: SETTING_KEY, value: pct, description: 'Reparto por defecto de gastos extra' },
    });
    return { defaultPct: pct };
  }

  /** % efectivo de un promotor: su override, o el default global. */
  async effectivePct(promoterId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: promoterId } });
    if (!user) throw new NotFoundException('Promotor no encontrado');
    if (user.costSharePct !== null) return user.costSharePct.toNumber();
    return this.getDefaultPct();
  }

  /** Umbral configurable (setting) de cost-share para habilitar CUOTAS. */
  async installmentsMinPct(): Promise<number> {
    const s = await this.prisma.setting.findUnique({ where: { key: INSTALLMENTS_MIN_KEY } });
    const n = typeof s?.value === 'number' ? s.value : Number(s?.value);
    return Number.isFinite(n) ? n : INSTALLMENTS_MIN_DEFAULT;
  }

  /** ¿El promotor califica para ofrecer CUOTAS? (cost-share ≥ umbral). */
  async installmentsAllowed(promoterId: string): Promise<boolean> {
    const [pct, min] = await Promise.all([
      this.effectivePct(promoterId),
      this.installmentsMinPct(),
    ]);
    return pct >= min;
  }

  /**
   * ¿El promotor puede USAR esta pasarela? La default del sistema SIEMPRE (ignora
   * su umbral — evita la paradoja de dejar un evento sin pasarela). Las demás
   * exigen cost-share ≥ su `minCostSharePct`.
   */
  gatewayAllowed(
    gw: { minCostSharePct: { toNumber(): number }; isPlatformDefault: boolean },
    promoterPct: number,
  ): boolean {
    if (gw.isPlatformDefault) return true;
    return promoterPct >= gw.minCostSharePct.toNumber();
  }

  async setPromoterPct(promoterId: string, pct: number | null) {
    if (pct !== null) this.assertPct(pct);
    const user = await this.prisma.user.findUnique({ where: { id: promoterId } });
    if (!user) throw new NotFoundException('Promotor no encontrado');
    const updated = await this.prisma.user.update({
      where: { id: promoterId },
      data: { costSharePct: pct === null ? null : new Decimal(pct) },
    });
    return {
      promoterId,
      override: updated.costSharePct === null ? null : updated.costSharePct.toNumber(),
      effectivePct: await this.effectivePct(promoterId),
    };
  }

  /**
   * Aplica un gasto EXTRA repartido: el promotor asume su %, la plataforma el
   * resto. Asienta en el ledger (partida doble): el gasto sale por platform_expense
   * y se financia reduciendo promoter_payable (su parte) y platform_revenue (resto).
   */
  async applyExtraCost(input: ExtraCostInput) {
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw new BadRequestException('El gasto extra debe ser mayor que 0');

    const pct = await this.effectivePct(input.promoterId);
    const promoterShare = amount.mul(pct).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    const platformShare = amount.sub(promoterShare); // absorbe el residuo de redondeo

    await this.ledger.post({
      kind: input.kind,
      refType: input.refType,
      refId: input.refId,
      memo: `Gasto extra repartido (promotor ${pct * 100}%)`,
      entries: [
        { type: 'platform_expense', amount: amount.toFixed(2) },
        {
          type: 'promoter_payable',
          ownerId: input.promoterId,
          amount: promoterShare.negated().toFixed(2),
        },
        { type: 'platform_revenue', amount: platformShare.negated().toFixed(2) },
      ],
    });

    return {
      pct,
      amount: amount.toFixed(2),
      promoterShare: promoterShare.toFixed(2),
      platformShare: platformShare.toFixed(2),
    };
  }
}
