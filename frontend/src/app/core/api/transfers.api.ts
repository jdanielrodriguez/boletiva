import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { OutgoingTransferDto, TransferCancelledDto, TransferClaimedDto } from './types';

/**
 * Transferencias de boletos (regalo interno por código compartido). El inicio de
 * la transferencia vive en TicketsApi.transfer (necesita el ticketId).
 */
@Injectable({ providedIn: 'root' })
export class TransfersApi {
  private readonly api = inject(ApiClient);

  /** Canjea un código: re-emite el boleto al nuevo dueño (invalida el anterior). */
  claim(code: string): Observable<TransferClaimedDto> {
    return this.api.post<TransferClaimedDto>('/tickets/transfers/claim', { code });
  }

  /** Transferencias pendientes iniciadas por el usuario (salientes). */
  outgoing(): Observable<OutgoingTransferDto[]> {
    return this.api.get<OutgoingTransferDto[]>('/tickets/transfers/outgoing');
  }

  /** Cancela una transferencia pendiente propia. */
  cancel(id: string): Observable<TransferCancelledDto> {
    return this.api.delete<TransferCancelledDto>(`/tickets/transfers/${id}`);
  }
}
