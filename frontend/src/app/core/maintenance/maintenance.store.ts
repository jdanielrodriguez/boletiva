import { Injectable, computed, inject, signal } from '@angular/core';
import { MaintenanceApi } from '../api/maintenance.api';

/**
 * Estado reactivo del modo mantenimiento (signals, zoneless). Fuente única de
 * verdad para "¿la plataforma está en mantenimiento?". Se alimenta de dos vías:
 *  - `load()`: consulta inicial a `GET /maintenance` (browser, al arrancar).
 *  - `markEnabled()`: lo llama el interceptor al ver un 503 (mantenimiento
 *    detectado en caliente sin recargar).
 * Si el fetch inicial falla, se asume NO-mantenimiento (la app sigue).
 */
@Injectable({ providedIn: 'root' })
export class MaintenanceStore {
  private readonly api = inject(MaintenanceApi);

  private readonly _enabled = signal(false);
  private readonly _message = signal<string | null>(null);
  private readonly _loaded = signal(false);

  readonly enabled = this._enabled.asReadonly();
  readonly message = this._message.asReadonly();
  /** true una vez que se resolvió (o falló) la consulta inicial de estado. */
  readonly loaded = this._loaded.asReadonly();
  readonly active = computed(() => this._loaded() && this._enabled());

  /** Consulta el estado inicial. Fallo → asume no-mantenimiento y marca cargado. */
  load(): void {
    this.api.status().subscribe({
      next: (s) => {
        this._enabled.set(s.enabled);
        this._message.set(s.message ?? null);
        this._loaded.set(true);
      },
      error: () => this._loaded.set(true),
    });
  }

  /** El interceptor lo invoca al recibir un 503: entramos en mantenimiento. */
  markEnabled(message?: string | null): void {
    this._enabled.set(true);
    if (message) this._message.set(message);
    this._loaded.set(true);
  }

  /** Tras desactivar el mantenimiento desde el banner admin. */
  markDisabled(): void {
    this._enabled.set(false);
    this._message.set(null);
  }
}
