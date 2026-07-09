import { Injectable } from '@angular/core';

/** Marcas de tarjeta reconocidas (coincide con el enum del backend). */
export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'other';

/** Resultado de tokenizar una tarjeta en el cliente (datos NO sensibles). */
export interface CardToken {
  /** Nonce de un solo uso para el backend (simula el token del SDK de la pasarela). */
  nonce: string;
  /** Marca detectada (para mostrar). */
  brand: CardBrand;
  /** Últimos 4 dígitos (para mostrar). */
  last4: string;
}

/** Entrada de tarjeta capturada por el formulario (permanece en el navegador). */
export interface CardInput {
  number: string;
  expMonth: string;
  expYear: string;
  cvc: string;
}

/**
 * Tokenizador de tarjetas del lado del cliente (STUB sandbox). Simula el SDK JS de
 * la pasarela (Recurrente/Pagalo): el PAN se procesa aquí y NUNCA se envía al
 * backend — solo sale un `nonce` opaco + marca + últimos 4. El proveedor real se
 * enchufa detrás de esta misma interfaz cuando lleguen las credenciales.
 */
@Injectable({ providedIn: 'root' })
export class CardTokenizerStub {
  /** Marca a partir del primer dígito (BIN simplificado, solo para mostrar). */
  private brandFromNumber(digits: string): CardBrand {
    if (digits.startsWith('4')) return 'visa';
    if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard';
    if (/^3[47]/.test(digits)) return 'amex';
    if (digits.startsWith('6')) return 'discover';
    return 'other';
  }

  /**
   * "Tokeniza" la tarjeta: valida mínimamente, deriva marca + últimos 4 y genera un
   * nonce aleatorio. Lanza si el número no es válido. El PAN no sale de esta función.
   */
  tokenize(card: CardInput): CardToken {
    const digits = (card.number ?? '').replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) {
      throw new Error('Número de tarjeta inválido.');
    }
    if (!/^\d{3,4}$/.test(card.cvc ?? '')) {
      throw new Error('CVC inválido.');
    }
    const nonce = `nonce_${this.randomHex(24)}`;
    return { nonce, brand: this.brandFromNumber(digits), last4: digits.slice(-4) };
  }

  private randomHex(len: number): string {
    const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (cryptoObj?.getRandomValues) {
      const bytes = new Uint8Array(len / 2);
      cryptoObj.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback SSR/entornos sin WebCrypto (no crítico: es un stub sandbox).
    let out = '';
    for (let i = 0; i < len; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
}
