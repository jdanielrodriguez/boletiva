import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'crypto';
import { IntegrationsService } from '../../../infra/integrations/integrations.service';
import { GoogleWalletProvider } from './google-wallet.provider';
import { WalletPassInput } from './wallet-provider';

const INPUT: WalletPassInput = {
  ticketId: 'tk_123',
  serial: 'PE1-ABC',
  eventName: 'Concierto de Prueba',
  seatLabel: 'A-12',
  qrPayload: 'PE1.PE1-ABC.482913',
};

/** IntegrationsService falso: controla disponibilidad de google/apple. */
function makeIntegrations(available: { google: boolean; apple: boolean }): IntegrationsService {
  return {
    available: (service: string) =>
      service === 'googleWallet' ? available.google : service === 'appleWallet' ? available.apple : false,
    assertAvailable: (service: string) => {
      const ok = service === 'googleWallet' ? available.google : available.apple;
      if (!ok) throw new ServiceUnavailableException(`Servicio no disponible: ${service}`);
    },
  } as unknown as IntegrationsService;
}

/** ConfigService falso que devuelve el sub-árbol `wallet`. */
function makeConfig(google: { issuerId: string; serviceAccountJson: string }): ConfigService {
  const wallet = {
    provider: 'google',
    apple: { passTypeId: '', teamId: '', certP12Base64: '', certPassword: '', wwdrBase64: '' },
    google,
  };
  return {
    getOrThrow: <T,>(key: string): T => {
      if (key === 'wallet') return wallet as unknown as T;
      throw new Error(`clave inesperada: ${key}`);
    },
  } as unknown as ConfigService;
}

/** Cuenta de servicio de prueba con una RSA real (solo para firmar). */
function testServiceAccount(): string {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return JSON.stringify({
    type: 'service_account',
    client_email: 'pases@pasaeventos.iam.gserviceaccount.com',
    private_key: privateKey,
  });
}

describe('GoogleWalletProvider', () => {
  it('sin Google Wallet configurado → 503 al pedir el pase', async () => {
    const provider = new GoogleWalletProvider(
      makeIntegrations({ google: false, apple: false }),
      makeConfig({ issuerId: '', serviceAccountJson: '' }),
    );
    await expect(provider.createPass('google', INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('con config genera la URL "Save to Google Wallet" con un JWT válido', async () => {
    const serviceAccountJson = testServiceAccount();
    const provider = new GoogleWalletProvider(
      makeIntegrations({ google: true, apple: false }),
      makeConfig({ issuerId: '3388000000022222', serviceAccountJson }),
    );

    const result = await provider.createPass('google', INPUT);

    expect(result.provider).toBe('google');
    expect(result.platform).toBe('google');
    expect(result.url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);

    // El fragmento tras /save/ es un JWT compacto (3 partes base64url).
    const jwt = result.url.replace('https://pay.google.com/gp/v/save/', '');
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const decode = (seg: string): Record<string, unknown> =>
      JSON.parse(Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

    const header = decode(parts[0]);
    expect(header.alg).toBe('RS256');
    expect(header.typ).toBe('JWT');

    const payload = decode(parts[1]);
    expect(payload.aud).toBe('google');
    expect(payload.typ).toBe('savetowallet');
    expect(payload.iss).toBe('pases@pasaeventos.iam.gserviceaccount.com');
    const inner = payload.payload as { eventTicketObjects: Array<Record<string, unknown>> };
    expect(inner.eventTicketObjects).toHaveLength(1);
    const obj = inner.eventTicketObjects[0];
    expect(obj.id).toBe('3388000000022222.tk_123');
    expect(obj.classId).toBe('3388000000022222.pasaeventos_event');
    expect((obj.barcode as { value: string }).value).toBe(INPUT.qrPayload);

    // La firma no está vacía.
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('acepta la cuenta de servicio codificada en base64', async () => {
    const serviceAccountJson = Buffer.from(testServiceAccount(), 'utf8').toString('base64');
    const provider = new GoogleWalletProvider(
      makeIntegrations({ google: true, apple: false }),
      makeConfig({ issuerId: '333', serviceAccountJson }),
    );
    const result = await provider.createPass('google', INPUT);
    expect(result.url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
  });

  it('cuenta de servicio inválida → 503 (sin filtrar el contenido)', async () => {
    const provider = new GoogleWalletProvider(
      makeIntegrations({ google: true, apple: false }),
      makeConfig({ issuerId: '333', serviceAccountJson: 'no-es-json-ni-base64-valido' }),
    );
    await expect(provider.createPass('google', INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('platform apple en el proveedor Google → 503 (usa apple/auto)', async () => {
    const provider = new GoogleWalletProvider(
      makeIntegrations({ google: true, apple: false }),
      makeConfig({ issuerId: '333', serviceAccountJson: testServiceAccount() }),
    );
    await expect(provider.createPass('apple', INPUT)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
