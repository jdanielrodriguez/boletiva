import { PLATFORM_ID, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { UpperCasePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, of, startWith, switchMap } from 'rxjs';
import { MoneyPipe } from '../../shared/money.pipe';
import { TourComponent, type TourStep } from '../../shared/tour/tour.component';
import { ConfirmationSplashComponent } from '../../shared/ui/confirmation-splash.component';
import { LoadingComponent } from '../../shared/ui/loading.component';
import { OrderStreamService } from '../../core/api/order-stream.service';
import { SessionStore } from '../../core/auth/session.store';
import { BillingApi } from '../../core/api/billing.api';
import { OrdersApi } from '../../core/api/orders.api';
import { PaymentMethodsApi } from '../../core/api/payment-methods.api';
import { WalletApi } from '../../core/api/wallet.api';
import type {
  GatewayPaymentOptionResponseDto,
  OrderResponseDto,
  PaymentMethodResponseDto,
  PaymentOptionsResponseDto,
  WalletBalanceResponseDto,
} from '../../core/api/types';

type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'expired' | 'refunded';
/** Cómo paga el comprador: una tarjeta guardada, el saldo (wallet), o una tarjeta nueva. */
type PayMode = 'saved' | 'wallet' | 'new';

/**
 * Checkout (F2). Muestra el desglose TRANSPARENTE para el comprador
 * (boleto + cuota por servicio + IVA), permite elegir método/cuotas
 * (payment-options; la cuota por servicio cambia por método) y paga. El estado
 * del pago se actualiza por SSE (pending → paid/failed) sin polling.
 *
 * v3.8/G3: en vez de pedir SIEMPRE agregar una tarjeta, carga los métodos
 * guardados del usuario y el saldo de wallet. Si tiene métodos, los ofrece para
 * SELECCIONAR (pidiendo el CVV al confirmar) o pagar con el saldo; si no tiene,
 * cae al formulario de agregar tarjeta (flujo anterior). Al confirmarse el pago
 * (SSE → paid) muestra un mensaje breve y redirige a "Mis boletos" a la compra.
 */
@Component({
  selector: 'app-checkout',
  imports: [
    FormsModule,
    MoneyPipe,
    TranslatePipe,
    UpperCasePipe,
    RouterLink,
    ConfirmationSplashComponent,
    LoadingComponent,
    TourComponent,
  ],
  templateUrl: './checkout.page.html',
})
export class CheckoutPage implements OnDestroy {
  /** Tour de onboarding del checkout (solo logueados que no lo han visto). */
  protected readonly tourSteps: TourStep[] = [
    { title: 'tour.checkout.welcomeTitle', body: 'tour.checkout.welcomeBody' },
    { title: 'tour.checkout.methodTitle', body: 'tour.checkout.methodBody' },
    { title: 'tour.checkout.statusTitle', body: 'tour.checkout.statusBody' },
  ];
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ordersApi = inject(OrdersApi);
  private readonly paymentMethodsApi = inject(PaymentMethodsApi);
  private readonly walletApi = inject(WalletApi);
  private readonly stream = inject(OrderStreamService);
  private readonly translate = inject(TranslateService);
  private readonly session = inject(SessionStore);
  private readonly billingApi = inject(BillingApi);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Modo prueba: muestra la ayuda de tarjetas de prueba (4242…) en el pago. */
  protected readonly isTestUser = computed(() => this.session.user()?.isTestUser === true);

  // Facturación (FEL): NIT (prellenado del perfil) + nombre. Se captura AQUÍ (en el
  // checkout, no en la reserva). El lookup por NIT autollena y BLOQUEA el nombre si FEL lo
  // encuentra; si FEL está off, el nombre queda editable. Sin NIT → CF (consumidor final).
  protected readonly billingNit = signal((this.session.user() as { nit?: string })?.nit ?? '');
  protected readonly billingName = signal((this.session.user() as { billingName?: string })?.billingName ?? '');
  protected readonly billingNameLocked = signal(false);
  protected readonly lookingUpNit = signal(false);

  protected readonly orderId = signal('');
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly paying = signal(false);
  /** El comprador ya envió el pago (HTTP en curso o esperando el webhook). */
  protected readonly submitted = signal(false);
  protected readonly status = signal<OrderStatus>('pending');
  /**
   * Feedback CONTINUO tras enviar el pago: sigue en marcha desde que se envía
   * hasta que el webhook (por SSE) confirma (paid → splash) o cancela
   * (cancelled/expired → pantalla de fallo). Cubre la ventana en que la petición
   * HTTP ya retornó pero el estado sigue en 'pending' (jitter del simulador 1–5s).
   */
  protected readonly processing = computed(() => this.submitted() && this.status() === 'pending');
  /** Cuenta atrás visible antes de redirigir a los boletos (tras pagar). */
  protected readonly redirecting = signal(false);

  protected readonly gatewayId = signal<string | null>(null);
  protected readonly installments = signal(1);

  // --- Métodos de pago del usuario + saldo de wallet ---
  protected readonly methodsLoading = signal(true);
  protected readonly methodsError = signal(false);
  protected readonly savedMethods = signal<PaymentMethodResponseDto[]>([]);
  protected readonly wallet = signal<WalletBalanceResponseDto | null>(null);
  protected readonly selectedCardId = signal<string | null>(null);
  /** Modo de pago elegido (tarjeta guardada / saldo / tarjeta nueva). */
  protected readonly payMode = signal<PayMode>('new');
  protected readonly cvv = signal('');

  // --- Tarjeta nueva (solo cuando no hay métodos guardados). Visual: el cobro
  // real lo hace la pasarela (simulador); estos datos no se procesan aún. ---
  protected readonly cardNumber = signal('');
  protected readonly cardExp = signal('');
  protected readonly cardCvv = signal('');
  protected readonly cardName = signal('');

  private readonly data = toSignal(
    this.route.paramMap.pipe(
      switchMap((pm) => {
        const id = pm.get('orderId') ?? '';
        this.orderId.set(id);
        return forkJoin({
          order: this.ordersApi.get(id),
          options: this.ordersApi.paymentOptions(id),
        });
      }),
      startWith(null as { order: OrderResponseDto; options: PaymentOptionsResponseDto } | null),
    ),
    { initialValue: null as { order: OrderResponseDto; options: PaymentOptionsResponseDto } | null },
  );

  protected readonly order = computed(() => this.data()?.order ?? null);
  protected readonly gateways = computed(() => this.data()?.options.gateways ?? []);

  protected readonly selectedGateway = computed<GatewayPaymentOptionResponseDto | null>(() => {
    const gws = this.gateways();
    return gws.find((g) => g.gatewayId === this.gatewayId()) ?? gws[0] ?? null;
  });

  /** Opción del plazo elegido dentro de la pasarela seleccionada. */
  protected readonly selectedOption = computed(() => {
    const gw = this.selectedGateway();
    if (!gw) return null;
    return gw.installmentOptions.find((o) => o.installments === this.installments()) ?? null;
  });

  /** Desglose transparente para el comprador (boleto + serviceFee + IVA). */
  protected readonly breakdown = computed(() => {
    const order = this.order();
    const gw = this.selectedGateway();
    const opt = this.selectedOption();
    if (!order) return null;
    const total = opt?.total ?? gw?.total ?? order.total;
    const serviceFee = opt?.serviceFee ?? gw?.serviceFee ?? order.gatewayFee;
    return { boleto: order.net, serviceFee, iva: order.iva, total, currency: order.currency };
  });

  /** Saldo del wallet en número (para comparaciones). */
  protected readonly walletBalance = computed(() => parseFloat(this.wallet()?.balance ?? '0'));
  protected readonly hasWalletFunds = computed(() => this.walletBalance() > 0);
  /** ¿El saldo cubre el total? (pago 100% con wallet, sin pasarela). */
  protected readonly walletCoversAll = computed(() => {
    const b = this.breakdown();
    if (!b) return false;
    return this.walletBalance() >= parseFloat(b.total);
  });
  protected readonly hasSavedMethods = computed(() => this.savedMethods().length > 0);

  /** Tarjeta guardada seleccionada (su marca fija la longitud del CVV). */
  protected readonly selectedCard = computed(
    () => this.savedMethods().find((c) => c.id === this.selectedCardId()) ?? null,
  );
  /** Longitud del CVV por marca de la tarjeta guardada: Amex 4, resto 3. */
  protected readonly cvvLen = computed(() => (this.selectedCard()?.brand === 'amex' ? 4 : 3));

  /** ¿Se necesita una pasarela para este pago? (no si el saldo cubre todo). */
  protected readonly needsGateway = computed(
    () => !(this.payMode() === 'wallet' && this.walletCoversAll()),
  );

  /** CVV válido: longitud EXACTA de la marca (Amex 4, resto 3) — al pagar guardada. */
  protected readonly cvvValid = computed(() =>
    new RegExp(`^\\d{${this.cvvLen()}}$`).test(this.cvv()),
  );

  /** Sanea el CVV: solo dígitos, recortado a la longitud de la marca. */
  protected onCvvInput(value: string): void {
    this.cvv.set((value ?? '').replace(/\D/g, '').slice(0, this.cvvLen()));
  }

  /** ¿Puede confirmar el pago con el modo/campos actuales? */
  protected readonly canPay = computed(() => {
    // Bloqueado mientras se procesa (evita doble envío durante el jitter del webhook).
    if (this.paying() || this.submitted()) return false;
    switch (this.payMode()) {
      case 'wallet':
        return this.hasWalletFunds();
      case 'saved':
        return !!this.selectedCardId() && this.cvvValid();
      case 'new':
        return true;
    }
  });

  constructor() {
    // Inicializa status y pasarela por defecto cuando llegan los datos.
    effect(() => {
      const d = this.data();
      if (!d || this.loaded()) return;
      this.status.set(d.order.status as OrderStatus);
      // Preselecciona la pasarela ASIGNADA al evento (recommended / eventGatewayId);
      // si el backend no la marca, cae al default de plataforma o al primero.
      const gws = d.options.gateways;
      const eventGw =
        gws.find((g) => g.recommended) ??
        gws.find((g) => g.gatewayId === d.options.eventGatewayId);
      const def = eventGw ?? gws.find((g) => g.isPlatformDefault) ?? gws[0];
      this.gatewayId.set(def?.gatewayId ?? null);
      this.loaded.set(true);
    });

    // Métodos guardados + saldo de wallet (mejoran el checkout; su fallo no rompe
    // el pago). Cada uno con su propio estado de carga/error.
    forkJoin({
      methods: this.paymentMethodsApi.list().pipe(catchError(() => of(null))),
      wallet: this.walletApi.balance().pipe(catchError(() => of(null))),
    }).subscribe(({ methods, wallet }) => {
      this.methodsLoading.set(false);
      if (methods === null) this.methodsError.set(true);
      const cards = methods ?? [];
      this.savedMethods.set(cards);
      this.wallet.set(wallet);
      // Modo por defecto: tarjeta guardada (la default) si existe; si no, tarjeta nueva.
      if (cards.length > 0) {
        const def = cards.find((c) => c.isDefault) ?? cards[0];
        this.selectedCardId.set(def.id);
        this.payMode.set('saved');
      } else {
        this.payMode.set('new');
      }
    });

    // Estado del pago en vivo por SSE (pending → paid/failed) sin polling.
    this.route.paramMap
      .pipe(
        switchMap(() => this.stream.stream(this.orderId())),
        takeUntilDestroyed(),
      )
      .subscribe((ev) => {
        const data = ev.data as { status?: OrderStatus } | null;
        if (data?.status) this.onStatus(data.status);
      });
  }

  private redirectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Aplica el nuevo estado; al confirmarse el pago, redirige a los boletos. */
  private onStatus(next: OrderStatus): void {
    this.status.set(next);
    if (next === 'paid' && !this.redirecting()) {
      this.redirecting.set(true);
      if (this.isBrowser) {
        this.redirectTimer = setTimeout(() => this.goToTickets(), 2600);
      }
    }
  }

  private goToTickets(): void {
    void this.router.navigate(['/cuenta'], {
      queryParams: { s: 'activos', order: this.orderId() },
    });
  }

  ngOnDestroy(): void {
    if (this.redirectTimer) clearTimeout(this.redirectTimer);
  }

  /** Monto de CADA cuota = total / número de cuotas (solo display). */
  protected perInstallment(total: string, installments: number): string {
    return (parseFloat(total) / installments).toFixed(2);
  }

  protected selectGateway(id: string): void {
    this.gatewayId.set(id);
    this.installments.set(1);
  }

  protected selectInstallments(n: string): void {
    this.installments.set(Number(n) || 1);
  }

  protected setPayMode(mode: PayMode): void {
    this.payMode.set(mode);
    this.error.set(null);
  }

  protected selectCard(id: string): void {
    this.selectedCardId.set(id);
    this.payMode.set('saved');
  }

  /**
   * Busca el nombre por NIT (FEL). Disponible + encontrado → autollena y bloquea el nombre;
   * FEL off o no encontrado → deja el nombre editable. NIT vacío/CF → no consulta.
   */
  protected lookupNit(): void {
    const nit = this.billingNit().trim();
    this.billingNameLocked.set(false);
    if (!nit || nit.toUpperCase() === 'CF') return;
    this.lookingUpNit.set(true);
    this.billingApi.nitName(nit).subscribe({
      next: (r) => {
        this.lookingUpNit.set(false);
        if (r.available && r.name) {
          this.billingName.set(r.name);
          this.billingNameLocked.set(true);
        }
      },
      error: () => this.lookingUpNit.set(false),
    });
  }

  protected pay(): void {
    const mode = this.payMode();
    if (mode === 'wallet' && !this.hasWalletFunds()) return;
    if (mode === 'saved' && !this.cvvValid()) {
      this.error.set(this.translate.instant('checkout.cvvRequired'));
      return;
    }
    const gw = this.selectedGateway();
    // Se necesita pasarela salvo que el saldo cubra todo.
    if (this.needsGateway() && !gw) return;
    this.paying.set(true);
    // Marca el envío: el feedback de carga se mantiene hasta que el SSE confirme
    // o cancele (no solo mientras dura la petición HTTP).
    this.submitted.set(true);
    this.error.set(null);
    this.ordersApi
      .pay(this.orderId(), {
        gatewayId: gw?.gatewayId,
        installments: this.installments(),
        useWallet: mode === 'wallet',
        billingNit: this.billingNit().trim() || undefined,
        billingName: this.billingName().trim() || undefined,
      })
      .subscribe({
        next: () => this.paying.set(false),
        error: () => {
          this.paying.set(false);
          // Reintentable: libera el estado de envío para que el comprador pueda pagar de nuevo.
          this.submitted.set(false);
          this.error.set(this.translate.instant('checkout.payError'));
        },
      });
  }
}
