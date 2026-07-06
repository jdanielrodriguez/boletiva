import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { SpanStatusCode } from '@opentelemetry/api';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { checkoutTracer } from '../../infra/observability/tracing';

export const DEFAULT_HOLD_TTL = 600; // 10 minutos

// Lua atómico: reserva TODOS los asientos o NINGUNO (todos-o-nada).
// KEYS = llaves de asiento; ARGV[1] = holderId; ARGV[2] = ttl (s).
// Devuelve 0 si reservó todos, o el índice (1-based) del primer asiento ocupado.
const HOLD_SCRIPT = `
for i, k in ipairs(KEYS) do
  if redis.call('EXISTS', k) == 1 then
    return i
  end
end
for i, k in ipairs(KEYS) do
  redis.call('SET', k, ARGV[1], 'EX', ARGV[2])
end
return 0
`;

// Libera solo las llaves cuyo valor coincide con el holder (no pisa holds ajenos).
const RELEASE_SCRIPT = `
local released = 0
for i, k in ipairs(KEYS) do
  if redis.call('GET', k) == ARGV[1] then
    redis.call('DEL', k)
    released = released + 1
  end
end
return released
`;

export interface HoldResult {
  seatIds: string[];
  holderId: string;
  ttlSeconds: number;
  expiresAt: string;
}

@Injectable()
export class SeatHoldService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  private key(eventId: string, seatId: string): string {
    return `hold:${eventId}:${seatId}`;
  }

  /**
   * Reserva temporal (hold) de asientos en Redis con TTL. Verifica en BD que los
   * asientos existen, pertenecen al evento y están disponibles, y luego los toma
   * de forma atómica (todos o ninguno). El TTL garantiza que, si el proceso o el
   * cliente mueren, el asiento se libera solo sin intervención manual.
   */
  async hold(
    eventId: string,
    seatIds: string[],
    holderId: string,
    ttlSeconds = DEFAULT_HOLD_TTL,
  ): Promise<HoldResult> {
    return checkoutTracer().startActiveSpan('seat.hold', async (span) => {
      span.setAttribute('event.id', eventId);
      span.setAttribute('seat.count', new Set(seatIds).size);
      try {
        const result = await this.runHold(eventId, seatIds, holderId, ttlSeconds);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (e) {
        span.recordException(e as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
        throw e;
      } finally {
        span.end();
      }
    });
  }

  private async runHold(
    eventId: string,
    seatIds: string[],
    holderId: string,
    ttlSeconds = DEFAULT_HOLD_TTL,
  ): Promise<HoldResult> {
    const unique = [...new Set(seatIds)];
    if (unique.length === 0) throw new BadRequestException('Debes indicar al menos un asiento');

    // Validación en BD (fuente de verdad del inventario, indexada por localidad/estado).
    const seats = await this.prisma.seat.findMany({
      where: { id: { in: unique }, locality: { eventId } },
      select: { id: true, status: true },
    });
    if (seats.length !== unique.length) {
      throw new BadRequestException('Algún asiento no existe o no pertenece al evento');
    }
    const notAvailable = seats.filter((s) => s.status !== 'available');
    if (notAvailable.length > 0) {
      throw new ConflictException('Algún asiento no está disponible');
    }

    const keys = unique.map((id) => this.key(eventId, id));
    const res = (await this.redis
      .getClient()
      .eval(HOLD_SCRIPT, keys.length, ...keys, holderId, String(ttlSeconds))) as number;
    if (res !== 0) {
      throw new ConflictException('Algún asiento ya está reservado por otra persona');
    }

    return {
      seatIds: unique,
      holderId,
      ttlSeconds,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** Libera los holds del holder (no toca holds de otros). */
  async release(
    eventId: string,
    seatIds: string[],
    holderId: string,
  ): Promise<{ released: number }> {
    const keys = [...new Set(seatIds)].map((id) => this.key(eventId, id));
    if (keys.length === 0) return { released: 0 };
    const released = (await this.redis
      .getClient()
      .eval(RELEASE_SCRIPT, keys.length, ...keys, holderId)) as number;
    return { released };
  }

  /** Estado de un hold: quién lo tiene y TTL restante (ms). Para depuración/validación. */
  async inspect(eventId: string, seatId: string): Promise<{ holder: string | null; pttl: number }> {
    const key = this.key(eventId, seatId);
    const client = this.redis.getClient();
    const [holder, pttl] = await Promise.all([client.get(key), client.pttl(key)]);
    return { holder, pttl };
  }
}
