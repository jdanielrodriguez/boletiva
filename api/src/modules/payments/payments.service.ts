import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { hmacSha256, randomToken, safeEqual } from '../../common/utils/crypto';
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
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

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
  async initiate(orderId: string, buyerId: string, useWallet = false) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException('Orden no encontrada'); // no filtra existencia (IDOR)
    }
    if (order.status !== 'pending') {
      throw new ConflictException(`La orden no está pendiente de pago (${order.status})`);
    }

    // Idempotencia: si ya hay un intento en curso, se devuelve tal cual.
    const existing = await this.prisma.payment.findFirst({ where: { orderId, status: 'pending' } });
    if (existing) return this.summarize(existing);

    const total = new Decimal(order.total.toString());
    const balance = useWallet ? await this.ledger.walletBalance(buyerId) : new Decimal(0);
    const walletPortion = Decimal.min(balance, total);
    const gatewayCharge = total.sub(walletPortion);

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
    });
    return { ...this.summarize(payment), paymentUrl: res.paymentUrl };
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
  }
}
