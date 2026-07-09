import { randomUUID } from 'crypto';
import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, Role, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EncryptionService } from '../../infra/crypto/encryption.service';
import { StorageService } from '../../infra/storage/storage.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { randomToken } from '../../common/utils/crypto';
import { KeysetQuery, keysetResult, keysetTake } from '../../common/utils/pagination';
import { TicketSigningService } from './ticket-signing.service';
import { TicketCryptoService, TicketIdentity } from './ticket-crypto.service';
import { TicketCustodyService } from './ticket-custody.service';
import { TicketSyncService } from './ticket-sync.service';

export type VerifyResult =
  | {
      valid: true;
      ticketId: string;
      serial: string;
      eventId: string;
      seatLabel: string | null;
      checkedIn: boolean;
    }
  | { valid: false; reason: string; serial?: string };

/**
 * Emisión y validación de boletos (Ola 4). La emisión se dispara como job de la
 * cola TICKETS tras asentar el pago; genera un boleto por línea de orden con firma
 * Ed25519 (identidad inmutable) + secreto TOTP cifrado (QR rotativo) y encola la
 * generación de media (QR/PDF) y el correo de confirmación.
 */
@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: TicketSigningService,
    private readonly crypto: TicketCryptoService,
    private readonly encryption: EncryptionService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly custody: TicketCustodyService,
    private readonly sync: TicketSyncService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler(QUEUES.TICKETS, (name, data) => this.handle(name, data));
  }

  /** Dispatcher de jobs de la cola TICKETS. */
  private async handle(name: string, data: unknown): Promise<void> {
    const payload = data as { orderId?: string };
    if (name === 'issue' && payload.orderId) {
      await this.issue(payload.orderId);
    } else {
      this.logger.warn(`Job de tickets no reconocido: ${name}`);
    }
  }

  /**
   * Emite los boletos de una orden PAGADA (idempotente: solo crea los que faltan,
   * un boleto por línea de orden). Encola media y correo por cada emisión nueva.
   */
  async issue(orderId: string): Promise<{ issued: number }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { where: { active: true } } },
    });
    if (!order) {
      this.logger.warn(`issue: orden ${orderId} inexistente`);
      return { issued: 0 };
    }
    if (order.status !== 'paid') {
      this.logger.warn(`issue: orden ${orderId} no pagada (${order.status}); no se emiten boletos`);
      return { issued: 0 };
    }

    const itemIds = order.items.map((i) => i.id);
    const existing = await this.prisma.ticket.findMany({
      where: { orderItemId: { in: itemIds } },
      select: { orderItemId: true },
    });
    const have = new Set(existing.map((e) => e.orderItemId));
    const pending = order.items.filter((i) => !have.has(i.id));

    const createdIds: string[] = [];
    for (const item of pending) {
      const ticketId = randomUUID();
      const serial = await this.uniqueSerial();
      const secret = this.crypto.newTotpSecret();
      const identity: TicketIdentity = {
        id: ticketId,
        serial,
        eventId: order.eventId,
        localityId: item.localityId,
        seatId: item.seatId,
        ownerId: order.buyerId,
      };
      const signature = this.signing.sign(this.crypto.identityMessage(identity));
      try {
        await this.prisma.ticket.create({
          data: {
            id: ticketId,
            orderItemId: item.id,
            orderId: order.id,
            eventId: order.eventId,
            localityId: item.localityId,
            seatId: item.seatId,
            ownerId: order.buyerId,
            serial,
            signature,
            signingKeyId: this.signing.keyId,
            totpSecret: this.encryption.encrypt(secret),
          },
        });
        createdIds.push(ticketId);
        // Génesis de la cadena de custodia del boleto.
        await this.custody.record({
          ticketId,
          type: 'issued',
          toOwnerId: order.buyerId,
          actorId: order.buyerId,
        });
        await this.sync.record(order.eventId, ticketId, 'issued');
      } catch (e) {
        // Carrera: otro worker emitió el mismo ítem primero (orderItemId único).
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }

    // Trabajo pesado fuera del camino crítico: media por boleto + correo una vez.
    for (const id of createdIds) {
      await this.queue.enqueue(QUEUES.MEDIA, 'generate', { ticketId: id });
    }
    if (createdIds.length > 0) {
      await this.queue.enqueue(QUEUES.MAIL, 'order-confirmation', { orderId: order.id });
    }
    return { issued: createdIds.length };
  }

  /** Serial público legible y único (reintenta ante colisión del índice único). */
  private async uniqueSerial(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const serial = `PE${randomToken(6).toUpperCase()}`;
      const clash = await this.prisma.ticket.findUnique({ where: { serial } });
      if (!clash) return serial;
    }
    return `PE${randomToken(9).toUpperCase()}`;
  }

  /** Boletos del usuario autenticado (keyset por `(issuedAt, id)` desc). */
  async listMine(userId: string, page: KeysetQuery = {}) {
    const rows = await this.prisma.ticket.findMany({
      where: { ownerId: userId },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      include: {
        event: { select: { name: true, slug: true, startsAt: true } },
        locality: { select: { name: true } },
        seat: { select: { label: true } },
      },
      ...keysetTake(page),
    });
    const res = keysetResult(rows, page);
    return { items: res.items.map((t) => this.toSummary(t)), nextCursor: res.nextCursor };
  }

  /** Detalle de un boleto (dueño o admin; si no, 404 para no filtrar existencia). */
  async getOne(id: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        event: { select: { name: true, slug: true, startsAt: true } },
        locality: { select: { name: true } },
        seat: { select: { label: true } },
      },
    });
    if (!ticket || (ticket.ownerId !== user.userId && !user.roles.includes(Role.admin))) {
      throw new NotFoundException('Boleto no encontrado');
    }
    return this.toSummary(ticket);
  }

  /**
   * Valor rotativo actual del QR (para render/refresco en cliente). Solo el dueño.
   * `expiresInSec` indica cuándo rota (el cliente lo refresca antes de expirar).
   */
  async currentQr(id: string, user: AuthUser) {
    const ticket = await this.getOwnedTicket(id, user);
    const secret = this.encryption.decrypt(ticket.totpSecret);
    const code = this.crypto.rotatingCode(secret);
    return {
      ticketId: ticket.id,
      serial: ticket.serial,
      status: ticket.status,
      payload: this.crypto.qrPayload(ticket.serial, code),
      refreshInSeconds: 30,
    };
  }

  /** URLs firmadas de la media (QR PNG + PDF). 409 si aún se está generando. */
  async mediaUrls(id: string, user: AuthUser) {
    const ticket = await this.getOwnedTicket(id, user);
    if (!ticket.mediaReadyAt || !ticket.pdfKey || !ticket.qrKey) {
      throw new ConflictException('La media del boleto aún se está generando');
    }
    return {
      pdfUrl: await this.storage.signedGetUrl(ticket.pdfKey, 300),
      qrUrl: await this.storage.signedGetUrl(ticket.qrKey, 300),
    };
  }

  private async getOwnedTicket(id: string, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket || (ticket.ownerId !== user.userId && !user.roles.includes(Role.admin))) {
      throw new NotFoundException('Boleto no encontrado');
    }
    return ticket;
  }

  /**
   * Valida un QR en puerta (operador). Comprueba, en orden: formato, existencia,
   * código TOTP vigente (anti-screenshot), firma Ed25519 (anti-falsificación) y
   * estado. Si `checkIn`, marca el boleto como usado de forma atómica (una única
   * entrada por boleto, a prueba de doble check-in concurrente).
   */
  async verify(payload: string, checkIn = true, actorId?: string): Promise<VerifyResult> {
    const parsed = this.crypto.parseQr(payload);
    if (!parsed) return { valid: false, reason: 'malformed' };

    const ticket = await this.prisma.ticket.findUnique({
      where: { serial: parsed.serial },
      include: { seat: { select: { label: true } } },
    });
    if (!ticket) return { valid: false, reason: 'not_found', serial: parsed.serial };

    const secret = this.encryption.decrypt(ticket.totpSecret);
    if (!this.crypto.verifyRotatingCode(parsed.code, secret)) {
      return { valid: false, reason: 'expired_or_invalid_code', serial: ticket.serial };
    }

    const identity: TicketIdentity = {
      id: ticket.id,
      serial: ticket.serial,
      eventId: ticket.eventId,
      localityId: ticket.localityId,
      seatId: ticket.seatId,
      ownerId: ticket.ownerId,
    };
    if (!this.signing.verify(this.crypto.identityMessage(identity), ticket.signature)) {
      return { valid: false, reason: 'bad_signature', serial: ticket.serial };
    }

    if (ticket.status === TicketStatus.revoked) {
      return { valid: false, reason: 'revoked', serial: ticket.serial };
    }
    if (ticket.status === TicketStatus.transferred) {
      return { valid: false, reason: 'transferred', serial: ticket.serial };
    }
    if (ticket.status === TicketStatus.used) {
      return { valid: false, reason: 'already_used', serial: ticket.serial };
    }

    let checkedIn = false;
    if (checkIn) {
      // Solo transiciona valid→used; el count evita el doble check-in en carrera.
      const res = await this.prisma.ticket.updateMany({
        where: { id: ticket.id, status: TicketStatus.valid },
        data: { status: TicketStatus.used, usedAt: new Date() },
      });
      if (res.count === 0) {
        return { valid: false, reason: 'already_used', serial: ticket.serial };
      }
      checkedIn = true;
      // Solo el que ganó el check-in registra el movimiento en la cadena.
      await this.custody.record({
        ticketId: ticket.id,
        type: 'checked_in',
        actorId: actorId ?? null,
      });
      await this.sync.record(ticket.eventId, ticket.id, 'checked_in');
    }

    return {
      valid: true,
      ticketId: ticket.id,
      serial: ticket.serial,
      eventId: ticket.eventId,
      seatLabel: ticket.seat?.label ?? null,
      checkedIn,
    };
  }

  /**
   * Revoca (invalida) todos los boletos de una orden — al reembolsar/contracargar.
   * Idempotente. La propagación a validadores offline se hace en la Ola 5.
   */
  async revokeByOrder(orderId: string): Promise<{ revoked: number }> {
    // Capturar los boletos afectados ANTES de actualizarlos (para su cadena).
    const affected = await this.prisma.ticket.findMany({
      where: { orderId, status: { in: [TicketStatus.valid, TicketStatus.used] } },
      select: { id: true, ownerId: true, eventId: true },
    });
    if (affected.length === 0) return { revoked: 0 };
    await this.prisma.ticket.updateMany({
      where: { id: { in: affected.map((t) => t.id) } },
      data: { status: TicketStatus.revoked, revokedAt: new Date() },
    });
    for (const t of affected) {
      await this.custody.record({ ticketId: t.id, type: 'revoked', fromOwnerId: t.ownerId });
      await this.sync.record(t.eventId, t.id, 'revoked'); // propaga la revocación a validadores
    }
    return { revoked: affected.length };
  }

  /** Cadena de custodia de un boleto (dueño/admin) + verificación de integridad. */
  async custodyChain(id: string, user: AuthUser) {
    await this.getOwnedTicket(id, user);
    const [events, integrity] = await Promise.all([
      this.custody.chain(id),
      this.custody.verifyChain(id),
    ]);
    return { integrity, events };
  }

  private toSummary(t: {
    id: string;
    serial: string;
    status: TicketStatus;
    seatId: string | null;
    orderId: string;
    localityId: string;
    qrKey: string | null;
    pdfKey: string | null;
    mediaReadyAt: Date | null;
    eventId: string;
    event?: { name: string; slug: string; startsAt: Date };
    locality?: { name: string } | null;
    seat?: { label: string } | null;
  }) {
    return {
      id: t.id,
      serial: t.serial,
      status: t.status,
      seatId: t.seatId,
      orderId: t.orderId,
      localityId: t.localityId,
      localityName: t.locality?.name ?? null,
      seatLabel: t.seat?.label ?? null,
      eventId: t.eventId,
      event: t.event,
      mediaReady: t.mediaReadyAt != null,
    };
  }
}
