import type { Request } from 'express';

/**
 * IP REAL del cliente para anti-abuso/rate-limit. Usa `req.ip`, que Express resuelve
 * según la config `trust proxy` (ver `main.ts`): bien configurado detrás de GCP
 * (Cloud Run/LB) devuelve la IP del cliente y NO es spoofeable metiendo entradas en
 * X-Forwarded-For. NUNCA parseamos XFF a mano (el primer token es controlado por el
 * cliente). Fallback al socket si no hay `req.ip`. Normaliza el prefijo IPv4-mapped.
 */
export function clientIp(req: Request): string | null {
  const raw = req.ip || req.socket?.remoteAddress || null;
  return raw ? raw.replace(/^::ffff:/, '') : null;
}
