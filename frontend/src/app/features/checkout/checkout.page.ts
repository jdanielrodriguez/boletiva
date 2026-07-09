import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, startWith, switchMap } from 'rxjs';
import { MoneyPipe } from '../../shared/money.pipe';
import { OrderStreamService } from '../../core/api/order-stream.service';
import { OrdersApi } from '../../core/api/orders.api';
import type {
  GatewayPaymentOptionResponseDto,
  OrderResponseDto,
  PaymentOptionsResponseDto,
} from '../../core/api/types';

type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'expired' | 'refunded';

/**
 * Checkout (F2). Muestra el desglose TRANSPARENTE para el comprador
 * (boleto + cuota por servicio + IVA), permite elegir método/cuotas
 * (payment-options; la cuota por servicio cambia por método) y paga. El estado
 * del pago se actualiza por SSE (pending → paid/failed) sin polling.
 */
@Component({
  selector: 'app-checkout',
  imports: [FormsModule, MoneyPipe],
  templateUrl: './checkout.page.html',
})
export class CheckoutPage {
  private readonly route = inject(ActivatedRoute);
  private readonly ordersApi = inject(OrdersApi);
  private readonly stream = inject(OrderStreamService);

  protected readonly orderId = signal('');
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly paying = signal(false);
  protected readonly status = signal<OrderStatus>('pending');

  protected readonly gatewayId = signal<string | null>(null);
  protected readonly installments = signal(1);

  // --- Método de pago (CÓMO paga el comprador). Visual por ahora: el cobro real
  // lo hace la pasarela; los datos de tarjeta no se procesan aún (integración
  // real con Recurrente/Pagalo pendiente). "Agregar método" es un placeholder. ---
  protected readonly method = signal<'card'>('card');
  protected readonly cardNumber = signal('');
  protected readonly cardExp = signal('');
  protected readonly cardCvv = signal('');
  protected readonly cardName = signal('');
  protected readonly addMethodNote = signal(false);

  protected addMethod(): void {
    this.addMethodNote.set(true);
  }

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

    // Estado del pago en vivo por SSE (pending → paid/failed) sin polling.
    this.route.paramMap
      .pipe(
        switchMap(() => this.stream.stream(this.orderId())),
        takeUntilDestroyed(),
      )
      .subscribe((ev) => {
        const data = ev.data as { status?: OrderStatus } | null;
        if (data?.status) this.status.set(data.status);
      });
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

  protected pay(): void {
    const gw = this.selectedGateway();
    if (!gw) return;
    this.paying.set(true);
    this.error.set(null);
    this.ordersApi
      .pay(this.orderId(), {
        gatewayId: gw.gatewayId,
        installments: this.installments(),
        useWallet: false,
      })
      .subscribe({
        next: () => this.paying.set(false),
        error: () => {
          this.paying.set(false);
          this.error.set('No se pudo iniciar el pago. Intenta de nuevo.');
        },
      });
  }
}
