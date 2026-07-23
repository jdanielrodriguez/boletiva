import type { GateManifest } from '../api/gate.api';
import { sha256Hex, verifyManifest } from './manifest-verify';

/**
 * Verificación offline del manifiesto SafeTix (QA Ola 4). Genera un par Ed25519 REAL con
 * WebCrypto (Chrome), firma el digest canónico como el backend y comprueba que:
 *  - un manifiesto íntegro → 'ok';
 *  - alterar un totpSecret (MITM) rompe el recomputo del digest → 'invalid';
 *  - una firma que no corresponde → 'invalid'.
 */
function bytesToB64(bytes: ArrayBuffer): string {
  let s = '';
  for (const byte of new Uint8Array(bytes)) s += String.fromCharCode(byte);
  return btoa(s);
}

function toPem(spki: ArrayBuffer): string {
  const b64 = bytesToB64(spki).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

/** Construye el canónico EXACTO del backend y devuelve {contentHash}. */
async function contentHashOf(m: GateManifest): Promise<string> {
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
  return sha256Hex(JSON.stringify({ eventId: m.eventId, maxSeq: m.maxSeq, expiresAt: m.expiresAt, tickets }));
}

describe('verifyManifest (SafeTix offline, Ed25519)', () => {
  let publicKeyPem: string;
  let privateKey: CryptoKey;

  const baseManifest = (): GateManifest => ({
    eventId: 'ev-1',
    maxSeq: 7,
    expiresAt: '2030-01-01T00:00:00.000Z',
    publicKeyPem: '',
    signature: '',
    contentHash: '',
    tickets: [
      { ticketId: 'b', ownerId: 'o2', serial: 'PE1.s2', status: 'valid', totpSecret: 'SECRET2' },
      { ticketId: 'a', ownerId: 'o1', serial: 'PE1.s1', status: 'valid', totpSecret: 'SECRET1' },
    ],
  });

  async function signInto(m: GateManifest): Promise<GateManifest> {
    m.publicKeyPem = publicKeyPem;
    m.contentHash = await contentHashOf(m);
    const sig = await crypto.subtle.sign(
      { name: 'Ed25519' },
      privateKey,
      new TextEncoder().encode(m.contentHash).buffer as ArrayBuffer,
    );
    m.signature = bytesToB64(sig);
    return m;
  }

  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    privateKey = pair.privateKey;
    publicKeyPem = toPem(await crypto.subtle.exportKey('spki', pair.publicKey));
  });

  it('manifiesto íntegro y bien firmado → ok', async () => {
    const m = await signInto(baseManifest());
    expect(await verifyManifest(m)).toBe('ok');
  });

  it('MITM: sustituir un totpSecret tras firmar → invalid (el digest no cuadra)', async () => {
    const m = await signInto(baseManifest());
    m.tickets[0].totpSecret = 'SECRET-HACKED'; // cambia el secreto en claro dejando firma intacta
    expect(await verifyManifest(m)).toBe('invalid');
  });

  it('firma que no corresponde al contenido → invalid', async () => {
    const m = await signInto(baseManifest());
    const other = await signInto({ ...baseManifest(), eventId: 'ev-OTRO' });
    m.signature = other.signature; // firma de otro contenido
    expect(await verifyManifest(m)).toBe('invalid');
  });

  it('faltan campos firmados (respuesta incompleta) → invalid', async () => {
    const m = baseManifest();
    m.publicKeyPem = '';
    expect(await verifyManifest(m)).toBe('invalid');
  });
});
