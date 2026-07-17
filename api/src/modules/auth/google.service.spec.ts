import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleAuthService } from './google.service';

/**
 * H-06 (auditoría externa): un `id_token` malformado no debe reventar en 500 con la
 * clase de error interna, sino en un 401 genérico. Y sin `GOOGLE_CLIENT_ID` → 503.
 */
describe('GoogleAuthService — robustez del verify (H-06)', () => {
  const make = (clientId: string): GoogleAuthService => {
    const config = {
      get: (k: string) => (k === 'oauth.google.clientId' ? clientId : undefined),
    } as unknown as ConfigService;
    return new GoogleAuthService(config);
  };

  it('sin GOOGLE_CLIENT_ID → 503 (no configurado)', async () => {
    await expect(make('').verify('cualquier-cosa')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('id_token malformado (verifyIdToken lanza) → 401, sin filtrar la clase de error', async () => {
    const svc = make('client-123.apps.googleusercontent.com');
    // Simula el fallo de parseo/firma que hoy causaba el 500.
    (svc as unknown as { client: { verifyIdToken: () => Promise<never> } }).client = {
      verifyIdToken: () => Promise.reject(new SyntaxError("Can't parse token envelope")),
    };
    await expect(svc.verify('not.a.jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token válido pero correo no verificado → 401', async () => {
    const svc = make('client-123.apps.googleusercontent.com');
    (svc as unknown as { client: { verifyIdToken: () => Promise<unknown> } }).client = {
      verifyIdToken: () => Promise.resolve({ getPayload: () => ({ email: 'x@y.com', email_verified: false }) }),
    };
    await expect(svc.verify('ok')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
