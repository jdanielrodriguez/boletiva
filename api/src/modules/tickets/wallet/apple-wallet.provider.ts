import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import {
  WalletPassInput,
  WalletPassResult,
  WalletPlatform,
  WalletProvider,
} from './wallet-provider';

/**
 * Proveedor de Apple Wallet (env-only: NO disponible sin certificados de Apple
 * Developer). Estructura lista detrás del mismo puerto `WalletProvider`; el armado
 * y la firma reales del `.pkpass` quedan como TODO hasta tener el certificado
 * Pass Type ID (.p12) + el certificado WWDR de Apple.
 *
 * `applePkpass` (vía createPass('apple', …)) exige `appleWallet` disponible; sin
 * certificados devuelve 503 al pedir el pase (no al arrancar la app).
 */
@Injectable()
export class AppleWalletProvider implements WalletProvider {
  readonly name = 'apple';

  constructor(private readonly integrations: IntegrationsService) {}

  async createPass(platform: WalletPlatform, input: WalletPassInput): Promise<WalletPassResult> {
    if (platform !== 'apple') {
      this.integrations.assertAvailable('googleWallet');
      throw new ServiceUnavailableException(
        'El proveedor Apple Wallet no genera pases de Google; usa WALLET_PROVIDER=google o auto.',
      );
    }
    // `input` (serial/evento/asiento/QR) alimentará el pass.json cuando se
    // implemente el armado real del .pkpass (ver applePkpass).
    void input;
    return this.applePkpass();
  }

  /**
   * Emite el `.pkpass` firmado para Apple Wallet.
   *
   * 503 mientras no haya certificados (Apple Developer). El armado real, cuando
   * lleguen las credenciales (`wallet.apple`: passTypeId, teamId, certP12Base64,
   * certPassword, wwdrBase64), es:
   *   1. Construir `pass.json` (eventTicket) con serial, evento, asiento y el
   *      `barcode` (QR = input.qrPayload).
   *   2. Calcular `manifest.json` (SHA-1 de cada archivo del bundle).
   *   3. Firmar el manifest con el certificado Pass Type ID (.p12) + la cadena
   *      WWDR de Apple (PKCS#7 detached) → `signature`.
   *   4. Empaquetar todo en un ZIP `.pkpass`, subirlo al storage y firmar la URL.
   *   5. (Premium) push updates vía APNs para el `rotatingBarcode`.
   * TODO(integración Apple): implementar 1–5; requiere Apple Developer + WWDR.
   */
  private async applePkpass(): Promise<WalletPassResult> {
    // 503 si falta cualquier certificado de Apple.
    this.integrations.assertAvailable('appleWallet');
    // Con certificados presentes pero armado aún no implementado, seguimos 503
    // (nunca entregamos un .pkpass a medio firmar).
    throw new ServiceUnavailableException(
      'Apple Wallet aún no está habilitado: la generación del .pkpass está pendiente de la integración con Apple Developer.',
    );
  }
}
