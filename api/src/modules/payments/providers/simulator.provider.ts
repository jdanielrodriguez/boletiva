import { Injectable } from '@nestjs/common';
import { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from '../payment.provider';

/**
 * Proveedor simulador: no llama a ninguna pasarela real. Devuelve una URL
 * ficticia; la confirmación llega por WEBHOOK igual que en producción (Pagalo/
 * Stripe). En dev/test, el "gateway" envía el webhook firmado a /payments/webhook.
 */
@Injectable()
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly name = 'simulator';

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    return { providerRef: input.providerRef, paymentUrl: `sim://checkout/${input.providerRef}` };
  }
}
