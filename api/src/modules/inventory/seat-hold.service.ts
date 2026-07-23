import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SpanStatusCode } from '@opentelemetry/api';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { checkoutTracer } from '../../infra/observability/tracing';

export const DEFAULT_HOLD_TTL = 600; // 10 minutos

// Tope de asientos en reserva SIMULTÁNEA por holder (usuario o reserva anónima). Evita
// que una cuenta verificada acapare todo el aforo con holds en bucle (hallazgo 1.1).
// Generoso para compras legítimas (el tope de GA por localidad ya es 50); un abusador
// llena el set rápido y queda bloqueado hasta que sus holds venzan/se liberen.
export const MAX_HELD_SEATS_PER_HOLDER = 50;

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

// Admisión general (GA): reserva ATÓMICA de N cupos de entre una lista de
// candidatos disponibles. Recorre las llaves candidatas y toma (SET NX EX) las
// primeras que estén libres hasta reunir `quantity`; si no alcanza, revierte
// lo que tomó (todos-o-nada) y devuelve vacío. Al ser un solo script Lua, corre
// sin intercalarse con otros clientes → dos compradores nunca toman el mismo
// cupo (el SET NX de Redis es la autoridad de la reserva, igual que en seated).
// KEYS = llaves candidatas; ARGV[1]=holderId; ARGV[2]=ttl(s); ARGV[3]=quantity.
// Devuelve los índices (1-based) de las llaves elegidas, o {} si no alcanzó.
const HOLD_N_SCRIPT = `
local need = tonumber(ARGV[3])
local chosen = {}
for i, k in ipairs(KEYS) do
  if #chosen >= need then break end
  if redis.call('EXISTS', k) == 0 then
    redis.call('SET', k, ARGV[1], 'EX', ARGV[2])
    chosen[#chosen + 1] = i
  end
end
if #chosen < need then
  for _, idx in ipairs(chosen) do redis.call('DEL', KEYS[idx]) end
  return {}
end
return chosen
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

  /** Set de asientos que un holder tiene en reserva ahora (para el tope simultáneo). */
  private ownerSetKey(holderId: string): string {
    return `hold:owner:${holderId}`;
  }

  /**
   * Cap EFECTIVO de boletos por compra para el evento (F4): el mínimo entre el tope
   * global anti-acaparamiento y el `maxPerOrder` que el promotor fijó en el evento
   * (null/≤0 → solo el global). Server-authoritative: no confía en la UI.
   */
  private async resolveCap(eventId: string): Promise<number> {
    const ev = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { maxPerOrder: true },
    });
    const perOrder = ev?.maxPerOrder ?? null;
    if (perOrder != null && perOrder > 0) return Math.min(MAX_HELD_SEATS_PER_HOLDER, perOrder);
    return MAX_HELD_SEATS_PER_HOLDER;
  }

  /**
   * Contabiliza los asientos recién tomados en el set del holder y aplica el tope
   * simultáneo (`cap` efectivo del evento). Si al sumarlos se excede, hace ROLLBACK
   * (libera los recién tomados) y lanza 409 → nadie puede acaparar el aforo con holds
   * en bucle ni superar el máximo por compra del evento.
   */
  private async trackAndCap(
    holderId: string,
    eventId: string,
    seatIds: string[],
    ttlSeconds: number,
    cap: number,
  ): Promise<void> {
    const client = this.redis.getClient();
    const setKey = this.ownerSetKey(holderId);
    await client.sadd(setKey, ...seatIds);
    await client.expire(setKey, ttlSeconds);
    const count = await client.scard(setKey);
    if (count > cap) {
      await this.release(eventId, seatIds, holderId); // libera lo recién tomado + SREM
      throw new ConflictException(
        `Máximo ${cap} boletos en reserva a la vez para este evento. Completa o cancela los actuales.`,
      );
    }
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
    const cap = await this.resolveCap(eventId);
    if (unique.length > cap) {
      throw new BadRequestException(`Máximo ${cap} boletos por reserva para este evento`);
    }

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

    await this.trackAndCap(holderId, eventId, unique, ttlSeconds, cap);

    return {
      seatIds: unique,
      holderId,
      ttlSeconds,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /**
   * Hold de admisión general (GA) POR CANTIDAD. El comprador no elige asientos:
   * el servidor asigna `quantity` cupos de la localidad general. Como el aforo
   * está materializado en filas `seats`, reutilizamos toda la maquinaria probada
   * (Redis NX + el commit con FOR UPDATE) SIN fila caliente:
   *  1) toma una lista acotada de candidatos `available` de la localidad;
   *  2) los reserva atómicamente en Redis (SET NX, todos-o-nada) → devuelve los
   *     seatIds concretos; el cliente los usa en el commit existente {seatIds}.
   * Los asientos siguen `available` en BD hasta la venta (el hold es Redis+TTL),
   * exactamente como en seated → el commit no cambia y el TTL auto-libera.
   */
  async holdByQuantity(
    eventId: string,
    localityId: string,
    quantity: number,
    holderId: string,
    ttlSeconds = DEFAULT_HOLD_TTL,
  ): Promise<HoldResult> {
    return checkoutTracer().startActiveSpan('seat.hold', async (span) => {
      span.setAttribute('event.id', eventId);
      span.setAttribute('locality.id', localityId);
      span.setAttribute('seat.count', quantity);
      span.setAttribute('hold.mode', 'ga');
      try {
        const result = await this.runHoldByQuantity(
          eventId,
          localityId,
          quantity,
          holderId,
          ttlSeconds,
        );
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

  private async runHoldByQuantity(
    eventId: string,
    localityId: string,
    quantity: number,
    holderId: string,
    ttlSeconds: number,
  ): Promise<HoldResult> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException('La cantidad debe ser un entero positivo');
    }
    const perOrderCap = await this.resolveCap(eventId);
    if (quantity > perOrderCap) {
      throw new BadRequestException(`Máximo ${perOrderCap} boletos por reserva para este evento`);
    }

    const locality = await this.prisma.locality.findFirst({
      where: { id: localityId, eventId },
      select: { id: true, kind: true },
    });
    if (!locality) throw new NotFoundException('La localidad no existe o no pertenece al evento');
    if (locality.kind !== 'general') {
      throw new BadRequestException('Esta localidad es numerada: reserva por asiento, no por cantidad');
    }

    // Candidatos disponibles (acotado). Sobre-tomamos para tolerar cupos que ya
    // estén reservados en Redis por otros compradores (el NX los descarta).
    const cap = Math.min(quantity * 4 + 20, 2000);
    const candidates = await this.prisma.seat.findMany({
      where: { localityId, status: 'available' },
      select: { id: true },
      orderBy: { label: 'asc' },
      take: cap,
    });
    if (candidates.length < quantity) {
      throw new ConflictException('No hay suficientes cupos disponibles');
    }

    const keys = candidates.map((c) => this.key(eventId, c.id));
    const chosen = (await this.redis
      .getClient()
      .eval(HOLD_N_SCRIPT, keys.length, ...keys, holderId, String(ttlSeconds), String(quantity))) as number[];
    if (!Array.isArray(chosen) || chosen.length < quantity) {
      // Los candidatos libres se agotaron por reservas concurrentes: reintentar.
      throw new ConflictException('No hay suficientes cupos disponibles, reintenta en un momento');
    }

    const seatIds = chosen.map((idx) => candidates[idx - 1].id);
    await this.trackAndCap(holderId, eventId, seatIds, ttlSeconds, perOrderCap);
    return {
      seatIds,
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
    const unique = [...new Set(seatIds)];
    const keys = unique.map((id) => this.key(eventId, id));
    if (keys.length === 0) return { released: 0 };
    const released = (await this.redis
      .getClient()
      .eval(RELEASE_SCRIPT, keys.length, ...keys, holderId)) as number;
    // Descuenta del tope simultáneo del holder (idempotente si no estaban).
    await this.redis.getClient().srem(this.ownerSetKey(holderId), ...unique).catch(() => undefined);
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
