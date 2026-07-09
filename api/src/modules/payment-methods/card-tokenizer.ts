import { randomBytes } from 'node:crypto';

/**
 * Puerto de tokenización de tarjetas (PCI-DSS). El PAN de la tarjeta NUNCA llega a
 * NestJS ni a Angular: el SDK de la pasarela (Recurrente/Pagalo) tokeniza en SUS
 * servidores y nos entrega un `nonce` de un solo uso; este puerto lo intercambia
 * por un TOKEN opaco reutilizable, que es lo único que persistimos.
 *
 * El proveedor real se enchufa detrás de este mismo puerto (token DI
 * `CARD_TOKENIZER`) cuando lleguen las credenciales; hoy corre el stub sandbox.
 */
export interface CardTokenizer {
  /**
   * Intercambia el nonce de un solo uso (del SDK de la pasarela) por un token
   * opaco reutilizable. Nunca recibe ni maneja el PAN.
   */
  tokenize(nonce: string): Promise<{ token: string }>;
}

/** Token de inyección del puerto CardTokenizer. */
export const CARD_TOKENIZER = Symbol('CARD_TOKENIZER');

/**
 * Tokenizador stub (sandbox): simula el intercambio nonce→token del SDK de la
 * pasarela devolviendo un token opaco aleatorio. No deriva nada del PAN (que jamás
 * ve). Sustituible por el proveedor real detrás del mismo puerto.
 */
export class StubCardTokenizer implements CardTokenizer {
  tokenize(nonce: string): Promise<{ token: string }> {
    if (!nonce || !nonce.trim()) {
      return Promise.reject(new Error('nonce requerido para tokenizar'));
    }
    // Token opaco: prefijo + aleatorio. No reversible al PAN (que no conocemos).
    const token = `tok_${randomBytes(18).toString('hex')}`;
    return Promise.resolve({ token });
  }
}
