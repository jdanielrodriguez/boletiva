import { UpperCasePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { LangSwitcherComponent } from '../../shared/layout/lang-switcher.component';
import { MoneyPipe } from '../../shared/money.pipe';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, expand, of, reduce } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import { TicketsApi } from '../../core/api/tickets.api';
import { TransfersApi } from '../../core/api/transfers.api';
import { UsersApi } from '../../core/api/users.api';
import { WalletApi } from '../../core/api/wallet.api';
import type {
  MovementResponseDto,
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
import {
  ConfirmDialogComponent,
  type ConfirmRequest,
} from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PagerComponent } from '../../shared/ui/pager.component';

type Section = 'perfil' | 'metodos' | 'facturacion' | 'wallet' | 'activos' | 'pasados';
type TicketKind = 'activos' | 'pasados';

/** Tamaño de página para facturación y el NIVEL 1 (eventos) de los boletos. */
const ACCOUNT_PAGE = 6;
/** Tamaño de página del NIVEL 2: compras (órdenes) dentro de un mismo evento. */
const ORDERS_PER_EVENT = 3;

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
  imports: [FormsModule, TranslatePipe, LocalizedDatePipe, UpperCasePipe, MoneyPipe, RouterLink, IconComponent, ConfirmDialogComponent, PagerComponent, EmptyStateComponent, LangSwitcherComponent],
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
  private readonly translate = inject(TranslateService);
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

  // --- Facturación (movimientos: ingresos + egresos) ---
  /** Órdenes: solo para la mini-lista de movimientos del Wallet. */
  protected readonly orders = signal<OrderResponseDto[]>([]);
  /** Feed unificado de movimientos (egreso = compra; ingreso = refund/reventa/venta). */
  protected readonly movements = signal<MovementResponseDto[]>([]);
  /** Filtro por orden concreta (deep-link desde un boleto/compra). null = todas. */
  protected readonly orderFilter = signal<string | null>(null);
  /** Filtro de dirección: '' = todos | 'income' = ingresos | 'expense' = egresos. */
  protected readonly movementDir = signal<'' | 'income' | 'expense'>('');
  /** Filtros de facturación. */
  protected readonly filterEvent = signal<string>('');
  protected readonly filterDate = signal<string>('');
  /** Movimientos tras aplicar dirección/evento/fecha y el deep-link por orden. */
  protected readonly filteredMovements = computed(() => {
    const only = this.orderFilter();
    const dir = this.movementDir();
    const eventQ = this.filterEvent().trim().toLowerCase();
    const date = this.filterDate();
    // El backend ya devuelve los movimientos más recientes primero.
    return this.movements().filter((m) => {
      if (only) return m.orderId === only;
      if (dir && m.direction !== dir) return false;
      if (eventQ && !(m.eventName ?? '').toLowerCase().includes(eventQ)) return false;
      if (date && !(m.createdAt ?? '').startsWith(date)) return false;
      return true;
    });
  });
  /** ¿Hay al menos un ingreso? (para dar sentido al filtro Ingresos/Egresos). */
  protected readonly hasIncome = computed(() =>
    this.movements().some((m) => m.direction === 'income'),
  );
  /** Paginación de facturación (sobre los movimientos ya filtrados). */
  protected readonly billingPage = signal(1);
  protected readonly billingTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.filteredMovements().length / ACCOUNT_PAGE)),
  );
  protected readonly pageMovements = computed(() => {
    const start = (this.billingPage() - 1) * ACCOUNT_PAGE;
    return this.filteredMovements().slice(start, start + ACCOUNT_PAGE);
  });
  protected goToBillingPage(p: number): void {
    this.billingPage.set(Math.min(Math.max(1, p), this.billingTotalPages()));
  }
  /** Setters de filtro que reinician la página (facturación). */
  protected setMovementDir(v: '' | 'income' | 'expense'): void {
    this.movementDir.set(v);
    this.billingPage.set(1);
  }
  protected setFilterEvent(v: string): void {
    this.filterEvent.set(v);
    this.billingPage.set(1);
  }
  protected setFilterDate(v: string): void {
    this.filterDate.set(v);
    this.billingPage.set(1);
  }
  /** Cadena contable (blockchain) por orden, cargada bajo demanda. */
  protected readonly chains = signal<Record<string, OrderLedgerChainDto>>({});
  protected readonly loadingChain = signal<string | null>(null);

  // --- Boletos ---
  // Trae TODOS los boletos siguiendo el cursor keyset (no solo la 1.ª página de
  // 100), para que la paginación por evento/compra cuente y muestre todo aunque
  // el usuario tenga cientos de boletos.
  private readonly ticketsData = toSignal(
    this.ticketsApi.list().pipe(
      expand((page) => (page.nextCursor ? this.ticketsApi.list(page.nextCursor) : EMPTY)),
      reduce(
        (acc, page) => ({ items: [...(acc.items ?? []), ...(page.items ?? [])], nextCursor: null }),
        { items: [] } as TicketPageResponseDto,
      ),
      catchError(() => of({ items: [] } as TicketPageResponseDto)),
    ),
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

  // --- Boletos: paginación en 3 NIVELES ---
  // Nivel 1: por EVENTO (paginado). Nivel 2: por COMPRA dentro del evento
  // (paginado, ORDERS_PER_EVENT). Nivel 3: los boletos de una compra NO se paginan.
  protected readonly activosPage = signal(1);
  protected readonly pasadosPage = signal(1);
  /** Página de compras (nivel 2) por evento, para activos y pasados por separado. */
  private readonly activosOrderPages = signal<Record<string, number>>({});
  private readonly pasadosOrderPages = signal<Record<string, number>>({});

  private eventPageSignal(kind: TicketKind) {
    return kind === 'activos' ? this.activosPage : this.pasadosPage;
  }
  private groupsFor(kind: TicketKind): EventGroup[] {
    return kind === 'activos' ? this.activosGrouped() : this.pasadosGrouped();
  }
  private orderPagesSignal(kind: TicketKind) {
    return kind === 'activos' ? this.activosOrderPages : this.pasadosOrderPages;
  }

  /** Nivel 1: total de páginas de eventos. */
  protected eventTotalPages(kind: TicketKind): number {
    return Math.max(1, Math.ceil(this.groupsFor(kind).length / ACCOUNT_PAGE));
  }
  /** Nivel 1: eventos de la página actual. */
  protected pageEvents(kind: TicketKind): EventGroup[] {
    const start = (this.eventPageSignal(kind)() - 1) * ACCOUNT_PAGE;
    return this.groupsFor(kind).slice(start, start + ACCOUNT_PAGE);
  }
  protected goToEventPage(kind: TicketKind, p: number): void {
    this.eventPageSignal(kind).set(Math.min(Math.max(1, p), this.eventTotalPages(kind)));
  }

  /** Nivel 2: total de páginas de compras dentro de un evento. */
  protected orderTotalPages(eg: EventGroup): number {
    return Math.max(1, Math.ceil(eg.orders.length / ORDERS_PER_EVENT));
  }
  /** Nivel 2: página de compras actual del evento (1 por defecto). */
  protected orderPageOf(kind: TicketKind, eventId: string): number {
    return this.orderPagesSignal(kind)()[eventId] ?? 1;
  }
  /** Nivel 2: compras de la página actual de un evento. */
  protected pageOrdersOf(kind: TicketKind, eg: EventGroup): OrderGroup[] {
    const page = this.orderPageOf(kind, eg.eventId);
    const start = (page - 1) * ORDERS_PER_EVENT;
    return eg.orders.slice(start, start + ORDERS_PER_EVENT);
  }
  protected goToOrderPage(kind: TicketKind, eventId: string, p: number): void {
    const total = Math.max(
      1,
      Math.ceil(
        (this.groupsFor(kind).find((e) => e.eventId === eventId)?.orders.length ?? 0) /
          ORDERS_PER_EVENT,
      ),
    );
    const next = Math.min(Math.max(1, p), total);
    this.orderPagesSignal(kind).update((m) => ({ ...m, [eventId]: next }));
  }

  // Nivel 1 (compatibilidad con specs previos): activos por página + navegación.
  protected readonly activosTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.activosGrouped().length / ACCOUNT_PAGE)),
  );
  protected readonly pageActivosGrouped = computed(() => {
    const start = (this.activosPage() - 1) * ACCOUNT_PAGE;
    return this.activosGrouped().slice(start, start + ACCOUNT_PAGE);
  });
  protected goToActivosPage(p: number): void {
    this.activosPage.set(Math.min(Math.max(1, p), this.activosTotalPages()));
  }
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
      if (this.section() === 'facturacion') this.loadMovements();
      if (this.section() === 'wallet') this.loadOrders();
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
    if (s === 'facturacion' && this.movements().length === 0) this.loadMovements();
    if (s === 'wallet' && this.orders().length === 0) this.loadOrders();
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
          this.toasts.success(this.translate.instant('account.toast.cardSaved'));
        },
        error: () => {
          this.savingCard.set(false);
          this.toasts.error(this.translate.instant('account.toast.cardSaveError'));
        },
      });
  }

  protected setDefaultCard(id: string): void {
    this.paymentMethodsApi.setDefault(id).subscribe({
      next: () => {
        this.loadCards();
        this.toasts.info(this.translate.instant('account.toast.defaultUpdated'));
      },
      error: () => this.toasts.error(this.translate.instant('account.toast.defaultError')),
    });
  }

  // --- Confirmación de acciones destructivas ---
  protected readonly confirm = signal<ConfirmRequest | null>(null);
  protected onConfirmAccept(): void {
    const c = this.confirm();
    this.confirm.set(null);
    c?.onConfirm();
  }
  protected onConfirmCancel(): void {
    this.confirm.set(null);
  }

  protected askRemoveCard(c: PaymentMethodResponseDto): void {
    this.confirm.set({
      title: this.translate.instant('account.methods.removeCardTitle'),
      message: this.translate.instant('account.confirm.removeCardMessage', {
        brand: c.brand.toUpperCase(),
        last4: c.last4,
      }),
      onConfirm: () => this.removeCard(c.id),
    });
  }

  protected removeCard(id: string): void {
    this.paymentMethodsApi.remove(id).subscribe({
      next: () => {
        this.loadCards();
        this.toasts.info(this.translate.instant('account.toast.cardRemoved'));
      },
      error: () => this.toasts.error(this.translate.instant('account.toast.cardRemoveError')),
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
          this.toasts.success(this.translate.instant('account.toast.profileSaved'));
        },
        error: () => {
          this.savingProfile.set(false);
          this.toasts.error(this.translate.instant('account.toast.profileError'));
        },
      });
  }

  // --- Cambio de contraseña ---
  protected changePassword(): void {
    const current = this.currentPassword();
    const next = this.newPassword();
    const confirm = this.confirmPassword();
    if (!current || !next) {
      this.toasts.warning(this.translate.instant('account.toast.pwIncomplete'));
      return;
    }
    if (next.length < 8) {
      this.toasts.warning(this.translate.instant('account.toast.pwTooShort'));
      return;
    }
    if (next !== confirm) {
      this.toasts.warning(this.translate.instant('account.toast.pwMismatch'));
      return;
    }
    this.changingPassword.set(true);
    this.auth.changePassword({ currentPassword: current, newPassword: next }).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
        this.toasts.success(this.translate.instant('account.toast.pwChanged'));
      },
      error: () => {
        this.changingPassword.set(false);
        this.toasts.error(this.translate.instant('account.toast.pwChangeError'));
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
      this.toasts.warning(this.translate.instant('account.toast.withdrawInvalid'));
      return;
    }
    this.withdrawing.set(true);
    this.walletApi.requestWithdrawal({ amount }).subscribe({
      next: () => {
        this.withdrawing.set(false);
        this.withdrawAmount.set(null);
        this.loadWallet();
        this.toasts.success(this.translate.instant('account.toast.withdrawRequested'));
      },
      error: () => {
        this.withdrawing.set(false);
        this.toasts.error(this.translate.instant('account.toast.withdrawError'));
      },
    });
  }

  protected askCancelWithdrawal(w: WithdrawalResponseDto): void {
    this.confirm.set({
      title: this.translate.instant('account.confirm.cancelWithdrawalTitle'),
      message: this.translate.instant('account.confirm.cancelWithdrawalMessage'),
      confirmLabel: this.translate.instant('account.wallet.cancelWithdrawalTitle'),
      confirmIcon: 'cancel',
      onConfirm: () => this.cancelWithdrawal(w.id),
    });
  }

  protected cancelWithdrawal(id: string): void {
    this.walletApi.cancelWithdrawal(id).subscribe({
      next: () => {
        this.loadWallet();
        this.toasts.info(this.translate.instant('account.toast.withdrawCancelled'));
      },
      error: () => this.toasts.error(this.translate.instant('account.toast.withdrawCancelError')),
    });
  }

  // --- Facturación ---
  private loadOrders(): void {
    this.ordersApi.list().subscribe({
      next: (p) => this.orders.set(p.items ?? []),
      error: () => this.orders.set([]),
    });
  }

  /** Carga el feed de movimientos (ingresos + egresos) para la facturación. */
  private loadMovements(): void {
    this.ordersApi.movements().subscribe({
      next: (p) => this.movements.set(p.items ?? []),
      error: () => this.movements.set([]),
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
        this.toasts.error(this.translate.instant('account.toast.chainError'));
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
        this.toasts.warning(this.translate.instant('account.toast.mediaNotReady')),
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
        this.toasts.success(this.translate.instant('account.toast.transferStarted'));
      },
      error: () =>
        this.toasts.error(this.translate.instant('account.toast.transferError')),
    });
  }
}
