import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_MAINTENANCE = 'allowDuringMaintenance';

/**
 * Marca una ruta (o un controller entero) como accesible AUNQUE el modo
 * mantenimiento esté activo. Se usa en el estado público de mantenimiento, los
 * health checks y el flujo de autenticación (para que un admin pueda entrar y
 * desactivar el mantenimiento). El bypass de admin autenticado lo resuelve el
 * MaintenanceGuard aparte (no requiere este decorador).
 */
export const AllowDuringMaintenance = () => SetMetadata(ALLOW_DURING_MAINTENANCE, true);
