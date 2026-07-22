import { JwtService } from '@nestjs/jwt';
import { verifyAccessToken } from './access-token';

/**
 * Verificación ÚNICA de access token para canales socket/SSE (QA T5-H1): acepta un
 * access token normal y RECHAZA cualquier token con `typ` (p.ej. el preauth `typ:'2fa'`)
 * aunque comparta el secreto, además de tokens inválidos/expirados/otro-secreto.
 */
describe('verifyAccessToken', () => {
  const secret = 'test-secret';
  const jwt = new JwtService({ secret });

  it('acepta un access token válido y devuelve sub + roles', () => {
    const token = jwt.sign({ sub: 'u1', roles: ['admin'] }, { secret });
    expect(verifyAccessToken(jwt, secret, token)).toEqual({ sub: 'u1', roles: ['admin'] });
  });

  it('roles ausentes → []', () => {
    const token = jwt.sign({ sub: 'u1' }, { secret });
    expect(verifyAccessToken(jwt, secret, token)).toEqual({ sub: 'u1', roles: [] });
  });

  it('RECHAZA un token con typ (preauth 2FA) aunque firme con el mismo secreto', () => {
    const preauth = jwt.sign({ sub: 'u1', typ: '2fa' }, { secret });
    expect(verifyAccessToken(jwt, secret, preauth)).toBeNull();
  });

  it('rechaza token de otro secreto, vacío o basura', () => {
    expect(verifyAccessToken(jwt, secret, jwt.sign({ sub: 'u1' }, { secret: 'otro' }))).toBeNull();
    expect(verifyAccessToken(jwt, secret, undefined)).toBeNull();
    expect(verifyAccessToken(jwt, secret, 'no-es-un-jwt')).toBeNull();
  });

  it('rechaza token sin sub', () => {
    expect(verifyAccessToken(jwt, secret, jwt.sign({ roles: ['admin'] }, { secret }))).toBeNull();
  });
});
