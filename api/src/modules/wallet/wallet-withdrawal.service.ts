import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Role, WithdrawalStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';

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

    // Se RESERVA en el ledger ANTES de materializar la solicitud: el advisory lock
    // + el guard anti-negativo del ledger serializan las reservas y rechazan una
    // sobre-reserva concurrente (409), sin dejar una solicitud huérfana sin respaldo.
    const id = randomUUID();
    await this.ledger.post({
      kind: 'withdrawal_request',
      refType: 'withdrawal',
      refId: id,
      memo: `Reserva de retiro ${id}`,
      entries: [
        { type: 'user_wallet', ownerId: userId, amount: amount.negated().toFixed(2) },
        { type: 'payout_pending', amount: net.toFixed(2) },
        { type: 'platform_revenue', amount: fee.toFixed(2) },
      ],
    });
    const withdrawal = await this.prisma.walletWithdrawal.create({
      data: {
        id,
        userId,
        amount: amount.toFixed(2),
        feePct: feePct.toFixed(5),
        fee: fee.toFixed(2),
        net: net.toFixed(2),
      },
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
      idempotent: true,
      entries: [
        { type: 'user_wallet', ownerId: w.userId, amount: w.amount.toFixed(2) },
        { type: 'payout_pending', amount: w.net.negated().toFixed(2) },
        { type: 'platform_revenue', amount: w.fee.negated().toFixed(2) },
      ],
    });
  }

  async approve(id: string, adminId: string) {
    // CAS: solo transiciona una vez (pending→approved). Doble clic/carrera → count 0 → 409.
    const claim = await this.prisma.walletWithdrawal.updateMany({
      where: { id, status: WithdrawalStatus.pending },
      data: { status: WithdrawalStatus.approved, decidedById: adminId, decidedAt: new Date() },
    });
    if (claim.count === 0) {
      const w = await this.getOr404(id); // 404 si no existe; si existe → conflicto de estado
      throw new ConflictException(`El retiro no está pendiente (${w.status})`);
    }
    return this.summarize(await this.prisma.walletWithdrawal.findUniqueOrThrow({ where: { id } }));
  }

  async pay(id: string, adminId: string, note?: string) {
    const w = await this.getOr404(id); // 404 + valores (net) para el asiento
    // CAS-FIRST: solo el ganador (pending|approved→paid) asienta el pago. Evita doble
    // payout por doble clic o por carrera con reject (solo una transición gana la fila).
    const claim = await this.prisma.walletWithdrawal.updateMany({
      where: { id, status: { in: [WithdrawalStatus.pending, WithdrawalStatus.approved] } },
      data: {
        status: WithdrawalStatus.paid,
        decidedById: adminId,
        decidedAt: w.decidedAt ?? new Date(),
        paidAt: new Date(),
        note: note ?? w.note,
      },
    });
    if (claim.count === 0) {
      throw new ConflictException(`El retiro no se puede pagar en estado ${w.status}`);
    }
    await this.ledger.post({
      kind: 'withdrawal_paid',
      refType: 'withdrawal',
      refId: id,
      memo: `Pago de retiro ${id}`,
      idempotent: true,
      entries: [
        { type: 'payout_pending', amount: new Decimal(w.net).negated().toFixed(2) },
        { type: 'payout_settled', amount: new Decimal(w.net).toFixed(2) },
      ],
    });
    return this.summarize(await this.prisma.walletWithdrawal.findUniqueOrThrow({ where: { id } }));
  }

  async reject(id: string, adminId: string, note?: string) {
    const w = await this.getOr404(id);
    // CAS-FIRST: solo el ganador reintegra. Evita doble reintegro por doble clic o por
    // carrera con pay (solo una transición terminal gana la fila).
    const claim = await this.prisma.walletWithdrawal.updateMany({
      where: { id, status: { in: [WithdrawalStatus.pending, WithdrawalStatus.approved] } },
      data: {
        status: WithdrawalStatus.rejected,
        decidedById: adminId,
        decidedAt: new Date(),
        note: note ?? null,
      },
    });
    if (claim.count === 0) {
      throw new ConflictException(`El retiro no se puede rechazar en estado ${w.status}`);
    }
    await this.refund(this.decimalize(w));
    return this.summarize(await this.prisma.walletWithdrawal.findUniqueOrThrow({ where: { id } }));
  }

  async cancel(id: string, userId: string) {
    const w = await this.getOr404(id);
    if (w.userId !== userId) throw new NotFoundException('Retiro no encontrado'); // IDOR
    // CAS-FIRST (ligado al dueño): solo el ganador reintegra. Evita doble reintegro.
    const claim = await this.prisma.walletWithdrawal.updateMany({
      where: { id, userId, status: WithdrawalStatus.pending },
      data: { status: WithdrawalStatus.cancelled, note: 'Cancelado por el usuario' },
    });
    if (claim.count === 0) {
      throw new ConflictException(`Solo puedes cancelar un retiro pendiente (${w.status})`);
    }
    await this.refund(this.decimalize(w));
    return this.summarize(await this.prisma.walletWithdrawal.findUniqueOrThrow({ where: { id } }));
  }

  async listMine(userId: string, page: KeysetQuery = {}) {
    const rows = await this.prisma.walletWithdrawal.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(page),
    });
    return keysetResult(rows, page);
  }

  async listAll(status?: WithdrawalStatus, page: KeysetQuery = {}) {
    const rows = await this.prisma.walletWithdrawal.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(page),
    });
    return keysetResult(rows, page);
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
