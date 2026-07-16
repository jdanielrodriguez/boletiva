import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { sha256 } from '../../common/utils/crypto';
import { KeysetQuery, KeysetResult, keysetResult, keysetTake } from '../../common/utils/pagination';

/** Advisory lock que serializa el encadenado del audit-log (distinto del ledger=4242). */
const AUDIT_CHAIN_LOCK_KEY = 4343;

export interface AuditInput {
  userId?: string | null;
  action: string;
  resource?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  payload?: unknown;
}

export interface AuditView {
  id: string;
  seq: string;
  userId: string | null;
  action: string;
  resource: string | null;
  ip: string | null;
  userAgent: string | null;
  payload: unknown;
  prevHash: string;
  hash: string;
  createdAt: Date;
}

/**
 * Bitácora de auditoría (v3.8, no-repudio). Registro APPEND-ONLY encadenado por
 * hash (misma técnica que el ledger/custody). `record()` sirve para uso interno
 * (acciones sensibles) y para el endpoint `POST /audit/confirm` que el confirm-dialog
 * del frontend llama al confirmar. La IP y el user-agent se capturan server-side.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  // Serialización CANÓNICA (claves ordenadas recursivamente) → estable ante el
  // reordenamiento de claves que hace Postgres jsonb al almacenar. Así el digest del
  // payload calculado al escribir coincide con el del readback al verificar (M4:
  // antes el payload se excluía del hash por miedo a esa flakiness → era alterable
  // sin romper verifyChain). null/undefined → cadena vacía estable.
  private canonical(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return `[${value.map((v) => this.canonical(v)).join(',')}]`;
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      return `{${Object.keys(obj)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${this.canonical(obj[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  // El hash liga los campos de NO-REPUDIO (userId/acción/recurso/IP/UA/timestamp) MÁS
  // un digest canónico del payload → un actor con escritura en BD no puede alterar el
  // contenido del registro sin romper verifyChain.
  private computeHash(p: {
    prevHash: string;
    seq: bigint;
    userId: string | null;
    action: string;
    resource: string | null;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
    payload: unknown;
  }): string {
    return sha256(
      [
        p.prevHash,
        p.seq.toString(),
        p.userId ?? '',
        p.action,
        p.resource ?? '',
        p.ip ?? '',
        p.userAgent ?? '',
        p.createdAt.toISOString(),
        sha256(this.canonical(p.payload)),
      ].join('|'),
    );
  }

  /** Agrega un registro a la cadena (serializado por advisory lock). */
  async record(input: AuditInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);
      const last = await tx.auditEvent.findFirst({ orderBy: { seq: 'desc' } });
      const prevHash = last?.hash ?? '';
      const userId = input.userId ?? null;
      const resource = input.resource ?? null;
      const ip = input.ip ?? null;
      const userAgent = input.userAgent ?? null;
      // Crear con hash provisional para obtener seq y createdAt (únicos por prevHash
      // dentro del lock), luego sellar el hash real.
      const created = await tx.auditEvent.create({
        data: {
          userId,
          action: input.action,
          resource,
          ip,
          userAgent,
          payload: input.payload as Prisma.InputJsonValue,
          prevHash,
          hash: `pending-${prevHash}`,
        },
      });
      const hash = this.computeHash({
        prevHash,
        seq: created.seq,
        userId,
        action: input.action,
        resource,
        ip,
        userAgent,
        createdAt: created.createdAt,
        payload: input.payload ?? null,
      });
      await tx.auditEvent.update({ where: { id: created.id }, data: { hash } });
    });
  }

  /** Listado keyset (más recientes primero) para el panel admin. */
  async list(query: KeysetQuery): Promise<KeysetResult<AuditView>> {
    const rows = await this.prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keysetTake(query),
    });
    const page = keysetResult(rows, query);
    return { items: page.items.map((r) => this.toView(r)), nextCursor: page.nextCursor };
  }

  private toView(r: {
    id: string;
    seq: bigint;
    userId: string | null;
    action: string;
    resource: string | null;
    ip: string | null;
    userAgent: string | null;
    payload: unknown;
    prevHash: string;
    hash: string;
    createdAt: Date;
  }): AuditView {
    return { ...r, seq: r.seq.toString() };
  }

  /** Verifica la integridad de toda la cadena (detecta manipulación). */
  async verifyChain(): Promise<{ ok: boolean; brokenAt?: string }> {
    const events = await this.prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
    let prev = '';
    for (const e of events) {
      const expected = this.computeHash({
        prevHash: prev,
        seq: e.seq,
        userId: e.userId,
        action: e.action,
        resource: e.resource,
        ip: e.ip,
        userAgent: e.userAgent,
        createdAt: e.createdAt,
        payload: e.payload ?? null,
      });
      if (e.prevHash !== prev || e.hash !== expected) {
        return { ok: false, brokenAt: e.seq.toString() };
      }
      prev = e.hash;
    }
    return { ok: true };
  }
}
