import { Injectable } from '@nestjs/common';
import { StorageService } from '../../../infra/storage/storage.service';
import {
  WalletPassInput,
  WalletPassResult,
  WalletPlatform,
  WalletProvider,
} from './wallet-provider';

/**
 * Proveedor de wallet STUB (sandbox): emite pases sin certificados de terceros,
 * para que los E2E de la Ola 4 no dependan de Apple Developer ni de la aprobación
 * de la Google Wallet API (esos trámites corren en paralelo). Los proveedores
 * reales (Google `rotatingBarcode`, Apple `.pkpass` firmado + push) se conectan
 * detrás de este mismo puerto cuando estén las credenciales.
 */
@Injectable()
export class StubWalletProvider implements WalletProvider {
  readonly name = 'stub';

  constructor(private readonly storage: StorageService) {}

  async createPass(platform: WalletPlatform, input: WalletPassInput): Promise<WalletPassResult> {
    if (platform === 'google') {
      // Google entrega una URL "Save to Google Wallet"; el stub la simula.
      return {
        platform,
        provider: this.name,
        url: `https://pay.google.com/gp/v/save/STUB-${input.serial}`,
      };
    }
    // Apple entrega un archivo .pkpass; el stub sube un placeholder y firma la URL.
    const key = `tickets/wallet/${input.ticketId}/pass.pkpass`;
    const body = JSON.stringify({
      stub: true,
      serial: input.serial,
      eventName: input.eventName,
      seatLabel: input.seatLabel,
      note: 'Placeholder .pkpass (sandbox). Firma/cert reales en integración Apple.',
    });
    await this.storage.putObject(key, body, 'application/vnd.apple.pkpass');
    const url = await this.storage.signedGetUrl(key, 600);
    return { platform, provider: this.name, url };
  }
}
