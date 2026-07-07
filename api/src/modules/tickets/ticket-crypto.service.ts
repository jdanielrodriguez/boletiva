import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

/** Identidad inmutable de un boleto (lo que se firma con Ed25519). */
export interface TicketIdentity {
  id: string;
  serial: string;
  eventId: string;
  localityId: string;
  seatId: string | null;
  ownerId: string;
}

const QR_PREFIX = 'PE1';

/**
 * Criptografía del QR rotativo: un secreto TOTP por boleto genera un código que
 * cambia cada 30s → un screenshot caduca. El valor del QR es `PE1.<serial>.<code>`.
 * El validador (en línea o, en la Ola 5, offline con manifiesto) recomputa el
 * código para la ventana actual y comprueba estado + firma Ed25519 de la identidad.
 */
@Injectable()
export class TicketCryptoService {
  // Instancia propia (no muta las opciones globales que usa el 2FA de auth).
  private readonly totp = authenticator.clone({ step: 30, digits: 6, window: 1 });

  /** Nuevo secreto TOTP (base32) para un boleto. */
  newTotpSecret(): string {
    return this.totp.generateSecret();
  }

  /** Código rotativo actual para un secreto. */
  rotatingCode(secretBase32: string): string {
    return this.totp.generate(secretBase32);
  }

  /** Verifica un código contra el secreto (tolerancia de ±1 ventana). */
  verifyRotatingCode(code: string, secretBase32: string): boolean {
    try {
      return this.totp.check(code, secretBase32);
    } catch {
      return false;
    }
  }

  /** Mensaje canónico de la identidad que se firma (orden y separadores fijos). */
  identityMessage(id: TicketIdentity): string {
    return [
      'PE-TKT-v1',
      id.id,
      id.serial,
      id.eventId,
      id.localityId,
      id.seatId ?? 'GA',
      id.ownerId,
    ].join('|');
  }

  /** Valor codificado en el QR (rotativo). */
  qrPayload(serial: string, code: string): string {
    return `${QR_PREFIX}.${serial}.${code}`;
  }

  /** Parsea un valor de QR. null si el formato no es válido. */
  parseQr(payload: string): { serial: string; code: string } | null {
    const parts = (payload ?? '').split('.');
    if (parts.length !== 3 || parts[0] !== QR_PREFIX) return null;
    if (!parts[1] || !/^\d{6}$/.test(parts[2])) return null;
    return { serial: parts[1], code: parts[2] };
  }
}
