import { SetMetadata } from '@nestjs/common';

export const ADMIN_ONLY_KEY = 'adminOnly';

/**
 * Marca un handler/controlador como EXCLUSIVO del admin (B2): ni siquiera un ASESOR
 * (que por lo demás hereda los permisos del admin) puede entrar. Se usa en la tab
 * "Sistema" (settings + pasarelas) y en operaciones de sistema/seguridad
 * (mantenimiento, retención, impersonación, auditoría). El `RolesGuard` lo respeta:
 * un asesor NO pasa un endpoint marcado así aunque el endpoint pida `admin`.
 */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
