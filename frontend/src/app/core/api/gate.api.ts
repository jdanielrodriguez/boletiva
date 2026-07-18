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
}

/** Manifiesto firmado de validación offline (`GET /events/:id/manifest`). */
export interface GateManifest {
  eventId?: string;
  publicKeyPem: string;
  signature: string;
  expiresAt: string;
  since?: number;
  cursor?: number;
  tickets: GateManifestTicket[];
}

/**
 * API de PUERTA (validación). `peek`/`claim` son públicos (magic-link → gate-token).
 * El manifiesto y el ingest de check-ins se autentican con el GATE-TOKEN vía
 * `?access_token=` (la PWA no tiene sesión; la estrategia JWT lo acepta como fallback).
 * El lote de check-ins se envía al endpoint que lo publica a RabbitMQ (fan-in async).
 */
@Injectable({ providedIn: 'root' })
export class GateApi {
  private readonly api = inject(ApiClient);

  peek(token: string): Observable<ValidatorPeekDto> {
    return this.api.get<ValidatorPeekDto>(`/validators/${encodeURIComponent(token)}`);
  }

  claim(token: string): Observable<ClaimResponseDto> {
    return this.api.post<ClaimResponseDto>('/validators/claim', { token });
  }

  manifest(eventId: string, gateToken: string, since?: number): Observable<GateManifest> {
    return this.api.get<GateManifest>(`/events/${eventId}/manifest`, {
      access_token: gateToken,
      ...(since != null ? { since } : {}),
    });
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
      { access_token: gateToken },
    );
  }
}
