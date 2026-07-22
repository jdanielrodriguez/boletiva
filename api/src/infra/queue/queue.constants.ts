/** Colas de trabajos asíncronos (BullMQ). */
export const QUEUES = {
  TICKETS: 'tickets', // emisión de boletos (firma + TOTP)
  MEDIA: 'media', // generación de QR/PDF y subida a storage
  MAIL: 'mail', // correos transaccionales
  WALLET: 'wallet', // generación de pases de wallet (Google/Apple)
  FEL: 'fel', // certificación de facturas electrónicas (SAT Guatemala) — async, nunca bloquea la entrega
  SUPPORT: 'support', // tickets de soporte: fallback + incumplimiento de SLA (correo a agentes/admin)
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Colas servidas por RabbitMQ (trabajo pesado tolerante a latencia): correos y emisión
 * de boletos/media. El resto (wallet/fel/support + holds/rate-limit/chat) sigue en
 * Redis/BullMQ (rápidas / ya integradas). En modo inline (test) todas corren síncronas
 * sin importar el backend. (La liquidación NO usa cola: su ledger es síncrono y el
 * advisory lock ya serializa los cierres concurrentes; solo el correo va por MAIL.)
 */
export const RABBIT_QUEUES: Record<string, { prefetch: number }> = {
  [QUEUES.MAIL]: { prefetch: 16 },
  [QUEUES.TICKETS]: { prefetch: 16 },
  [QUEUES.MEDIA]: { prefetch: 16 },
};
