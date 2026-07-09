import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { MoneyPipe } from '../../shared/money.pipe';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { TransfersApi } from '../../core/api/transfers.api';
import { UsersApi } from '../../core/api/users.api';
import { WalletApi } from '../../core/api/wallet.api';
import type {
  OrderLedgerChainDto,
  OrderResponseDto,
  PaymentMethodResponseDto,
  TicketMediaResponseDto,
  TicketPageResponseDto,
  TicketResponseDto,
  WithdrawalResponseDto,
} from '../../core/api/types';
import { CardTokenizerStub } from '../../core/payments/card-tokenizer.stub';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';

type Section = 'perfil' | 'metodos' | 'facturacion' | 'wallet' | 'activos' | 'pasados';

/** Grupo de boletos de una misma compra (orden). */
interface OrderGroup {
  orderId: string;
  tickets: TicketResponseDto[];
}
/** Grupo de boletos por evento (con sus compras). */
interface EventGroup {
  eventId: string;
  eventName: string;
  startsAt?: string;
  /** Banner (cover) firmado del evento, para el boleto estilo póster. */
  bannerUrl?: string | null;
  orders: OrderGroup[];
}

/**
 * Agrupa boletos por EVENTO y, dentro de cada evento, por COMPRA (orderId): así se
 * revisa cada compra por separado. La localidad/asiento va como detalle del boleto.
 */
function groupByEventOrder(tickets: TicketResponseDto[]): EventGroup[] {
  const byEvent = new Map<string, EventGroup>();
  for (const t of tickets) {
    const eventName = t.event?.name ?? t.eventId;
    let eg = byEvent.get(t.eventId);
    if (!eg) {
      eg = {
        eventId: t.eventId,
        eventName,
        startsAt: t.event?.startsAt,
        bannerUrl: (t as { eventBannerUrl?: string | null }).eventBannerUrl ?? null,
        orders: [],
      };
      byEvent.set(t.eventId, eg);
    }
    let og = eg.orders.find((o) => o.orderId === t.orderId);
    if (!og) {
      og = { orderId: t.orderId, tickets: [] };
      eg.orders.push(og);
    }
    og.tickets.push(t);
  }
  return [...byEvent.values()];
}

/**
 * Mi cuenta (F3 + backlog perfiles v2): menú lateral con Perfil (datos + cambio
 * de contraseña), Métodos de pago (tokenización PCI), Facturación (historial +
 * vista blockchain), Wallet (saldo + retiros, SIN recarga) y Boletos
 * activos/pasados en cards (QR/PDF + transferencia). Las notificaciones salen por
 * TOASTS (no notas grises). Ruta protegida (authGuard).
 */
@Component({
  selector: 'app-account',
  imports: [FormsModule, DatePipe, UpperCasePipe, MoneyPipe, RouterLink],
  templateUrl: './account.html',
})
export class Account {
  protected readonly session = inject(SessionStore);
  private readonly walletApi = inject(WalletApi);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly ordersApi = inject(OrdersApi);
  private readonly transfersApi = inject(TransfersApi);
  private readonly usersApi = inject(UsersApi);
  private readonly paymentMethodsApi = inject(PaymentMethodsApi);
  private readonly tokenizer = inject(CardTokenizerStub);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);

  private readonly route = inject(ActivatedRoute);
  protected readonly section = signal<Section>('perfil');

  /** Secciones válidas para el deep-link `?s=` (accesos rápidos del dropdown). */
  private static readonly SECTIONS: Section[] = [
    'perfil',
    'metodos',
    'facturacion',
    'wallet',
    'activos',
    'pasados',
  ];

  // --- Perfil editable ---
  protected readonly firstName = signal(this.session.user()?.firstName ?? '');
  protected readonly lastName = signal(this.session.user()?.lastName ?? '');
  protected readonly phone = signal((this.session.user() as { phone?: string })?.phone ?? '');
  protected readonly savingProfile = signal(false);

  // --- Métodos de pago (tarjetas tokenizadas, PCI) ---
  protected readonly cards = signal<PaymentMethodResponseDto[]>([]);
  protected readonly cardNumber = signal('');
  protected readonly cardExpMonth = signal('');
  protected readonly cardExpYear = signal('');
  protected readonly cardCvc = signal('');
  protected readonly savingCard = signal(false);
  protected readonly showCardForm = signal(false);

  // --- Cambio de contraseña (autenticado) ---
  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly changingPassword = signal(false);

  // --- Wallet + retiros ---
  protected readonly wallet = signal<{ balance: string; currency: string } | null>(null);
  protected readonly withdrawals = signal<WithdrawalResponseDto[]>([]);
  protected readonly withdrawAmount = signal<number | null>(null);
  protected readonly withdrawing = signal(false);
  /** Filtros de la tabla de retiros (estado/fecha). */
  protected readonly wdFilterStatus = signal<string>('');
  protected readonly wdFilterDate = signal<string>('');
  protected readonly withdrawalStatuses = computed(() => [
    ...new Set(this.withdrawals().map((w) => w.status)),
  ]);
  protected readonly filteredWithdrawals = computed(() => {
    const status = this.wdFilterStatus();
    const date = this.wdFilterDate();
    return this.withdrawals().filter((w) => {
      if (status && w.status !== status) return false;
      if (date && !((w as { createdAt?: string }).createdAt ?? '').startsWith(date)) return false;
      return true;
    });
  });
  /**
   * Comisión de retiro estimada por rol: promotor 3%, usuario 6% (el doble). Es
   * solo una previsualización; el valor autoritativo lo calcula el backend.
   */
  protected readonly withdrawFeePct = computed(() =>
    this.session.hasAnyRole?.(['promoter', 'admin']) ? 0.03 : 0.06,
  );
  /** Neto estimado a recibir (monto − comisión), para la previsualización. */
  protected readonly withdrawNetPreview = computed(() => {
    const amount = this.withdrawAmount() ?? 0;
    if (amount <= 0) return null;
    return amount * (1 - this.withdrawFeePct());
  });

  // --- Facturación (órdenes) ---
  protected readonly orders = signal<OrderResponseDto[]>([]);
  /** Filtro por orden concreta (deep-link desde un boleto/compra). null = todas. */
  protected readonly orderFilter = signal<string | null>(null);
  /** Filtros de facturación. */
  protected readonly filterStatus = signal<string>('');
  protected readonly filterEvent = signal<string>('');
  protected readonly filterDate = signal<string>('');
  /** Órdenes tras aplicar los filtros (estado/evento/fecha) y el deep-link. */
  protected readonly filteredOrders = computed(() => {
    const of = this.orderFilter();
    const status = this.filterStatus();
    const eventQ = this.filterEvent().trim().toLowerCase();
    const date = this.filterDate();
    return this.orders().filter((o) => {
      if (of) return o.id === of;
      if (status && o.status !== status) return false;
      if (eventQ && !(o.event?.name ?? o.eventId).toLowerCase().includes(eventQ)) return false;
      if (date && !(o.createdAt ?? '').startsWith(date)) return false;
      return true;
    });
  });
  /** Estados distintos presentes (para el selector de filtro). */
  protected readonly orderStatuses = computed(() => [...new Set(this.orders().map((o) => o.status))]);
  /** Cadena contable (blockchain) por orden, cargada bajo demanda. */
  protected readonly chains = signal<Record<string, OrderLedgerChainDto>>({});
  protected readonly loadingChain = signal<string | null>(null);

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
  /** Boletos activos y pasados agrupados por evento → compra (para las cards). */
  protected readonly activosGrouped = computed(() => groupByEventOrder(this.activos()));
  protected readonly pasadosGrouped = computed(() => groupByEventOrder(this.pasados()));
  /** Media (QR/PDF) por boleto, cargada bajo demanda. */
  protected readonly media = signal<Record<string, TicketMediaResponseDto>>({});
  /** QR oculto por boleto (por defecto el QR se muestra; el botón alterna). */
  protected readonly qrHidden = signal<Record<string, boolean>>({});
  /** Boletos cuya media ya se pidió (evita recargas al reejecutarse el efecto). */
  private readonly mediaRequested = new Set<string>();
  /** Código de transferencia por boleto (se muestra una sola vez). */
  protected readonly transferCode = signal<Record<string, string>>({});

  constructor() {
    this.loadWallet();

    // Deep-link REACTIVO a `?s=` y `?order=`: nos suscribimos a queryParamMap (no
    // snapshot). Así, al navegar dentro de /cuenta cambiando el query param (accesos
    // rápidos del header, misma instancia del componente), la URL cambia Y la vista
    // se re-despliega. Antes se leía una sola vez en el constructor → la URL cambiaba
    // pero la sección no. Fix del bug del menú.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((pm) => {
      const s = pm.get('s') as Section | null;
      this.section.set(s && Account.SECTIONS.includes(s) ? s : 'perfil');
      this.orderFilter.set(pm.get('order'));
      if (this.section() === 'facturacion' || this.section() === 'wallet') this.loadOrders();
      if (this.section() === 'metodos') this.loadCards();
    });

    // El QR se muestra por defecto: al abrir "activos", precargamos la media de los
    // boletos cuya media ya esté lista (una sola vez por boleto).
    effect(() => {
      if (this.section() !== 'activos') return;
      for (const t of this.activos()) {
        if (t.mediaReady && !this.mediaRequested.has(t.id)) {
          this.mediaRequested.add(t.id);
          this.loadMedia(t.id);
        }
      }
    });
  }

  /**
   * Cambia de sección (menú lateral): fija la señal → respuesta inmediata. La
   * navegación EXTERNA por query param (accesos rápidos del header sobre la MISMA
   * instancia de /cuenta) la maneja la suscripción a queryParamMap del constructor
   * — ese era el bug: la URL cambiaba pero la vista no se re-desplegaba.
   */
  protected select(s: Section): void {
    this.section.set(s); // respuesta inmediata del menú lateral (y para tests)
    this.orderFilter.set(null);
    if ((s === 'facturacion' || s === 'wallet') && this.orders().length === 0) this.loadOrders();
    if (s === 'metodos' && this.cards().length === 0) this.loadCards();
    // Sincroniza el ESTADO DEL ROUTER (no solo la URL): así el dropdown del header
    // nunca queda en navegación nula tras usar el menú lateral (bug del "menú que
    // deja de responder"). replaceState del Location no basta: no actualiza el
    // estado interno del router y la navegación siguiente al mismo query se ignora.
    void this.router
      .navigate(['/cuenta'], { queryParams: { s: s === 'perfil' ? null : s } })
      .catch(() => undefined);
  }

  // --- Métodos de pago ---
  private loadCards(): void {
    this.paymentMethodsApi.list().subscribe({
      next: (c) => this.cards.set(c),
      error: () => this.cards.set([]),
    });
  }

  /**
   * Guarda una tarjeta. PCI: el número se tokeniza EN EL NAVEGADOR (stub que simula
   * el SDK de la pasarela); al backend solo viaja el nonce + marca + últimos 4.
   */
  protected addCard(): void {
    let token;
    try {
      token = this.tokenizer.tokenize({
        number: this.cardNumber(),
        expMonth: this.cardExpMonth(),
        expYear: this.cardExpYear(),
        cvc: this.cardCvc(),
      });
    } catch (e) {
      this.toasts.warning((e as Error).message);
      return;
    }
    this.savingCard.set(true);
    this.paymentMethodsApi
      .add({ nonce: token.nonce, brand: token.brand, last4: token.last4 })
      .subscribe({
        next: () => {
          this.savingCard.set(false);
          this.showCardForm.set(false);
          this.cardNumber.set('');
          this.cardExpMonth.set('');
          this.cardExpYear.set('');
          this.cardCvc.set('');
          this.loadCards();
          this.toasts.success('Tarjeta guardada de forma segura (tokenizada).');
        },
        error: () => {
          this.savingCard.set(false);
          this.toasts.error('No se pudo guardar la tarjeta. Intenta de nuevo.');
        },
      });
  }

  protected setDefaultCard(id: string): void {
    this.paymentMethodsApi.setDefault(id).subscribe({
      next: () => {
        this.loadCards();
        this.toasts.info('Método predeterminado actualizado.');
      },
      error: () => this.toasts.error('No se pudo actualizar el método predeterminado.'),
    });
  }

  protected removeCard(id: string): void {
    this.paymentMethodsApi.remove(id).subscribe({
      next: () => {
        this.loadCards();
        this.toasts.info('Tarjeta eliminada.');
      },
      error: () => this.toasts.error('No se pudo eliminar la tarjeta.'),
    });
  }

  // --- Perfil ---
  protected saveProfile(): void {
    this.savingProfile.set(true);
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
          this.toasts.success('Perfil actualizado.');
        },
        error: () => {
          this.savingProfile.set(false);
          this.toasts.error('No se pudo guardar el perfil. Revisa los datos e intenta de nuevo.');
        },
      });
  }

  // --- Cambio de contraseña ---
  protected changePassword(): void {
    const current = this.currentPassword();
    const next = this.newPassword();
    const confirm = this.confirmPassword();
    if (!current || !next) {
      this.toasts.warning('Completa la contraseña actual y la nueva.');
      return;
    }
    if (next.length < 8) {
      this.toasts.warning('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (next !== confirm) {
      this.toasts.warning('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    this.changingPassword.set(true);
    this.auth.changePassword({ currentPassword: current, newPassword: next }).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
        this.toasts.success('Contraseña actualizada.');
      },
      error: () => {
        this.changingPassword.set(false);
        this.toasts.error('No se pudo cambiar la contraseña. ¿La actual es correcta?');
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
      this.toasts.warning('Ingresa un monto válido para retirar.');
      return;
    }
    this.withdrawing.set(true);
    this.walletApi.requestWithdrawal({ amount }).subscribe({
      next: () => {
        this.withdrawing.set(false);
        this.withdrawAmount.set(null);
        this.loadWallet();
        this.toasts.success('Retiro solicitado. Queda pendiente de aprobación.');
      },
      error: () => {
        this.withdrawing.set(false);
        this.toasts.error('No se pudo solicitar el retiro (¿saldo insuficiente?).');
      },
    });
  }

  protected cancelWithdrawal(id: string): void {
    this.walletApi.cancelWithdrawal(id).subscribe({
      next: () => {
        this.loadWallet();
        this.toasts.info('Retiro cancelado. El saldo fue reintegrado.');
      },
      error: () => this.toasts.error('No se pudo cancelar el retiro.'),
    });
  }

  // --- Facturación ---
  private loadOrders(): void {
    this.ordersApi.list().subscribe({
      next: (p) => this.orders.set(p.items ?? []),
      error: () => this.orders.set([]),
    });
  }

  /** Limpia el filtro por orden concreta (vuelve a ver todas las compras). */
  protected clearOrderFilter(): void {
    this.orderFilter.set(null);
  }

  /** Carga (bajo demanda) la cadena contable de una orden para la vista blockchain. */
  protected loadChain(orderId: string): void {
    if (this.chains()[orderId]) {
      // Ya cargada: alterna ocultándola.
      this.chains.update((c) => {
        const next = { ...c };
        delete next[orderId];
        return next;
      });
      return;
    }
    this.loadingChain.set(orderId);
    this.ordersApi.ledgerChain(orderId).subscribe({
      next: (chain) => {
        this.chains.update((c) => ({ ...c, [orderId]: chain }));
        this.loadingChain.set(null);
      },
      error: () => {
        this.loadingChain.set(null);
        this.toasts.error('No se pudo cargar la cadena de la transacción.');
      },
    });
  }

  /** Abre la vista dedicada de detalle de la transacción (compra). */
  protected verCompra(orderId: string): void {
    void this.router.navigate(['/cuenta/transaccion', orderId]);
  }

  // --- Boletos: media + transferencia ---
  protected loadMedia(ticketId: string): void {
    this.ticketsApi.media(ticketId).subscribe({
      next: (m) => this.media.update((cur) => ({ ...cur, [ticketId]: m })),
      error: () =>
        this.toasts.warning('La media del boleto aún no está lista. Intenta en unos segundos.'),
    });
  }

  /** Alterna la visibilidad del QR; si va a mostrarse y no está cargado, lo pide. */
  protected toggleQr(ticketId: string): void {
    const hidden = !this.qrHidden()[ticketId];
    this.qrHidden.update((cur) => ({ ...cur, [ticketId]: hidden }));
    if (!hidden && !this.media()[ticketId]) {
      this.mediaRequested.add(ticketId);
      this.loadMedia(ticketId);
    }
  }

  /** true si el QR debe verse (por defecto sí, salvo que se haya ocultado). */
  protected qrVisible(ticketId: string): boolean {
    return !this.qrHidden()[ticketId];
  }

  protected startTransfer(ticketId: string): void {
    this.ticketsApi.transfer(ticketId).subscribe({
      next: (t) => {
        this.transferCode.update((cur) => ({ ...cur, [ticketId]: t.code }));
        this.toasts.success('Transferencia iniciada. Comparte el código con quien recibirá el boleto.');
      },
      error: () =>
        this.toasts.error('No se pudo iniciar la transferencia (¿ya hay una pendiente o alcanzaste el límite?).'),
    });
  }
}
