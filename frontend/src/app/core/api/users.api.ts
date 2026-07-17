import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { PublicUserResponseDto, UpdateProfileDto } from './types';

/** Resultado del presign de subida del avatar. */
export interface AvatarPresignResult {
  key: string;
  uploadUrl: string;
}

/** Perfil propio del usuario. */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly api = inject(ApiClient);
  private readonly http = inject(HttpClient);

  /** Actualiza el perfil propio (nombre, apellido, teléfono, idioma, tema). */
  updateMe(dto: UpdateProfileDto): Observable<PublicUserResponseDto> {
    return this.api.patch<PublicUserResponseDto>('/users/me', dto);
  }

  /** Marca un tour de onboarding como visto (completado/saltado). */
  markTourSeen(tour: string): Observable<PublicUserResponseDto> {
    return this.api.post<PublicUserResponseDto>('/users/me/tours', { tour });
  }

  /** Sube la foto de perfil: presign → PUT directo al storage → confirma la key. */
  uploadAvatar(file: File): Observable<PublicUserResponseDto> {
    return this.api
      .post<AvatarPresignResult>('/users/me/avatar/presign', {
        filename: file.name,
        contentType: file.type,
      })
      .pipe(
        switchMap((res) =>
          this.http
            .put(res.uploadUrl, file, { headers: { 'Content-Type': file.type } })
            .pipe(map(() => res.key)),
        ),
        switchMap((key) => this.api.patch<PublicUserResponseDto>('/users/me/avatar', { key })),
      );
  }

  /** Quita la foto de perfil. */
  clearAvatar(): Observable<PublicUserResponseDto> {
    return this.api.delete<PublicUserResponseDto>('/users/me/avatar');
  }
}
