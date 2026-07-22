/**
 * Puerto del RESPONDEDOR AUTOMÁTICO del chat de soporte (T5 · hook para bot/IA).
 *
 * Hoy la implementación por defecto es NO-OP (solo humanos). En el futuro, un bot de
 * reglas o una IA (Claude API, fundamentada en la base de conocimiento Q&A de T6)
 * implementará esta misma interfaz y se enchufará por DI/config SIN tocar el flujo:
 * cuando el promotor manda un mensaje, `SupportService` invoca al respondedor de forma
 * ASÍNCRONA (no bloquea). Si devuelve texto, se publica como respuesta del sistema.
 *
 * Puntos de enganche previstos (a decidir en la impl. real):
 *  - primer mensaje de un ticket sin agente en línea,
 *  - respuesta automática inicial de "recibido",
 *  - respuestas fuera de horario.
 */
export interface AutoResponderContext {
  ticketId: string;
  promoterId: string;
  message: string;
  /** ¿Es el primer mensaje del ticket? (útil para el saludo/bienvenida del bot). */
  isFirstMessage: boolean;
}

export interface SupportAutoResponder {
  /** Devuelve el cuerpo de una respuesta automática, o `null` si no debe responder. */
  onPromoterMessage(ctx: AutoResponderContext): Promise<string | null>;
}

/** Token DI del respondedor (permite intercambiar noop → bot → IA sin tocar el service). */
export const SUPPORT_AUTORESPONDER = Symbol('SUPPORT_AUTORESPONDER');

/** Implementación por defecto: no responde nada (atención 100% humana). */
export class NoopAutoResponder implements SupportAutoResponder {
  async onPromoterMessage(): Promise<string | null> {
    return null;
  }
}
