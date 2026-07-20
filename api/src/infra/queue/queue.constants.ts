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
