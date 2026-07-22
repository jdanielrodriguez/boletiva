import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TicketEventType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EncryptionService } from '../../infra/crypto/encryption.service';
import { sha256 } from '../../common/utils/crypto';
import { TicketSigningService } from './ticket-signing.service';

/**
 * Sincronización de validadores offline (Ola 5, modelo SafeTix) + propagación de
 * revocaciones (Ola 3→5). Cada emisión/transferencia/check-in/revocación agrega
 * una entrada a la bitácora (`ticket_sync_entries`, seq global monótono). El
 * dispositivo de puerta hace pull incremental (`since`) y arma su estado local.
 *
 * El manifiesto va FIRMADO (Ed25519) para que el dispositivo verifique su
 * autenticidad e integridad offline con la llave pública. Incluye el secreto TOTP
 * de cada boleto (descifrado al vuelo, servido solo a operadores sobre TLS) para
 * poder recomputar el QR rotativo sin red → un screenshot NO sirve aunque no haya
 * internet. Las transferencias propagan el nuevo secreto; las revocaciones, el
 * estado `revoked`.
 */
@Injectable()
export class TicketSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly signing: TicketSigningService,
    private readonly config: ConfigService,
  ) {}

  /** Registra un movimiento en la bitácora de sincronización. */
  async record(eventId: string, ticketId: string, reason: TicketEventType): Promise<void> {
    await this.prisma.ticketSyncEntry.create({ data: { eventId, ticketId, reason } });
  }

  /**
   * Manifiesto (o delta desde `since`) de un evento, FIRMADO. Devuelve el último
   * estado por boleto que cambió después de `since`, con su secreto TOTP en claro.
   */
  async manifest(eventId: string, since = 0) {
    const entries = await this.prisma.ticketSyncEntry.findMany({
      where: { eventId, seq: { gt: BigInt(since) } },
      orderBy: { seq: 'asc' },
    });

    // Último estado por boleto (dedupe conservando la entrada más reciente).
    const latestByTicket = new Map<string, { seq: bigint; reason: TicketEventType }>();
    for (const e of entries) latestByTicket.set(e.ticketId, { seq: e.seq, reason: e.reason });
    const maxSeq = entries.length ? Number(entries[entries.length - 1].seq) : since;

    const ticketIds = [...latestByTicket.keys()];
    const tickets = ticketIds.length
      ? await this.prisma.ticket.findMany({
          where: { id: { in: ticketIds } },
          include: { seat: { select: { label: true } } },
        })
      : [];

    const items = tickets
      .map((t) => ({
        ticketId: t.id,
        serial: t.serial,
        seatLabel: t.seat?.label ?? null,
        ownerId: t.ownerId,
        status: t.status,
        signature: t.signature,
        signingKeyId: t.signingKeyId,
        totpSecret: this.encryption.decrypt(t.totpSecret), // en claro (SafeTix)
        reason: latestByTicket.get(t.id)?.reason,
      }))
      .sort((a, b) => a.ticketId.localeCompare(b.ticketId)); // orden estable para firmar

    // Expiración firmada (SafeTix): el device rechaza offline un manifiesto vencido
    // (lleva secretos TOTP en claro) → un manifiesto robado deja de servir tras el
    // TTL; el device re-hace pull cuando hay red. Va DENTRO del contenido firmado.
    const generatedAt = new Date();
    const ttlSeconds = this.config.getOrThrow<number>('safetix.manifestTtl');
    const expiresAt = new Date(generatedAt.getTime() + ttlSeconds * 1000);

    // Firma sobre un digest canónico. CUBRE el secreto TOTP (por hash) y el dueño, no
    // solo id|status|serial: si no, un MITM podía SUSTITUIR el `totpSecret` en claro de
    // un boleto dejando id/serial/status intactos y la firma seguía validando → generaba
    // QRs válidos de un boleto ajeno offline. Al firmar `sha256(totpSecret)`+ownerId, el
    // device recomputa el hash del secreto servido y detecta cualquier sustitución (QA).
    const canonical = JSON.stringify({
      eventId,
      maxSeq,
      expiresAt: expiresAt.toISOString(),
      tickets: items.map((t) => ({
        id: t.ticketId,
        st: t.status,
        s: t.serial,
        o: t.ownerId,
        sec: sha256(t.totpSecret),
      })),
    });
    const contentHash = sha256(canonical);
    const signature = this.signing.sign(contentHash);

    return {
      eventId,
      maxSeq,
      keyId: this.signing.keyId,
      publicKeyPem: this.signing.publicKeyPem(),
      count: items.length,
      tickets: items,
      contentHash,
      signature,
      generatedAt: generatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
