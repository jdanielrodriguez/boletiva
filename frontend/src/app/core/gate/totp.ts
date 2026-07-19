/**
 * Verificación TOTP OFFLINE en el navegador (modelo SafeTix): recomputa el código
 * rotativo del boleto a partir del secreto base32 del manifiesto y lo compara con el
 * que trae el QR — SIN red. Debe casar EXACTO con el backend (otplib authenticator:
 * HMAC-SHA1, paso 30 s, 6 dígitos, ventana ±1). Usa Web Crypto (crypto.subtle), así
 * que es asíncrono y no requiere ninguna dependencia.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // acepta el código del paso actual y ±1 (tolerancia de reloj)

/** Decodifica base32 (RFC 4648, alfabeto A-Z2-7, sin padding) a bytes. */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue; // ignora caracteres fuera del alfabeto
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Contador TOTP (big-endian de 8 bytes) para un instante dado. */
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // JS bitwise es de 32 bits; partimos el contador en alto/bajo.
  let hi = Math.floor(counter / 0x100000000);
  let lo = counter >>> 0;
  for (let i = 7; i >= 0; i--) {
    buf[i] = (i >= 4 ? lo : hi) & 0xff;
    if (i >= 4) lo = Math.floor(lo / 256);
    else hi = Math.floor(hi / 256);
  }
  return buf;
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter).buffer as ArrayBuffer));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/**
 * Verifica un código TOTP contra el secreto base32, con ventana ±1 (misma que el
 * backend). `nowMs` inyectable para tests. Devuelve true si casa en algún paso.
 */
export async function verifyTotp(secretBase32: string, code: string, nowMs: number = Date.now()): Promise<boolean> {
  const clean = (code ?? '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const base = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (let w = -WINDOW; w <= WINDOW; w++) {
    if ((await hotp(secret, base + w)) === clean) return true;
  }
  return false;
}

/** Parsea el payload del QR `PE1.<serial>.<6 dígitos>`. Null si no está bien formado. */
export function parseQr(payload: string): { serial: string; code: string } | null {
  const parts = (payload ?? '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'PE1') return null;
  const [, serial, code] = parts;
  if (!serial || !/^\d{6}$/.test(code)) return null;
  return { serial, code };
}
