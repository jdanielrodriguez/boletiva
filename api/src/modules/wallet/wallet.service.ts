import { Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';

/**
 * Saldo interno del usuario. La fuente de verdad es el ledger (cuenta
 * user_wallet); el wallet se llena por reembolsos/reventas y se gasta en compras
 * (pago con saldo o mixto). No hay recarga por tarjeta.
 */
@Injectable()
export class WalletService {
  constructor(private readonly ledger: LedgerService) {}

  async summary(userId: string): Promise<{ balance: string; currency: 'GTQ' }> {
    const balance = await this.ledger.walletBalance(userId);
    return { balance: balance.toFixed(2), currency: 'GTQ' };
  }
}
