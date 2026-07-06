import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/** Hash SHA-256 en hex (para guardar tokens/códigos sin exponerlos). */
export const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** HMAC-SHA256 en hex (firma de webhooks). */
export const hmacSha256 = (secret: string, data: string): string =>
  createHmac('sha256', secret).update(data).digest('hex');

/** Comparación en tiempo constante (evita timing attacks al validar firmas). */
export const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/** Token opaco de alta entropía (para magic links). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

/** Código OTP de 6 dígitos (con ceros a la izquierda). */
export const randomOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
