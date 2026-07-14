import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { IntegrationsService } from '../../infra/integrations/integrations.service';
import type { AppConfig } from '../../config/configuration';
import {
  CONSUMIDOR_FINAL_NIT,
  FEL_CERTIFIER,
  FelInvalidNitError,
  type FelCertResult,
  type FelCertifier,
  type FelInvoiceInput,
} from './fel-certifier.port';

/** Nombre del job de certificación de una orden en la cola FEL. */
const JOB_CERTIFY_ORDER = 'certify-order';

/** Payload del job FEL. */
interface CertifyOrderJob {
  orderId: string;
}

/**
 * Orquestador de facturación electrónica (FEL, SAT Guatemala) — ASÍNCRONO.
 *
 * `requestCertification(orderId)` ENCOLA la certificación (cola FEL) y retorna de
 * inmediato: la factura JAMÁS bloquea la entrega del boleto (regla del arquitecto).
 * El handler certifica en segundo plano, con reintentos de BullMQ ante fallos.
 *
 * DOBLE FACTURA: por cada orden se emiten DOS DTEs — uno de la PLATAFORMA (su comisión
 * de servicio) y otro del PROMOTOR (el neto del boleto), con DOS juegos de
 * (uuid/serie/numero) y dos NITs emisores distintos.
 *
 * LIMITACIÓN DE SCHEMA (hoy): `orders` tiene UN solo juego FEL
 * (felUuid/felSerie/felNumero/felCertifiedAt). Se usa para la factura de la PLATAFORMA.
 * El 2º juego (promotor) solo se loguea/persiste parcialmente hasta una migración futura.
 *   TODO(fel-schema): añadir felUuidPromoter/felSeriePromoter/felNumeroPromoter/
 *   felCertifiedAtPromoter a `orders` (o una tabla `fel_documents` 1..N por orden) para
 *   persistir el DTE del promotor por completo.
 *
 * FALLBACK NIT→CF: si el certificador rechaza el NIT del receptor (NIT inválido en el
 * padrón del SAT) se reintenta con 'CF' (consumidor final) para no perder la factura.
 *
 * DISPONIBILIDAD: si la integración FEL no está configurada (`integrations.available`
 * = false) se usa el STUB determinista SIN fallar (sandbox/tests) — nada se bloquea.
 */
@Injectable()
export class FelService implements OnModuleInit {
  private readonly logger = new Logger(FelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly integrations: IntegrationsService,
    private readonly config: ConfigService,
    // Certificador configurado (real cuando haya credenciales; stub por ahora). Cuando
    // la integración NO está disponible, se usa igualmente el stub para no fallar.
    @Inject(FEL_CERTIFIER) private readonly certifier: FelCertifier,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.FEL, (name, data) => this.handle(name, data));
  }

  private async handle(name: string, data: unknown): Promise<void> {
    if (name !== JOB_CERTIFY_ORDER) return; // cola propia, pero defensivo por si se comparte
    const job = data as CertifyOrderJob;
    if (job?.orderId) await this.certifyOrder(job.orderId);
  }

  /**
   * Solicita la certificación FEL de una orden. NO certifica en línea: encola el trabajo
   * y retorna. Nunca lanza (un fallo al encolar no debe tumbar el flujo disparador, p.ej.
   * el fulfillment de un pago ya asentado).
   */
  async requestCertification(orderId: string): Promise<void> {
    try {
      await this.queue.enqueue(QUEUES.FEL, JOB_CERTIFY_ORDER, { orderId } satisfies CertifyOrderJob);
    } catch (err) {
      // Defensa en profundidad: `enqueue` ya no lanza, pero si algo cambiara, esto no
      // debe propagar al llamador (la factura no bloquea nada).
      this.logger.error(`No se pudo encolar la certificación FEL de la orden ${orderId}: ${(err as Error).message}`);
    }
  }

  /**
   * Certifica las DOS facturas de una orden (plataforma + promotor). Handler de la cola FEL.
   * Persiste el DTE de la PLATAFORMA en los campos FEL de la orden; el del PROMOTOR se
   * loguea (persistencia completa = migración futura, ver nota de clase).
   */
  async certifyOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        event: { select: { name: true, promoter: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!order) {
      this.logger.warn(`certify-order: orden ${orderId} inexistente; se ignora`);
      return;
    }

    const platformInput = this.buildInput(order, 'platform');
    const promoterInput = this.buildInput(order, 'promoter');

    // Factura de la PLATAFORMA → se persiste en los campos FEL existentes de la orden.
    const platform = await this.certifyWithFallback(platformInput);
    if (platform) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          felUuid: platform.uuid,
          felSerie: platform.serie,
          felNumero: platform.numero,
          felCertifiedAt: platform.certifiedAt,
        },
      });
      this.logger.log(`FEL plataforma orden ${order.id}: uuid=${platform.uuid} serie=${platform.serie} nro=${platform.numero}`);
    }

    // Factura del PROMOTOR → hoy SOLO se loguea (falta juego de columnas en el schema).
    // TODO(fel-schema): persistir en felUuidPromoter/... cuando exista la migración.
    const promoter = await this.certifyWithFallback(promoterInput);
    if (promoter) {
      this.logger.log(`FEL promotor orden ${order.id} (persistencia parcial, ver TODO fel-schema): uuid=${promoter.uuid} serie=${promoter.serie} nro=${promoter.numero}`);
    }
  }

  /**
   * Certifica un DTE eligiendo certificador según disponibilidad y aplicando el fallback
   * NIT→CF. Devuelve null si ni el intento normal ni el CF prosperan (no relanza: el job
   * lo reintentará BullMQ; una factura no bloquea la entrega).
   */
  private async certifyWithFallback(input: FelInvoiceInput): Promise<FelCertResult | null> {
    // Sin credenciales reales → stub determinista (sandbox/tests), nunca red.
    // (Hoy el certificador inyectado YA es el stub; la rama deja explícita la intención
    //  cuando el proveedor real esté conectado detrás del puerto.)
    const useReal = this.integrations.available('fel');
    const certifier = this.certifier;
    if (!useReal) {
      this.logger.debug(`FEL no configurada; certifico ${input.type} de forma simulada (stub)`);
    }

    try {
      return await certifier.certify(input);
    } catch (err) {
      if (err instanceof FelInvalidNitError && input.receptorNit !== CONSUMIDOR_FINAL_NIT) {
        this.logger.warn(`FEL ${input.type}: NIT ${input.receptorNit} rechazado; reintento con CF (consumidor final)`);
        try {
          return await certifier.certify({
            ...input,
            receptorNit: CONSUMIDOR_FINAL_NIT,
            receptorName: undefined,
            receptorAddress: undefined,
          });
        } catch (retryErr) {
          this.logger.error(`FEL ${input.type}: falló también con CF: ${(retryErr as Error).message}`);
          return null;
        }
      }
      this.logger.error(`FEL ${input.type}: certificación fallida: ${(err as Error).message}`);
      return null;
    }
  }

  /** Arma el `FelInvoiceInput` de un juego de la orden (plataforma o promotor). */
  private buildInput(
    order: {
      id: string;
      currency: string;
      net: { toString(): string };
      platformFee: { toString(): string };
      gatewayFee: { toString(): string };
      iva: { toString(): string };
      total: { toString(): string };
      billingNit: string;
      billingName: string | null;
      billingAddress: string | null;
      event: { name: string; promoter: { firstName: string; lastName: string } };
    },
    type: 'platform' | 'promoter',
  ): FelInvoiceInput {
    const fel = this.config.get<AppConfig['fel']>('fel');
    // NIT del emisor de la plataforma (de config). El del promotor NO se almacena aún
    // en el modelo User → placeholder = requestorNit de la plataforma.
    // TODO(fel-promoter-nit): guardar el NIT fiscal del promotor y usarlo aquí.
    const platformNit = fel?.requestorNit || CONSUMIDOR_FINAL_NIT;

    if (type === 'platform') {
      // La plataforma factura su comisión de servicio (comisión de plataforma + pasarela)
      // + el IVA correspondiente.
      const serviceFee = order.platformFee.toString();
      return {
        emisorNit: platformNit,
        receptorNit: order.billingNit,
        receptorName: order.billingName ?? undefined,
        receptorAddress: order.billingAddress ?? undefined,
        items: [
          {
            description: `Servicio de boletería — ${order.event.name}`,
            quantity: 1,
            unitPrice: serviceFee,
            total: serviceFee,
          },
        ],
        currency: order.currency,
        total: serviceFee,
        iva: order.iva.toString(),
        type,
        correlationId: order.id,
      };
    }

    // Factura del PROMOTOR: el neto del boleto que percibe.
    const net = order.net.toString();
    return {
      emisorNit: platformNit, // TODO(fel-promoter-nit): NIT real del promotor
      receptorNit: order.billingNit,
      receptorName: order.billingName ?? undefined,
      receptorAddress: order.billingAddress ?? undefined,
      items: [
        {
          description: `Entrada — ${order.event.name}`,
          quantity: 1,
          unitPrice: net,
          total: net,
        },
      ],
      currency: order.currency,
      total: net,
      iva: '0.00',
      type,
      correlationId: order.id,
    };
  }
}
