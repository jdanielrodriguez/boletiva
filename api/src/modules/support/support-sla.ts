import { SupportPriority, SupportStatus } from '@prisma/client';

/**
 * Objetivos de SLA por prioridad (T1). Defaults sensatos EN CÓDIGO (como
 * pricing-defaults); el override por settings del admin queda como follow-up.
 * `firstResponseMins` = minutos para la 1ª respuesta de un agente;
 * `resolutionHours` = horas para dejar el ticket resuelto.
 */
export const SLA_TARGETS: Record<SupportPriority, { firstResponseMins: number; resolutionHours: number }> = {
  urgent: { firstResponseMins: 15, resolutionHours: 4 },
  high: { firstResponseMins: 30, resolutionHours: 8 },
  medium: { firstResponseMins: 60, resolutionHours: 24 },
  low: { firstResponseMins: 120, resolutionHours: 72 },
};

/**
 * Estados en los que el RELOJ SLA CORRE (el ticket espera acción de soporte).
 * En los demás (awaiting_promoter, suspended, resolved, closed) el reloj se PAUSA:
 * no es justo penalizar al soporte mientras espera al promotor o está congelado.
 */
export const SLA_RUNNING_STATES: ReadonlySet<SupportStatus> = new Set([
  SupportStatus.new,
  SupportStatus.open,
  SupportStatus.awaiting_support,
  SupportStatus.reopened,
]);

export function slaRunning(status: SupportStatus): boolean {
  return SLA_RUNNING_STATES.has(status);
}

/** Vencimientos iniciales al crear el ticket, según la prioridad. */
export function initialDueDates(
  priority: SupportPriority,
  now: Date,
): { firstResponseDueAt: Date; resolveDueAt: Date } {
  const t = SLA_TARGETS[priority];
  return {
    firstResponseDueAt: new Date(now.getTime() + t.firstResponseMins * 60_000),
    resolveDueAt: new Date(now.getTime() + t.resolutionHours * 3_600_000),
  };
}

/** Corre un vencimiento hacia adelante `deltaMs` (al reanudar tras una pausa). */
export function shiftDue(due: Date | null, deltaMs: number): Date | null {
  return due ? new Date(due.getTime() + deltaMs) : null;
}
