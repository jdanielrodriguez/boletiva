import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'crypto';

/**
 * Firma Ed25519 de la identidad inmutable de un boleto (anti-falsificación). El
 * par de llaves se deriva de forma determinista de un seed de 32 bytes (config
 * `tickets.signingSeed`); el mismo seed reconstruye la llave tras reiniciar, y en
 * prod vive en Secret Manager (rotable vía `signingKeyId`).
 *
 * La firma cubre SOLO la identidad estática del boleto; la frescura (anti-
 * screenshot) la aporta el TOTP rotativo del QR. Un validador offline con la llave
 * pública verifica la firma sin red (protocolo completo + manifiesto en la Ola 5).
 */
@Injectable()
export class TicketSigningService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly keyId: string;

  constructor(config: ConfigService) {
    const seedHex = config.getOrThrow<string>('tickets.signingSeed');
    this.keyId = config.getOrThrow<string>('tickets.signingKeyId');
    const seed = Buffer.from(seedHex, 'hex');
    // Envoltura PKCS8 DER de una llave privada Ed25519: prefijo ASN.1 fijo +
    // OCTET STRING(0x04 0x20) con el seed de 32 bytes.
    const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    this.privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    this.publicKey = createPublicKey(this.privateKey);
  }

  /** Firma un mensaje canónico. Devuelve la firma en base64. */
  sign(message: string): string {
    return sign(null, Buffer.from(message, 'utf8'), this.privateKey).toString('base64');
  }

  /** Verifica una firma base64 sobre un mensaje canónico. */
  verify(message: string, signatureB64: string): boolean {
    try {
      return verify(null, Buffer.from(message, 'utf8'), this.publicKey, Buffer.from(signatureB64, 'base64'));
    } catch {
      return false;
    }
  }

  /** Llave pública en PEM (SPKI) para empaquetar en el bundle de validadores offline. */
  publicKeyPem(): string {
    return this.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }
}
