import { Injectable } from '@nestjs/common';
import { Prisma, TicketEventType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { computeCustodyHash } from './custody-hash.util';

export interface CustodyInput {
  ticketId: string;
  type: TicketEventType;
  fromOwnerId?: string | null;
  toOwnerId?: string | null;
  actorId?: string | null;
  meta?: Prisma.InputJsonValue;
}

/**
 * Cadena de custodia de boletos (Ola 5): bitácora append-only encadenada por hash
 * (blockchain) por boleto. Cada movimiento (emisión, transferencia, check-in,
 * revocación) enlaza con el anterior vía `prevHash`. Un advisory lock por boleto
 * serializa los append para que la cadena no se bifurque bajo concurrencia.
 */
@Injectable()
export class TicketCustodyService {
  constructor(private readonly prisma: PrismaService) {}

  private computeHash = computeCustodyHash;

  /** Agrega un movimiento a la cadena del boleto (serializado por advisory lock). */
  async record(input: CustodyInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Lock por boleto: serializa los append de ESTE boleto (hashtext → int4).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.ticketId}))`;
      const last = await tx.ticketCustodyEvent.findFirst({
        where: { ticketId: input.ticketId },
        orderBy: { seq: 'desc' },
      });
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? '';
      const createdAt = new Date();
      const fromOwnerId = input.fromOwnerId ?? null;
      const toOwnerId = input.toOwnerId ?? null;
      const actorId = input.actorId ?? null;
      const hash = this.computeHash({
        prevHash,
        ticketId: input.ticketId,
        seq,
        type: input.type,
        fromOwnerId,
        toOwnerId,
        actorId,
        createdAt,
      });
      await tx.ticketCustodyEvent.create({
        data: {
          ticketId: input.ticketId,
          seq,
          type: input.type,
          fromOwnerId,
          toOwnerId,
          actorId,
          prevHash,
          hash,
          meta: input.meta,
          createdAt,
        },
      });
    });
  }

  /** Cadena completa de un boleto (orden cronológico). */
  chain(ticketId: string) {
    return this.prisma.ticketCustodyEvent.findMany({
      where: { ticketId },
      orderBy: { seq: 'asc' },
    });
  }

  /** Verifica la integridad de la cadena de un boleto (detecta manipulación). */
  async verifyChain(ticketId: string): Promise<{ ok: boolean; brokenAt?: number }> {
    const events = await this.chain(ticketId);
    let prev = '';
    for (const e of events) {
      const expected = this.computeHash({
        prevHash: prev,
        ticketId,
        seq: e.seq,
        type: e.type,
        fromOwnerId: e.fromOwnerId,
        toOwnerId: e.toOwnerId,
        actorId: e.actorId,
        createdAt: e.createdAt,
      });
      if (e.prevHash !== prev || e.hash !== expected) {
        return { ok: false, brokenAt: e.seq };
      }
      prev = e.hash;
    }
    return { ok: true };
  }

  /**
   * Recomputa la cadena de UN boleto con la fórmula vigente del hash (G6.1: incluye
   * actorId). Serializado por advisory lock, como `record()`. Idempotente: solo
   * reescribe los eventos cuyo hash cambia. Lo usa el script de migración de deploy
   * `recompute-custody-hashes` para actualizar el histórico sin bloquear el arranque.
   */
  async recomputeChain(ticketId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ticketId}))`;
      const events = await tx.ticketCustodyEvent.findMany({
        where: { ticketId },
        orderBy: { seq: 'asc' },
      });
      let prev = '';
      let rewritten = 0;
      for (const e of events) {
        const hash = this.computeHash({
          prevHash: prev,
          ticketId,
          seq: e.seq,
          type: e.type,
          fromOwnerId: e.fromOwnerId,
          toOwnerId: e.toOwnerId,
          actorId: e.actorId,
          createdAt: e.createdAt,
        });
        if (e.prevHash !== prev || e.hash !== hash) {
          await tx.ticketCustodyEvent.update({ where: { id: e.id }, data: { prevHash: prev, hash } });
          rewritten++;
        }
        prev = hash;
      }
      return rewritten;
    });
  }
}
