import type { GateManifest } from '../api/gate.api';

/**
 * Verificación OFFLINE del manifiesto SafeTix en el dispositivo de puerta (QA Ola 4).
 * Antes la PWA confiaba a ciegas en el manifiesto → un manifiesto MANIPULADO (MITM que
 * sustituye un `totpSecret` en claro) o uno ROBADO se aceptaba. Aquí:
 *  1) recomputamos el digest canónico EXACTO que firmó el backend (mismo orden de claves
 *     y `sec = sha256(totpSecret)`) y lo comparamos con `contentHash`;
 *  2) verificamos la firma Ed25519 de `contentHash` con la llave pública (WebCrypto).
 * Cualquier alteración de boletos/secretos rompe (1); cualquier firma falsa rompe (2).
 * La expiración (`expiresAt`) se hace cumplir aparte, en el momento de validar (offline).
 */
export type ManifestVerdict = 'ok' | 'invalid' | 'unsupported';

/** sha256 en HEX (igual que el `sha256` del backend) vía WebCrypto. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input).buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decodifica base64 (PEM/firma) a bytes. */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PEM SPKI → DER (bytes) quitando cabeceras y espacios. */
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
  return b64ToBytes(b64);
}

/**
 * Reconstruye el `contentHash` a partir del contenido del manifiesto, replicando BIT A BIT
 * el `JSON.stringify` del backend (orden de claves: eventId, maxSeq, expiresAt, tickets[
 * {id, st, s, o, sec}] ordenados por ticketId con localeCompare; `sec = sha256(totpSecret)`).
 */
async function recomputeContentHash(m: GateManifest): Promise<string> {
  const sorted = [...m.tickets].sort((a, b) => (a.ticketId ?? '').localeCompare(b.ticketId ?? ''));
  const tickets = await Promise.all(
    sorted.map(async (t) => ({
      id: t.ticketId,
      st: t.status,
      s: t.serial,
      o: t.ownerId,
      sec: await sha256Hex(t.totpSecret),
    })),
  );
  const canonical = JSON.stringify({
    eventId: m.eventId,
    maxSeq: m.maxSeq,
    expiresAt: m.expiresAt,
    tickets,
  });
  return sha256Hex(canonical);
}

/**
 * Verifica autenticidad + integridad del manifiesto. Devuelve:
 *  - `ok`: firma válida y el contenido coincide con lo firmado → confiable.
 *  - `invalid`: contenido alterado o firma inválida → NO debe guardarse/usarse.
 *  - `unsupported`: el navegador no soporta Ed25519 en WebCrypto → no se pudo verificar
 *    (degradación: el llamador decide; la expiración sigue protegiendo).
 */
export async function verifyManifest(m: GateManifest): Promise<ManifestVerdict> {
  // Sin los campos firmados no se puede verificar (respuesta antigua/incompleta).
  if (!m.publicKeyPem || !m.signature || !m.contentHash) return 'invalid';
  // (1) el contenido servido debe hashear EXACTAMENTE al contentHash firmado.
  let recomputed: string;
  try {
    recomputed = await recomputeContentHash(m);
  } catch {
    return 'invalid';
  }
  if (recomputed !== m.contentHash) return 'invalid';
  // (2) firma Ed25519 de contentHash (el backend firma la CADENA hex de contentHash).
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'spki',
      pemToDer(m.publicKeyPem).buffer as ArrayBuffer,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
  } catch {
    return 'unsupported'; // navegador sin Ed25519 en WebCrypto (Chrome <137, etc.)
  }
  try {
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      b64ToBytes(m.signature).buffer as ArrayBuffer,
      new TextEncoder().encode(m.contentHash).buffer as ArrayBuffer,
    );
    return ok ? 'ok' : 'invalid';
  } catch {
    return 'invalid';
  }
}
