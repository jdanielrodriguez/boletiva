import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EncryptionService } from '../../infra/crypto/encryption.service';
import { QueueService } from '../../infra/queue/queue.service';
import { QUEUES } from '../../infra/queue/queue.constants';
import { sha256 } from '../../common/utils/crypto';
import { TicketSigningService } from './ticket-signing.service';
import { TicketCryptoService, TicketIdentity } from './ticket-crypto.service';
import { TicketCustodyService } from './ticket-custody.service';

const MAX_KEY = 'transfer.max_per_ticket_default';
const TTL_HOURS = 48;
// Alfabeto sin caracteres ambiguos (O/0, I/1, L) para un código fácil de dictar.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Transferencia (regalo interno) de boletos (Ola 5). Handshake de doble
 * confirmación con código compartido: el remitente inicia y recibe un código
 * (guardado hasheado); el destinatario verificado lo canjea. Al canjear se
 * RE-EMITE el boleto (nuevo secreto TOTP + nueva firma Ed25519 sobre el nuevo
 * dueño) → el QR/pase anterior queda inservible; se asienta en la cadena de
 * custodia y se regenera la media del nuevo dueño.
 */
@Injectable()
export class TicketTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly signing: TicketSigningService,
    private readonly crypto: TicketCryptoService,
    private readonly custody: TicketCustodyService,
    private readonly queue: QueueService,
  ) {}

  /** Máximo de transferencias del boleto: override del evento o default global. */
  private async maxTransfers(event: { maxTransfers: number | null }): Promise<number> {
    if (event.maxTransfers != null) return event.maxTransfers;
    const s = await this.prisma.setting.findUnique({ where: { key: MAX_KEY } });
    const n = typeof s?.value === 'number' ? s.value : Number(s?.value);
    return Number.isFinite(n) && n >= 0 ? n : 1;
  }

  private genCode(): string {
    const bytes = randomBytes(8);
    return Array.from(bytes)
      .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
      .join('');
  }

  /** El remitente (dueño) inicia una transferencia y obtiene el código (una vez). */
  async initiate(ticketId: string, senderId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { event: { select: { maxTransfers: true } } },
    });
    if (!ticket || ticket.ownerId !== senderId) {
      throw new NotFoundException('Boleto no encontrado'); // no filtra existencia (IDOR)
    }
    if (ticket.status !== TicketStatus.valid) {
      throw new BadRequestException('El boleto no está vigente para transferir');
    }
    const max = await this.maxTransfers(ticket.event);
    if (ticket.transferCount >= max) {
      throw new BadRequestException(`Se alcanzó el límite de transferencias (${max}) del boleto`);
    }

    const code = this.genCode();
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
    try {
      const transfer = await this.prisma.ticketTransfer.create({
        data: { ticketId, senderId, codeHash: sha256(code), expiresAt },
      });
      return { transferId: transfer.id, code, expiresAt }; // el código va SOLO aquí
    } catch (e) {
      // Índice parcial: ya hay una transferencia pendiente para este boleto.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya hay una transferencia pendiente para este boleto');
      }
      throw e;
    }
  }

  /** El destinatario (verificado) canjea el código y recibe el boleto re-emitido. */
  async claim(code: string, recipientId: string) {
    const transfer = await this.prisma.ticketTransfer.findFirst({
      where: { codeHash: sha256(code.trim().toUpperCase()), status: 'pending' },
    });
    if (!transfer) throw new NotFoundException('Código de transferencia inválido');
    if (transfer.expiresAt.getTime() < Date.now()) {
      await this.prisma.ticketTransfer.update({
        where: { id: transfer.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('La transferencia expiró');
    }
    if (transfer.senderId === recipientId) {
      throw new BadRequestException('No puedes transferirte el boleto a ti mismo');
    }

    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: transfer.ticketId },
      include: { event: { select: { maxTransfers: true } } },
    });
    if (ticket.ownerId !== transfer.senderId || ticket.status !== TicketStatus.valid) {
      // El boleto cambió de dueño o dejó de ser válido desde que se inició.
      await this.prisma.ticketTransfer.update({ where: { id: transfer.id }, data: { status: 'cancelled' } });
      throw new ConflictException('El boleto ya no está disponible para transferir');
    }
    const max = await this.maxTransfers(ticket.event);
    if (ticket.transferCount >= max) {
      throw new BadRequestException(`Se alcanzó el límite de transferencias (${max}) del boleto`);
    }

    // Re-emisión: nuevo secreto + nueva firma sobre la identidad del NUEVO dueño.
    const newSecret = this.crypto.newTotpSecret();
    const identity: TicketIdentity = {
      id: ticket.id,
      serial: ticket.serial,
      eventId: ticket.eventId,
      localityId: ticket.localityId,
      seatId: ticket.seatId,
      ownerId: recipientId,
    };
    const signature = this.signing.sign(this.crypto.identityMessage(identity));

    await this.prisma.$transaction(async (tx) => {
      // Serializa contra otra reclamación concurrente del mismo boleto.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ticket.id}))`;
      const fresh = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      if (fresh.ownerId !== transfer.senderId || fresh.status !== TicketStatus.valid) {
        throw new ConflictException('El boleto ya no está disponible para transferir');
      }
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          ownerId: recipientId,
          totpSecret: this.encryption.encrypt(newSecret),
          signature,
          transferCount: { increment: 1 },
          // Invalida la media anterior: se regenera para el nuevo dueño.
          qrKey: null,
          pdfKey: null,
          mediaReadyAt: null,
        },
      });
      await tx.ticketTransfer.update({
        where: { id: transfer.id },
        data: { status: 'claimed', recipientId, claimedAt: new Date() },
      });
    });

    // Fuera de la tx: cadena de custodia + regeneración de media (async).
    await this.custody.record({
      ticketId: ticket.id,
      type: 'transferred',
      fromOwnerId: transfer.senderId,
      toOwnerId: recipientId,
      actorId: recipientId,
    });
    await this.queue.enqueue(QUEUES.MEDIA, 'generate', { ticketId: ticket.id });

    return {
      ticketId: ticket.id,
      serial: ticket.serial,
      status: 'valid',
      transferredFrom: transfer.senderId,
    };
  }

  /** El remitente cancela una transferencia pendiente. */
  async cancel(transferId: string, senderId: string) {
    const transfer = await this.prisma.ticketTransfer.findUnique({ where: { id: transferId } });
    if (!transfer || transfer.senderId !== senderId) {
      throw new NotFoundException('Transferencia no encontrada'); // IDOR
    }
    if (transfer.status !== 'pending') {
      throw new BadRequestException(`La transferencia ya no está pendiente (${transfer.status})`);
    }
    await this.prisma.ticketTransfer.update({
      where: { id: transferId },
      data: { status: 'cancelled' },
    });
    return { id: transferId, status: 'cancelled' };
  }

  /** Transferencias iniciadas por mí que siguen pendientes. */
  outgoing(senderId: string) {
    return this.prisma.ticketTransfer.findMany({
      where: { senderId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ticketId: true, expiresAt: true, createdAt: true },
    });
  }
}
