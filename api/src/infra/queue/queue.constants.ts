/** Colas de trabajos asíncronos (BullMQ). */
export const QUEUES = {
  TICKETS: 'tickets', // emisión de boletos (firma + TOTP)
  MEDIA: 'media', // generación de QR/PDF y subida a storage
  MAIL: 'mail', // correos transaccionales
  WALLET: 'wallet', // generación de pases de wallet (Google/Apple)
  FEL: 'fel', // certificación de facturas electrónicas (SAT Guatemala) — async, nunca bloquea la entrega
  SUPPORT: 'support', // tickets de soporte: fallback + incumplimiento de SLA (correo a agentes/admin)
  SETTLEMENT: 'settlement', // liquidación de caja de eventos — RabbitMQ, UNA A UNA (prefetch 1)
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Colas servidas por RabbitMQ (trabajo pesado tolerante a latencia): correos, emisión
 * de boletos/media y liquidaciones. El resto (wallet/fel/support + holds/rate-limit/chat)
 * sigue en Redis/BullMQ (rápidas / ya integradas). En modo inline (test) todas corren
 * síncronas sin importar el backend.
 */
export const RABBIT_QUEUES: Record<string, { prefetch: number }> = {
  [QUEUES.MAIL]: { prefetch: 16 },
  [QUEUES.TICKETS]: { prefetch: 16 },
  [QUEUES.MEDIA]: { prefetch: 16 },
  [QUEUES.SETTLEMENT]: { prefetch: 1 }, // una a una: liquidaciones concurrentes serializadas
};
