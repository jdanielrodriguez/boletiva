import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Role, TicketStatus } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { EncryptionService } from '../../../infra/crypto/encryption.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';
import { CostShareService } from '../../cost-share/cost-share.service';
import { TicketCryptoService } from '../ticket-crypto.service';
import { WALLET_PROVIDER, WalletPlatform, WalletProvider } from './wallet-provider';

const PASS_FEE_KEY = 'wallet.pass_fee';

/**
 * Emisión de pases de wallet para un boleto. El costo de generar el pase (cargo
 * EXTRA, fuera del precio del boleto) se reparte promotor↔plataforma vía
 * CostShareService (Ola 3.5·E): la parte del promotor se descuenta de su neto.
 */
@Injectable()
export class WalletPassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly crypto: TicketCryptoService,
    private readonly costShare: CostShareService,
    @Inject(WALLET_PROVIDER) private readonly provider: WalletProvider,
  ) {}

  async createPass(ticketId: string, platform: WalletPlatform, user: AuthUser) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: { select: { name: true, promoterId: true } },
        seat: { select: { label: true } },
      },
    });
    if (!ticket || (ticket.ownerId !== user.userId && !user.roles.includes(Role.admin))) {
      throw new NotFoundException('Boleto no encontrado');
    }
    if (ticket.status === TicketStatus.revoked || ticket.status === TicketStatus.transferred) {
      throw new BadRequestException('El boleto no está vigente');
    }

    const secret = this.encryption.decrypt(ticket.totpSecret);
    const qrPayload = this.crypto.qrPayload(ticket.serial, this.crypto.rotatingCode(secret));
    const pass = await this.provider.createPass(platform, {
      ticketId: ticket.id,
      serial: ticket.serial,
      eventName: ticket.event.name,
      seatLabel: ticket.seat?.label ?? null,
      qrPayload,
    });

    // Cargo EXTRA por pasar a wallet (si está configurado): se reparte.
    const fee = await this.passFee();
    let costShare: unknown = null;
    if (fee.gt(0)) {
      costShare = await this.costShare.applyExtraCost({
        promoterId: ticket.event.promoterId,
        amount: fee.toFixed(2),
        kind: 'wallet_pass_fee',
        refType: 'ticket',
        refId: ticket.id,
      });
    }

    return { ...pass, feeApplied: fee.toFixed(2), costShare };
  }

  /** Cargo por pasar a wallet (setting `wallet.pass_fee`, default 0 = sin cargo). */
  private async passFee(): Promise<Decimal> {
    const s = await this.prisma.setting.findUnique({ where: { key: PASS_FEE_KEY } });
    const n = typeof s?.value === 'number' ? s.value : Number(s?.value);
    return new Decimal(Number.isFinite(n) && n > 0 ? n : 0);
  }
}
