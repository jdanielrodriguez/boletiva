import { Injectable, Injector, inject, signal } from '@angular/core';
import { PublicConfigApi } from '../api/public-config.api';

/**
 * Estado reactivo de la config pública (signals, zoneless). Fuente única de verdad
 * de los flags globales de la plataforma que afectan al visitante:
 *  - `allowVisitorLangSwitch`: ¿el visitante sin sesión puede cambiar idioma?
 *  - `showHomeCategories`: ¿se muestran las categorías en el inicio?
 *
 * Valores por defecto = los del backend (visitante NO cambia idioma; categorías SÍ
 * se muestran) → seguros para el primer render/SSR mientras llega la respuesta. Se
 * carga SOLO en el navegador al arrancar (como el estado de mantenimiento).
 */
@Injectable({ providedIn: 'root' })
export class PublicConfigStore {
  // El API (→ ApiClient → HttpClient) se resuelve DIFERIDO en `load()`: así, los
  // componentes que solo LEEN los flags (header/lang-switcher, catálogo) no
  // arrastran HttpClient a sus specs por el mero hecho de inyectar el store.
  private readonly injector = inject(Injector);

  private readonly _allowVisitorLangSwitch = signal(false);
  private readonly _showHomeCategories = signal(true);
  private readonly _loaded = signal(false);

  readonly allowVisitorLangSwitch = this._allowVisitorLangSwitch.asReadonly();
  readonly showHomeCategories = this._showHomeCategories.asReadonly();
  /** true una vez resuelta (o fallida) la consulta inicial. */
  readonly loaded = this._loaded.asReadonly();

  /** Consulta la config inicial. Fallo → conserva los defaults y marca cargado. */
  load(): void {
    if (this._loaded()) return;
    this.injector.get(PublicConfigApi).get().subscribe({
      next: (c) => {
        this._allowVisitorLangSwitch.set(c.allowVisitorLangSwitch);
        this._showHomeCategories.set(c.showHomeCategories);
        this._loaded.set(true);
      },
      error: () => this._loaded.set(true),
    });
  }
}
