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
    // Sin credenciales → 503 "servicio no disponible" (nunca pega al endpoint real).
    this.integrations.assertAvailable('recurrente');
    const r = this.config.getOrThrow<{ apiSecret: string; baseUrl: string }>('recurrente');
    // URL del frontend para el retorno (primer CORS origin), igual que otros enlaces.
    const front = (this.config.get<string[]>('cors.origins') ?? [])[0] ?? '';
    // Monto en centavos (GTQ, 2 decimales). Mínimo Q5 (500) según Recurrente.
    const amountInCents = Math.round(parseFloat(input.amount) * 100);

    // Checkout HOSPEDADO: crea el checkout y devuelve la URL a la que el frontend redirige.
    // El fulfillment NO es síncrono: llega por el webhook Svix de Recurrente
    // (POST /payments/recurrente/webhook), que mapea `metadata.providerRef` → nuestra orden.
    let json: { checkout_url?: string; id?: string };
    try {
      const res = await fetch(`${r.baseUrl}/checkouts`, {
        method: 'POST',
        headers: { 'X-SECRET-KEY': r.apiSecret, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              name: `Orden ${input.orderId}`,
              amount_in_cents: amountInCents,
              currency: input.currency,
              quantity: 1,
            },
          ],
          success_url: `${front}/checkout/${input.orderId}?estado=ok`,
          cancel_url: `${front}/checkout/${input.orderId}?estado=cancelado`,
          // Correlation id: metadata viaja de vuelta en el webhook → mapea a nuestra orden.
          metadata: { orderId: input.orderId, providerRef: input.providerRef },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Recurrente ${res.status}: ${body.slice(0, 300)}`);
      }
      json = (await res.json()) as { checkout_url?: string; id?: string };
    } catch (e) {
      this.logger.error(`Recurrente: fallo al crear checkout de la orden ${input.orderId}: ${String(e)}`);
      throw e;
    }
    if (!json.checkout_url) {
      throw new Error(`Recurrente no devolvió checkout_url (orden ${input.orderId})`);
    }
    return { providerRef: input.providerRef, paymentUrl: json.checkout_url, installments: input.installments };
  }
}
