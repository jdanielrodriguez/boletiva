/** Token de inyección del proveedor de pago activo. */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface CreatePaymentInput {
  providerRef: string;
  orderId: string;
  amount: string; // monto a cobrar por la pasarela (GTQ, 2 decimales)
  currency: string;
  /** Número de cuotas (1 = pago único). Recurrente/Visacuotas: 3/6/12/18. */
  installments?: number;
}

export interface CreatePaymentResult {
  providerRef: string;
  /** URL/ábrete-sésamo para completar el pago (en el simulador, ficticia). */
  paymentUrl: string;
  /** Cuotas confirmadas por la pasarela (eco de la selección). */
  installments?: number;
}

/** Entrega un webhook firmado al handler (in-process). Usado por el auto-confirm. */
export type WebhookDelivery = (
  payload: { id: string; type: string; providerRef: string },
  signature: string,
) => Promise<unknown>;

/**
 * Puerto de pasarela de pago. Implementaciones: simulador (Ola 3), luego Pagalo,
 * Stripe/GPay/PayPal. El fulfillment SIEMPRE ocurre por webhook (webhook-first),
 * nunca de forma síncrona en createPayment.
 */
export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /**
   * Opcional: programa una confirmación automática (simulador en dev/staging).
   * Las pasarelas reales no lo implementan (el webhook llega del gateway externo).
   */
  scheduleAutoConfirm?(providerRef: string, deliver: WebhookDelivery): void;
}
