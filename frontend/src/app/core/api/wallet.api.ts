import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { WalletBalanceResponseDto } from './types';

/** Saldo interno (wallet) del usuario. */
@Injectable({ providedIn: 'root' })
export class WalletApi {
  private readonly api = inject(ApiClient);

  balance(): Observable<WalletBalanceResponseDto> {
    return this.api.get<WalletBalanceResponseDto>('/wallet');
  }
}
