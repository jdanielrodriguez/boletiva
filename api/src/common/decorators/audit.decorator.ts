import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'audit_meta';

export interface AuditMeta {
  /** Acción canónica (p.ej. 'admin.settings.set'). */
  action: string;
  /** Etiqueta del recurso (default: la acción). El id sale de un route param. */
  resource?: string;
  /** Nombre del route param del que se toma el id del recurso (default: el 1.º). */
  param?: string;
}

/**
 * Marca un endpoint MUTADOR sensible para que el `AuditInterceptor` deje rastro de
 * no-repudio (hash-chain) al completarse con éxito: quién (userId del JWT), qué
 * (action), sobre qué (resource:id), desde dónde (IP/UA server-side) y un payload
 * saneado. Best-effort: nunca rompe la respuesta. Auditoría 4 · G4.1.
 */
export const Audit = (action: string, opts?: { resource?: string; param?: string }): MethodDecorator =>
  SetMetadata(AUDIT_KEY, { action, ...opts } as AuditMeta);
