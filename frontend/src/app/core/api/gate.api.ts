import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { BatchCheckinResultDto, ClaimResponseDto, ValidatorPeekDto } from './types';

/** Boleto del manifiesto SafeTix (secreto TOTP en claro → validación offline). */
export interface GateManifestTicket {
  serial: string;
  status: string;
  totpSecret: string;
  signature?: string;
  // Campos que cubre la firma del manifiesto (necesarios para reconstruir el digest):
  ticketId?: string;
  ownerId?: string;
}

/** Manifiesto firmado de validación offline (`GET /events/:id/manifest`). */
export interface GateManifest {
  eventId?: string;
  maxSeq?: number; // parte del contenido firmado
  contentHash?: string; // sha256 del contenido canónico (lo que se firma)
  publicKeyPem: string;
  signature: string;
  expiresAt: string;
  since?: number;
  cursor?: number;
  tickets: GateManifestTicket[];
}

/**
 * API de PUERTA (validación). `peek`/`claim` son públicos (magic-link → gate-token).
 * El manifiesto y el ingest de check-ins se autentican con el GATE-TOKEN en el header
 * `Authorization: Bearer` (NO en la URL: evita filtrar el token en logs y evita que el
 * token de SESIÓN del navegador — si el promotor está logueado — gane sobre el gate-token;
 * el authInterceptor respeta un Authorization ya presente). El lote se publica a RabbitMQ.
 */
@Injectable({ providedIn: 'root' })
export class GateApi {
  private readonly api = inject(ApiClient);

  /** Header con el gate-token, para que el interceptor NO lo sustituya por el de sesión. */
  private gateAuth(gateToken: string): { headers: Record<string, string> } {
    return { headers: { Authorization: `Bearer ${gateToken}` } };
  }

  peek(token: string): Observable<ValidatorPeekDto> {
    return this.api.get<ValidatorPeekDto>(`/validators/${encodeURIComponent(token)}`);
  }

  claim(token: string): Observable<ClaimResponseDto> {
    return this.api.post<ClaimResponseDto>('/validators/claim', { token });
  }

  manifest(eventId: string, gateToken: string, since?: number): Observable<GateManifest> {
    return this.api.get<GateManifest>(
      `/events/${eventId}/manifest`,
      since != null ? { since } : undefined,
      this.gateAuth(gateToken),
    );
  }

  /** Envía el lote de check-ins → backend lo publica a RabbitMQ (idempotente). */
  batchCheckin(
    eventId: string,
    items: { serial: string; checkedInAt?: string }[],
    gateToken: string,
  ): Observable<BatchCheckinResultDto> {
    return this.api.post<BatchCheckinResultDto>(
      `/events/${eventId}/checkins/batch`,
      { items },
      undefined,
      this.gateAuth(gateToken),
    );
  }
}
