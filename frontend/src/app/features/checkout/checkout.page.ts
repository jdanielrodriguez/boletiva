import { PLATFORM_ID, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { UpperCasePipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, forkJoin, of, startWith, switchMap } from 'rxjs';
import { MoneyPipe } from '../../shared/money.pipe';
import { ConfirmationSplashComponent } from '../../shared/ui/confirmation-splash.component';
import { OrderStreamService } from '../../core/api/order-stream.service';
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
  imports: [FormsModule, MoneyPipe, TranslatePipe, UpperCasePipe, RouterLink, ConfirmationSplashComponent],
  templateUrl: './checkout.page.html',
})
export class CheckoutPage implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly ordersApi = inject(OrdersApi);
  private readonly paymentMethodsApi = inject(PaymentMethodsApi);
  private readonly walletApi = inject(WalletApi);
  private readonly stream = inject(OrderStreamService);
  private readonly translate = inject(TranslateService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly orderId = signal('');
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly paying = signal(false);
  protected readonly status = signal<OrderStatus>('pending');
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

  /** ¿Se necesita una pasarela para este pago? (no si el saldo cubre todo). */
  protected readonly needsGateway = computed(
    () => !(this.payMode() === 'wallet' && this.walletCoversAll()),
  );

  /** CVV válido (3–4 dígitos) — requerido al pagar con tarjeta guardada. */
  protected readonly cvvValid = computed(() => /^\d{3,4}$/.test(this.cvv()));

  /** ¿Puede confirmar el pago con el modo/campos actuales? */
  protected readonly canPay = computed(() => {
    if (this.paying()) return false;
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
      const def = d.options.gateways.find((g) => g.isPlatformDefault) ?? d.options.gateways[0];
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
    this.error.set(null);
    this.ordersApi
      .pay(this.orderId(), {
        gatewayId: gw?.gatewayId,
        installments: this.installments(),
        useWallet: mode === 'wallet',
      })
      .subscribe({
        next: () => this.paying.set(false),
        error: () => {
          this.paying.set(false);
          this.error.set(this.translate.instant('checkout.payError'));
        },
      });
  }
}
