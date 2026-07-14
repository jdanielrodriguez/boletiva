import { ServiceUnavailableException } from '@nestjs/common';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { AppleWalletProvider } from './apple-wallet.provider';
import { WalletPassInput } from './wallet-provider';

const INPUT: WalletPassInput = {
  ticketId: 'tk_123',
  serial: 'PE1-ABC',
  eventName: 'Concierto de Prueba',
  seatLabel: 'A-12',
  qrPayload: 'PE1.PE1-ABC.482913',
};

function makeIntegrations(available: { google: boolean; apple: boolean }): IntegrationsService {
  return {
    available: (service: string) =>
      service === 'googleWallet' ? available.google : service === 'appleWallet' ? available.apple : false,
    assertAvailable: (service: string) => {
      const ok = service === 'googleWallet' ? available.google : available.apple;
      if (!ok) throw new ServiceUnavailableException(`Servicio no disponible: ${service}`);
    },
  } as unknown as IntegrationsService;
}

describe('AppleWalletProvider', () => {
  it('sin certificados de Apple → 503 al pedir el .pkpass', async () => {
    const provider = new AppleWalletProvider(makeIntegrations({ google: false, apple: false }));
    await expect(provider.createPass('apple', INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('con certificados presentes pero armado pendiente → 503 (nunca .pkpass a medias)', async () => {
    const provider = new AppleWalletProvider(makeIntegrations({ google: false, apple: true }));
    await expect(provider.createPass('apple', INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('platform google en el proveedor Apple → 503 (usa google/auto)', async () => {
    const provider = new AppleWalletProvider(makeIntegrations({ google: false, apple: true }));
    await expect(provider.createPass('google', INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
