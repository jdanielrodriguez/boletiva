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

/**
 * Verifica una firma de webhook estilo SVIX (Recurrente). El contenido firmado es
 * `${svixId}.${svixTimestamp}.${rawBody}`, la llave es la porción base64 del secreto
 * `whsec_...` decodificada a bytes, y la firma es HMAC-SHA256 en base64. El header
 * `svix-signature` trae una lista separada por espacios de `v1,<base64>`; basta que UNA
 * coincida (comparación en tiempo constante). Ver docs.recurrente.com / svix.com.
 */
export const verifySvixSignature = (
  secret: string,
  svixId: string,
  svixTimestamp: string,
  rawBody: string,
  signatureHeader: string,
): boolean => {
  if (!secret || !svixId || !svixTimestamp || !signatureHeader) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`)
    .digest('base64');
  const expBuf = Buffer.from(expected);
  // El header puede traer varias firmas (rotación de secreto): "v1,<b64> v1,<b64>".
  return signatureHeader.split(' ').some((part) => {
    const sig = part.startsWith('v1,') ? part.slice(3) : part;
    const sBuf = Buffer.from(sig);
    return sBuf.length === expBuf.length && timingSafeEqual(sBuf, expBuf);
  });
};

/** Token opaco de alta entropía (para magic links). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

/** Código OTP de 6 dígitos (con ceros a la izquierda). */
export const randomOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
