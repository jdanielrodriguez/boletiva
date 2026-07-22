import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { hmacSha256, randomToken } from '../../../common/utils/crypto';
import {
  CardData,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  WebhookDelivery,
} from '../payment.provider';

/** Config tipada de la pasarela Pagalo (subconjunto de AppConfig). */
interface PagaloConfig {
  credencial: string;
  dominio: string;
  estado: string;
  keyPublic: string;
  keySecret: string;
  idenEmpresa: string;
  webhookSecret: string;
}

/** Respuesta (parcial) de Pagalo. El estado real llega en `estado`/`status`. */
interface PagaloResponse {
  estado?: string;
  status?: string;
  id?: string;
  idTransaccion?: string;
  mensaje?: string;
  message?: string;
}

/** Estados que Pagalo reporta como aprobación sincrónica de la transacción. */
const APPROVED = new Set(['aprobada', 'aprobado', 'approved', 'success', 'completada', '1']);

/**
 * Pasarela PAGALO (pagalocard) — alternativa/failover. VALUE-READY: con las credenciales
 * puestas (credencial+dominio+llaves de empresa) cobra contra el contrato real
 * `POST https://{dominio}/api/v1/integracion/{credencial}` (docs https://docs.pagalo.co/).
 *
 * Flujo WEBHOOK-FIRST: si Pagalo aprueba sincrónicamente, este proveedor entrega un
 * webhook `payment.succeeded` FIRMADO in-process (vía scheduleAutoConfirm), disparando el
 * fulfillment existente sin cambios — igual que el simulador. En prod, Pagalo puede además
 * notificar por su propio webhook a POST /payments/webhook (idempotente por (provider,eventId)).
 */
@Injectable()
export class PagaloPaymentProvider implements PaymentProvider {
  readonly name = 'pagalo';
  private readonly logger = new Logger(PagaloPaymentProvider.name);
  /** providerRefs aprobados sincrónicamente, pendientes de entregar su webhook. */
  private readonly approvedRefs = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly integrations: IntegrationsService,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    // Sin credenciales → 503 "servicio no disponible" (nunca pega al endpoint real).
    this.integrations.assertAvailable('pagalo');
    // Pagalo NO tiene SDK de tokenización de cliente: cobra con la tarjeta que el
    // comprador captura en NUESTRO formulario (misma UX que el simulador). Sin tarjeta
    // no hay cómo cobrar → 400 (nunca pega al endpoint real). CVV fresco por cobro; NO se persiste.
    if (!input.card) {
      throw new BadRequestException('Pagalo requiere los datos de la tarjeta para cobrar');
    }
    const cfg = this.config.getOrThrow<PagaloConfig>('pagalo');

    const body = this.buildBody(cfg, input);
    const url = `https://${cfg.dominio}/api/v1/integracion/${cfg.credencial}`;

    let json: PagaloResponse;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      json = (await res.json()) as PagaloResponse;
    } catch (e) {
      // NUNCA loguear el body (aunque no lleva PAN: la tokenización es opaca).
      this.logger.error(`Pagalo: fallo de red al cobrar orden ${input.orderId}: ${String(e)}`);
      throw e;
    }

    const providerRef = input.providerRef;
    const estado = (json.estado ?? json.status ?? '').toLowerCase();
    if (APPROVED.has(estado)) {
      // Marcar para que scheduleAutoConfirm entregue el webhook firmado (webhook-first).
      this.approvedRefs.add(providerRef);
      this.logger.log(`Pagalo aprobó la orden ${input.orderId} (ref ${providerRef})`);
    } else {
      this.logger.warn(
        `Pagalo no aprobó la orden ${input.orderId} (estado="${estado}"); se esperará el webhook del gateway`,
      );
    }

    return {
      providerRef,
      // Pagalo integrado responde sin redirección (cobro directo con token); dejamos una
      // URL de referencia. El fulfillment ocurre por webhook.
      paymentUrl: `pagalo://transaccion/${json.id ?? json.idTransaccion ?? providerRef}`,
      installments: input.installments,
    };
  }

  /**
   * Construye el form POST real de Pagalo (contrato pagalocard verificado en el legacy
   * `ticketera`/`tiketera`). `tarjetaPagalo` lleva los datos de la tarjeta que el comprador
   * capturó en nuestro formulario — Pagalo NO ofrece SDK de tokenización de cliente, así que
   * el cobro es SAQ-D (aceptado sólo para alpha; en la versión pública se usa dLocal, PCI-safe).
   * El monto es server-authoritative (`input.amount`); el nombre en la tarjeta identifica al comprador.
   */
  private buildBody(cfg: PagaloConfig, input: CreatePaymentInput): string {
    const card = input.card as CardData; // garantizado por createPayment
    const empresa = {
      key_secret: cfg.keySecret,
      key_public: cfg.keyPublic,
      idenEmpresa: cfg.idenEmpresa,
    };
    const cliente = {
      codigo: input.orderId,
      firstName: card.name,
      lastName: '',
      street1: '',
      country: 'GT',
      city: '',
      state: '',
      email: '',
      ipAddress: '',
      Total: input.amount,
      currency: input.currency || 'GTQ',
      fecha_transaccion: null,
      postalCode: '',
      phone: '',
      deviceFingerprintID: '',
    };
    // tarjetaPagalo: shape exacto del contrato pagalocard (nameCard/accountNumber/
    // expirationMonth/expirationYear/CVVCard). El CVV viaja sólo aquí y NO se persiste.
    const tarjetaPagalo = {
      nameCard: card.name,
      accountNumber: card.number,
      expirationMonth: card.expMonth,
      expirationYear: card.expYear,
      CVVCard: card.cvv,
    };
    const detalle = {
      id_producto: input.orderId,
      cantidad: 1,
      tipo: 'producto',
      nombre: `Orden ${input.orderId}`,
      precio: input.amount,
      Subtotal: input.amount,
    };

    const form = new URLSearchParams();
    form.set('empresa', JSON.stringify(empresa));
    form.set('cliente', JSON.stringify(cliente));
    form.set('tarjetaPagalo', JSON.stringify(tarjetaPagalo));
    form.set('detalle', JSON.stringify(detalle));
    return form.toString();
  }

  /**
   * Si Pagalo aprobó sincrónicamente en createPayment, entrega un webhook
   * `payment.succeeded` FIRMADO (HMAC con el `payment.webhookSecret` que verifica el
   * handler) — reproduce el camino webhook-first del gateway real. No-op si no hubo
   * aprobación sincrónica (se esperará el webhook propio de Pagalo).
   */
  scheduleAutoConfirm(providerRef: string, deliver: WebhookDelivery): void {
    if (!this.approvedRefs.delete(providerRef)) return;
    const secret = this.config.get<string>('payment.webhookSecret') as string;
    const id = `pagalo_evt_${randomToken(12)}`;
    const type = 'payment.succeeded';
    const signature = hmacSha256(secret, `${id}.${type}.${providerRef}`);
    deliver({ id, type, providerRef }, signature).catch((e) =>
      this.logger.warn(`Pagalo: entrega in-process del webhook falló para ${providerRef}: ${String(e)}`),
    );
  }
}
