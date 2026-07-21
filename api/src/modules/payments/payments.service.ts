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
import { CostShareService } from '../cost-share/cost-share.service';
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
    private readonly costShare: CostShareService,
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
    opts: {
      gatewayId?: string;
      useWallet?: boolean;
      installments?: number;
      billingNit?: string;
      billingName?: string;
    } = {},
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

    // Datos de facturación (FEL): se capturan en el CHECKOUT (no en la reserva). Si vienen,
    // se aplican a la orden antes de cobrar. Default de la orden: CF (consumidor final).
    if (opts.billingNit !== undefined || opts.billingName !== undefined) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          billingNit: opts.billingNit?.trim() || 'CF',
          billingName: opts.billingName?.trim() || null,
        },
      });
    }

    // Idempotencia: si ya hay un intento en curso, se devuelve tal cual.
    const existing = await this.prisma.payment.findFirst({ where: { orderId, status: 'pending' } });
    if (existing) return this.summarize(existing);

    // Anclaje a Sandbox: si el promotor del evento es usuario de PRUEBA, el cobro
    // se fuerza al simulador aunque el comprador elija otra pasarela (no contamina
    // métricas de pasarelas reales). Requisito del arquitecto.
    opts = { ...opts, gatewayId: await this.anchorGatewayForTestUser(order.eventId, opts.gatewayId) };

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
    // Ola 6.6 (edge 3): en pago MIXTO, la porción por pasarela no puede ser menor
    // que su fijo por transacción (la cobraría a pérdida / monto no procesable).
    // El comprador debe pagar todo por pasarela o usar más saldo.
    if (walletPortion.gt(0) && gatewayCharge.gt(0) && gateway) {
      const txFixed = gateway.transactionFixedFee.toNumber();
      if (txFixed > 0 && gatewayCharge.lte(txFixed)) {
        throw new BadRequestException(
          'El monto a cobrar por pasarela es menor que su cargo fijo; paga el total por pasarela',
        );
      }
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
        event: {
          select: {
            ivaOnNet: true,
            absorbInstallmentCost: true,
            promoterId: true,
            gatewayId: true,
            frozenGatewayId: true,
          },
        },
      },
    });
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException('Orden no encontrada'); // IDOR → 404
    }
    const absorbedByPromoter = order.event.absorbInstallmentCost;
    // Pasarela EFECTIVA del evento para esta orden (la recomendada en el checkout):
    // congelada de la orden (feeGatewayId) → congelada del evento → elegida por el
    // promotor → default de plataforma. Reusa la resolución del pricing (no se
    // duplica): resolveGateway hace `frozenGatewayId ?? gatewayId ?? default`, así
    // que se alimenta feeGatewayId/frozenGatewayId como "frozen".
    const eventGatewayId = (
      await this.pricing.resolveFeesForEvent({
        gatewayId: order.event.gatewayId,
        frozenGatewayId: order.feeGatewayId ?? order.event.frozenGatewayId,
        ivaOnNet: order.event.ivaOnNet,
      })
    ).gatewayId;
    // Política del promotor (Ola 6.6): cuotas y pasarelas según su cost-share.
    const promoterPct = await this.costShare.effectivePct(order.event.promoterId);
    const installmentsAllowed = promoterPct >= (await this.costShare.installmentsMinPct());
    const gateways = (await this.gateways.listActive()).filter((gw) =>
      this.costShare.gatewayAllowed(gw, promoterPct),
    );

    // La tabla de comisiones (plataforma+IVA+fijos) es la misma para todas las
    // pasarelas: se lee UNA vez; por pasarela solo cambia gatewayFeePct.
    const platformBase = await this.pricing.paramsForRequote(
      order.feeScheduleVersion,
      0,
      order.event.ivaOnNet,
    );

    const result = gateways.map((gw) => {
      const params: FeeParams = {
        ...platformBase,
        gatewayFeePct: gw.feePct.toNumber(),
        transactionFixedFee: gw.transactionFixedFee.toNumber(),
      };
      const base = this.quoteOrderTotals(order.items, params);
      const options = [{ installments: 1, total: base.total, serviceFee: base.serviceFee }];

      // Cuotas solo si: el promotor las tiene habilitadas (cost-share) Y la pasarela
      // las permite (perilla del admin). Si no, solo se ofrece 1 pago.
      const rates =
        installmentsAllowed && gw.installmentsEnabled
          ? (gw.installmentRates as Record<string, number> | null) ?? {}
          : {};
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
        // Pasarela asignada al evento → recomendada/preseleccionada en el checkout.
        recommended: gw.id === eventGatewayId,
        total: base.total,
        serviceFee: base.serviceFee,
        installmentOptions: options,
      };
    });

    return {
      orderId: order.id,
      currency: order.currency,
      absorbedByPromoter,
      eventGatewayId,
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
  /**
   * Si el promotor del evento es usuario de PRUEBA (isTestUser), fuerza la pasarela
   * Sandbox (ignora la elección del comprador). Si no, devuelve la elección tal cual.
   */
  private async anchorGatewayForTestUser(
    eventId: string,
    gatewayId: string | undefined,
  ): Promise<string | undefined> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { promoter: { select: { isTestUser: true } } },
    });
    if (!event?.promoter?.isTestUser) return gatewayId;
    const sandbox = await this.gateways.sandboxGateway();
    return sandbox ? sandbox.id : gatewayId;
  }

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
        event: { select: { ivaOnNet: true, absorbInstallmentCost: true, promoterId: true } },
      },
    });
    // Ola 6.6: re-validar la política del promotor EN EL MOMENTO del cobro (por si
    // el admin bajó su cost-share entre el quote y el pago).
    const promoterPct = await this.costShare.effectivePct(order.event.promoterId);
    if (!this.costShare.gatewayAllowed(gateway, promoterPct)) {
      throw new ConflictException('La pasarela ya no está disponible para este evento');
    }
    if (installments > 1 && !(await this.costShare.installmentsAllowed(order.event.promoterId))) {
      throw new ConflictException('Las cuotas ya no están habilitadas para este evento');
    }
    // La pasarela puede tener las cuotas apagadas (perilla del admin) aunque el
    // promotor las permita → no se puede cobrar en cuotas por ella.
    if (installments > 1 && !gateway.installmentsEnabled) {
      throw new ConflictException('Esta pasarela no permite pago en cuotas');
    }
    const params = await this.pricing.paramsForRequote(
      order.feeScheduleVersion,
      gateway.feePct.toNumber(),
      order.event.ivaOnNet,
      gateway.transactionFixedFee.toNumber(),
    );
    // Plan de cuotas (solo si >1): tasa de la pasarela; lo absorbe la plataforma
    // salvo que el evento marque que lo absorbe el promotor. El fijo por
    // transacción va en `params` (mismo en 1 pago y cuotas → se cancela en el costo).
    const plan: InstallmentPlan | undefined =
      installments > 1
        ? {
            count: installments,
            ratePct: this.pricing.installmentRate(gateway, installments),
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
    // H2: si el plazo dejaría a la PLATAFORMA en margen negativo y NO lo absorbe el
    // promotor, se rechaza — mismo criterio que oculta esos plazos en paymentOptions.
    // Impide pagar por un plazo "oculto" y que la plataforma coma la pérdida.
    if (plan && !plan.absorbedByPromoter && sum.platform.lt(0)) {
      throw new BadRequestException('Ese plazo de cuotas no está disponible para esta orden');
    }
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
      include: {
        event: { select: { promoterId: true } },
        items: { select: { total: true } },
      },
    });
    // Solo se confirma una orden PENDIENTE. Además de la idempotencia (una orden ya
    // `paid` no re-asienta), esto es defensivo ante un `payment.succeeded` tardío o
    // fuera de orden: una orden ya `refunded`/`cancelled`/`expired` NO debe resucitar
    // a `paid` ni re-emitir boletos. (La dedupe por (provider,eventId) cubre el replay
    // del MISMO evento, pero no un evento distinto con el mismo pago.)
    if (order.status !== 'pending') return;

    // Asiento contable (idempotente por referencia de orden).
    const already = await this.prisma.ledgerTransaction.findFirst({
      where: { kind: 'order_payment', refType: 'order', refId: order.id },
    });
    if (!already) {
      const net = new Decimal(order.net.toString());
      const platformFee = new Decimal(order.platformFee.toString());
      const fixedFees = new Decimal(order.fixedFees.toString());
      const iva = new Decimal(order.iva.toString());
      const gatewayFee = new Decimal(order.gatewayFee.toString());
      const total = new Decimal(order.total.toString());
      const walletPortion = new Decimal(payment.walletAmount.toString());
      const gatewayCharge = new Decimal(payment.amount.toString());
      const promoterId = order.event.promoterId;

      // Ola 6.6: la pasarela cobra UN solo fijo por transacción, pero el comprador
      // pagó N (uno embebido por ítem con total>0). El surplus (N-1)·fijo lo retiene
      // la plataforma. Se separa el fijo del %: el % escala con la porción cobrada
      // (proporción wallet), el fijo aplica UNA vez si la pasarela cobra algo.
      const gw = order.feeGatewayId
        ? await this.prisma.paymentGateway.findUnique({ where: { id: order.feeGatewayId } })
        : null;
      const txFixed = new Decimal(gw ? gw.transactionFixedFee.toString() : 0);
      const paidItems = order.items.filter((it) => new Decimal(it.total.toString()).gt(0)).length;
      const fixedBaked = txFixed.mul(Math.max(paidItems, 0)); // N·fijo embebido en gatewayFee
      const pctPart = gatewayFee.sub(fixedBaked); // = %pasarela · total
      const realPctFee = pctPart.mul(
        /* istanbul ignore next: el total de una orden nunca es 0 (precio server-authoritative con neto > 0); la guarda evita una división por cero de forma puramente defensiva */
        total.isZero() ? 0 : gatewayCharge.div(total),
      );
      const realFixed = gatewayCharge.gt(0) ? txFixed : new Decimal(0);
      const gatewayFeeR = realPctFee.add(realFixed).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
      // La plataforma retiene la diferencia: surplus (N-1)·fijo + ahorro por wallet.
      // Cancela exacto en la suma (partida doble) porque gatewayFeeR es común.
      const savedFee = gatewayFee.sub(gatewayFeeR);
      const gatewayInflow = gatewayCharge.sub(gatewayFeeR);

      const entries: Array<{ type: string; ownerId?: string; amount: string }> = [
        { type: 'promoter_payable', ownerId: promoterId, amount: net.toFixed(2) },
        // La plataforma retiene su comisión + el surplus de pasarela + los cargos FIJOS
        // (fixedFees). Incluir fixedFees es OBLIGATORIO: forman parte del `total` del
        // snapshot; omitirlos desbalancea el asiento en −fixedFees y tumba el fulfillment.
        { type: 'platform_revenue', amount: platformFee.add(savedFee).add(fixedFees).toFixed(2) },
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

    // Marca pagada de forma CONDICIONAL (compare-and-set status='pending'): si el
    // orders-sweeper expiró la orden entre la lectura y aquí (pago tardío tras
    // expiración), NO la resucitamos a `paid` — el sweeper ya liberó sus asientos y
    // reactivarla los revendería (doble-venta). El asiento contable ya quedó asentado
    // (idempotente); este caso raro requiere reconciliación/refund, no reventa.
    const [, claim] = await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: 'succeeded', succeededAt: new Date() },
      }),
      this.prisma.order.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'paid', paidAt: new Date() },
      }),
    ]);
    if (claim.count === 0) {
      this.logger.warn(
        `Orden ${order.id} ya no estaba pending al confirmar (sweeper/expiración); no se reactiva a paid`,
      );
      return;
    }

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
      const fixedFees = new Decimal(order.fixedFees.toString());
      const iva = new Decimal(order.iva.toString());
      // Simétrico con fulfill: se revierte también el cargo FIJO (platform_revenue lo
      // recibió al pagar). No se reembolsa el gatewayFee (COGS real que la pasarela
      // retuvo). inflow = lo que se devuelve al comprador.
      const inflow = net.add(platformFee).add(fixedFees).add(iva);
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
          { type: 'platform_revenue', amount: platformFee.add(fixedFees).negated().toFixed(2) },
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
