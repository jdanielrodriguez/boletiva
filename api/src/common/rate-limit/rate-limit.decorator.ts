import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';
export const SKIP_RATE_LIMIT_KEY = 'skip_rate_limit';

export interface RateLimitOptions {
  /** Máximo de peticiones permitidas en la ventana. */
  limit: number;
  /** Ventana en segundos. */
  windowSec: number;
  /**
   * Etiqueta lógica del contador (agrupa varias rutas bajo el mismo cupo si se repite).
   * Default: método+ruta. Útil p.ej. para juntar login+2fa bajo un mismo bucket por IP.
   */
  scope?: string;
}

/**
 * Límite estricto por IP para un endpoint sensible (auth, reservas, disponibilidad…).
 * Sustituye al techo global. Env-gated: sin `RATE_LIMIT_ENABLED` es no-op (test/dev).
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

/** Exime a un endpoint del rate-limit (webhooks de pasarela, SSE, health). */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT_KEY, true);
