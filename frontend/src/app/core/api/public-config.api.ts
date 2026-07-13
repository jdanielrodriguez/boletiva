import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Config pública de la plataforma (contrato del backend, SIN login). */
export interface PublicConfig {
  /** ¿Puede un visitante SIN sesión cambiar el idioma con la barra superior? */
  allowVisitorLangSwitch: boolean;
  /** ¿Se muestran las categorías en la página principal? */
  showHomeCategories: boolean;
}

/**
 * SDK de la config pública. `GET /public/config` es abierto (lo consulta cualquiera
 * al arrancar en el navegador). Silencioso: sondeo de fondo, no debe oscurecer la
 * pantalla con el overlay de carga.
 */
@Injectable({ providedIn: 'root' })
export class PublicConfigApi {
  private readonly api = inject(ApiClient);

  get(): Observable<PublicConfig> {
    return this.api.get<PublicConfig>('/public/config', undefined, { silent: true });
  }
}
