import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, WithdrawalStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

const FEE_USER_KEY = 'wallet.withdraw_fee_user_pct';
const FEE_PROMOTER_KEY = 'wallet.withdraw_fee_promoter_pct';

/**
 * Retiros de saldo interno (Ola 6). Flujo solicitud→aprobación→pago:
 *  - request: valida saldo y RESERVA en el ledger (user_wallet −amount →
 *    payout_pending +net, platform_revenue +fee). La comisión del usuario es el
 *    doble que la del promotor (settings).
 *  - approve/pay: el admin aprueba y marca pagado (payout_pending →payout_settled).
 *  - reject/cancel: reintegra el saldo y la comisión al wallet.
 * Todo el dinero en Decimal (Banker's rounding); el ledger nunca deja el wallet negativo.
 */
@Injectable()
export class WalletWithdrawalService {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  private async feePctFor(userId: string): Promise<Decimal> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const key = user.roles.includes(Role.promoter) ? FEE_PROMOTER_KEY : FEE_USER_KEY;
    const s = await this.prisma.setting.findUnique({ where: { key } });
    const n = typeof s?.value === 'number' ? s.value : Number(s?.value);
    const def = key === FEE_PROMOTER_KEY ? 0.03 : 0.06;
    return new Decimal(Number.isFinite(n) && n >= 0 && n < 1 ? n : def);
  }

  /** Crea una solicitud de retiro y reserva el saldo en el ledger. */
  async request(userId: string, amountInput: number) {
    const amount = new Decimal(amountInput).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    if (amount.lte(0)) throw new BadRequestException('El monto debe ser mayor que 0');

    const balance = await this.ledger.walletBalance(userId);
    if (balance.lt(amount)) {
      throw new BadRequestException('Saldo insuficiente para el retiro');
    }
    const feePct = await this.feePctFor(userId);
    const fee = amount.mul(feePct).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
    const net = amount.sub(fee);

    const withdrawal = await this.prisma.walletWithdrawal.create({
      data: {
        userId,
        amount: amount.toFixed(2),
        feePct: feePct.toFixed(5),
        fee: fee.toFixed(2),
        net: net.toFixed(2),
      },
    });
    await this.ledger.post({
      kind: 'withdrawal_request',
      refType: 'withdrawal',
      refId: withdrawal.id,
      memo: `Reserva de retiro ${withdrawal.id}`,
      entries: [
        { type: 'user_wallet', ownerId: userId, amount: amount.negated().toFixed(2) },
        { type: 'payout_pending', amount: net.toFixed(2) },
        { type: 'platform_revenue', amount: fee.toFixed(2) },
      ],
    });
    return this.summarize(withdrawal);
  }

  /** Reintegra al wallet la reserva de un retiro (rechazo/cancelación). */
  private async refund(w: {
    id: string;
    userId: string;
    amount: Decimal;
    fee: Decimal;
    net: Decimal;
  }): Promise<void> {
    await this.ledger.post({
      kind: 'withdrawal_refund',
      refType: 'withdrawal',
      refId: w.id,
      memo: `Reintegro de retiro ${w.id}`,
      entries: [
        { type: 'user_wallet', ownerId: w.userId, amount: w.amount.toFixed(2) },
        { type: 'payout_pending', amount: w.net.negated().toFixed(2) },
        { type: 'platform_revenue', amount: w.fee.negated().toFixed(2) },
      ],
    });
  }

  async approve(id: string, adminId: string) {
    const w = await this.getOr404(id);
    if (w.status !== WithdrawalStatus.pending) {
      throw new ConflictException(`El retiro no está pendiente (${w.status})`);
    }
    const updated = await this.prisma.walletWithdrawal.update({
      where: { id },
      data: { status: WithdrawalStatus.approved, decidedById: adminId, decidedAt: new Date() },
    });
    return this.summarize(updated);
  }

  async pay(id: string, adminId: string, note?: string) {
    const w = await this.getOr404(id);
    if (w.status !== WithdrawalStatus.pending && w.status !== WithdrawalStatus.approved) {
      throw new ConflictException(`El retiro no se puede pagar en estado ${w.status}`);
    }
    await this.ledger.post({
      kind: 'withdrawal_paid',
      refType: 'withdrawal',
      refId: id,
      memo: `Pago de retiro ${id}`,
      entries: [
        { type: 'payout_pending', amount: new Decimal(w.net).negated().toFixed(2) },
        { type: 'payout_settled', amount: new Decimal(w.net).toFixed(2) },
      ],
    });
    const updated = await this.prisma.walletWithdrawal.update({
      where: { id },
      data: {
        status: WithdrawalStatus.paid,
        decidedById: adminId,
        decidedAt: w.decidedAt ?? new Date(),
        paidAt: new Date(),
        note: note ?? w.note,
      },
    });
    return this.summarize(updated);
  }

  async reject(id: string, adminId: string, note?: string) {
    const w = await this.getOr404(id);
    if (w.status !== WithdrawalStatus.pending && w.status !== WithdrawalStatus.approved) {
      throw new ConflictException(`El retiro no se puede rechazar en estado ${w.status}`);
    }
    await this.refund(this.decimalize(w));
    const updated = await this.prisma.walletWithdrawal.update({
      where: { id },
      data: {
        status: WithdrawalStatus.rejected,
        decidedById: adminId,
        decidedAt: new Date(),
        note: note ?? null,
      },
    });
    return this.summarize(updated);
  }

  async cancel(id: string, userId: string) {
    const w = await this.getOr404(id);
    if (w.userId !== userId) throw new NotFoundException('Retiro no encontrado'); // IDOR
    if (w.status !== WithdrawalStatus.pending) {
      throw new ConflictException(`Solo puedes cancelar un retiro pendiente (${w.status})`);
    }
    await this.refund(this.decimalize(w));
    const updated = await this.prisma.walletWithdrawal.update({
      where: { id },
      data: { status: WithdrawalStatus.cancelled, note: 'Cancelado por el usuario' },
    });
    return this.summarize(updated);
  }

  listMine(userId: string) {
    return this.prisma.walletWithdrawal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll(status?: WithdrawalStatus) {
    return this.prisma.walletWithdrawal.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getOr404(id: string) {
    const w = await this.prisma.walletWithdrawal.findUnique({ where: { id } });
    if (!w) throw new NotFoundException('Retiro no encontrado');
    return w;
  }

  private decimalize(w: {
    id: string;
    userId: string;
    amount: Decimal.Value;
    fee: Decimal.Value;
    net: Decimal.Value;
  }) {
    return {
      id: w.id,
      userId: w.userId,
      amount: new Decimal(w.amount),
      fee: new Decimal(w.fee),
      net: new Decimal(w.net),
    };
  }

  private summarize(w: {
    id: string;
    userId: string;
    amount: Decimal.Value;
    fee: Decimal.Value;
    net: Decimal.Value;
    feePct: Decimal.Value;
    status: WithdrawalStatus;
    note: string | null;
    createdAt: Date;
    paidAt: Date | null;
  }) {
    return {
      id: w.id,
      userId: w.userId,
      amount: new Decimal(w.amount).toFixed(2),
      fee: new Decimal(w.fee).toFixed(2),
      net: new Decimal(w.net).toFixed(2),
      feePct: new Decimal(w.feePct).toNumber(),
      status: w.status,
      note: w.note,
      createdAt: w.createdAt,
      paidAt: w.paidAt,
    };
  }
}
