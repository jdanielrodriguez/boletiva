import { Injectable } from '@nestjs/common';
import { Prisma, TicketEventType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { sha256 } from '../../common/utils/crypto';

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

  private computeHash(p: {
    prevHash: string;
    ticketId: string;
    seq: number;
    type: TicketEventType;
    fromOwnerId: string | null;
    toOwnerId: string | null;
    createdAt: Date;
  }): string {
    return sha256(
      [
        p.prevHash,
        p.ticketId,
        p.seq,
        p.type,
        p.fromOwnerId ?? '',
        p.toOwnerId ?? '',
        p.createdAt.toISOString(),
      ].join('|'),
    );
  }

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
      const hash = this.computeHash({
        prevHash,
        ticketId: input.ticketId,
        seq,
        type: input.type,
        fromOwnerId,
        toOwnerId,
        createdAt,
      });
      await tx.ticketCustodyEvent.create({
        data: {
          ticketId: input.ticketId,
          seq,
          type: input.type,
          fromOwnerId,
          toOwnerId,
          actorId: input.actorId ?? null,
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
        createdAt: e.createdAt,
      });
      if (e.prevHash !== prev || e.hash !== expected) {
        return { ok: false, brokenAt: e.seq };
      }
      prev = e.hash;
    }
    return { ok: true };
  }
}
