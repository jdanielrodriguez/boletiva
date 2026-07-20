import { SupportPriority, SupportStatus } from '@prisma/client';

/**
 * Objetivos de SLA por prioridad (T1). Defaults sensatos EN CÓDIGO (como
 * pricing-defaults); el override por settings del admin queda como follow-up.
 * `firstResponseMins` = minutos para la 1ª respuesta de un agente;
 * `resolutionHours` = horas para dejar el ticket resuelto.
 */
export interface SlaTarget {
  firstResponseMins: number;
  resolutionHours: number;
}
export type SlaTargets = Record<SupportPriority, SlaTarget>;

export const SLA_TARGETS: SlaTargets = {
  urgent: { firstResponseMins: 15, resolutionHours: 4 },
  high: { firstResponseMins: 30, resolutionHours: 8 },
  medium: { firstResponseMins: 60, resolutionHours: 24 },
  low: { firstResponseMins: 120, resolutionHours: 72 },
};

/**
 * Fusiona los defaults con overrides del admin (setting `support.sla`), validando que
 * cada valor sea un entero positivo (ignora basura). Los override parciales conservan
 * los defaults de lo no especificado.
 */
export function mergeSlaTargets(overrides: unknown): SlaTargets {
  const out: SlaTargets = {
    urgent: { ...SLA_TARGETS.urgent },
    high: { ...SLA_TARGETS.high },
    medium: { ...SLA_TARGETS.medium },
    low: { ...SLA_TARGETS.low },
  };
  if (!overrides || typeof overrides !== 'object') return out;
  const o = overrides as Record<string, Partial<SlaTarget>>;
  for (const p of Object.keys(out) as SupportPriority[]) {
    const fr = Number(o[p]?.firstResponseMins);
    const rh = Number(o[p]?.resolutionHours);
    if (Number.isInteger(fr) && fr > 0) out[p].firstResponseMins = fr;
    if (Number.isInteger(rh) && rh > 0) out[p].resolutionHours = rh;
  }
  return out;
}

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

/** Vencimientos iniciales al crear el ticket, según la prioridad (targets resueltos). */
export function initialDueDates(
  priority: SupportPriority,
  now: Date,
  targets: SlaTargets = SLA_TARGETS,
): { firstResponseDueAt: Date; resolveDueAt: Date } {
  const t = targets[priority];
  return {
    firstResponseDueAt: new Date(now.getTime() + t.firstResponseMins * 60_000),
    resolveDueAt: new Date(now.getTime() + t.resolutionHours * 3_600_000),
  };
}

/** Corre un vencimiento hacia adelante `deltaMs` (al reanudar tras una pausa). */
export function shiftDue(due: Date | null, deltaMs: number): Date | null {
  return due ? new Date(due.getTime() + deltaMs) : null;
}
