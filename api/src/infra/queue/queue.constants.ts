/** Colas de trabajos asíncronos (BullMQ). */
export const QUEUES = {
  TICKETS: 'tickets', // emisión de boletos (firma + TOTP)
  MEDIA: 'media', // generación de QR/PDF y subida a storage
  MAIL: 'mail', // correos transaccionales
  WALLET: 'wallet', // generación de pases de wallet (Google/Apple)
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
