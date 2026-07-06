import { createHash, randomBytes, randomInt } from 'crypto';

/** Hash SHA-256 en hex (para guardar tokens/códigos sin exponerlos). */
export const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** Token opaco de alta entropía (para magic links). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

/** Código OTP de 6 dígitos (con ceros a la izquierda). */
export const randomOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
