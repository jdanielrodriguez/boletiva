import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RabbitService } from '../../infra/messaging/rabbit.service';
import { withSpan } from '../../infra/observability/tracing';
import { TicketCustodyService } from './ticket-custody.service';
import { TicketSyncService } from './ticket-sync.service';
import { StreamService } from '../stream/stream.service';

const QUEUE = 'validation.ingest';

export interface CheckinItem {
  serial: string;
  gateId?: string;
  checkedInAt?: string;
  /** Evento al que está acotado el lote (8.1): un serial de otro evento → invalid. */
  eventId?: string;
  /** Operador/validador que hizo el check-in (se registra como actor en la custodia
   * → atribución del dashboard "por validador"). Se estampa desde el token en submit. */
  operatorId?: string | null;
}

export type CheckinOutcome = 'checked_in' | 'already_used' | 'not_found' | 'invalid';

/**
 * Ingest masivo de validación (Ola 6). Las puertas offline acumulan check-ins y,
 * al reconectar, los envían en lote; el bus RabbitMQ desacopla el fan-in. Cada
 * check-in se aplica IDEMPOTENTE: si el boleto está `valid` se marca `used`
 * (custody + sync); si ya estaba `used` es un DOBLE check-in (posible otra puerta)
 * → se registra un CheckinConflict para revisión; si está revocado/inexistente se
 * reporta sin romper. En test corre inline (síncrono); en dev/prod vía RabbitMQ.
 */
@Injectable()
export class ValidationIngestService implements OnModuleInit {
  private readonly logger = new Logger(ValidationIngestService.name);
  private readonly inline: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbit: RabbitService,
    private readonly custody: TicketCustodyService,
    private readonly sync: TicketSyncService,
    private readonly stream: StreamService,
    config: ConfigService,
  ) {
    this.inline = config.get<boolean>('amqp.inline') ?? false;
  }

  async onModuleInit(): Promise<void> {
    if (this.inline) return; // en test no se abre consumidor AMQP
    try {
      await this.rabbit.consume<CheckinItem>(QUEUE, (item) => this.applyCheckin(item).then(() => undefined));
    } catch (err) {
      this.logger.error(`No se pudo iniciar el consumidor de ingest: ${(err as Error).message}`);
    }
  }

  /**
   * Envía un lote de check-ins. Inline → aplica y devuelve la reconciliación;
   * async → publica al bus y devuelve lo aceptado (el consumidor reconcilia).
   */
  async submit(items: CheckinItem[], eventId?: string, gateId?: string, operatorId?: string) {
    const stamped = items.map((i) => ({
      ...i,
      gateId: i.gateId ?? gateId,
      eventId: eventId ?? i.eventId,
      operatorId: i.operatorId ?? operatorId ?? null,
    }));
    if (this.inline) {
      return { mode: 'inline' as const, ...(await this.ingestBatch(stamped)) };
    }
    for (const item of stamped) await this.rabbit.publish(QUEUE, item);
    return { mode: 'async' as const, accepted: stamped.length };
  }

  /** Aplica un lote y agrega el resultado de la reconciliación (con span de negocio). */
  async ingestBatch(items: CheckinItem[]) {
    return withSpan('validation.ingest', { 'ingest.count': items.length }, async (span) => {
      const summary = { total: items.length, checkedIn: 0, alreadyUsed: 0, notFound: 0, invalid: 0 };
      for (const item of items) {
        const outcome = await this.applyCheckin(item);
        if (outcome === 'checked_in') summary.checkedIn++;
        else if (outcome === 'already_used') summary.alreadyUsed++;
        else if (outcome === 'not_found') summary.notFound++;
        else summary.invalid++;
      }
      span.setAttribute('ingest.checked_in', summary.checkedIn);
      span.setAttribute('ingest.conflicts', summary.alreadyUsed + summary.invalid);
      return summary;
    });
  }

  /** Aplica un check-in idempotente y devuelve el desenlace. */
  async applyCheckin(item: CheckinItem): Promise<CheckinOutcome> {
    const ticket = await this.prisma.ticket.findUnique({ where: { serial: item.serial } });
    if (!ticket) return 'not_found';
    // Fecha del check-in offline; si viene inválida, se usa "ahora" (no persistir Invalid Date).
    let at = new Date();
    if (item.checkedInAt) {
      const parsed = new Date(item.checkedInAt);
      if (!Number.isNaN(parsed.getTime())) at = parsed;
    }

    // 8.1: el lote está acotado a un evento; un serial de OTRO evento no se valida.
    if (item.eventId && ticket.eventId !== item.eventId) {
      await this.recordConflict(ticket, item, 'wrong_event', at);
      return 'invalid';
    }

    if (ticket.status === TicketStatus.revoked || ticket.status === TicketStatus.transferred) {
      await this.recordConflict(ticket, item, `invalid_state:${ticket.status}`, at);
      return 'invalid';
    }
    if (ticket.status === TicketStatus.used) {
      await this.recordConflict(ticket, item, 'already_used', at);
      return 'already_used';
    }

    // valid → used (guard atómico contra otra puerta/ingest concurrente).
    const res = await this.prisma.ticket.updateMany({
      where: { id: ticket.id, status: TicketStatus.valid },
      data: { status: TicketStatus.used, usedAt: at },
    });
    if (res.count === 0) {
      await this.recordConflict(ticket, item, 'already_used', at);
      return 'already_used';
    }
    await this.custody.record({
      ticketId: ticket.id,
      type: 'checked_in',
      actorId: item.operatorId ?? null, // atribución al validador (dashboard "por validador")
      meta: { source: 'offline_ingest', gateId: item.gateId ?? null },
    });
    await this.sync.record(ticket.eventId, ticket.id, 'checked_in');
    this.stream.emitCheckin(ticket.eventId, { serial: ticket.serial }); // dashboard en vivo (SSE)
    return 'checked_in';
  }

  private async recordConflict(
    ticket: { id: string; eventId: string; serial: string },
    item: CheckinItem,
    reason: string,
    attemptedAt: Date,
  ): Promise<void> {
    await this.prisma.checkinConflict.create({
      data: {
        ticketId: ticket.id,
        eventId: ticket.eventId,
        serial: ticket.serial,
        gateId: item.gateId ?? null,
        reason,
        attemptedAt,
      },
    });
  }

  /** Conflictos de validación de un evento (para revisión del organizador). */
  listConflicts(eventId: string) {
    return this.prisma.checkinConflict.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
