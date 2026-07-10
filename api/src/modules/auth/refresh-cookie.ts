import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';

/**
 * Custodia del refresh token en una cookie httpOnly.
 *
 * El refresh token vive en una cookie `HttpOnly` (inaccesible a JS → mitiga XSS),
 * `Secure` en producción y `SameSite=Lax`. El frontend web ya no lo guarda en
 * localStorage: en carga fría el navegador reenvía la cookie a `/auth/refresh` y
 * la sesión se rehidrata sin exponer el token. El body sigue devolviendo el
 * refresh como fallback para clientes no-web (móvil/CLI) y compatibilidad.
 */
export const REFRESH_COOKIE_NAME = 'refresh_token';

/** Opciones de la cookie de refresh derivadas del entorno (TTL = refresh TTL). */
export function refreshCookieOptions(config: ConfigService): CookieOptions {
  const isProd = config.get<boolean>('isProd') === true;
  const ttlSeconds = config.getOrThrow<number>('jwt.refreshTtl');
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds * 1000,
  };
}

/** Set-ea (o re-set-ea tras rotar) la cookie de refresh si hay token. */
export function setRefreshCookie(
  res: Response,
  config: ConfigService,
  refreshToken: string | undefined,
): void {
  if (!refreshToken) return;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions(config));
}

/** Borra la cookie de refresh (logout). Debe usar los mismos path/flags al limpiar. */
export function clearRefreshCookie(res: Response, config: ConfigService): void {
  const opts = refreshCookieOptions(config);
  delete opts.maxAge; // clearCookie fija su propia expiración en el pasado
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
}

/**
 * Lee el refresh token de la cookie entrante (parseo manual del header, sin
 * depender de cookie-parser). Devuelve undefined si no está presente.
 */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === REFRESH_COOKIE_NAME) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}
