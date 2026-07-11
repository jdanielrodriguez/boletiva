import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Estado del overlay de carga GLOBAL (v3.9 · C1). Cuenta las peticiones HTTP en
 * vuelo (las no-silenciosas) y expone `visible` para que la app muestre un overlay
 * OSCURECIDO con el loader por encima mientras haya trabajo.
 *
 * Debounce de ~180ms: el overlay solo aparece si la petición no terminó casi al
 * instante → evita el PARPADEO en respuestas rápidas. Se oculta de inmediato al
 * llegar el contador a 0. SSR-safe: en el servidor nunca se activa.
 */
@Injectable({ providedIn: 'root' })
export class LoadingStore {
  private static readonly DEBOUNCE_MS = 180;

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly _count = signal(0);
  private readonly _visible = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** ¿Mostrar el overlay oscurecido? (tras el debounce, con peticiones en vuelo). */
  readonly visible = this._visible.asReadonly();

  /** Registra el inicio de una petición no-silenciosa. */
  start(): void {
    this._count.update((n) => n + 1);
    this.reconcile();
  }

  /** Registra el fin (éxito o error) de una petición no-silenciosa. */
  stop(): void {
    this._count.update((n) => Math.max(0, n - 1));
    this.reconcile();
  }

  /** Ajusta el overlay al estado del contador, con debounce al mostrar. */
  private reconcile(): void {
    if (!this.isBrowser) return;
    if (this._count() > 0) {
      // Ya visible o con temporizador en marcha → nada que programar.
      if (this._visible() || this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this._count() > 0) this._visible.set(true);
      }, LoadingStore.DEBOUNCE_MS);
    } else {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this._visible.set(false);
    }
  }
}
