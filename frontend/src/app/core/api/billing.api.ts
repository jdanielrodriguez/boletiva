import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

export interface NitNameLookup {
  /** false = FEL desactivado → el usuario escribe el nombre a mano. */
  available: boolean;
  /** Nombre fiscal encontrado (null = no encontrado). */
  name: string | null;
}

/** Facturación (FEL): búsqueda de nombre por NIT para autollenar el checkout. */
@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly api = inject(ApiClient);

  /** Busca el nombre fiscal por NIT. Config-gated por FEL (available=false → escribe a mano). */
  nitName(nit: string): Observable<NitNameLookup> {
    return this.api.get<NitNameLookup>('/billing/nit-name', { nit });
  }
}
