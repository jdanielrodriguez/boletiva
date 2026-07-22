import { createHmac } from 'crypto';
import { verifySvixSignature } from './crypto';

/** Verificación de firma estilo SVIX (webhook de Recurrente). */
describe('verifySvixSignature', () => {
  // Secreto whsec_ (la porción tras el prefijo es base64).
  const rawKey = Buffer.from('una-llave-de-webhook-secreta-123');
  const secret = `whsec_${rawKey.toString('base64')}`;
  const id = 'msg_2abc';
  const ts = '1700000000';
  const body = '{"event_type":"intent.succeeded","metadata":{"providerRef":"recurrente_x"}}';
  const sign = (key: Buffer, content: string) =>
    createHmac('sha256', key).update(content).digest('base64');

  it('acepta una firma válida (header v1,<b64>)', () => {
    const sig = 'v1,' + sign(rawKey, `${id}.${ts}.${body}`);
    expect(verifySvixSignature(secret, id, ts, body, sig)).toBe(true);
  });

  it('acepta si UNA de varias firmas (rotación) coincide', () => {
    const good = 'v1,' + sign(rawKey, `${id}.${ts}.${body}`);
    expect(verifySvixSignature(secret, id, ts, body, `v1,firmavieja ${good}`)).toBe(true);
  });

  it('rechaza cuerpo manipulado', () => {
    const sig = 'v1,' + sign(rawKey, `${id}.${ts}.${body}`);
    expect(verifySvixSignature(secret, id, ts, body + 'X', sig)).toBe(false);
  });

  it('rechaza con secreto equivocado', () => {
    const sig = 'v1,' + sign(Buffer.from('otra-llave'), `${id}.${ts}.${body}`);
    expect(verifySvixSignature(secret, id, ts, body, sig)).toBe(false);
  });

  it('rechaza si faltan headers o firma vacía', () => {
    expect(verifySvixSignature(secret, '', ts, body, 'v1,x')).toBe(false);
    expect(verifySvixSignature(secret, id, ts, body, '')).toBe(false);
    expect(verifySvixSignature('', id, ts, body, 'v1,x')).toBe(false);
  });
});
