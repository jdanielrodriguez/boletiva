import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { randomToken } from '../../common/utils/crypto';

/**
 * Identidad ESTABLE del dispositivo en una cookie httpOnly.
 *
 * El reconocimiento de "dispositivo confiable" (para no repetir 2FA en el mismo
 * navegador) necesita una huella que NO cambie entre inicios de sesión. Antes se
 * derivaba de `userAgent|ip`, pero la IP es volátil (proxies, Cloud Run, redes
 * móviles) → el mismo navegador se veía como uno nuevo y el 2FA se pedía SIEMPRE.
 *
 * Esta cookie guarda un id opaco por navegador: `HttpOnly` (inaccesible a JS),
 * `Secure` en producción y `SameSite=Lax`. Como el frontend ya hace todas las
 * peticiones con `withCredentials`, el navegador la reenvía en los siguientes
 * logins y la huella se mantiene estable, independiente de la IP. Un cliente que
 * gestione su propia identidad puede seguir mandando el header `X-Device-Id`
 * (tiene prioridad sobre la cookie).
 */
export const DEVICE_COOKIE_NAME = 'device_id';

/** Vida larga (400 días = tope que respetan los navegadores para cookies). */
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

function deviceCookieOptions(config: ConfigService): CookieOptions {
  const isProd = config.get<boolean>('isProd') === true;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  };
}

/** Lee el id de dispositivo de la cookie entrante (parseo manual, sin cookie-parser). */
export function readDeviceCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === DEVICE_COOKIE_NAME) {
      const value = decodeURIComponent(part.slice(idx + 1).trim());
      return value || undefined;
    }
  }
  return undefined;
}

/** Set-ea (o refresca el TTL de) la cookie estable de dispositivo. */
export function setDeviceCookie(res: Response, config: ConfigService, id: string): void {
  res.cookie(DEVICE_COOKIE_NAME, id, deviceCookieOptions(config));
}

/** Genera un id de dispositivo opaco de alta entropía. */
export function newDeviceId(): string {
  return randomToken(24);
}
