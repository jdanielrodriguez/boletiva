import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  email: string;
  firstName: string;
  lastName?: string;
  picture?: string;
  providerAccountId: string;
}

/**
 * Verifica el id_token que el cliente obtiene de Google (flujo recomendado para
 * SPA/PWA). Queda inactivo hasta configurar GOOGLE_CLIENT_ID.
 */
@Injectable()
export class GoogleAuthService {
  private readonly clientId: string;
  private readonly client: OAuth2Client | null;

  constructor(config: ConfigService) {
    this.clientId = config.get<string>('oauth.google.clientId') ?? '';
    this.client = this.clientId ? new OAuth2Client(this.clientId) : null;
  }

  get enabled(): boolean {
    return this.client != null;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.client) {
      throw new ServiceUnavailableException('El inicio de sesión con Google no está configurado');
    }
    const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
    const p = ticket.getPayload();
    if (!p?.email || !p.email_verified) {
      throw new UnauthorizedException('Token de Google inválido o correo no verificado');
    }
    return {
      email: p.email.toLowerCase(),
      firstName: p.given_name ?? 'Usuario',
      lastName: p.family_name,
      picture: p.picture,
      providerAccountId: p.sub,
    };
  }
}
