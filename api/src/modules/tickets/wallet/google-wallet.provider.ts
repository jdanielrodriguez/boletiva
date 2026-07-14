import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, KeyObject, sign } from 'crypto';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import type { AppConfig } from '../../../config/configuration';
import {
  WalletPassInput,
  WalletPassResult,
  WalletPlatform,
  WalletProvider,
} from './wallet-provider';

/** Cuenta de servicio de Google (subset usado para firmar el JWT del pase). */
interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
}

/**
 * Proveedor REAL de Google Wallet (value-ready: solo requiere `issuerId` +
 * `serviceAccountJson` por env). Con la cuenta de servicio firma el JWT de
 * "Guardar en Google Wallet" (RS256 con la private key del JSON) y arma la URL
 * `https://pay.google.com/gp/v/save/<jwt>` con un EventTicketObject que lleva el
 * código (QR) del boleto.
 *
 * Firmamos con el `crypto` de Node (sin dependencia extra de `jsonwebtoken`, que
 * solo está como transitiva de `@nestjs/jwt` y sin tipos). NUNCA se registran la
 * private key ni el JWT firmado.
 */
@Injectable()
export class GoogleWalletProvider implements WalletProvider {
  readonly name = 'google';
  private readonly logger = new Logger(GoogleWalletProvider.name);

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly config: ConfigService,
  ) {}

  async createPass(platform: WalletPlatform, input: WalletPassInput): Promise<WalletPassResult> {
    if (platform !== 'google') {
      // Este proveedor solo emite pases de Google. Si el despliegue tampoco tiene
      // Apple configurado, assertAvailable ya devuelve un 503 claro.
      this.integrations.assertAvailable('appleWallet');
      throw new ServiceUnavailableException(
        'El proveedor Google Wallet no genera pases de Apple; usa WALLET_PROVIDER=apple o auto.',
      );
    }
    // 503 si falta issuerId o la cuenta de servicio.
    this.integrations.assertAvailable('googleWallet');

    const wallet = this.config.getOrThrow<AppConfig['wallet']>('wallet');
    const { issuerId, serviceAccountJson } = wallet.google;
    const account = this.parseServiceAccount(serviceAccountJson);

    const classId = `${issuerId}.pasaeventos_event`;
    const objectId = `${issuerId}.${this.sanitizeId(input.ticketId)}`;
    const eventTicketObject = {
      id: objectId,
      classId,
      state: 'ACTIVE',
      barcode: {
        type: 'QR_CODE',
        value: input.qrPayload,
        alternateText: input.serial,
      },
      ticketHolderName: null,
      seatInfo: input.seatLabel ? { seat: { defaultValue: { language: 'es', value: input.seatLabel } } } : undefined,
      textModulesData: [{ header: 'Evento', body: input.eventName }],
    };

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iss: account.client_email,
      aud: 'google',
      typ: 'savetowallet',
      iat: now,
      origins: [] as string[],
      payload: { eventTicketObjects: [eventTicketObject] },
    };

    const jwt = this.signJwt(jwtPayload, account.private_key);
    return {
      platform,
      provider: this.name,
      url: `https://pay.google.com/gp/v/save/${jwt}`,
    };
  }

  /** Acepta el JSON crudo o base64 (como suele venir de Secret Manager). */
  private parseServiceAccount(raw: string): GoogleServiceAccount {
    const attempt = (text: string): GoogleServiceAccount | null => {
      try {
        const parsed = JSON.parse(text) as Partial<GoogleServiceAccount>;
        if (parsed.client_email && parsed.private_key) {
          return { client_email: parsed.client_email, private_key: parsed.private_key };
        }
      } catch {
        // no era JSON directo
      }
      return null;
    };
    const direct = attempt(raw);
    if (direct) return direct;
    const decoded = attempt(Buffer.from(raw, 'base64').toString('utf8'));
    if (decoded) return decoded;
    // No exponemos el contenido de la cuenta de servicio en el error/log.
    this.logger.error('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON inválido (no es JSON ni base64 con client_email/private_key)');
    throw new ServiceUnavailableException('Google Wallet mal configurado: cuenta de servicio inválida.');
  }

  /** Firma un JWT compacto RS256 (header.payload.signature en base64url). */
  private signJwt(payload: Record<string, unknown>, privateKeyPem: string): string {
    const header = { alg: 'RS256', typ: 'JWT' };
    const signingInput = `${this.b64url(JSON.stringify(header))}.${this.b64url(JSON.stringify(payload))}`;
    let key: KeyObject;
    try {
      key = createPrivateKey(privateKeyPem);
    } catch {
      this.logger.error('La private_key de la cuenta de servicio de Google no es una llave PEM válida');
      throw new ServiceUnavailableException('Google Wallet mal configurado: llave privada inválida.');
    }
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), key);
    return `${signingInput}.${this.b64urlBuffer(signature)}`;
  }

  private b64url(text: string): string {
    return this.b64urlBuffer(Buffer.from(text, 'utf8'));
  }

  private b64urlBuffer(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** IDs de objeto Google Wallet: solo alfanuméricos, '.', '_', '-'. */
  private sanitizeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
