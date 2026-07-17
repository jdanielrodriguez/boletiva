import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { Schemas } from './types';

export type MyPromoterStatusResponseDto = Schemas['MyPromoterStatusResponseDto'];
export type PromoterStatusResponseDto = Schemas['PromoterStatusResponseDto'];

/**
 * SDK de autoservicio de promotores (autorización): el usuario consulta su estado
 * y SOLICITA darse de alta como promotor. En "modo pruebas"
 * (`promoters.require_approval=false`) la solicitud se auto-aprueba. La gestión
 * admin (aprobar/rechazar/suspender) vive en {@link AdminApi}.
 */
@Injectable({ providedIn: 'root' })
export class PromotersApi {
  private readonly api = inject(ApiClient);

  /** Mi estado de promotor (+ si el modo de autorización está activo). */
  myStatus(): Observable<MyPromoterStatusResponseDto> {
    return this.api.get<MyPromoterStatusResponseDto>('/promoters/me');
  }

  /** Solicita ser promotor. Auto-aprueba en modo pruebas (devuelve `approved`). */
  apply(captchaToken?: string): Observable<PromoterStatusResponseDto> {
    return this.api.post<PromoterStatusResponseDto>(
      '/promoters/apply',
      {},
      undefined,
      captchaToken ? { headers: { 'x-captcha-token': captchaToken } } : undefined,
    );
  }
}
