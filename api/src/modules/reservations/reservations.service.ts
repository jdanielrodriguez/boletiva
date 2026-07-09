import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { SeatHoldService } from '../inventory/seat-hold.service';
import { CheckoutService, BillingInput } from '../orders/checkout.service';
import { PricingService } from '../pricing/pricing.service';
import { CreateReservationDto } from './dto/reservations.dto';

/** TTL de una reserva compartible (más largo que un hold normal: hay que dar
 * tiempo a que otra persona la abra y pague). 30 min. */
const RESERVATION_TTL = 1800;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly holds: SeatHoldService,
    private readonly checkout: CheckoutService,
    private readonly pricing: PricingService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('jwt.accessSecret');
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
   * Crea una reserva anónima (hold bajo el token). Puede combinar VARIAS
   * localidades: asientos numerados + cupos generales, todo bajo el mismo `rid`.
   * Si algún hold falla, libera lo ya tomado (todo-o-nada a nivel de reserva).
   */
  async create(eventId: string, dto: CreateReservationDto) {
    const quantities = [
      ...(dto.localityId && dto.quantity ? [{ localityId: dto.localityId, quantity: dto.quantity }] : []),
      ...(dto.quantities ?? []),
    ];
    const hasSeats = !!(dto.seatIds && dto.seatIds.length > 0);
    if (!hasSeats && quantities.length === 0) {
      throw new BadRequestException('Indica asientos (seatIds) o cantidades por localidad');
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

    const exp = Date.now() + RESERVATION_TTL * 1000;
    const token = this.sign({ rid, eventId, seatIds: held, exp });
    return this.summarize(token, eventId, held, rid);
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
    return this.checkout.commit(eventId, seatIds, buyerId, billing, rid);
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
      select: { id: true, label: true, locality: { select: { id: true, name: true, desiredNet: true } } },
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
