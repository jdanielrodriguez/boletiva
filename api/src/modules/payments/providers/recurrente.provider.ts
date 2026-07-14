import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from '../payment.provider';

/**
 * Pasarela RECURRENTE (principal en GT). ENV-ONLY por ahora: la integración real es
 * compleja (checkout hospedado + tokenización + webhooks propios) y queda DIFERIDA.
 *
 * Hasta que se configuren las credenciales (`RECURRENTE_API_KEY`/`RECURRENTE_API_SECRET`),
 * `IntegrationsService.available('recurrente')` es false → `assertAvailable` lanza 503 al
 * intentar cobrar. El proveedor EXISTE (se puede seleccionar por config) pero responde
 * "servicio no disponible" hasta poner las llaves.
 */
@Injectable()
export class RecurrentePaymentProvider implements PaymentProvider {
  readonly name = 'recurrente';
  private readonly logger = new Logger(RecurrentePaymentProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Sin credenciales → 503 "servicio no disponible". Punto único de corte: mientras
    // no haya llaves, jamás se ejecuta el request real de abajo.
    this.integrations.assertAvailable('recurrente');

    // TODO(integración Recurrente): crear el checkout real. Esqueleto de referencia
    // (docs https://app.recurrente.com/api). El fulfillment llega por el webhook propio
    // de Recurrente a POST /payments/webhook (webhook-first), no de forma síncrona.
    //
    // const r = this.config.getOrThrow('recurrente') as {
    //   apiKey: string; apiSecret: string; baseUrl: string;
    // };
    // const res = await fetch(`${r.baseUrl}/checkouts`, {
    //   method: 'POST',
    //   headers: {
    //     'X-PUBLIC-KEY': r.apiKey,
    //     'X-SECRET-KEY': r.apiSecret,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     items: [{ name: `Orden ${input.orderId}`, amount_in_cents: ..., currency: input.currency }],
    //     metadata: { orderId: input.orderId, providerRef: input.providerRef },
    //   }),
    // });
    // const json = await res.json();
    // return { providerRef: input.providerRef, paymentUrl: json.checkout_url, installments: input.installments };

    // Inalcanzable (assertAvailable ya cortó); presente para el contrato de tipos.
    this.logger.warn(
      `RecurrentePaymentProvider.createPayment invocado sin integración activa (orden ${input.orderId})`,
    );
    throw new Error('Recurrente no implementado (env-only, diferido)');
  }
}
