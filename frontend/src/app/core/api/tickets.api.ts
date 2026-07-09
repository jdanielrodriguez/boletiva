import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  TicketMediaResponseDto,
  TicketPageResponseDto,
  TicketResponseDto,
  TransferInitiatedDto,
} from './types';

/** Boletos del usuario (keyset), su media (QR/PDF) y transferencia. */
@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly api = inject(ApiClient);

  list(cursor?: string): Observable<TicketPageResponseDto> {
    return this.api.get<TicketPageResponseDto>('/tickets', { cursor, limit: 100 });
  }

  get(id: string): Observable<TicketResponseDto> {
    return this.api.get<TicketResponseDto>(`/tickets/${id}`);
  }

  /** URLs firmadas del QR (PNG) y del pase (PDF). */
  media(id: string): Observable<TicketMediaResponseDto> {
    return this.api.get<TicketMediaResponseDto>(`/tickets/${id}/media`);
  }

  /** Inicia una transferencia (regalo): devuelve el código a compartir (solo aquí). */
  transfer(id: string): Observable<TransferInitiatedDto> {
    return this.api.post<TransferInitiatedDto>(`/tickets/${id}/transfer`);
  }
}
