import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { AddPaymentMethodDto, PaymentMethodResponseDto } from './types';

/**
 * Métodos de pago (tarjetas tokenizadas). PCI-DSS: `add` envía un nonce del
 * tokenizador (nunca el PAN) más marca y últimos 4 dígitos para mostrar.
 */
@Injectable({ providedIn: 'root' })
export class PaymentMethodsApi {
  private readonly api = inject(ApiClient);

  list(): Observable<PaymentMethodResponseDto[]> {
    return this.api.get<PaymentMethodResponseDto[]>('/payment-methods');
  }

  add(dto: AddPaymentMethodDto): Observable<PaymentMethodResponseDto> {
    return this.api.post<PaymentMethodResponseDto>('/payment-methods', dto);
  }

  setDefault(id: string): Observable<PaymentMethodResponseDto> {
    return this.api.post<PaymentMethodResponseDto>(`/payment-methods/${id}/default`);
  }

  remove(id: string): Observable<{ deleted: boolean }> {
    return this.api.delete<{ deleted: boolean }>(`/payment-methods/${id}`);
  }
}
