import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SpanStatusCode } from '@opentelemetry/api';
import Decimal from 'decimal.js';
import { checkoutTracer } from '../../infra/observability/tracing';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { PricingService, ResolvedFees } from '../pricing/pricing.service';
import { PriceQuote, PricingEngine } from '../pricing/pricing.engine';

/** Datos de facturación FEL opcionales (sin NIT → consumidor final 'CF'). */
export interface BillingInput {
  nit?: string;
  name?: string;
  address?: string;
}

/** Tiempo máximo esperando el lock de un asiento antes de rendirse (ms). */
const LOCK_TIMEOUT_MS = 5000;
/** Ventana de pago tras el commit (los asientos ya están `sold`). */
const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

interface LockedSeat {
  id: string;
  status: string;
  locality_id: string;
  label: string;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pricing: PricingService,
  ) {}

  private holdKey(eventId: string, seatId: string): string {
    return `hold:${eventId}:${seatId}`;
  }

  /**
   * Commit de compra: materializa los asientos reservados en una orden.
   *
   * Garantía de 0 doble-venta en 3 capas:
   *  1) Hold en Redis (primera línea): si un asiento está reservado por OTRO, 409.
   *  2) SELECT ... FOR UPDATE (autoritativo): serializa commits concurrentes; solo
   *     se venden asientos en estado `available`. Postgres es la fuente de verdad.
   *  3) Índice único parcial `order_items_active_seat_uniq` (belt-and-suspenders).
   *
   * El precio es server-authoritative: se recalcula desde settings + desiredNet.
   */
  /**
   * Envuelve el commit en un span raíz `checkout.commit` (con atributos de
   * negocio) para trazar el camino crítico. Los spans de Prisma/Redis/HTTP cuelgan
   * de este cuando OTel está habilitado; es no-op si está desactivado.
   */
  async commit(eventId: string, rawSeatIds: string[], buyerId: string, billing?: BillingInput) {
    return checkoutTracer().startActiveSpan('checkout.commit', async (span) => {
      span.setAttribute('event.id', eventId);
      span.setAttribute('seat.count', new Set(rawSeatIds).size);
      try {
        const order = await this.runCommit(eventId, rawSeatIds, buyerId, billing);
        span.setAttribute('order.id', order.id);
        span.setAttribute('order.total', order.total.toString());
        span.setStatus({ code: SpanStatusCode.OK });
        return order;
      } catch (e) {
        span.recordException(e as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
        throw e;
      } finally {
        span.end();
      }
    });
  }

  private async runCommit(
    eventId: string,
    rawSeatIds: string[],
    buyerId: string,
    billing?: BillingInput,
  ) {
    const seatIds = [...new Set(rawSeatIds)];
    if (seatIds.length === 0) {
      throw new BadRequestException('Debes indicar al menos un asiento');
    }

    // Capa 1: respetar holds ajenos. Si el asiento está reservado por otra
    // persona en Redis, no se puede comprar (aunque en BD siga `available`).
    await this.assertNoForeignHold(eventId, seatIds, buyerId);

    // Comisiones vigentes (fee_schedule activo): se leen ANTES de la transacción
    // (con el cliente base). Dentro de la tx solo se usa la conexión de la tx +
    // cálculo puro, para no pedir una 2ª conexión del pool mientras se sostiene el
    // lock de fila (evita un deadlock de pool bajo alta concurrencia).
    const fees = await this.pricing.resolveFees();

    try {
      const order = await this.prisma.$transaction(
        async (tx) => this.commitTx(tx, eventId, seatIds, buyerId, fees, billing),
        {
          // maxWait: espera por una conexión del pool bajo alta concurrencia.
          // timeout: duración máxima de la transacción una vez iniciada.
          maxWait: 10000,
          timeout: 20000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
      // Liberar los holds propios ya consumidos (best-effort, fuera de la tx).
      await this.releaseOwnHolds(eventId, seatIds, buyerId);
      return order;
    } catch (e) {
      throw this.translate(e);
    }
  }

  private async commitTx(
    tx: Prisma.TransactionClient,
    eventId: string,
    seatIds: string[],
    buyerId: string,
    fees: ResolvedFees,
    billing?: BillingInput,
  ) {
    // Fallar rápido si otro commit tiene el lock demasiado tiempo (no colgar).
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

    // Capa 2: bloquear las filas de asiento. FOR UPDATE OF s bloquea solo `seats`.
    // Los parámetros se castean a uuid: Prisma los envía como texto y Postgres no
    // compara uuid = text implícitamente (además, así se usa el índice PK).
    const idList = Prisma.join(seatIds.map((id) => Prisma.sql`${id}::uuid`));
    const locked = await tx.$queryRaw<LockedSeat[]>(Prisma.sql`
      SELECT s.id, s.status::text AS status, s.locality_id, s.label
      FROM seats s
      JOIN localities l ON l.id = s.locality_id
      WHERE s.id IN (${idList}) AND l.event_id = ${eventId}::uuid
      FOR UPDATE OF s
    `);

    if (locked.length !== seatIds.length) {
      throw new BadRequestException('Algún asiento no existe o no pertenece al evento');
    }
    const notAvailable = locked.filter((s) => s.status !== 'available');
    if (notAvailable.length > 0) {
      throw new ConflictException('Algún asiento ya no está disponible');
    }

    // Precio por localidad (server-authoritative). Usa la conexión de la tx para
    // leer y cálculo PURO (sin I/O) para cotizar, con las comisiones ya cargadas.
    const localityIds = [...new Set(locked.map((s) => s.locality_id))];
    const localities = await tx.locality.findMany({ where: { id: { in: localityIds } } });
    const quoteByLocality = new Map<string, PriceQuote>();
    for (const loc of localities) {
      if (loc.desiredNet === null) {
        throw new UnprocessableEntityException(
          `La localidad "${loc.name}" no tiene precio configurado (desiredNet)`,
        );
      }
      quoteByLocality.set(loc.id, PricingEngine.quote(loc.desiredNet.toString(), fees.params));
    }

    // Totales = suma exacta (Decimal) de los ítems.
    const zero = new Decimal(0);
    const sum = {
      net: zero,
      fixed: zero,
      platform: zero,
      taxable: zero,
      iva: zero,
      gateway: zero,
      total: zero,
    };
    const itemsData = locked.map((seat) => {
      const q = quoteByLocality.get(seat.locality_id) as PriceQuote;
      sum.net = sum.net.add(q.net);
      sum.fixed = sum.fixed.add(q.fixedFees);
      sum.platform = sum.platform.add(q.platformFee);
      sum.taxable = sum.taxable.add(q.taxableBase);
      sum.iva = sum.iva.add(q.iva);
      sum.gateway = sum.gateway.add(q.gatewayFee);
      sum.total = sum.total.add(q.total);
      return {
        localityId: seat.locality_id,
        seatId: seat.id,
        label: seat.label,
        net: q.net,
        total: q.total,
        quote: q as unknown as Prisma.InputJsonValue,
        quoteHash: q.hash,
      };
    });

    // NIT en mayúsculas; sin NIT válido → 'CF' (consumidor final).
    const nit = billing?.nit?.trim().toUpperCase();
    const order = await tx.order.create({
      data: {
        buyerId,
        eventId,
        status: 'pending',
        currency: 'GTQ',
        net: sum.net.toFixed(2),
        fixedFees: sum.fixed.toFixed(2),
        platformFee: sum.platform.toFixed(2),
        taxableBase: sum.taxable.toFixed(2),
        iva: sum.iva.toFixed(2),
        gatewayFee: sum.gateway.toFixed(2),
        total: sum.total.toFixed(2),
        feeScheduleId: fees.scheduleId,
        feeScheduleVersion: fees.version,
        billingNit: nit && nit.length > 0 ? nit : 'CF',
        billingName: billing?.name?.trim() || null,
        billingAddress: billing?.address?.trim() || null,
        expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
        items: { create: itemsData },
      },
      include: { items: true },
    });

    // Marcar asientos como vendidos DENTRO de la misma tx (mismo lock).
    await tx.seat.updateMany({
      where: { id: { in: seatIds } },
      data: { status: 'sold' },
    });

    return order;
  }

  /** Capa 1: rechaza si algún asiento está reservado en Redis por otra persona. */
  private async assertNoForeignHold(
    eventId: string,
    seatIds: string[],
    buyerId: string,
  ): Promise<void> {
    const client = this.redis.getClient();
    const holders = await client.mget(...seatIds.map((id) => this.holdKey(eventId, id)));
    const foreign = holders.some((h) => h !== null && h !== buyerId);
    if (foreign) {
      throw new ConflictException('Algún asiento está reservado por otra persona');
    }
  }

  private async releaseOwnHolds(
    eventId: string,
    seatIds: string[],
    buyerId: string,
  ): Promise<void> {
    try {
      const client = this.redis.getClient();
      const keys = seatIds.map((id) => this.holdKey(eventId, id));
      const holders = await client.mget(...keys);
      const mine = keys.filter((_, i) => holders[i] === buyerId);
      if (mine.length) await client.del(...mine);
    } catch (e) {
      // No es crítico: el TTL los libera igual. Solo registramos.
      this.logger.warn(`No se pudieron liberar holds tras el commit: ${String(e)}`);
    }
  }

  /** Traduce errores de Postgres/Prisma a excepciones HTTP con contrato claro. */
  private translate(e: unknown): Error {
    if (
      e instanceof BadRequestException ||
      e instanceof ConflictException ||
      e instanceof NotFoundException ||
      e instanceof ForbiddenException ||
      e instanceof UnprocessableEntityException
    ) {
      return e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    // 55P03 lock_not_available (venció lock_timeout) → conflicto reintentar.
    if (
      msg.includes('lock_timeout') ||
      msg.includes('55P03') ||
      msg.includes('canceling statement')
    ) {
      return new ConflictException('El asiento está en disputa, reintenta en un momento');
    }
    // P2002 / unique_violation en el índice parcial → doble-venta bloqueada.
    if (
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
      msg.includes('order_items_active_seat_uniq') ||
      msg.includes('23505')
    ) {
      return new ConflictException('Algún asiento ya fue vendido');
    }
    // P2028: no se pudo iniciar/mantener la transacción (saturación del pool) →
    // capacidad, reintentable. Nunca es un 500.
    if (
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2028') ||
      msg.includes('Transaction API error') ||
      msg.includes('Unable to start a transaction')
    ) {
      return new ServiceUnavailableException('Servicio saturado, reintenta en un momento');
    }
    this.logger.error(`Fallo inesperado en commit de compra: ${msg}`);
    return e instanceof Error ? e : new Error(msg);
  }
}
