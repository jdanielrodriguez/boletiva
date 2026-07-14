// Valida en vivo las credenciales de Google configuradas por env, sin depender de
// un navegador. Ejercita el MISMO camino que usa el backend:
//  - Google Wallet: decodifica el service account (crudo o base64), firma un JWT
//    RS256 con la private key y arma la save URL → prueba que las llaves sirven.
//  - reCAPTCHA: llama a siteverify con un token dummy; si el error es
//    'invalid-input-secret' la secret es INVÁLIDA; cualquier otro error de token
//    (invalid-input-response) confirma que la secret es VÁLIDA.
//  - OAuth: valida formato de clientId + presencia de clientSecret.
// Uso: docker exec pasaeventos_api node /app/tools/qa/validate-google.mjs
import { createPrivateKey, sign } from 'crypto';

const b64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function parseServiceAccount(raw) {
  const attempt = (text) => {
    try {
      const p = JSON.parse(text);
      if (p.client_email && p.private_key) return p;
    } catch {
      /* no era json */
    }
    return null;
  };
  return attempt(raw) ?? attempt(Buffer.from(raw, 'base64').toString('utf8'));
}

function validateGoogleWallet() {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID ?? '';
  const rawSa = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON ?? '';
  if (!issuerId || !rawSa) return { ok: false, skip: true, detail: 'sin GOOGLE_WALLET_* (se ignora)' };

  const sa = parseServiceAccount(rawSa);
  if (!sa) return { ok: false, detail: 'service account inválido (ni JSON ni base64 con client_email/private_key)' };

  let key;
  try {
    key = createPrivateKey(sa.private_key);
  } catch {
    return { ok: false, detail: 'private_key no es una llave PEM válida' };
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: now,
    origins: [],
    payload: {
      eventTicketObjects: [
        { id: `${issuerId}.validacion_test`, classId: `${issuerId}.pasaeventos_event`, state: 'ACTIVE' },
      ],
    },
  };
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), key);
  const jwt = `${signingInput}.${b64url(signature)}`;
  const url = `https://pay.google.com/gp/v/save/${jwt}`;

  return {
    ok: true,
    detail: `firma RS256 OK · issuer=${issuerId} · SA=${sa.client_email} · project=${sa.project_id ?? '?'}`,
    saveUrlPreview: `${url.slice(0, 72)}…(${url.length} chars)`,
  };
}

async function validateRecaptcha() {
  const secret = process.env.RECAPTCHA_SECRET_KEY ?? '';
  const site = process.env.RECAPTCHA_SITE_KEY ?? '';
  if (!secret) return { ok: false, skip: true, detail: 'sin RECAPTCHA_SECRET_KEY (se ignora)' };

  const body = new URLSearchParams({ secret, response: 'dummy-token-de-validacion' });
  let data;
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    data = await res.json();
  } catch (e) {
    return { ok: false, detail: `no se pudo llamar a siteverify: ${e.message}` };
  }
  const codes = data['error-codes'] ?? [];
  if (codes.includes('invalid-input-secret')) {
    return { ok: false, detail: `SECRET INVÁLIDA (Google: ${codes.join(', ')})` };
  }
  // success=false por el token dummy es lo esperado y CONFIRMA que la secret es válida.
  return {
    ok: true,
    detail: `secret VÁLIDA (Google aceptó la secret; rechazó el token dummy: ${codes.join(', ') || 'sin error'}) · siteKey=${site.slice(0, 12)}…`,
  };
}

function validateOAuth() {
  const id = process.env.GOOGLE_CLIENT_ID ?? '';
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  if (!id && !secret) return { ok: false, skip: true, detail: 'sin GOOGLE_CLIENT_* (se ignora)' };
  const idOk = /\.apps\.googleusercontent\.com$/.test(id);
  const secretOk = secret.startsWith('GOCSPX-');
  return {
    ok: idOk && secretOk,
    detail: `clientId ${idOk ? 'formato OK' : 'FORMATO RARO'} · clientSecret ${secretOk ? 'formato OK' : secret ? 'FORMATO RARO' : 'AUSENTE'}`,
  };
}

function line(name, r) {
  const icon = r.skip ? '⏭️ ' : r.ok ? '✅' : '❌';
  console.log(`${icon} ${name.padEnd(16)} ${r.detail}`);
  if (r.saveUrlPreview) console.log(`   ↳ ${r.saveUrlPreview}`);
}

const wallet = validateGoogleWallet();
const recaptcha = await validateRecaptcha();
const oauth = validateOAuth();

console.log('── Validación de credenciales Google ──');
line('Google Wallet', wallet);
line('reCAPTCHA', recaptcha);
line('Google OAuth', oauth);

const failed = [wallet, recaptcha, oauth].some((r) => !r.ok && !r.skip);
process.exit(failed ? 1 : 0);
