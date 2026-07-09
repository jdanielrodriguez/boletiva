import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { TicketsApi } from '../../core/api/tickets.api';
import { WalletApi } from '../../core/api/wallet.api';
import type { TicketPageResponseDto, TicketResponseDto } from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';

type Section = 'perfil' | 'metodos' | 'facturacion' | 'wallet' | 'activos' | 'pasados';

/**
 * Mi cuenta / Configuración: menú lateral con Perfil, Métodos de pago (agregar),
 * Facturación (historial), Wallet (saldo) y Boletos activos/pasados (por estado
 * del boleto: `valid` = activo, `used` = pasado). Ruta protegida (authGuard).
 */
@Component({
  selector: 'app-account',
  templateUrl: './account.html',
})
export class Account {
  protected readonly session = inject(SessionStore);
  private readonly walletApi = inject(WalletApi);
  private readonly ticketsApi = inject(TicketsApi);

  protected readonly section = signal<Section>('perfil');
  protected readonly addMethodNote = signal(false);

  protected readonly wallet = toSignal(
    this.walletApi.balance().pipe(catchError(() => of(null))),
    { initialValue: null },
  );

  private readonly tickets = toSignal(
    this.ticketsApi.list().pipe(catchError(() => of({ items: [] } as TicketPageResponseDto))),
    { initialValue: { items: [] } as TicketPageResponseDto },
  );
  protected readonly activos = computed(() =>
    (this.tickets().items ?? []).filter((t: TicketResponseDto) => t.status === 'valid'),
  );
  protected readonly pasados = computed(() =>
    (this.tickets().items ?? []).filter((t: TicketResponseDto) => t.status === 'used'),
  );

  protected select(s: Section): void {
    this.section.set(s);
  }

  protected addMethod(): void {
    this.addMethodNote.set(true);
  }
}
