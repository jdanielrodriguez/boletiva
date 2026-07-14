import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { StorageService } from '../../../infra/storage/storage.service';
import { AppleWalletProvider } from './apple-wallet.provider';
import { AutoWalletProvider } from './auto-wallet.provider';
import { GoogleWalletProvider } from './google-wallet.provider';
import { StubWalletProvider } from './stub-wallet.provider';
import { walletProviderFactory } from './wallet-provider.factory';

function makeConfig(provider: string | undefined): ConfigService {
  return {
    get: <T,>(key: string): T | undefined => (key === 'wallet.provider' ? (provider as unknown as T) : undefined),
  } as unknown as ConfigService;
}

const storage = {} as unknown as StorageService;
const integrations = {
  available: () => false,
  assertAvailable: () => undefined,
} as unknown as IntegrationsService;

describe('walletProviderFactory', () => {
  it("'stub' → StubWalletProvider", () => {
    expect(walletProviderFactory(makeConfig('stub'), storage, integrations)).toBeInstanceOf(StubWalletProvider);
  });

  it("'google' → GoogleWalletProvider", () => {
    expect(walletProviderFactory(makeConfig('google'), storage, integrations)).toBeInstanceOf(GoogleWalletProvider);
  });

  it("'apple' → AppleWalletProvider", () => {
    expect(walletProviderFactory(makeConfig('apple'), storage, integrations)).toBeInstanceOf(AppleWalletProvider);
  });

  it("'auto' → AutoWalletProvider", () => {
    expect(walletProviderFactory(makeConfig('auto'), storage, integrations)).toBeInstanceOf(AutoWalletProvider);
  });

  it('sin config (undefined) → StubWalletProvider (default)', () => {
    expect(walletProviderFactory(makeConfig(undefined), storage, integrations)).toBeInstanceOf(StubWalletProvider);
  });

  it('valor desconocido → StubWalletProvider (default seguro)', () => {
    expect(walletProviderFactory(makeConfig('marte'), storage, integrations)).toBeInstanceOf(StubWalletProvider);
  });
});
