import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  CheckoutDto,
  OrderLedgerChainDto,
  OrderPageResponseDto,
  OrderResponseDto,
  PayOrderDto,
  PayOrderResponseDto,
  PaymentOptionsResponseDto,
} from './types';

/** Órdenes y pago (server-authoritative: el cliente nunca envía montos). */
@Injectable({ providedIn: 'root' })
export class OrdersApi {
  private readonly api = inject(ApiClient);

  /** Commit: convierte los asientos reservados en una orden. */
  create(eventId: string, body: CheckoutDto): Observable<OrderResponseDto> {
    return this.api.post<OrderResponseDto>(`/events/${eventId}/orders`, body);
  }

  /** Historial de órdenes del comprador (keyset). */
  list(cursor?: string): Observable<OrderPageResponseDto> {
    return this.api.get<OrderPageResponseDto>('/orders', { cursor, limit: 50 });
  }

  get(orderId: string): Observable<OrderResponseDto> {
    return this.api.get<OrderResponseDto>(`/orders/${orderId}`);
  }

  /** Cadena contable (hash-chain) de la orden — vista blockchain de transparencia. */
  ledgerChain(orderId: string): Observable<OrderLedgerChainDto> {
    return this.api.get<OrderLedgerChainDto>(`/orders/${orderId}/ledger`);
  }

  /** Opciones de pago por pasarela (total del comprador + plazos disponibles). */
  paymentOptions(orderId: string): Observable<PaymentOptionsResponseDto> {
    return this.api.get<PaymentOptionsResponseDto>(`/orders/${orderId}/payment-options`);
  }

  /** Inicia el pago (recotiza por método/cuotas); la confirmación llega por webhook/SSE. */
  pay(orderId: string, body: PayOrderDto): Observable<PayOrderResponseDto> {
    return this.api.post<PayOrderResponseDto>(`/orders/${orderId}/pay`, body);
  }
}
