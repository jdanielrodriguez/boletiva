import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { AppleWalletProvider } from './apple-wallet.provider';
import { AutoWalletProvider } from './auto-wallet.provider';
import { GoogleWalletProvider } from './google-wallet.provider';
import { StubWalletProvider } from './stub-wallet.provider';
import { WalletPassInput, WalletPassResult, WalletPlatform } from './wallet-provider';

const INPUT: WalletPassInput = {
  ticketId: 'tk_123',
  serial: 'PE1-ABC',
  eventName: 'Concierto',
  seatLabel: null,
  qrPayload: 'PE1.PE1-ABC.1',
};

function fakeProvider(name: string): { createPass: jest.Mock } {
  return {
    createPass: jest.fn(
      async (platform: WalletPlatform): Promise<WalletPassResult> => ({ platform, provider: name, url: `${name}-url` }),
    ),
  };
}

function makeIntegrations(available: { google: boolean; apple: boolean }): IntegrationsService {
  return {
    available: (service: string) =>
      service === 'googleWallet' ? available.google : service === 'appleWallet' ? available.apple : false,
  } as unknown as IntegrationsService;
}

describe('AutoWalletProvider (enrutamiento por plataforma)', () => {
  it('google disponible → usa el proveedor Google', async () => {
    const google = fakeProvider('google');
    const stub = fakeProvider('stub');
    const auto = new AutoWalletProvider(
      makeIntegrations({ google: true, apple: false }),
      google as unknown as GoogleWalletProvider,
      fakeProvider('apple') as unknown as AppleWalletProvider,
      stub as unknown as StubWalletProvider,
    );
    const res = await auto.createPass('google', INPUT);
    expect(res.provider).toBe('google');
    expect(google.createPass).toHaveBeenCalled();
    expect(stub.createPass).not.toHaveBeenCalled();
  });

  it('google NO disponible → cae al stub', async () => {
    const google = fakeProvider('google');
    const stub = fakeProvider('stub');
    const auto = new AutoWalletProvider(
      makeIntegrations({ google: false, apple: false }),
      google as unknown as GoogleWalletProvider,
      fakeProvider('apple') as unknown as AppleWalletProvider,
      stub as unknown as StubWalletProvider,
    );
    const res = await auto.createPass('google', INPUT);
    expect(res.provider).toBe('stub');
    expect(google.createPass).not.toHaveBeenCalled();
    expect(stub.createPass).toHaveBeenCalled();
  });

  it('apple disponible → usa el proveedor Apple', async () => {
    const apple = fakeProvider('apple');
    const stub = fakeProvider('stub');
    const auto = new AutoWalletProvider(
      makeIntegrations({ google: false, apple: true }),
      fakeProvider('google') as unknown as GoogleWalletProvider,
      apple as unknown as AppleWalletProvider,
      stub as unknown as StubWalletProvider,
    );
    const res = await auto.createPass('apple', INPUT);
    expect(res.provider).toBe('apple');
    expect(apple.createPass).toHaveBeenCalled();
    expect(stub.createPass).not.toHaveBeenCalled();
  });

  it('apple NO disponible → cae al stub', async () => {
    const stub = fakeProvider('stub');
    const auto = new AutoWalletProvider(
      makeIntegrations({ google: false, apple: false }),
      fakeProvider('google') as unknown as GoogleWalletProvider,
      fakeProvider('apple') as unknown as AppleWalletProvider,
      stub as unknown as StubWalletProvider,
    );
    const res = await auto.createPass('apple', INPUT);
    expect(res.provider).toBe('stub');
    expect(stub.createPass).toHaveBeenCalled();
  });
});
