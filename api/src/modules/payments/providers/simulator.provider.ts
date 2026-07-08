import { Injectable } from '@nestjs/common';
import { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from '../payment.provider';

/**
 * Proveedor simulador: no llama a ninguna pasarela real. Devuelve una URL
 * ficticia; la confirmación llega por WEBHOOK igual que en producción (Recurrente/
 * Pagalo/Stripe). En dev/test, el "gateway" envía el webhook firmado a
 * /payments/webhook. Acepta `installments` para simular la respuesta de
 * Recurrente (Visacuotas/Mastercuotas): la URL y el eco reflejan el plazo elegido.
 */
@Injectable()
export class SimulatorPaymentProvider implements PaymentProvider {
  readonly name = 'simulator';

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const n = input.installments && input.installments > 1 ? input.installments : 1;
    const suffix = n > 1 ? `?cuotas=${n}` : '';
    return {
      providerRef: input.providerRef,
      paymentUrl: `sim://checkout/${input.providerRef}${suffix}`,
      installments: n,
    };
  }
}
