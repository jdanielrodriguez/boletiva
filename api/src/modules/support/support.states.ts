import { SupportStatus } from '@prisma/client';

/**
 * Máquina de estados de un ticket de soporte (T1).
 *
 *   new ──(agente toma/asigna)──▶ open
 *   open/new/awaiting_support ──(agente responde)──▶ awaiting_promoter   (reloj SLA pausa)
 *   awaiting_promoter/open/new ──(promotor responde)──▶ awaiting_support  (reloj corre)
 *   * ──(agente resuelve)──▶ resolved ──(cierra)──▶ closed
 *   resolved ──(promotor responde dentro de la ventana)──▶ reopened ▶ awaiting_support
 *   cualquiera-no-final ──(agente suspende)──▶ suspended ──(reanuda)──▶ awaiting_support
 *
 * `archived` NO es un estado: es una marca (archivedByPromoterAt) que oculta la vista
 * del promotor sin borrar el ticket (no-repudio).
 */

export const FINAL_STATES: ReadonlySet<SupportStatus> = new Set([SupportStatus.closed]);

export function isFinal(status: SupportStatus): boolean {
  return FINAL_STATES.has(status);
}

/** Transiciones permitidas (from → set de destinos). Se valida además el ROL en el servicio. */
// `closed` es alcanzable desde cualquier estado activo (el promotor o el agente pueden
// cerrar en cualquier momento). `closed` solo sale hacia `reopened`.
const ALLOWED: Record<SupportStatus, ReadonlySet<SupportStatus>> = {
  new: new Set([SupportStatus.open, SupportStatus.awaiting_promoter, SupportStatus.awaiting_support, SupportStatus.suspended, SupportStatus.resolved, SupportStatus.closed]),
  open: new Set([SupportStatus.awaiting_promoter, SupportStatus.awaiting_support, SupportStatus.resolved, SupportStatus.suspended, SupportStatus.closed]),
  awaiting_promoter: new Set([SupportStatus.awaiting_support, SupportStatus.open, SupportStatus.resolved, SupportStatus.suspended, SupportStatus.closed]),
  awaiting_support: new Set([SupportStatus.awaiting_promoter, SupportStatus.open, SupportStatus.resolved, SupportStatus.suspended, SupportStatus.closed]),
  resolved: new Set([SupportStatus.reopened, SupportStatus.awaiting_support, SupportStatus.closed]),
  reopened: new Set([SupportStatus.awaiting_promoter, SupportStatus.awaiting_support, SupportStatus.open, SupportStatus.resolved, SupportStatus.suspended, SupportStatus.closed]),
  suspended: new Set([SupportStatus.awaiting_support, SupportStatus.open, SupportStatus.closed]),
  closed: new Set([SupportStatus.reopened]), // reabrir un cerrado (agente/admin)
};

export function canTransition(from: SupportStatus, to: SupportStatus): boolean {
  if (from === to) return true; // idempotente (p.ej. dos mensajes seguidos del mismo lado)
  return ALLOWED[from]?.has(to) ?? false;
}
