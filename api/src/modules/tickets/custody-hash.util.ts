import { TicketEventType } from '@prisma/client';
import { sha256 } from '../../common/utils/crypto';

/**
 * Fórmula PURA del hash de un eslabón de la cadena de custodia (fuente ÚNICA de verdad:
 * la usan `TicketCustodyService` y el script de migración `recompute-custody-hashes`).
 * Sin dependencias de NestJS/DI a propósito, para poder importarla desde un script
 * standalone (ts-node) sin arrastrar el contenedor de inyección. G6.1 (auditoría 4):
 * incluye `actorId` → la atribución 'quién ejecutó el movimiento' (operador de puerta,
 * remitente…) queda a prueba de manipulación; reasignar el actorId rompe la cadena.
 */
export function computeCustodyHash(p: {
  prevHash: string;
  ticketId: string;
  seq: number;
  type: TicketEventType;
  fromOwnerId: string | null;
  toOwnerId: string | null;
  actorId: string | null;
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
      p.actorId ?? '',
      p.createdAt.toISOString(),
    ].join('|'),
  );
}
