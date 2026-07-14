import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
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
import { GateAccessService } from './gate-access.service';
import { GateAccessController } from './gate-access.controller';
import { ValidationIngestService } from './validation-ingest.service';
import { ValidationIngestController } from './validation-ingest.controller';
import { WalletPassService } from './wallet/wallet-pass.service';
import { WALLET_PROVIDER } from './wallet/wallet-provider';
import { walletProviderFactory } from './wallet/wallet-provider.factory';
import { IntegrationsService } from '../../infra/integrations/integrations.service';

/**
 * Boletos (Ola 4): emisión (Ed25519 + TOTP) encolada tras el pago, generación de
 * media (QR/PDF) y correos async, y pases de wallet vía puerto `WALLET_PROVIDER`.
 * Exporta TicketsService para que Payments revoque boletos en reembolsos/contracargos.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    TicketsController,
    TicketTransfersController,
    TicketManifestController,
    ValidationIngestController,
    GateAccessController,
  ],
  providers: [
    TicketsService,
    TicketSigningService,
    TicketCryptoService,
    TicketCustodyService,
    TicketSyncService,
    GateAccessService,
    TicketMediaService,
    TicketMailService,
    TicketTransferService,
    ValidationIngestService,
    WalletPassService,
    // Proveedor de wallet elegido por config (`wallet.provider`):
    //  - 'stub'   → sandbox sin certificados (default; no rompe E2E).
    //  - 'google' → Google Wallet real (value-ready: issuerId + service account).
    //  - 'apple'  → Apple Wallet (503 sin certificados de Apple Developer).
    //  - 'auto'   → usa google/apple si están disponibles; si no, cae al stub.
    // Google/Apple viven detrás del mismo puerto; sin credenciales devuelven 503
    // al PEDIR el pase (no al arrancar).
    {
      provide: WALLET_PROVIDER,
      inject: [ConfigService, StorageService, IntegrationsService],
      useFactory: walletProviderFactory,
    },
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
