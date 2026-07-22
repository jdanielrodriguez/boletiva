/**
 * Tipos de notificación (T5). Cadenas libres (el schema guarda `type: string`), pero
 * centralizadas aquí para consistencia backend↔frontend↔i18n. Añadir un tipo NO exige
 * migración; solo sumar la clave i18n `notifications.type.<TYPE>` en el frontend.
 */
export const NotificationType = {
  // Manual del admin
  ADMIN_MESSAGE: 'admin_message',
  // Promotor
  PROMOTER_APPROVED: 'promoter_approved',
  PROMOTER_REJECTED: 'promoter_rejected',
  PROMOTER_SUSPENDED: 'promoter_suspended',
  SETTLEMENT_PAID: 'settlement_paid',
  PREMIUM_ACTIVATED: 'premium_activated',
  EVENT_STARTING: 'event_starting',
  EVENT_FINISHED: 'event_finished',
  TICKET_UPDATE: 'ticket_update',
  ORDER_REFUNDED: 'order_refunded',
  // Admin
  SUPPORT_ACTIVITY: 'support_activity',
} as const;

export type NotificationChannel = 'inapp' | 'email';

/** Canal in-app siempre por defecto ON; correo por defecto OFF (opt-in, evita spam). */
export const CHANNEL_DEFAULT: Record<NotificationChannel, boolean> = {
  inapp: true,
  email: false,
};
