import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { SeatHoldService, MAX_HELD_SEATS_PER_HOLDER } from '../inventory/seat-hold.service';
import { CheckoutService, BillingInput } from '../orders/checkout.service';
import { PricingService } from '../pricing/pricing.service';
import { CreateReservationDto } from './dto/reservations.dto';

/** TTL de una reserva compartible: 10 min (igual que el hold), para que quede
 * claro que la reserva se mantiene por 10 minutos. */
const RESERVATION_TTL = 600;

/** Contexto de la petición para el anti-abuso de reservas. */
export interface ReservationContext {
  /** IP real del cliente (req.ip según trust proxy). null si no se pudo determinar. */
  ip: string | null;
  /** true si la petición trae un usuario autenticado. */
  isUser: boolean;
  /** Id del usuario autenticado (si isUser) — para el cap de asientos por CUENTA. */
  userId?: string | null;
}

interface TokenPayload {
  rid: string;
  eventId: string;
  seatIds: string[];
  exp: number;
}

/**
 * Reservas ANÓNIMAS y COMPARTIBLES. Un usuario (sin login) reserva asientos y
 * recibe un token firmado (HMAC) que puede compartir por link/redes; el hold en
 * Redis se toma bajo el `rid` de la reserva (no un userId). Cualquiera que abra
 * el token ve la reserva; para PAGAR debe iniciar sesión (el checkout crea la
 * orden a su nombre pasando `holderId = rid`, para que el commit acepte el hold).
 * Caso de uso: un hijo elige boletos y le manda el link al padre para que pague.
 */
@Injectable()
export class ReservationsService {
  private readonly secret: string;
  private readonly anonLimitEnabled: boolean;
  private readonly anonCooldownSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly holds: SeatHoldService,
    private readonly checkout: CheckoutService,
    private readonly pricing: PricingService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('jwt.accessSecret');
    this.anonLimitEnabled = config.get<boolean>('reservation.anonLimitEnabled') ?? true;
    this.anonCooldownSeconds = config.get<number>('reservation.anonCooldownSeconds') ?? 3600;
  }

  // --- Anti-abuso por IP (solo VISITANTES sin login) ----------------------
  // Un visitante puede tener UNA sola reserva anónima activa a la vez (evita que
  // bloqueen boletos "por joder"). Tras cancelarla, hay un cooldown antes de poder
  // crear otra. Los usuarios logueados (accountable por su cuenta) no tienen límite.
  private activeKey(ip: string): string {
    return `res:ip:active:${ip}`;
  }
  private cooldownKey(ip: string): string {
    return `res:ip:cooldown:${ip}`;
  }
  private limitApplies(ctx: ReservationContext): ctx is ReservationContext & { ip: string } {
    return this.anonLimitEnabled && !ctx.isUser && !!ctx.ip;
  }

  /**
   * Clave del cap de asientos en reserva por IDENTIDAD ESTABLE (cuenta si hay login,
   * si no la IP). NO usa el `rid` (que cambia por reserva) → cierra H1: un usuario
   * logueado no puede estrenar 50 asientos limpios por cada reserva en bucle. null si
   * no hay identidad utilizable (no aplica el cap).
   */
  private seatCapKey(ctx: ReservationContext): string | null {
    if (ctx.isUser && ctx.userId) return `res:seats:u:${ctx.userId}`;
    if (ctx.ip) return `res:seats:ip:${ctx.ip}`;
    return null;
  }

  /**
   * Contabiliza los asientos recién reservados contra el tope por identidad y hace
   * rollback (libera lo tomado bajo `rid`) si se excede. Igual espíritu que el cap de
   * holds, pero por cuenta/IP y a través de TODAS las reservas (no por rid).
   */
  private async capReservedSeats(ctx: ReservationContext, eventId: string, held: string[], rid: string) {
    // Logueado: el cap SIEMPRE aplica (H1, accountable pero acotado). Anónimo (por IP):
    // solo si el anti-abuso de reservas está activo (mismo gate que la regla de 1 reserva)
    // → con el límite OFF (tests) no hay tope por IP y no se acumula entre suites.
    if (!ctx.isUser && !this.anonLimitEnabled) return;
    const key = this.seatCapKey(ctx);
    if (!key || held.length === 0) return;
    const client = this.redis.getClient();
    await client.sadd(key, ...held);
    await client.expire(key, RESERVATION_TTL);
    if ((await client.scard(key)) > MAX_HELD_SEATS_PER_HOLDER) {
      await client.srem(key, ...held).catch(() => undefined);
      await this.holds.release(eventId, held, rid).catch(() => undefined);
      throw new HttpException(
        `Máximo ${MAX_HELD_SEATS_PER_HOLDER} asientos en reserva a la vez. Completa o cancela los actuales.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // --- Token firmado (integridad, no secreto): base64url(payload).hmac ---
  private sign(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(`res.${body}`).digest('base64url');
    return `${body}.${mac}`;
  }

  private verify(token: string): TokenPayload {
    const [body, mac] = token.split('.');
    if (!body || !mac) throw new BadRequestException('Reserva inválida');
    const expected = createHmac('sha256', this.secret).update(`res.${body}`).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Reserva inválida');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    if (!payload.exp || Date.now() > payload.exp) throw new BadRequestException('La reserva expiró');
    return payload;
  }

  /**
   * Estado del cooldown/límite anti-abuso para el visitante actual (por IP).
   * El frontend lo consulta para pintar el banner + cronómetro con el tiempo
   * restante AUTORITATIVO (sirve al recargar: siempre muestra los segundos reales).
   * Usuario logueado o límite deshabilitado → nunca bloqueado.
   */
  async cooldownStatus(ctx: ReservationContext): Promise<{
    onCooldown: boolean;
    hasActive: boolean;
    retryAfterSeconds: number;
  }> {
    if (!this.limitApplies(ctx)) {
      return { onCooldown: false, hasActive: false, retryAfterSeconds: 0 };
    }
    const client = this.redis.getClient();
    const [cooldownTtl, activeExists] = await Promise.all([
      client.ttl(this.cooldownKey(ctx.ip)),
      client.exists(this.activeKey(ctx.ip)),
    ]);
    // ttl: -2 = no existe, -1 = sin expiración (no debería), >0 = segundos restantes.
    const retryAfterSeconds = cooldownTtl > 0 ? cooldownTtl : 0;
    return {
      onCooldown: retryAfterSeconds > 0,
      hasActive: activeExists === 1,
      retryAfterSeconds,
    };
  }

  /**
   * Crea una reserva anónima (hold bajo el token). Puede combinar VARIAS
   * localidades: asientos numerados + cupos generales, todo bajo el mismo `rid`.
   * Si algún hold falla, libera lo ya tomado (todo-o-nada a nivel de reserva).
   */
  async create(eventId: string, dto: CreateReservationDto, ctx: ReservationContext = { ip: null, isUser: false }) {
    const quantities = [
      ...(dto.localityId && dto.quantity ? [{ localityId: dto.localityId, quantity: dto.quantity }] : []),
      ...(dto.quantities ?? []),
    ];
    const hasSeats = !!(dto.seatIds && dto.seatIds.length > 0);
    if (!hasSeats && quantities.length === 0) {
      throw new BadRequestException('Indica asientos (seatIds) o cantidades por localidad');
    }

    // Anti-abuso por IP (visitantes): cooldown activo o reserva ya en curso → 429.
    if (this.limitApplies(ctx)) {
      const client = this.redis.getClient();
      const [onCooldown, hasActive] = await Promise.all([
        client.exists(this.cooldownKey(ctx.ip)),
        client.exists(this.activeKey(ctx.ip)),
      ]);
      if (onCooldown) {
        throw new HttpException(
          'Cancelaste una reserva hace poco. Espera un momento o inicia sesión para reservar de nuevo.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (hasActive) {
        throw new HttpException(
          'Ya tienes una reserva activa. Complétala, cancélala o inicia sesión para reservar más.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const rid = randomUUID();
    const held: string[] = [];
    try {
      if (hasSeats) {
        const h = await this.holds.hold(eventId, dto.seatIds as string[], rid, RESERVATION_TTL);
        held.push(...h.seatIds);
      }
      for (const q of quantities) {
        const h = await this.holds.holdByQuantity(eventId, q.localityId, q.quantity, rid, RESERVATION_TTL);
        held.push(...h.seatIds);
      }
    } catch (e) {
      if (held.length > 0) await this.holds.release(eventId, held, rid).catch(() => undefined);
      throw e;
    }

    // Cap de asientos reservados por identidad estable (cuenta o IP) — cierra H1.
    // Aplica a logueados y anónimos; hace rollback de lo recién tomado si excede.
    await this.capReservedSeats(ctx, eventId, held, rid);

    // Marca la reserva activa de esta IP (misma vida que el hold → se auto-libera).
    if (this.limitApplies(ctx)) {
      await this.redis
        .getClient()
        .set(this.activeKey(ctx.ip), rid, 'EX', RESERVATION_TTL)
        .catch(() => undefined);
    }

    const exp = Date.now() + RESERVATION_TTL * 1000;
    const token = this.sign({ rid, eventId, seatIds: held, exp });
    return this.summarize(token, eventId, held, rid);
  }

  /**
   * Cancela una reserva anónima: libera los cupos en Redis y, para visitantes,
   * limpia la marca de reserva activa e inicia el cooldown antes de poder crear
   * otra (anti-abuso). Idempotente: cancelar dos veces no falla.
   */
  async cancel(token: string, ctx: ReservationContext = { ip: null, isUser: false }) {
    const { rid, eventId, seatIds } = this.verify(token);
    if (seatIds.length > 0) {
      await this.holds.release(eventId, seatIds, rid).catch(() => undefined);
      // Descuenta del cap de asientos reservados por identidad (cierra H1).
      const capKey = this.seatCapKey(ctx);
      if (capKey) await this.redis.getClient().srem(capKey, ...seatIds).catch(() => undefined);
    }
    if (this.limitApplies(ctx)) {
      const client = this.redis.getClient();
      await client.del(this.activeKey(ctx.ip)).catch(() => undefined);
      if (this.anonCooldownSeconds > 0) {
        await client
          .set(this.cooldownKey(ctx.ip), '1', 'EX', this.anonCooldownSeconds)
          .catch(() => undefined);
      }
    }
    return { cancelled: true };
  }

  /** Resumen de una reserva por token (para verla desde el link compartido). */
  async getByToken(token: string) {
    const { rid, eventId, seatIds } = this.verify(token);
    return this.summarize(token, eventId, seatIds, rid);
  }

  /** Crea la orden a nombre del usuario logueado a partir de la reserva. */
  async checkoutReservation(token: string, buyerId: string, billing?: BillingInput) {
    const { rid, eventId, seatIds } = this.verify(token);
    // holderId = rid → el commit acepta el hold hecho bajo la reserva.
    const order = await this.checkout.commit(eventId, seatIds, buyerId, billing, rid);
    // Libera los asientos VENDIDOS del set de cap por identidad (QA): antes solo se limpiaba
    // al CANCELAR, así que un comprador que reservó cerca del tope quedaba bloqueado ~10 min
    // tras COMPRAR. Best-effort (el TTL igual purga). El usuario logueado usa la clave `u:`.
    await this.redis.getClient().srem(`res:seats:u:${buyerId}`, ...seatIds).catch(() => undefined);
    return order;
  }

  /**
   * Arma el resumen: evento + ítems (asiento/localidad + precio de comprador) +
   * total, y valida contra Redis que la reserva siga viva (holds del `rid`).
   */
  private async summarize(token: string, eventId: string, seatIds: string[], rid: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, status: 'published' },
      select: {
        id: true,
        name: true,
        slug: true,
        startsAt: true,
        gatewayId: true,
        frozenGatewayId: true,
        ivaOnNet: true,
      },
    });
    if (!event) throw new NotFoundException('El evento no existe o no está publicado');

    const seats = await this.prisma.seat.findMany({
      where: { id: { in: seatIds } },
      select: {
        id: true,
        label: true,
        section: true,
        row: true,
        locality: { select: { id: true, name: true, desiredNet: true } },
      },
    });

    // Validez: todos los cupos siguen tomados en Redis por ESTA reserva.
    const states = await Promise.all(seatIds.map((id) => this.holds.inspect(eventId, id)));
    const valid = states.length > 0 && states.every((s) => s.holder === rid && s.pttl > 0);
    const minPttl = states.reduce((m, s) => (s.pttl > 0 ? Math.min(m, s.pttl) : m), Number.MAX_SAFE_INTEGER);
    const expiresAt =
      valid && minPttl !== Number.MAX_SAFE_INTEGER
        ? new Date(Date.now() + minPttl).toISOString()
        : null;

    // Precio de comprador por localidad (server-authoritative), cacheado por
    // localidad para no recotizar el mismo neto por cada asiento.
    const quoteCache = new Map<string, { currency: string; net: string; serviceFee: string; iva: string; total: string }>();
    const items = [];
    for (const s of seats) {
      const net = s.locality.desiredNet?.toString() ?? '0';
      let price = quoteCache.get(s.locality.id);
      if (!price) {
        const q = await this.pricing.quoteForEvent(net, event);
        price = { currency: q.currency, net: q.net, serviceFee: q.serviceFee, iva: q.iva, total: q.total };
        quoteCache.set(s.locality.id, price);
      }
      items.push({
        seatId: s.id,
        label: s.label,
        section: s.section,
        row: s.row,
        localityId: s.locality.id,
        localityName: s.locality.name,
        price,
      });
    }
    const totalCents = items.reduce((acc, it) => acc + Math.round(parseFloat(it.price.total) * 100), 0);

    return {
      token,
      eventId: event.id,
      eventName: event.name,
      eventSlug: event.slug,
      startsAt: event.startsAt.toISOString(),
      valid,
      expiresAt,
      currency: 'GTQ',
      total: (totalCents / 100).toFixed(2),
      items,
    };
  }
}
