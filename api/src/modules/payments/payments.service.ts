import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PricingService } from '../pricing/pricing.service';
import { FeeParams, InstallmentPlan, PricingEngine } from '../pricing/pricing.engine';
import { PaymentGatewaysService } from '../payment-gateways/payment-gateways.service';
import { hmacSha256, randomToken, safeEqual } from '../../common/utils/crypto';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { TicketsService } from '../tickets/tickets.service';
import { StreamService } from '../stream/stream.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';

export interface WebhookPayload {
  id: string; // id del evento en la pasarela (idempotencia)
  type: string; // 'payment.succeeded' | 'payment.failed'
  providerRef: string;
  occurredAt?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
    private readonly gateways: PaymentGatewaysService,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
    private readonly tickets: TicketsService,
    private readonly stream: StreamService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /** Notifica el saldo de wallet del usuario por SSE (best-effort, nunca lanza). */
  private async pushWallet(userId: string): Promise<void> {
    try {
      const balance = await this.ledger.walletBalance(userId);
      this.stream.emitWallet(userId, { balance: balance.toFixed(2) });
    } catch {
      /* best-effort: un fallo del push no debe afectar el flujo de pago */
    }
  }

  private get webhookSecret(): string {
    return this.config.get<string>('payment.webhookSecret') as string;
  }

  /**
   * Inicia el pago de una orden (webhook-first). Si `useWallet`, aplica el saldo
   * interno primero (pago mixto obligatorio cuando el total supera el saldo):
   *  - wallet cubre todo → se confirma AL INSTANTE (no hay pasarela).
   *  - mixto → se RESERVA la porción de wallet en payment_holding y la pasarela
   *    cobra el resto; el fulfillment ocurre por webhook.
   *  - sin wallet → 100% pasarela.
   * Reutiliza un intento pending existente (idempotencia).
   */
  async initiate(
    orderId: string,
    buyerId: string,
    opts: { gatewayId?: string; useWallet?: boolean; installments?: number } = {},
  ) {
    const useWallet = opts.useWallet ?? false;
    const installments = opts.installments ?? 1;
    let order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException('Orden no encontrada'); // no filtra existencia (IDOR)
    }
    if (order.status !== 'pending') {
      throw new ConflictException(`La orden no está pendiente de pago (${order.status})`);
    }

    // Idempotencia: si ya hay un intento en curso, se devuelve tal cual.
    const existing = await this.prisma.payment.findFirst({ where: { orderId, status: 'pending' } });
    if (existing) return this.summarize(existing);

    // Método: pasarela elegida (o la de la orden / default de plataforma) si está
    // activa. Se RECOTIZA la orden cuando se cambia de pasarela O se elige pago en
    // cuotas (el catálogo/commit siempre cotiza en 1 pago). El comprador paga lo
    // mismo en cuotas; el costo extra lo absorbe la plataforma/promotor.
    const gateway = await this.resolveChosenGateway(opts.gatewayId, order.feeGatewayId);
    if (installments > 1 && !gateway) {
      throw new BadRequestException('No hay una pasarela activa para pagar en cuotas');
    }
    const needsRequote = (gateway && gateway.id !== order.feeGatewayId) || installments > 1;
    if (needsRequote && gateway) {
      await this.requote(order.id, gateway, installments);
      order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    }

    const total = new Decimal(order.total.toString());
    const balance = useWallet ? await this.ledger.walletBalance(buyerId) : new Decimal(0);
    const walletPortion = Decimal.min(balance, total);
    const gatewayCharge = total.sub(walletPortion);

    // No se puede completar si hay que cobrar por pasarela y no hay una disponible
    // (p.ej. saldo parcial sin tarjeta / sin método de pago configurado).
    if (gatewayCharge.gt(0) && !gateway) {
      throw new BadRequestException('No hay un método de pago disponible para completar la compra');
    }

    // Caso 1: el wallet cubre el total → confirmación inmediata (sin pasarela).
    if (walletPortion.gt(0) && gatewayCharge.isZero()) {
      const payment = await this.prisma.payment.create({
        data: {
          orderId,
          provider: this.provider.name,
          providerRef: `wallet_${randomToken(12)}`,
          method: 'wallet',
          amount: '0.00',
          walletAmount: total.toFixed(2),
          currency: order.currency,
        },
      });
      await this.fulfill(payment.id); // debita wallet + distribuye + orden paid
      const done = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return this.summarize(done);
    }

    // Caso 2: mixto → reservar la porción de wallet (payment_holding) ahora.
    if (walletPortion.gt(0)) {
      await this.ledger.post({
        kind: 'wallet_reserve',
        refType: 'order',
        refId: orderId,
        memo: `Reserva de saldo para orden ${orderId}`,
        entries: [
          { type: 'user_wallet', ownerId: buyerId, amount: walletPortion.negated().toFixed(2) },
          { type: 'payment_holding', amount: walletPortion.toFixed(2) },
        ],
      });
    }

    // Caso 2 y 3: la pasarela cobra `gatewayCharge` (todo el total si no hay wallet).
    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        provider: this.provider.name,
        providerRef: `${this.provider.name}_${randomToken(12)}`,
        method: walletPortion.gt(0) ? 'mixed' : 'gateway',
        amount: gatewayCharge.toFixed(2),
        walletAmount: walletPortion.toFixed(2),
        currency: order.currency,
      },
    });
    const res = await this.provider.createPayment({
      providerRef: payment.providerRef,
      orderId,
      amount: gatewayCharge.toFixed(2),
      currency: order.currency,
      installments,
    });
    // Simulador (dev/staging): auto-confirma tras un jitter, reproduciendo el
    // webhook del gateway real. No-op si está desactivado (default y en test).
    this.provider.scheduleAutoConfirm?.(payment.providerRef, (p, sig) =>
      this.handleWebhook(p, sig),
    );
    return { ...this.summarize(payment), installments, paymentUrl: res.paymentUrl };
  }

  /**
   * Opciones de pago para el checkout de una orden PENDIENTE: por cada pasarela
   * activa, el total que pagaría el comprador (igual en todos los plazos, porque
   * el recargo lo absorbe la plataforma/promotor) y los plazos de cuotas
   * DISPONIBLES. Regla del arquitecto: si absorbe la PLATAFORMA (default), se
   * OCULTAN los plazos cuyo costo la dejaría con margen negativo
   * (platformFee < 0); si absorbe el PROMOTOR, se liberan todos (él asume el
   * costo contra su neto). Protege las finanzas por código, sin intervención.
   */
  async paymentOptions(orderId: string, buyerId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        event: { select: { ivaOnNet: true, absorbInstallmentCost: true } },
      },
    });
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException('Orden no encontrada'); // IDOR → 404
    }
    const absorbedByPromoter = order.event.absorbInstallmentCost;
    const gateways = await this.gateways.listActive();

    // La tabla de comisiones (plataforma+IVA+fijos) es la misma para todas las
    // pasarelas: se lee UNA vez; por pasarela solo cambia gatewayFeePct.
    const platformBase = await this.pricing.paramsForRequote(
      order.feeScheduleVersion,
      0,
      order.event.ivaOnNet,
    );

    const result = gateways.map((gw) => {
      const params: FeeParams = { ...platformBase, gatewayFeePct: gw.feePct.toNumber() };
      const base = this.quoteOrderTotals(order.items, params);
      const options = [{ installments: 1, total: base.total, serviceFee: base.serviceFee }];

      const rates = (gw.installmentRates as Record<string, number> | null) ?? {};
      const fixedFee = gw.installmentFixedFee ? gw.installmentFixedFee.toNumber() : 0;
      const counts = Object.keys(rates)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 2)
        .sort((a, b) => a - b);

      for (const count of counts) {
        let q: { total: string; platformFee: string; serviceFee: string };
        try {
          q = this.quoteOrderTotals(order.items, params, {
            count,
            ratePct: rates[String(count)],
            fixedFee,
            absorbedByPromoter,
          });
        } catch {
          continue; // el promotor no puede absorber (neto insuficiente) → no se ofrece
        }
        // Filtro de margen: la plataforma no vende a pérdida (a menos que el promotor absorba).
        if (!absorbedByPromoter && new Decimal(q.platformFee).lt(0)) continue;
        options.push({ installments: count, total: q.total, serviceFee: q.serviceFee });
      }

      return {
        gatewayId: gw.id,
        name: gw.name,
        provider: gw.provider,
        isPlatformDefault: gw.isPlatformDefault,
        total: base.total,
        serviceFee: base.serviceFee,
        installmentOptions: options,
      };
    });

    return {
      orderId: order.id,
      currency: order.currency,
      absorbedByPromoter,
      gateways: result,
    };
  }

  /** Cotiza la orden completa (suma de ítems) para una pasarela/plan, sin persistir. */
  private quoteOrderTotals(
    items: Array<{ net: Prisma.Decimal }>,
    params: FeeParams,
    plan?: InstallmentPlan,
  ): { total: string; platformFee: string; serviceFee: string } {
    let total = new Decimal(0);
    let platform = new Decimal(0);
    let service = new Decimal(0);
    for (const it of items) {
      const q = PricingEngine.quote(it.net.toString(), params, plan);
      total = total.add(q.total);
      platform = platform.add(q.platformFee);
      service = service.add(q.serviceFee);
    }
    return { total: total.toFixed(2), platformFee: platform.toFixed(2), serviceFee: service.toFixed(2) };
  }

  private summarize(p: {
    id: string;
    providerRef: string;
    status: string;
    method: string;
    amount: Prisma.Decimal;
    walletAmount: Prisma.Decimal;
  }) {
    return {
      paymentId: p.id,
      providerRef: p.providerRef,
      status: p.status,
      method: p.method,
      amount: p.amount.toFixed(2),
      walletAmount: p.walletAmount.toFixed(2),
    };
  }

  /**
   * Pasarela a usar: la elegida (debe estar activa) o, sin elección, la de la
   * orden si sigue activa, o la default de plataforma. null si no hay ninguna
   * activa (→ no se puede cobrar por pasarela).
   */
  private async resolveChosenGateway(
    gatewayId: string | undefined,
    orderGatewayId: string | null,
  ): Promise<PaymentGateway | null> {
    if (gatewayId) {
      const gw = await this.gateways.get(gatewayId);
      if (gw.status !== 'active') {
        throw new BadRequestException('La pasarela elegida no está disponible');
      }
      return gw;
    }
    if (orderGatewayId) {
      const gw = await this.prisma.paymentGateway.findUnique({ where: { id: orderGatewayId } });
      if (gw && gw.status === 'active') return gw;
    }
    const def = await this.gateways.platformDefault();
    return def && def.status === 'active' ? def : null;
  }

  /**
   * Recotiza una orden con otra pasarela (al elegir método de pago). Recalcula
   * cada ítem con la comisión de la pasarela + el IVA del evento, resume los
   * totales y estampa la pasarela usada. Todo en una transacción.
   */
  private async requote(
    orderId: string,
    gateway: PaymentGateway,
    installments = 1,
  ): Promise<void> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: true,
        event: { select: { ivaOnNet: true, absorbInstallmentCost: true } },
      },
    });
    const params = await this.pricing.paramsForRequote(
      order.feeScheduleVersion,
      gateway.feePct.toNumber(),
      order.event.ivaOnNet,
    );
    // Plan de cuotas (solo si >1): tasa y fijo de la pasarela; lo absorbe la
    // plataforma salvo que el evento marque que lo absorbe el promotor.
    const plan: InstallmentPlan | undefined =
      installments > 1
        ? {
            count: installments,
            ratePct: this.pricing.installmentRate(gateway, installments),
            fixedFee: gateway.installmentFixedFee ? gateway.installmentFixedFee.toNumber() : 0,
            absorbedByPromoter: order.event.absorbInstallmentCost,
          }
        : undefined;
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
    const itemUpdates = order.items.map((it) => {
      const q = PricingEngine.quote(it.net.toString(), params, plan);
      sum.net = sum.net.add(q.net);
      sum.fixed = sum.fixed.add(q.fixedFees);
      sum.platform = sum.platform.add(q.platformFee);
      sum.taxable = sum.taxable.add(q.taxableBase);
      sum.iva = sum.iva.add(q.iva);
      sum.gateway = sum.gateway.add(q.gatewayFee);
      sum.total = sum.total.add(q.total);
      return this.prisma.orderItem.update({
        where: { id: it.id },
        data: {
          net: q.net,
          total: q.total,
          quote: q as unknown as Prisma.InputJsonValue,
          quoteHash: q.hash,
        },
      });
    });
    await this.prisma.$transaction([
      ...itemUpdates,
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          net: sum.net.toFixed(2),
          fixedFees: sum.fixed.toFixed(2),
          platformFee: sum.platform.toFixed(2),
          taxableBase: sum.taxable.toFixed(2),
          iva: sum.iva.toFixed(2),
          gatewayFee: sum.gateway.toFixed(2),
          total: sum.total.toFixed(2),
          feeGatewayId: gateway.id,
        },
      }),
    ]);
  }

  /** Firma esperada de un webhook (HMAC sobre campos canónicos). */
  private expectedSignature(p: WebhookPayload): string {
    return hmacSha256(this.webhookSecret, `${p.id}.${p.type}.${p.providerRef}`);
  }

  /**
   * Procesa un webhook de la pasarela. Verifica la firma, es idempotente
   * (dedupe por (provider,eventId); reintentos/replays no reprocesan) y ejecuta
   * el fulfillment o la cancelación según el tipo de evento.
   */
  async handleWebhook(payload: WebhookPayload, signature: string | undefined) {
    if (!signature || !safeEqual(this.expectedSignature(payload), signature)) {
      throw new UnauthorizedException('Firma de webhook inválida');
    }
    const provider = this.provider.name;

    // Idempotencia: si ya se procesó este evento, no reprocesar.
    const prior = await this.prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider, eventId: payload.id } },
    });
    if (prior?.processedAt) return { received: true, duplicate: true };

    if (!prior) {
      try {
        await this.prisma.webhookEvent.create({
          data: {
            provider,
            eventId: payload.id,
            type: payload.type,
            providerRef: payload.providerRef,
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        // Carrera de duplicados: otro proceso lo insertó primero → tratar como recibido.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { received: true, duplicate: true };
        }
        throw e;
      }
    }

    const payment = await this.prisma.payment.findUnique({
      where: { providerRef: payload.providerRef },
    });
    if (!payment) {
      // Evento sin pago asociado: se registra pero no rompe (200 para no reintentar en bucle).
      this.logger.warn(`Webhook sin pago para providerRef=${payload.providerRef}`);
      await this.markProcessed(provider, payload.id);
      return { received: true, unknown: true };
    }

    if (payload.type === 'payment.succeeded') {
      await this.fulfill(payment.id);
    } else if (payload.type === 'payment.failed') {
      await this.fail(payment.id, 'gateway_declined');
    } else if (payload.type === 'payment.refunded') {
      await this.reverse(payment.id, 'refund');
    } else if (payload.type === 'payment.chargeback') {
      await this.reverse(payment.id, 'chargeback');
    } else {
      this.logger.warn(`Tipo de webhook no manejado: ${payload.type}`);
    }

    await this.markProcessed(provider, payload.id);
    return { received: true };
  }

  private async markProcessed(provider: string, eventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { provider_eventId: { provider, eventId } },
      data: { processedAt: new Date() },
    });
  }

  /**
   * Fulfillment de un pago exitoso: confirma la orden y asienta la contabilidad
   * en el ledger. Idempotente: si la orden ya está pagada o el asiento contable
   * ya existe, no duplica.
   */
  async fulfill(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: { event: { select: { promoterId: true } } },
    });
    if (order.status === 'paid') return; // ya confirmada (idempotente)

    // Asiento contable (idempotente por referencia de orden).
    const already = await this.prisma.ledgerTransaction.findFirst({
      where: { kind: 'order_payment', refType: 'order', refId: order.id },
    });
    if (!already) {
      const net = new Decimal(order.net.toString());
      const platformFee = new Decimal(order.platformFee.toString());
      const iva = new Decimal(order.iva.toString());
      const gatewayFee = new Decimal(order.gatewayFee.toString());
      const total = new Decimal(order.total.toString());
      const walletPortion = new Decimal(payment.walletAmount.toString());
      const gatewayCharge = new Decimal(payment.amount.toString());
      const promoterId = order.event.promoterId;

      // Comisión de pasarela SOLO sobre la porción cobrada por gateway (proporcional).
      // El ahorro por usar wallet acredita a la plataforma (misma cifra que cancela
      // en la suma → partida doble exacta).
      const gatewayFeeActual = gatewayFee.mul(total.isZero() ? 0 : gatewayCharge.div(total));
      const gatewayFeeR = gatewayFeeActual.toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
      const savedFee = gatewayFee.sub(gatewayFeeR);
      const gatewayInflow = gatewayCharge.sub(gatewayFeeR);

      const entries: Array<{ type: string; ownerId?: string; amount: string }> = [
        { type: 'promoter_payable', ownerId: promoterId, amount: net.toFixed(2) },
        { type: 'platform_revenue', amount: platformFee.add(savedFee).toFixed(2) },
        { type: 'tax_payable', amount: iva.toFixed(2) },
      ];
      if (walletPortion.gt(0)) {
        // wallet-only: se debita el saldo directo (no hubo reserva). mixed: se
        // libera la reserva que se movió a payment_holding al iniciar.
        entries.push(
          payment.method === 'wallet'
            ? {
                type: 'user_wallet',
                ownerId: order.buyerId,
                amount: walletPortion.negated().toFixed(2),
              }
            : { type: 'payment_holding', amount: walletPortion.negated().toFixed(2) },
        );
      }
      if (gatewayInflow.gt(0)) {
        entries.push({ type: 'gateway_clearing', amount: gatewayInflow.negated().toFixed(2) });
      }
      await this.ledger.post({
        kind: 'order_payment',
        refType: 'order',
        refId: order.id,
        memo: `Pago de orden ${order.id} (${payment.method})`,
        entries: entries as never,
      });
    }

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'succeeded', succeededAt: new Date() },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date() },
      }),
    ]);

    // Trabajo pesado FUERA del camino crítico: la emisión de boletos (y, en
    // cascada, QR/PDF y correos) se encola tras asentar el pago (condición del
    // arquitecto). enqueue no lanza: un fallo aquí no revierte el pago.
    await this.queue.enqueue(QUEUES.TICKETS, 'issue', { orderId: order.id });

    // Push SSE: la orden quedó pagada (el frontend deja el estado `pending`).
    this.stream.emitOrder(order.id, { status: 'paid', total: order.total.toFixed(2) });
    if (new Decimal(payment.walletAmount.toString()).gt(0)) await this.pushWallet(order.buyerId);
  }

  /**
   * Reembolso (voluntario) o contracargo (disputa) de una orden PAGADA:
   *  - revierte la distribución contable (clawback a promotor/plataforma/IVA),
   *  - **refund** → acredita el `inflow` al WALLET del comprador (saldo interno),
   *  - **chargeback** → el `inflow` sale de vuelta por `gateway_clearing` (la tarjeta
   *    ya recuperó el dinero vía disputa),
   *  - invalida la orden (refunded) y LIBERA el asiento (available) para reventa.
   * Idempotente (solo procesa órdenes en estado `paid`). La propagación de la
   * revocación a validadores offline es de la Ola 5.
   */
  async reverse(paymentId: string, mode: 'refund' | 'chargeback'): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: { items: true, event: { select: { promoterId: true } } },
    });
    if (order.status !== 'paid') {
      this.logger.warn(`${mode} sobre orden no pagada ${order.id} (${order.status}); se ignora`);
      return; // idempotente: tras el primer reverso la orden queda 'refunded'
    }

    const already = await this.prisma.ledgerTransaction.findFirst({
      where: { kind: { in: ['refund', 'chargeback'] }, refType: 'order', refId: order.id },
    });
    if (!already) {
      const net = new Decimal(order.net.toString());
      const platformFee = new Decimal(order.platformFee.toString());
      const iva = new Decimal(order.iva.toString());
      const inflow = net.add(platformFee).add(iva);
      const destination =
        mode === 'chargeback'
          ? { type: 'gateway_clearing', amount: inflow.toFixed(2) }
          : { type: 'user_wallet', ownerId: order.buyerId, amount: inflow.toFixed(2) };
      await this.ledger.post({
        kind: mode,
        refType: 'order',
        refId: order.id,
        memo: `${mode} de orden ${order.id}`,
        entries: [
          {
            type: 'promoter_payable',
            ownerId: order.event.promoterId,
            amount: net.negated().toFixed(2),
          },
          { type: 'platform_revenue', amount: platformFee.negated().toFixed(2) },
          { type: 'tax_payable', amount: iva.negated().toFixed(2) },
          destination,
        ] as never,
      });
    }

    const seatIds = order.items.map((i) => i.seatId).filter((x): x is string => !!x);
    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: paymentId }, data: { status: 'refunded' } }),
      this.prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { active: false } }),
      this.prisma.seat.updateMany({
        where: { id: { in: seatIds } },
        data: { status: 'available' },
      }),
      this.prisma.order.update({ where: { id: order.id }, data: { status: 'refunded' } }),
    ]);

    // Invalidar los boletos al instante (reembolso/contracargo). La propagación a
    // validadores offline es de la Ola 5.
    await this.tickets.revokeByOrder(order.id);

    // Push SSE: orden revertida + asientos liberados (mapa) + wallet (el refund lo acredita).
    this.stream.emitOrder(order.id, { status: 'refunded' });
    if (seatIds.length) this.stream.emitSeat(order.eventId, { released: seatIds });
    if (mode === 'refund') await this.pushWallet(order.buyerId);
  }

  /**
   * Pago fallido: marca el intento y LIBERA el inventario (asientos → available,
   * ítems inactivos, orden cancelada) para no dejar asientos bloqueados. Idempotente.
   */
  async fail(paymentId: string, reason: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: { items: true },
    });
    if (order.status === 'paid') {
      this.logger.warn(`Webhook failed para orden ya pagada ${order.id}; se ignora`);
      return;
    }
    if (payment.status !== 'pending') return; // ya procesado (idempotente)

    // Pago mixto: devolver al wallet la reserva retenida en payment_holding.
    const walletPortion = new Decimal(payment.walletAmount.toString());
    if (payment.method === 'mixed' && walletPortion.gt(0)) {
      await this.ledger.post({
        kind: 'wallet_refund_reserve',
        refType: 'order',
        refId: order.id,
        memo: `Devolución de reserva por pago fallido ${order.id}`,
        entries: [
          { type: 'payment_holding', amount: walletPortion.negated().toFixed(2) },
          { type: 'user_wallet', ownerId: order.buyerId, amount: walletPortion.toFixed(2) },
        ],
      });
    }

    const seatIds = order.items.map((i) => i.seatId).filter((x): x is string => !!x);
    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'failed', failureReason: reason },
      }),
      this.prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { active: false } }),
      this.prisma.seat.updateMany({
        where: { id: { in: seatIds } },
        data: { status: 'available' },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      }),
    ]);

    // Push SSE: pago fallido → orden cancelada + asientos liberados (mapa) + wallet
    // (si había reserva mixta, se devolvió al saldo).
    this.stream.emitOrder(order.id, { status: 'cancelled' });
    if (seatIds.length) this.stream.emitSeat(order.eventId, { released: seatIds });
    if (payment.method === 'mixed' && walletPortion.gt(0)) await this.pushWallet(order.buyerId);
  }
}
