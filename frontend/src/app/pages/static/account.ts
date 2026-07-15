import { HttpResponse } from '@angular/common/http';
import { DOCUMENT, UpperCasePipe, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, PLATFORM_ID, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocalizedDatePipe } from '../../core/i18n/localized-date.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Lang } from '../../core/i18n/i18n.types';
import { MoneyPipe } from '../../shared/money.pipe';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, expand, of, reduce } from 'rxjs';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
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
import type { CardBrand } from '../../core/payments/card-tokenizer.stub';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfirmController } from '../../shared/confirm-dialog/confirm-controller';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { IconComponent } from '../../shared/icon/icon.component';
import { TicketTransferModal } from '../../shared/ticket-transfer-modal/ticket-transfer-modal.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PagerComponent } from '../../shared/ui/pager.component';
import { StatusLabelPipe } from '../../shared/ui/status-label.pipe';

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
  imports: [FormsModule, TranslatePipe, LocalizedDatePipe, UpperCasePipe, MoneyPipe, RouterLink, IconComponent, ConfirmDialogComponent, PagerComponent, EmptyStateComponent, StatusLabelPipe, TicketTransferModal],
  templateUrl: './account.html',
})
export class Account {
  protected readonly session = inject(SessionStore);
  private readonly walletApi = inject(WalletApi);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly ordersApi = inject(OrdersApi);
  private readonly promoterEventsApi = inject(PromoterEventsApi);
  private readonly transfersApi = inject(TransfersApi);
  private readonly usersApi = inject(UsersApi);
  private readonly paymentMethodsApi = inject(PaymentMethodsApi);
  private readonly tokenizer = inject(CardTokenizerStub);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

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

  // --- Foto de perfil (opcional) ---
  protected readonly pendingAvatarFile = signal<File | null>(null);
  protected readonly pendingAvatarUrl = signal<string | null>(null);
  protected readonly uploadingAvatar = signal(false);
  /** Iniciales para el placeholder cuando no hay foto. */
  protected readonly avatarInitials = computed(() => {
    const u = this.session.user();
    const ini = `${u?.firstName?.[0] ?? ''}${u?.lastName?.[0] ?? ''}`.trim();
    return (ini || u?.email?.[0] || '?').toUpperCase();
  });

  // --- Preferencia de idioma persistente en BD (v3.7) ---
  /** Idioma persistido del usuario (o el idioma activo si aún no tiene). */
  protected readonly persistedLang = computed<Lang>(() => {
    const saved = (this.session.user()?.language ?? '') as Lang;
    return saved === 'es' || saved === 'en' ? saved : this.i18n.lang();
  });
  /** Idioma seleccionado en el perfil (sin aplicar hasta Guardar). */
  protected readonly profileLang = signal<Lang>(this.persistedLang());
  /** ¿Cambió respecto al persistido? → muestra el botón Guardar. */
  protected readonly languageDirty = computed(() => this.profileLang() !== this.persistedLang());
  protected readonly savingLanguage = signal(false);
  protected setProfileLang(lang: Lang): void {
    this.profileLang.set(lang);
  }
  /** Persiste la preferencia en BD (PATCH /users/me), actualiza sesión y aplica. */
  protected saveLanguage(): void {
    const lang = this.profileLang();
    this.savingLanguage.set(true);
    this.usersApi.updateMe({ language: lang }).subscribe({
      next: (user) => {
        this.session.setUser(user);
        this.i18n.use(lang);
        this.savingLanguage.set(false);
        this.toasts.success(this.translate.instant('account.language.saved'));
      },
      error: () => {
        this.savingLanguage.set(false);
        this.toasts.error(this.translate.instant('account.language.saveError'));
      },
    });
  }

  // --- Métodos de pago (tarjetas tokenizadas, PCI) ---
  protected readonly cards = signal<PaymentMethodResponseDto[]>([]);
  /** Número de tarjeta: se guarda SOLO dígitos; se muestra formateado (grupos). */
  protected readonly cardNumber = signal('');
  protected readonly cardExpMonth = signal('');
  protected readonly cardExpYear = signal('');
  protected readonly cardCvc = signal('');
  protected readonly savingCard = signal(false);
  protected readonly showCardForm = signal(false);
  /** Referencia al input de AÑO para autofocar al completar el MES (B6.2). */
  private readonly expYearInput = viewChild<ElementRef<HTMLInputElement>>('expYearInput');

  /** Marca detectada del número tecleado (visa/mastercard/amex/discover/other). */
  protected readonly cardBrand = computed<CardBrand>(() => this.tokenizer.detectBrand(this.cardNumber()));
  /** Solo visa/mastercard/amex se aceptan como marca reconocida en el formulario. */
  protected readonly cardBrandRecognized = computed(() =>
    ['visa', 'mastercard', 'amex'].includes(this.cardBrand()),
  );
  /** Longitud de dígitos esperada por marca: Amex 15, resto 16. */
  protected readonly cardMaxLen = computed(() => (this.cardBrand() === 'amex' ? 15 : 16));
  /** Longitud del CVV por marca: Amex 4, resto 3. */
  protected readonly cvcMaxLen = computed(() => (this.cardBrand() === 'amex' ? 4 : 3));
  /** Número mostrado con separadores por marca (Amex 4-6-5; resto grupos de 4). */
  protected readonly cardNumberDisplay = computed(() =>
    Account.formatCardNumber(this.cardNumber(), this.cardBrand()),
  );
  /**
   * Largo MÁXIMO del texto mostrado (dígitos + espacios): Amex 15+2 = 17; resto
   * 16+3 = 19. Se enlaza al `maxlength` del input para que el navegador NO deje
   * teclear más caracteres. Sin esto, al llegar al tope el valor saneado coincide
   * con el previo → el signal no cambia → Angular no re-pinta el input → el caracter
   * de más quedaba visible.
   */
  protected readonly cardNumberDisplayMaxLen = computed(() =>
    this.cardBrand() === 'amex' ? 17 : 19,
  );

  /** Año actual en 2 dígitos (para validar la expiración). */
  private static readonly currentYY = new Date().getFullYear() % 100;

  /** Mes válido: 2 dígitos y 01–12. */
  protected readonly expMonthValid = computed(() => {
    const m = this.cardExpMonth();
    return /^\d{2}$/.test(m) && +m >= 1 && +m <= 12;
  });
  /** Año válido: 2 dígitos y >= año actual. */
  protected readonly expYearValid = computed(() => {
    const y = this.cardExpYear();
    return /^\d{2}$/.test(y) && +y >= Account.currentYY;
  });
  /** CVV válido: exactamente la longitud de la marca (3 o 4 dígitos). */
  protected readonly cvcValid = computed(() =>
    new RegExp(`^\\d{${this.cvcMaxLen()}}$`).test(this.cardCvc()),
  );
  /** Número completo y válido (marca reconocida + longitud + Luhn). */
  protected readonly cardNumberValid = computed(() => {
    const digits = this.cardNumber();
    if (!this.cardBrandRecognized()) return false;
    if (digits.length !== this.cardMaxLen()) return false;
    return Account.luhn(digits);
  });
  /** Formulario de tarjeta completo (habilita el botón Guardar). */
  protected readonly cardFormValid = computed(
    () => this.cardNumberValid() && this.expMonthValid() && this.expYearValid() && this.cvcValid(),
  );

  /** Formatea el número por marca: Amex en 4-6-5, el resto en grupos de 4. */
  private static formatCardNumber(digits: string, brand: CardBrand): string {
    if (!digits) return '';
    if (brand === 'amex') {
      return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)].filter(Boolean).join(' ');
    }
    return (digits.match(/.{1,4}/g) ?? []).join(' ');
  }

  /** Algoritmo de Luhn (validez del número de tarjeta). */
  private static luhn(digits: string): boolean {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = +digits[i];
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  /** Sanea (solo dígitos) y recorta al máximo de la marca; guarda solo dígitos. */
  protected onCardNumberInput(value: string): void {
    const digits = (value ?? '').replace(/\D/g, '');
    const brand = this.tokenizer.detectBrand(digits);
    const max = brand === 'amex' ? 15 : 16;
    this.cardNumber.set(digits.slice(0, max));
  }

  /** Mes: solo dígitos, 2 máx.; al completar 2 dígitos válidos autofoca el año. */
  protected onCardExpMonthInput(value: string): void {
    const digits = (value ?? '').replace(/\D/g, '').slice(0, 2);
    this.cardExpMonth.set(digits);
    if (digits.length === 2 && +digits >= 1 && +digits <= 12) {
      this.expYearInput()?.nativeElement.focus();
    }
  }

  /** Año: solo dígitos, 2 máx. */
  protected onCardExpYearInput(value: string): void {
    this.cardExpYear.set((value ?? '').replace(/\D/g, '').slice(0, 2));
  }

  /** CVV: solo dígitos, recortado a la longitud de la marca (3 o 4). */
  protected onCardCvcInput(value: string): void {
    this.cardCvc.set((value ?? '').replace(/\D/g, '').slice(0, this.cvcMaxLen()));
  }

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
  /**
   * ¿El usuario es "vendedor" (promotor/admin)? Determina la información del wallet
   * y si ve los retiros: el backend responde 403 a un buyer en /wallet/withdrawals,
   * así que el cliente NO debe ver "mis retiros" ni "solicitar retiro".
   */
  protected readonly isSellerRole = computed(() => this.session.hasAnyRole(['promoter', 'admin']));
  /** Modal informativo del origen del saldo (contenido según rol). */
  protected readonly showWalletInfo = signal(false);
  protected openWalletInfo(): void {
    this.showWalletInfo.set(true);
  }
  protected closeWalletInfo(): void {
    this.showWalletInfo.set(false);
  }
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
  /** Filtro por ESTADO de la transacción ('' = todos; p.ej. paid/pending/refunded). */
  protected readonly movementStatus = signal<string>('');
  /** Filtros de facturación. */
  protected readonly filterEvent = signal<string>('');
  protected readonly filterDate = signal<string>('');
  /** Estados presentes en los movimientos (para poblar el filtro). Orden estable. */
  protected readonly movementStatuses = computed(() => {
    const present = new Set(
      this.movements()
        .map((m) => m.status)
        .filter((s): s is string => !!s),
    );
    // Orden preferido; los desconocidos van al final por si el backend crece.
    const preferred = ['paid', 'pending', 'cancelled', 'expired', 'refunded'];
    const ordered = preferred.filter((s) => present.has(s));
    const extra = [...present].filter((s) => !preferred.includes(s));
    return [...ordered, ...extra];
  });
  /** Movimientos tras aplicar dirección/estado/evento/fecha y el deep-link por orden. */
  protected readonly filteredMovements = computed(() => {
    const only = this.orderFilter();
    const dir = this.movementDir();
    const status = this.movementStatus();
    const eventQ = this.filterEvent().trim().toLowerCase();
    const date = this.filterDate();
    // El backend ya devuelve los movimientos más recientes primero.
    return this.movements().filter((m) => {
      if (only) return m.orderId === only;
      if (dir && m.direction !== dir) return false;
      if (status && m.status !== status) return false;
      if (eventQ && !(m.eventName ?? '').toLowerCase().includes(eventQ)) return false;
      if (date && !(m.createdAt ?? '').startsWith(date)) return false;
      return true;
    });
  });
  /** ¿Hay al menos un ingreso? (para dar sentido al filtro Ingresos/Egresos). */
  protected readonly hasIncome = computed(() =>
    this.movements().some((m) => m.direction === 'income'),
  );
  /**
   * ¿Mostrar el filtro "Ingresos"? (P4) Promotores/admin siempre (cobran eventos,
   * reembolsos, reventas). El CLIENTE (buyer) solo si tiene algún ingreso real
   * (devolución o reventa recibida); si solo tiene compras, no tiene sentido.
   */
  protected readonly showIncomeFilter = computed(
    () => this.session.hasRole('promoter') || this.session.hasRole('admin') || this.hasIncome(),
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
  protected setMovementStatus(v: string): void {
    this.movementStatus.set(v);
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
  /** Un boleto es PASADO si su evento ya concluyó (endsAt < ahora) o ya no es usable
   *  (usado/revocado/transferido). ACTIVO = usable y su evento aún no terminó. */
  private isPastTicket(t: TicketResponseDto): boolean {
    const ended = !!t.event?.endsAt && new Date(t.event.endsAt).getTime() < Date.now();
    return ended || t.status !== 'valid';
  }
  protected readonly activos = computed(() =>
    (this.ticketsData().items ?? []).filter((t: TicketResponseDto) => !this.isPastTicket(t)),
  );
  protected readonly pasados = computed(() =>
    (this.ticketsData().items ?? []).filter((t: TicketResponseDto) => this.isPastTicket(t)),
  );
  /**
   * Filtra por una compra concreta cuando llega `?order=` (deep-link tras pagar
   * en el checkout → "a la compra específica"). Sin el parámetro, todos.
   */
  private filterByOrder(list: TicketResponseDto[]): TicketResponseDto[] {
    const only = this.orderFilter();
    return only ? list.filter((t) => t.orderId === only) : list;
  }
  /** Boletos activos y pasados agrupados por evento → compra (para las cards). */
  protected readonly activosGrouped = computed(() =>
    groupByEventOrder(this.filterByOrder(this.activos())),
  );
  protected readonly pasadosGrouped = computed(() =>
    groupByEventOrder(this.filterByOrder(this.pasados())),
  );

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
  /** Boletos a los que ya se reintentó la media (un solo reintento). */
  private readonly qrRetried = new Set<string>();
  /** Boleto en proceso de transferencia (abre el modal-asistente). null = cerrado. */
  protected readonly transferTicket = signal<{ id: string; serial: string } | null>(null);

  constructor() {
    this.loadWallet();

    // Sincroniza la selección del perfil con el idioma persistido del usuario: al
    // resolver la sesión (o tras Guardar) el selector refleja el valor real de BD y
    // el botón Guardar desaparece (dirty=false). No pisa una edición en curso porque
    // solo reacciona a cambios del valor PERSISTIDO, no de la selección local.
    effect(() => {
      const persisted = this.persistedLang();
      this.profileLang.set(persisted);
    });

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
  protected readonly confirm = new ConfirmController();

  protected askRemoveCard(c: PaymentMethodResponseDto): void {
    this.confirm.ask({
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

  /** Elige archivo → valida imagen → muestra preview local (aún NO sube). */
  protected onAvatarFile(event: Event): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toasts.error(this.translate.instant('account.profile.photoImageError'));
      return;
    }
    const prev = this.pendingAvatarUrl();
    if (prev) URL.revokeObjectURL(prev);
    this.pendingAvatarFile.set(file);
    this.pendingAvatarUrl.set(URL.createObjectURL(file));
  }

  /** Descarta el preview sin subir. */
  protected cancelAvatar(): void {
    const url = this.pendingAvatarUrl();
    if (url) URL.revokeObjectURL(url);
    this.pendingAvatarFile.set(null);
    this.pendingAvatarUrl.set(null);
  }

  /** Sube la foto (presign→PUT→confirma) y actualiza la sesión. */
  protected saveAvatar(): void {
    const file = this.pendingAvatarFile();
    if (!file || this.uploadingAvatar()) return;
    this.uploadingAvatar.set(true);
    this.usersApi.uploadAvatar(file).subscribe({
      next: (user) => {
        this.session.setUser(user);
        this.uploadingAvatar.set(false);
        this.cancelAvatar();
        this.toasts.success(this.translate.instant('account.profile.photoSaved'));
      },
      error: () => {
        this.uploadingAvatar.set(false);
        this.toasts.error(this.translate.instant('account.profile.photoError'));
      },
    });
  }

  /** Quita la foto de perfil actual. */
  protected removeAvatar(): void {
    if (this.uploadingAvatar()) return;
    this.uploadingAvatar.set(true);
    this.usersApi.clearAvatar().subscribe({
      next: (user) => {
        this.session.setUser(user);
        this.uploadingAvatar.set(false);
        this.toasts.info(this.translate.instant('account.profile.photoRemoved'));
      },
      error: () => {
        this.uploadingAvatar.set(false);
        this.toasts.error(this.translate.instant('account.profile.photoError'));
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
    this.confirm.ask({
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

  /**
   * Clave de caché de la cadena para un movimiento. Las compras usan su `orderId`
   * (endpoint `/orders/:id/ledger`); las liquidaciones NO tienen orden → usan su id
   * sintético de movimiento (`ledger:<entryId>`), que es único y estable.
   */
  protected chainKey(m: MovementResponseDto): string {
    return m.orderId ?? m.id;
  }

  /**
   * Carga (bajo demanda) la cadena contable para la vista blockchain — SIEMPRE
   * disponible en el detalle de cualquier transacción (compras y liquidaciones).
   * `key` es la clave de caché (chainKey del movimiento); `backendId` es el id que se
   * envía al backend (la orden en compras; el evento en liquidaciones). Retrocompatible:
   * si se llama con un solo argumento (p.ej. `loadChain(orderId)`), la clave y el id
   * del backend coinciden.
   */
  protected loadChain(key: string, backendId: string = key, scope: 'order' | 'event' = 'order'): void {
    if (this.chains()[key]) {
      // Ya cargada: alterna ocultándola.
      this.chains.update((c) => {
        const next = { ...c };
        delete next[key];
        return next;
      });
      return;
    }
    this.loadingChain.set(key);
    const source$ =
      scope === 'event' ? this.ordersApi.eventLedgerChain(backendId) : this.ordersApi.ledgerChain(backendId);
    source$.subscribe({
      next: (chain) => {
        this.chains.update((c) => ({ ...c, [key]: chain }));
        this.loadingChain.set(null);
      },
      error: () => {
        this.loadingChain.set(null);
        this.toasts.error(this.translate.instant('account.toast.chainError'));
      },
    });
  }

  /**
   * Detalle inline de una transacción (movimiento) expandido. null = ninguno. Se usa
   * para "Ver transacción" de las liquidaciones, que no tienen una orden a la que
   * navegar: se muestra el detalle de LA transacción individual aquí mismo.
   */
  protected readonly expandedTxn = signal<string | null>(null);
  protected toggleTxnDetail(m: MovementResponseDto): void {
    this.expandedTxn.update((cur) => (cur === m.id ? null : m.id));
  }

  /** Abre la vista dedicada de detalle de la transacción (compra). */
  protected verCompra(orderId: string): void {
    void this.router.navigate(['/cuenta/transaccion', orderId]);
  }

  // --- Liquidación del promotor (W7) ---
  /** Evento cuya liquidación se está descargando ahora (para el spinner del botón). */
  protected readonly downloadingSettlement = signal<string | null>(null);

  /**
   * Descarga el detalle de la liquidación del evento en Excel (.xlsx). Como requiere
   * auth (Bearer) y es binario, se pide con `responseType:'blob'` (pasa por el
   * interceptor), se crea un objectURL y se dispara la descarga con un `<a download>`.
   * Respeta el nombre del `Content-Disposition` si viene; si no, usa un nombre local.
   * Solo navegador (SSR-safe).
   */
  protected downloadSettlement(eventId: string): void {
    if (!isPlatformBrowser(this.platformId) || !eventId) return;
    this.downloadingSettlement.set(eventId);
    this.promoterEventsApi.exportSettlement(eventId).subscribe({
      next: (res) => {
        this.downloadingSettlement.set(null);
        const blob = res.body;
        if (!blob) {
          this.toasts.error(this.translate.instant('account.billing.settlement.downloadError'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = this.document.createElement('a');
        a.href = url;
        a.download = this.filenameFrom(res) ?? `liquidacion-${eventId}.xlsx`;
        this.document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloadingSettlement.set(null);
        this.toasts.error(this.translate.instant('account.billing.settlement.downloadError'));
      },
    });
  }

  /** Extrae `filename="…"` del `Content-Disposition` (RFC-simple) si viene. */
  private filenameFrom(res: HttpResponse<Blob>): string | null {
    const cd = res.headers.get('content-disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    return match ? decodeURIComponent(match[1].trim()) : null;
  }

  /** Navega a la tab "Cuentas" del evento (liquidación) en el editor del promotor. */
  protected verEventAccounts(eventId: string): void {
    if (!eventId) return;
    void this.router.navigate(['/promotor/eventos', eventId, 'editar'], {
      queryParams: { tab: 'cuentas' },
    });
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

  /**
   * La imagen del QR falló al cargar. La media (PNG) se genera async por cola tras
   * el pago, así que justo tras comprar puede no estar lista. Reintentamos UNA vez
   * la media ~4s después (re-firma la URL); no ocultamos la imagen (en un navegador
   * real la URL pública sí resuelve; el reintento cubre el caso "aún generándose").
   */
  protected onQrError(ticketId: string): void {
    if (this.qrRetried.has(ticketId)) return;
    this.qrRetried.add(ticketId);
    setTimeout(() => this.loadMedia(ticketId), 4000);
  }

  /** Abre el asistente de transferencia (modal de 2 pasos) para un boleto. */
  protected openTransfer(t: TicketResponseDto): void {
    this.transferTicket.set({ id: t.id, serial: t.serial });
  }

  protected closeTransfer(): void {
    this.transferTicket.set(null);
  }
}
