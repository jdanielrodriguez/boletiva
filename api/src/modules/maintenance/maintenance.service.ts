import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** Claves de settings que respaldan el modo mantenimiento. */
const KEY_ENABLED = 'maintenance.enabled';
const KEY_MESSAGE = 'maintenance.message';

export interface MaintenanceStatus {
  enabled: boolean;
  message: string | null;
}

/**
 * Modo mantenimiento (v3.8). Estado persistido en `settings`
 * (`maintenance.enabled` bool + `maintenance.message` string opcional). Se gestiona
 * fuera del catálogo de knobs porque tiene endpoint dedicado (`/maintenance` público
 * + `PATCH /admin/maintenance`) y un guard global que lo consulta en CADA request.
 *
 * Para no pegarle a la BD en cada request, cachea el estado en memoria con un TTL
 * corto; el toggle admin invalida la caché → el efecto es inmediato (importante para
 * que el admin pueda desactivarlo sin esperar y para que los e2e sean deterministas).
 *
 * NOTA de despliegue: la automatización de deploy (tarea futura, Q3) activará el
 * mantenimiento automáticamente al iniciar el rollout y lo desactivará al terminar,
 * llamando a `set(true)` / `set(false)` (o el endpoint admin con credenciales de CI).
 */
@Injectable()
export class MaintenanceService {
  private static readonly CACHE_TTL_MS = 2000;
  private cache: { value: MaintenanceStatus; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Estado actual (cacheado con TTL corto para el guard global). */
  async getStatus(): Promise<MaintenanceStatus> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < MaintenanceService.CACHE_TTL_MS) {
      return this.cache.value;
    }
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [KEY_ENABLED, KEY_MESSAGE] } },
    });
    const enabledRow = rows.find((r) => r.key === KEY_ENABLED);
    const messageRow = rows.find((r) => r.key === KEY_MESSAGE);
    const value: MaintenanceStatus = {
      enabled: enabledRow?.value === true,
      message: typeof messageRow?.value === 'string' ? (messageRow.value as string) : null,
    };
    this.cache = { value, at: now };
    return value;
  }

  /** Activa/desactiva el mantenimiento (y su mensaje opcional). Invalida la caché. */
  async set(enabled: boolean, message?: string | null): Promise<MaintenanceStatus> {
    await this.prisma.setting.upsert({
      where: { key: KEY_ENABLED },
      update: { value: enabled },
      create: { key: KEY_ENABLED, value: enabled, description: 'Modo mantenimiento activo' },
    });
    if (message !== undefined) {
      await this.prisma.setting.upsert({
        where: { key: KEY_MESSAGE },
        update: { value: message ?? '' },
        create: {
          key: KEY_MESSAGE,
          value: message ?? '',
          description: 'Mensaje mostrado durante el mantenimiento',
        },
      });
    }
    this.cache = null; // invalida → efecto inmediato
    return this.getStatus();
  }
}
