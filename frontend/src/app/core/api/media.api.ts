import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, switchMap } from 'rxjs';
import { ApiClient } from '../http/api-client.service';

/** Respuesta del presign de subida a S3/GCS. */
export interface PresignResult {
  key: string;
  uploadUrl: string;
}

/** Media registrada (banner/galería) de un evento. */
export interface EventMediaResult {
  id: string;
  eventId: string;
  key: string;
  kind: string;
  position: number;
}

/**
 * Subida de media de eventos (banner ya hecho / galería). Flujo estándar del
 * backend: presign (URL firmada) → PUT del archivo al storage → register (asocia el
 * objeto al evento). `uploadBanner` encadena los tres pasos y lo marca como `cover`.
 */
@Injectable({ providedIn: 'root' })
export class MediaApi {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);

  presign(eventId: string, dto: { filename: string; contentType: string }): Observable<PresignResult> {
    return this.api.post<PresignResult>(`/events/${eventId}/media/presign`, dto);
  }

  register(eventId: string, dto: { key: string; kind?: string; position?: number }): Observable<EventMediaResult> {
    return this.api.post<EventMediaResult>(`/events/${eventId}/media`, dto);
  }

  /** PUT directo del archivo a la URL firmada (sin Authorization: es a S3/GCS). */
  put(uploadUrl: string, file: File): Observable<unknown> {
    return this.http.put(uploadUrl, file, { headers: { 'Content-Type': file.type } });
  }

  /** Sube una imagen ya hecha y la registra como banner (`cover`) del evento. */
  uploadBanner(eventId: string, file: File): Observable<EventMediaResult> {
    return this.presign(eventId, { filename: file.name, contentType: file.type }).pipe(
      switchMap((res) => this.put(res.uploadUrl, file).pipe(map(() => res.key))),
      switchMap((key) => this.register(eventId, { key, kind: 'cover', position: 0 })),
    );
  }
}
