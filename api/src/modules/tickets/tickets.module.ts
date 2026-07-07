import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../infra/storage/storage.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketSigningService } from './ticket-signing.service';
import { TicketCryptoService } from './ticket-crypto.service';
import { TicketCustodyService } from './ticket-custody.service';
import { TicketMediaService } from './ticket-media.service';
import { TicketMailService } from './ticket-mail.service';
import { TicketTransferService } from './ticket-transfer.service';
import { TicketTransfersController } from './ticket-transfers.controller';
import { TicketSyncService } from './ticket-sync.service';
import { TicketManifestController } from './ticket-manifest.controller';
import { ValidationIngestService } from './validation-ingest.service';
import { ValidationIngestController } from './validation-ingest.controller';
import { WalletPassService } from './wallet/wallet-pass.service';
import { WALLET_PROVIDER } from './wallet/wallet-provider';
import { StubWalletProvider } from './wallet/stub-wallet.provider';

/**
 * Boletos (Ola 4): emisión (Ed25519 + TOTP) encolada tras el pago, generación de
 * media (QR/PDF) y correos async, y pases de wallet vía puerto `WALLET_PROVIDER`.
 * Exporta TicketsService para que Payments revoque boletos en reembolsos/contracargos.
 */
@Module({
  controllers: [
    TicketsController,
    TicketTransfersController,
    TicketManifestController,
    ValidationIngestController,
  ],
  providers: [
    TicketsService,
    TicketSigningService,
    TicketCryptoService,
    TicketCustodyService,
    TicketSyncService,
    TicketMediaService,
    TicketMailService,
    TicketTransferService,
    ValidationIngestService,
    WalletPassService,
    // Proveedor de wallet elegido por config (hoy solo 'stub'; Google/Apple detrás
    // del mismo puerto cuando haya certificados/credenciales).
    {
      provide: WALLET_PROVIDER,
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService, storage: StorageService) => {
        const provider = config.get<string>('wallet.provider') ?? 'stub';
        switch (provider) {
          case 'stub':
          default:
            return new StubWalletProvider(storage);
        }
      },
    },
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
