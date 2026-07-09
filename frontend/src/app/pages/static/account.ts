import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { TransfersApi } from '../../core/api/transfers.api';
import { UsersApi } from '../../core/api/users.api';
import { WalletApi } from '../../core/api/wallet.api';
import type {
  OrderResponseDto,
  TicketMediaResponseDto,
  TicketPageResponseDto,
  TicketResponseDto,
  WithdrawalResponseDto,
} from '../../core/api/types';
import { SessionStore } from '../../core/auth/session.store';

type Section = 'perfil' | 'metodos' | 'facturacion' | 'wallet' | 'activos' | 'pasados';

/**
 * Mi cuenta / Configuración (F3): menú lateral con Perfil (editable), Métodos de
 * pago (placeholder tokenización), Facturación (historial de órdenes), Wallet
 * (saldo + retiros) y Boletos activos/pasados (activo=`valid`, pasado=`used`) con
 * media (QR/PDF) y transferencia. Ruta protegida (authGuard).
 */
@Component({
  selector: 'app-account',
  imports: [FormsModule, DatePipe],
  templateUrl: './account.html',
})
export class Account {
  protected readonly session = inject(SessionStore);
  private readonly walletApi = inject(WalletApi);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly ordersApi = inject(OrdersApi);
  private readonly transfersApi = inject(TransfersApi);
  private readonly usersApi = inject(UsersApi);

  protected readonly section = signal<Section>('perfil');
  protected readonly addMethodNote = signal(false);

  // --- Perfil editable ---
  protected readonly firstName = signal(this.session.user()?.firstName ?? '');
  protected readonly lastName = signal(this.session.user()?.lastName ?? '');
  protected readonly phone = signal((this.session.user() as { phone?: string })?.phone ?? '');
  protected readonly savingProfile = signal(false);
  protected readonly profileSaved = signal(false);
  protected readonly profileError = signal<string | null>(null);

  // --- Wallet + retiros ---
  protected readonly wallet = signal<{ balance: string; currency: string } | null>(null);
  protected readonly withdrawals = signal<WithdrawalResponseDto[]>([]);
  protected readonly withdrawAmount = signal<number | null>(null);
  protected readonly withdrawing = signal(false);
  protected readonly withdrawError = signal<string | null>(null);

  // --- Facturación (órdenes) ---
  protected readonly orders = signal<OrderResponseDto[]>([]);

  // --- Boletos ---
  private readonly ticketsData = toSignal(
    this.ticketsApi.list().pipe(catchError(() => of({ items: [] } as TicketPageResponseDto))),
    { initialValue: { items: [] } as TicketPageResponseDto },
  );
  protected readonly activos = computed(() =>
    (this.ticketsData().items ?? []).filter((t: TicketResponseDto) => t.status === 'valid'),
  );
  protected readonly pasados = computed(() =>
    (this.ticketsData().items ?? []).filter((t: TicketResponseDto) => t.status === 'used'),
  );
  /** Media (QR/PDF) por boleto, cargada bajo demanda. */
  protected readonly media = signal<Record<string, TicketMediaResponseDto>>({});
  /** Código de transferencia por boleto (se muestra una sola vez). */
  protected readonly transferCode = signal<Record<string, string>>({});
  protected readonly ticketError = signal<string | null>(null);

  constructor() {
    this.loadWallet();
  }

  protected select(s: Section): void {
    this.section.set(s);
    if (s === 'facturacion' && this.orders().length === 0) this.loadOrders();
  }

  protected addMethod(): void {
    this.addMethodNote.set(true);
  }

  // --- Perfil ---
  protected saveProfile(): void {
    this.savingProfile.set(true);
    this.profileSaved.set(false);
    this.profileError.set(null);
    this.usersApi
      .updateMe({
        firstName: this.firstName() || undefined,
        lastName: this.lastName() || undefined,
        phone: this.phone() || undefined,
      })
      .subscribe({
        next: (user) => {
          this.session.setUser(user);
          this.savingProfile.set(false);
          this.profileSaved.set(true);
        },
        error: () => {
          this.savingProfile.set(false);
          this.profileError.set('No se pudo guardar el perfil. Revisa los datos e intenta de nuevo.');
        },
      });
  }

  // --- Wallet ---
  private loadWallet(): void {
    this.walletApi.balance().subscribe({
      next: (w) => this.wallet.set(w),
      error: () => this.wallet.set(null),
    });
    this.walletApi.withdrawals().subscribe({
      next: (p) => this.withdrawals.set(p.items ?? []),
      error: () => this.withdrawals.set([]),
    });
  }

  protected requestWithdrawal(): void {
    const amount = this.withdrawAmount();
    if (!amount || amount <= 0) {
      this.withdrawError.set('Ingresa un monto válido.');
      return;
    }
    this.withdrawing.set(true);
    this.withdrawError.set(null);
    this.walletApi.requestWithdrawal({ amount }).subscribe({
      next: () => {
        this.withdrawing.set(false);
        this.withdrawAmount.set(null);
        this.loadWallet();
      },
      error: () => {
        this.withdrawing.set(false);
        this.withdrawError.set('No se pudo solicitar el retiro (¿saldo insuficiente?).');
      },
    });
  }

  protected cancelWithdrawal(id: string): void {
    this.walletApi.cancelWithdrawal(id).subscribe({ next: () => this.loadWallet() });
  }

  // --- Facturación ---
  private loadOrders(): void {
    this.ordersApi.list().subscribe({
      next: (p) => this.orders.set(p.items ?? []),
      error: () => this.orders.set([]),
    });
  }

  // --- Boletos: media + transferencia ---
  protected loadMedia(ticketId: string): void {
    this.ticketError.set(null);
    this.ticketsApi.media(ticketId).subscribe({
      next: (m) => this.media.update((cur) => ({ ...cur, [ticketId]: m })),
      error: () => this.ticketError.set('La media del boleto aún no está lista. Intenta en unos segundos.'),
    });
  }

  protected startTransfer(ticketId: string): void {
    this.ticketError.set(null);
    this.ticketsApi.transfer(ticketId).subscribe({
      next: (t) => this.transferCode.update((cur) => ({ ...cur, [ticketId]: t.code })),
      error: () =>
        this.ticketError.set('No se pudo iniciar la transferencia (¿ya hay una pendiente o alcanzaste el límite?).'),
    });
  }
}
