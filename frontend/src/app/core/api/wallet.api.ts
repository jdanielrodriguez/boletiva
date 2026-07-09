import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  RequestWithdrawalDto,
  WalletBalanceResponseDto,
  WithdrawalPageResponseDto,
  WithdrawalResponseDto,
} from './types';

/** Saldo interno (wallet) del usuario + retiros. */
@Injectable({ providedIn: 'root' })
export class WalletApi {
  private readonly api = inject(ApiClient);

  balance(): Observable<WalletBalanceResponseDto> {
    return this.api.get<WalletBalanceResponseDto>('/wallet');
  }

  /** Retiros propios (keyset). */
  withdrawals(cursor?: string): Observable<WithdrawalPageResponseDto> {
    return this.api.get<WithdrawalPageResponseDto>('/wallet/withdrawals', { cursor, limit: 50 });
  }

  /** Solicita un retiro del saldo (reserva en el ledger; queda pendiente). */
  requestWithdrawal(dto: RequestWithdrawalDto): Observable<WithdrawalResponseDto> {
    return this.api.post<WithdrawalResponseDto>('/wallet/withdrawals', dto);
  }

  /** Cancela un retiro propio pendiente (reintegra el saldo). */
  cancelWithdrawal(id: string): Observable<WithdrawalResponseDto> {
    return this.api.delete<WithdrawalResponseDto>(`/wallet/withdrawals/${id}`);
  }
}
