import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hmacSha256, randomToken } from '../../../common/utils/crypto';
import {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  WebhookDelivery,
} from '../payment.provider';

/**
 * Proveedor simulador: no llama a ninguna pasarela real. Devuelve una URL
 * ficticia; la confirmación llega por WEBHOOK igual que en producción (Recurrente/
 * Pagalo/Stripe). Acepta `installments` para simular Recurrente (Visacuotas).
 *
 * Auto-confirm con JITTER (dev/staging): si `PAYMENT_SIMULATOR_AUTO_CONFIRM=true`,
 * tras un retardo aleatorio (1–5s configurable) el simulador se envía a sí mismo un
 * webhook `payment.succeeded` FIRMADO (HMAC) — igual que lo haría el gateway real
 * cuando el usuario termina de pagar. Esto obliga al frontend a manejar el estado
 * `pending` y reconexiones realistas. SIEMPRE OFF en test (los e2e disparan el
 * webhook manualmente y de forma determinista).
 */
@Injectable()
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly name = 'simulator';
  private readonly logger = new Logger(SimulatorPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const n = input.installments && input.installments > 1 ? input.installments : 1;
    const suffix = n > 1 ? `?cuotas=${n}` : '';
    return {
      providerRef: input.providerRef,
      paymentUrl: `sim://checkout/${input.providerRef}${suffix}`,
      installments: n,
    };
  }

  /** Retardo aleatorio (ms) dentro del rango configurado [min, max]. */
  jitterMs(): number {
    const min = this.config.get<number>('payment.simulatorJitterMinMs') ?? 1000;
    const max = this.config.get<number>('payment.simulatorJitterMaxMs') ?? 5000;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  /**
   * Programa (best-effort) el webhook de confirmación tras el jitter. No-op si
   * el auto-confirm está desactivado. `deliver` entrega el webhook firmado al
   * handler (in-process), reproduciendo el camino real webhook-first.
   */
  scheduleAutoConfirm(providerRef: string, deliver: WebhookDelivery): void {
    if (!this.config.get<boolean>('payment.simulatorAutoConfirm')) return;
    const secret = this.config.get<string>('payment.webhookSecret') as string;
    const id = `sim_evt_${randomToken(12)}`;
    const type = 'payment.succeeded';
    const signature = hmacSha256(secret, `${id}.${type}.${providerRef}`);
    const timer = setTimeout(() => {
      deliver({ id, type, providerRef }, signature).catch((e) =>
        this.logger.warn(`Auto-confirm del simulador falló para ${providerRef}: ${String(e)}`),
      );
    }, this.jitterMs());
    // No retener el event loop (proceso puede salir sin esperar este timer).
    if (typeof timer.unref === 'function') timer.unref();
  }
}
