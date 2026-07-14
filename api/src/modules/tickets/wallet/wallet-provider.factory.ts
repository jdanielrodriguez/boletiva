import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { AppleWalletProvider } from './apple-wallet.provider';
import { AutoWalletProvider } from './auto-wallet.provider';
import { GoogleWalletProvider } from './google-wallet.provider';
import { StubWalletProvider } from './stub-wallet.provider';
import { WalletProvider } from './wallet-provider';

/**
 * Elige el proveedor de wallet según `wallet.provider`:
 *  - 'stub'   → sandbox sin certificados (default; no rompe E2E).
 *  - 'google' → Google Wallet real (value-ready).
 *  - 'apple'  → Apple Wallet (503 sin certificados de Apple Developer).
 *  - 'auto'   → google/apple si están disponibles; si no, cae al stub.
 * Todos comparten el mismo puerto; sin credenciales devuelven 503 al PEDIR el pase.
 */
export function walletProviderFactory(
  config: ConfigService,
  storage: StorageService,
  integrations: IntegrationsService,
): WalletProvider {
  const provider = config.get<string>('wallet.provider') ?? 'stub';
  const stub = new StubWalletProvider(storage);
  switch (provider) {
    case 'google':
      return new GoogleWalletProvider(integrations, config);
    case 'apple':
      return new AppleWalletProvider(integrations);
    case 'auto':
      return new AutoWalletProvider(
        integrations,
        new GoogleWalletProvider(integrations, config),
        new AppleWalletProvider(integrations),
        stub,
      );
    case 'stub':
    default:
      return stub;
  }
}
