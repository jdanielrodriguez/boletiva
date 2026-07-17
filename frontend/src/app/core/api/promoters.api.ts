import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { Schemas } from './types';

export type MyPromoterStatusResponseDto = Schemas['MyPromoterStatusResponseDto'];
export type PromoterStatusResponseDto = Schemas['PromoterStatusResponseDto'];
export type PromoterTier = 'free' | 'premium';

/** Respuesta del registro en un paso: sesión iniciada + estado de promotor. */
export interface RegisterPromoterResponse {
  user: Schemas['PublicUserResponseDto'];
  tokens: Schemas['TokenPairResponseDto'];
  promoter: PromoterStatusResponseDto;
}

/**
 * SDK de autoservicio de promotores (autorización): el usuario consulta su estado
 * y SOLICITA darse de alta como promotor, eligiendo su PLAN (free/premium). En
 * "modo pruebas" (`promoters.require_approval=false`) la solicitud se auto-aprueba.
 * `register` combina alta de cuenta + solicitud para VISITANTES sin sesión. La
 * gestión admin (aprobar/rechazar/suspender) vive en {@link AdminApi}.
 */
@Injectable({ providedIn: 'root' })
export class PromotersApi {
  private readonly api = inject(ApiClient);

  /** Mi estado de promotor (+ si el modo de autorización está activo). */
  myStatus(): Observable<MyPromoterStatusResponseDto> {
    return this.api.get<MyPromoterStatusResponseDto>('/promoters/me');
  }

  /**
   * Solicita ser promotor con un plan (default free). Auto-aprueba en modo pruebas
   * (devuelve `approved`). Requiere sesión con correo verificado.
   */
  apply(tier: PromoterTier = 'free', captchaToken?: string): Observable<PromoterStatusResponseDto> {
    return this.api.post<PromoterStatusResponseDto>('/promoters/apply', { tier }, undefined, captchaOpts(captchaToken));
  }

  /**
   * Registro + alta como promotor en un paso (VISITANTE sin sesión): crea la
   * cuenta, inicia sesión (cookie refresh) y solicita el alta con el plan elegido.
   */
  register(
    body: { email: string; password: string; firstName: string; tier?: PromoterTier },
    captchaToken?: string,
  ): Observable<RegisterPromoterResponse> {
    return this.api.post<RegisterPromoterResponse>('/promoters/register', body, undefined, captchaOpts(captchaToken));
  }
}

/** Adjunta el token de captcha como header solo si viene (config-gated). */
function captchaOpts(token?: string): { headers: Record<string, string> } | undefined {
  return token ? { headers: { 'x-captcha-token': token } } : undefined;
}
