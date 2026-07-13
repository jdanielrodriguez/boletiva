import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { LedgerAccountType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { sha256 } from '../../common/utils/crypto';

Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/** Dueño centinela para cuentas de sistema (evita NULL en el índice único). */
export const SYSTEM_OWNER = '00000000-0000-0000-0000-000000000000';

/** Clave del advisory lock que serializa el encadenado del ledger. */
const CHAIN_LOCK_KEY = 4242;

export interface EntryInput {
  type: LedgerAccountType;
  /** user.id para cuentas de usuario/promotor; omitir para cuentas de sistema. */
  ownerId?: string;
  /** Monto firmado: + acredita, - debita el saldo de la cuenta. */
  amount: Decimal.Value;
}

export interface PostInput {
  kind: string;
  refType?: string;
  refId?: string;
  memo?: string;
  entries: EntryInput[];
}

/** Cuál es una cuenta de sistema (sin dueño real). */
const SYSTEM_TYPES = new Set<LedgerAccountType>([
  LedgerAccountType.platform_revenue,
  LedgerAccountType.tax_payable,
  LedgerAccountType.gateway_clearing,
  LedgerAccountType.gateway_fee,
  LedgerAccountType.payment_holding,
  LedgerAccountType.platform_expense,
  LedgerAccountType.payout_pending,
  LedgerAccountType.payout_settled,
]);

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private ownerFor(type: LedgerAccountType, ownerId?: string): string {
    if (SYSTEM_TYPES.has(type)) return SYSTEM_OWNER;
    if (!ownerId) throw new BadRequestException(`La cuenta ${type} requiere ownerId`);
    return ownerId;
  }

  /**
   * Asienta una transacción de partida doble encadenada por hash. Los montos
   * deben sumar EXACTAMENTE 0. Toma un advisory lock para serializar el chain
   * (append-only ordenado) y actualiza los saldos cacheados en la misma tx.
   */
  async post(input: PostInput) {
    if (!input.entries || input.entries.length < 2) {
      throw new BadRequestException('Una transacción contable requiere al menos 2 asientos');
    }
    const sum = input.entries.reduce((acc, e) => acc.add(new Decimal(e.amount)), new Decimal(0));
    if (!sum.isZero()) {
      throw new BadRequestException(`Los asientos deben sumar 0 (suman ${sum.toFixed(2)})`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Serializa el encadenado: solo un post construye el chain a la vez.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`);

      // Resolver/crear cuentas y calcular su nuevo saldo.
      const resolved: Array<{ accountId: string; amount: Decimal }> = [];
      for (const e of input.entries) {
        const ownerId = this.ownerFor(e.type, e.ownerId);
        const account = await tx.ledgerAccount.upsert({
          where: { type_ownerId_currency: { type: e.type, ownerId, currency: 'GTQ' } },
          update: {},
          create: { type: e.type, ownerId, currency: 'GTQ' },
        });
        const amount = new Decimal(e.amount);
        resolved.push({ accountId: account.id, amount });
        const newBalance = new Decimal(account.balance.toString()).add(amount);
        // Invariante: un wallet nunca queda negativo (guard race-safe dentro del
        // advisory lock del chain). Bloquea sobre-gasto del saldo interno.
        if (e.type === LedgerAccountType.user_wallet && newBalance.isNegative()) {
          throw new ConflictException('Saldo interno insuficiente');
        }
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: { balance: newBalance.toFixed(2) },
        });
      }

      // Encadenar: leer la última transacción para el prevHash.
      const last = await tx.ledgerTransaction.findFirst({ orderBy: { seq: 'desc' } });
      const prevHash = last?.hash ?? '';

      // Crear la transacción (hash provisional) para obtener seq y createdAt.
      const created = await tx.ledgerTransaction.create({
        data: {
          kind: input.kind,
          refType: input.refType,
          refId: input.refId,
          memo: input.memo,
          prevHash,
          hash: `pending-${prevHash}`, // provisional; se sella abajo (único por prevHash)
          entries: {
            create: resolved.map((r) => ({ accountId: r.accountId, amount: r.amount.toFixed(2) })),
          },
        },
      });

      const hash = this.computeHash(prevHash, created.seq, input, resolved, created.createdAt);
      return tx.ledgerTransaction.update({
        where: { id: created.id },
        data: { hash },
        include: { entries: true },
      });
    });
  }

  /** Hash canónico de una transacción (base del encadenado). */
  private computeHash(
    prevHash: string,
    seq: bigint,
    input: PostInput,
    entries: Array<{ accountId: string; amount: Decimal }>,
    createdAt: Date,
  ): string {
    const canonical = JSON.stringify({
      prevHash,
      seq: seq.toString(),
      kind: input.kind,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      createdAt: createdAt.toISOString(),
      entries: [...entries]
        .map((e) => ({ accountId: e.accountId, amount: e.amount.toFixed(2) }))
        .sort((a, b) => a.accountId.localeCompare(b.accountId)),
    });
    return sha256(canonical);
  }

  /** Saldo del wallet interno de un usuario (0 si no tiene cuenta aún). */
  async walletBalance(userId: string): Promise<Decimal> {
    const acc = await this.prisma.ledgerAccount.findUnique({
      where: {
        type_ownerId_currency: {
          type: LedgerAccountType.user_wallet,
          ownerId: userId,
          currency: 'GTQ',
        },
      },
    });
    return new Decimal(acc?.balance.toString() ?? '0');
  }

  /**
   * Cadena contable (hash-chain) de una orden, para mostrarla al COMPRADOR como
   * prueba de transparencia ("blockchain"). Expone solo el sobre de cada
   * transacción (seq, tipo, fecha, hash, prevHash) + si su hash recomputado cuadra
   * (`verified`), sin filtrar los montos de cuentas de sistema. `chainValid` = todas
   * las transacciones de la orden verifican (barato: NO escanea el ledger completo,
   * a diferencia de verifyChain, para no penalizar una vista de comprador).
   */
  async orderChain(orderId: string): Promise<{
    orderId: string;
    transactions: Array<{
      seq: string;
      kind: string;
      createdAt: string;
      hash: string;
      prevHash: string;
      verified: boolean;
    }>;
    chainValid: boolean;
  }> {
    const transactions = await this.refChain('order', orderId);
    const chainValid = transactions.every((t) => t.verified);
    return { orderId, transactions, chainValid };
  }

  /**
   * Cadena contable de un EVENTO (vista "blockchain" de la LIQUIDACIÓN de caja, W7):
   * las liquidaciones se asientan con `refType:'event'` (no tienen orden), por lo que
   * su transparencia se expone por evento. Mismo sobre que `orderChain` (seq/tipo/
   * fecha/hash/prevHash + `verified`), sin filtrar montos de cuentas de sistema.
   */
  async eventChain(eventId: string): Promise<{
    eventId: string;
    transactions: Array<{
      seq: string;
      kind: string;
      createdAt: string;
      hash: string;
      prevHash: string;
      verified: boolean;
    }>;
    chainValid: boolean;
  }> {
    const transactions = await this.refChain('event', eventId);
    const chainValid = transactions.every((t) => t.verified);
    return { eventId, transactions, chainValid };
  }

  /**
   * Sobre verificable de las transacciones que referencian `(refType, refId)`, en
   * orden de secuencia. Recompone el hash de cada una para marcar `verified` (no
   * escanea el ledger completo: vista barata de transparencia, no auditoría global).
   */
  private async refChain(
    refType: 'order' | 'event',
    refId: string,
  ): Promise<Array<{ seq: string; kind: string; createdAt: string; hash: string; prevHash: string; verified: boolean }>> {
    const txs = await this.prisma.ledgerTransaction.findMany({
      where: { refType, refId },
      orderBy: { seq: 'asc' },
      include: { entries: true },
    });
    return txs.map((t) => {
      // refType/refId son exactamente los del filtro (no-null): usamos los literales
      // para reproducir el hash sin ramas nullish muertas.
      const expected = this.computeHash(
        t.prevHash,
        t.seq,
        { kind: t.kind, refType, refId, entries: [] },
        t.entries.map((e) => ({ accountId: e.accountId, amount: new Decimal(e.amount.toString()) })),
        t.createdAt,
      );
      return {
        seq: t.seq.toString(),
        kind: t.kind,
        createdAt: t.createdAt.toISOString(),
        hash: t.hash,
        prevHash: t.prevHash,
        verified: expected === t.hash,
      };
    });
  }

  /**
   * Verifica la integridad del ledger: encadenado de hashes correcto, cada
   * transacción cuadra en 0, y el saldo cacheado de cada cuenta coincide con la
   * suma de sus asientos. Detecta manipulación.
   */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: string }> {
    const txs = await this.prisma.ledgerTransaction.findMany({
      orderBy: { seq: 'asc' },
      include: { entries: true },
    });
    let prevHash = '';
    for (const t of txs) {
      const sum = t.entries.reduce(
        (a, e) => a.add(new Decimal(e.amount.toString())),
        new Decimal(0),
      );
      if (!sum.isZero() || t.prevHash !== prevHash) {
        return { ok: false, checked: txs.length, brokenAt: t.id };
      }
      const expected = this.computeHash(
        prevHash,
        t.seq,
        { kind: t.kind, refType: t.refType ?? undefined, refId: t.refId ?? undefined, entries: [] },
        t.entries.map((e) => ({
          accountId: e.accountId,
          amount: new Decimal(e.amount.toString()),
        })),
        t.createdAt,
      );
      if (expected !== t.hash) {
        return { ok: false, checked: txs.length, brokenAt: t.id };
      }
      prevHash = t.hash;
    }

    // Saldos cacheados == suma de asientos por cuenta.
    const accounts = await this.prisma.ledgerAccount.findMany({ include: { entries: true } });
    for (const a of accounts) {
      const sum = a.entries.reduce(
        (s, e) => s.add(new Decimal(e.amount.toString())),
        new Decimal(0),
      );
      if (!sum.equals(new Decimal(a.balance.toString()))) {
        return { ok: false, checked: txs.length, brokenAt: a.id };
      }
    }
    return { ok: true, checked: txs.length };
  }
}
