import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';
import { MoneyPipe } from '../../shared/money.pipe';
import { OrdersApi } from '../../core/api/orders.api';
import type { OrderLedgerChainDto, OrderResponseDto } from '../../core/api/types';
import { ToastService } from '../../core/ui/toast.service';

/**
 * Detalle de UNA transacción (compra). Vista dedicada a la que llegan tanto la
 * facturación como los boletos: evento, fecha, método, descripción de cada boleto
 * (localidad/asiento), montos por ítem, total, NIT/FEL y la cadena blockchain de
 * esa orden (partida doble + hash-chain, vía `GET /orders/:id/ledger`). authGuard.
 */
@Component({
  selector: 'app-transaction-detail',
  imports: [DatePipe, RouterLink, MoneyPipe],
  templateUrl: './transaction-detail.html',
})
export class TransactionDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly ordersApi = inject(OrdersApi);
  private readonly toasts = inject(ToastService);

  protected readonly orderId = signal('');
  protected readonly notFound = signal(false);

  private readonly data = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => {
        const id = pm.get('orderId') ?? '';
        this.orderId.set(id);
        return this.ordersApi.get(id).pipe(
          catchError(() => {
            this.notFound.set(true);
            return of(null);
          }),
        );
      }),
    ),
    { initialValue: undefined },
  );

  protected readonly order = computed<OrderResponseDto | null>(() => this.data() ?? null);
  protected readonly loading = computed(() => this.data() === undefined && !this.notFound());

  protected readonly chain = signal<OrderLedgerChainDto | null>(null);
  protected readonly loadingChain = signal(false);

  /** Carga (alterna) la cadena contable de la orden para la vista blockchain. */
  protected toggleChain(): void {
    if (this.chain()) {
      this.chain.set(null);
      return;
    }
    this.loadingChain.set(true);
    this.ordersApi.ledgerChain(this.orderId()).subscribe({
      next: (c) => {
        this.chain.set(c);
        this.loadingChain.set(false);
      },
      error: () => {
        this.loadingChain.set(false);
        this.toasts.error('No se pudo cargar la cadena de la transacción.');
      },
    });
  }
}
