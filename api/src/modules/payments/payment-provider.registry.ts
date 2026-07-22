import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider } from './payment.provider';
import { SimulatorPaymentProvider } from './providers/simulator.provider';
import { RecurrentePaymentProvider } from './providers/recurrente.provider';
import { PagaloPaymentProvider } from './providers/pagalo.provider';

/**
 * Registro de proveedores de pago para el ENRUTAMIENTO multi-pasarela. El cobro elige la
 * clase según el `provider` del gateway EFECTIVO de la orden (Pagalo→Pagalo, Recurrente→
 * Recurrente, Sandbox→Simulador). `payment.provider` (env PAYMENT_PROVIDER):
 *  - un nombre CONOCIDO ('simulator'|'recurrente'|'pagalo') → FUERZA ese proveedor para
 *    TODO cobro (los e2e fijan 'simulator' → todo se cobra por el simulador aunque el
 *    gateway sea real → canon y suite intactos);
 *  - 'auto' (o cualquier otro valor) → enruta por el `provider` del gateway (prod/alpha).
 * Fallback SIEMPRE al simulador si el `provider` del gateway no está registrado.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly logger = new Logger(PaymentProviderRegistry.name);
  private readonly byName: Map<string, PaymentProvider>;
  private readonly forced: string | null;

  constructor(
    config: ConfigService,
    simulator: SimulatorPaymentProvider,
    recurrente: RecurrentePaymentProvider,
    pagalo: PagaloPaymentProvider,
  ) {
    this.byName = new Map<string, PaymentProvider>([
      ['simulator', simulator],
      ['recurrente', recurrente],
      ['pagalo', pagalo],
    ]);
    const cfg = (config.get<string>('payment.provider') ?? 'simulator').toLowerCase();
    this.forced = this.byName.has(cfg) ? cfg : null; // 'auto'/desconocido → enruta por gateway
    this.logger.log(
      this.forced
        ? `Proveedor de pago FORZADO: ${this.forced} (ignora el gateway)`
        : 'Enrutamiento de pago POR GATEWAY (auto)',
    );
  }

  /** Proveedor a usar para el gateway efectivo (o el forzado). Fallback: simulador. */
  resolveFor(gateway?: { provider?: string | null } | null): PaymentProvider {
    const name = this.forced ?? gateway?.provider ?? 'simulator';
    return this.byName.get(name) ?? this.byName.get('simulator')!;
  }
}
