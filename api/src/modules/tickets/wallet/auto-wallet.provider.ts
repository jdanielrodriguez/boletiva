import { Injectable } from '@nestjs/common';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { AppleWalletProvider } from './apple-wallet.provider';
import { GoogleWalletProvider } from './google-wallet.provider';
import { StubWalletProvider } from './stub-wallet.provider';
import { WalletPassInput, WalletPassResult, WalletPlatform, WalletProvider } from './wallet-provider';

/**
 * Proveedor AUTO: enruta por plataforma al proveedor real cuando su integración
 * está disponible (Google → GoogleWalletProvider, Apple → AppleWalletProvider) y,
 * si no lo está, cae al stub (sandbox) — así los pases siguen funcionando en
 * entornos sin certificados sin romper el flujo.
 */
@Injectable()
export class AutoWalletProvider implements WalletProvider {
  readonly name = 'auto';

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly google: GoogleWalletProvider,
    private readonly apple: AppleWalletProvider,
    private readonly stub: StubWalletProvider,
  ) {}

  createPass(platform: WalletPlatform, input: WalletPassInput): Promise<WalletPassResult> {
    if (platform === 'google') {
      return this.integrations.available('googleWallet')
        ? this.google.createPass(platform, input)
        : this.stub.createPass(platform, input);
    }
    return this.integrations.available('appleWallet')
      ? this.apple.createPass(platform, input)
      : this.stub.createPass(platform, input);
  }
}
