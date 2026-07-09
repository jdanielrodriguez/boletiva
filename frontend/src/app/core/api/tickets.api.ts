import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { TicketPageResponseDto } from './types';

/** Boletos del usuario (keyset). */
@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly api = inject(ApiClient);

  list(cursor?: string): Observable<TicketPageResponseDto> {
    return this.api.get<TicketPageResponseDto>('/tickets', { cursor, limit: 100 });
  }
}
