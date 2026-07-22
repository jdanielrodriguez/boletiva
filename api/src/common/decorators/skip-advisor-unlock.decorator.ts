import { SetMetadata } from '@nestjs/common';

export const SKIP_ADVISOR_UNLOCK_KEY = 'skipAdvisorUnlock';

/**
 * Marca un endpoint como DOMINIO PROPIO DEL ASESOR: aunque su `@Roles` incluya `admin`
 * (para que el admin también entre), NO exige la ventana de desbloqueo del asesor.
 * Se usa en la bandeja de soporte (tomar/resolver/suspender/reanudar/reabrir/cerrar/
 * prioridad/categoría): atender tickets es el TRABAJO del asesor, no una mutación de la
 * consola admin, así que el candado (que protege gobernanza: promotores, cost-share,
 * settings) no debe bloquearlo. El `AdvisorUnlockGuard` lo respeta con short-circuit.
 */
export const SkipAdvisorUnlock = () => SetMetadata(SKIP_ADVISOR_UNLOCK_KEY, true);
