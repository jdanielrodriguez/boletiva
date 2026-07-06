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
   * Inicia el pago de una orden (webhook-first): crea el intento en estado
   * pending y delega en la pasarela. La orden NO se confirma aquí; se confirma
   * al recibir el webhook. Reutiliza un intento pending existente (idempotencia).
   */
  async initiate(orderId: string, buyerId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.buyerId !== buyerId) {
      throw new NotFoundException('Orden no encontrada'); // no filtra existencia (IDOR)
    }
    if (order.status !== 'pending') {
      throw new ConflictException(`La orden no está pendiente de pago (${order.status})`);
    }

    const existing = await this.prisma.payment.findFirst({
      where: { orderId, status: 'pending' },
    });
    const payment =
      existing ??
      (await this.prisma.payment.create({
        data: {
          orderId,
          provider: this.provider.name,
          providerRef: `${this.provider.name}_${randomToken(12)}`,
          method: 'gateway',
          amount: order.total,
          currency: order.currency,
        },
      }));

    const res = await this.provider.createPayment({
      providerRef: payment.providerRef,
      orderId,
      amount: order.total.toString(),
      currency: order.currency,
    });

    return {
      paymentId: payment.id,
      providerRef: payment.providerRef,
      status: payment.status,
      amount: payment.amount.toFixed(2),
      paymentUrl: res.paymentUrl,
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
      const inflow = net.add(platformFee).add(iva); // lo que entra a la plataforma
      await this.ledger.post({
        kind: 'order_payment',
        refType: 'order',
        refId: order.id,
        memo: `Pago de orden ${order.id}`,
        entries: [
          { type: 'gateway_clearing', amount: inflow.negated().toFixed(2) },
          { type: 'promoter_payable', ownerId: order.event.promoterId, amount: net.toFixed(2) },
          { type: 'platform_revenue', amount: platformFee.toFixed(2) },
          { type: 'tax_payable', amount: iva.toFixed(2) },
        ],
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
    if (payment.status === 'failed' && order.status === 'cancelled') return; // idempotente

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
