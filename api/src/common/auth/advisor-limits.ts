import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Límites RBAC del ASESOR (decisión del arquitecto, Auditoría 4 · G7). El asesor es un
 * rol de SOPORTE OPERATIVO, no un súper-admin: durante su ventana de desbloqueo puede
 * editar eventos ajenos, gestionar mapas, aprobar promotores y procesar reembolsos
 * regulares, pero NUNCA puede cancelar/eliminar eventos (exclusivo del admin por
 * implicaciones legales) ni tocar finanzas/banca ni solicitar retiros de wallet.
 *
 * `@AdminOnly` no sirve para esos casos porque también bloquearía al PROMOTOR dueño
 * (que sí puede cancelar/eliminar SU evento); aquí se excluye SOLO al asesor.
 */
export function isAdvisorNotAdmin(roles: readonly Role[] | undefined): boolean {
  return !!roles && roles.includes(Role.advisor) && !roles.includes(Role.admin);
}

/** Lanza 403 si el actor es un asesor (que hereda admin pero no es admin real). */
export function assertNotAdvisor(user: { roles?: readonly Role[] }, message: string): void {
  if (isAdvisorNotAdmin(user.roles)) throw new ForbiddenException(message);
}
