/** Token de inyección del proveedor de pago activo. */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface CreatePaymentInput {
  providerRef: string;
  orderId: string;
  amount: string; // monto a cobrar por la pasarela (GTQ, 2 decimales)
  currency: string;
}

export interface CreatePaymentResult {
  providerRef: string;
  /** URL/ábrete-sésamo para completar el pago (en el simulador, ficticia). */
  paymentUrl: string;
}

/**
 * Puerto de pasarela de pago. Implementaciones: simulador (Ola 3), luego Pagalo,
 * Stripe/GPay/PayPal. El fulfillment SIEMPRE ocurre por webhook (webhook-first),
 * nunca de forma síncrona en createPayment.
 */
export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
}
