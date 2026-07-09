import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type { PublicUserResponseDto, UpdateProfileDto } from './types';

/** Perfil propio del usuario. */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly api = inject(ApiClient);

  /** Actualiza el perfil propio (nombre, apellido, teléfono, avatar). */
  updateMe(dto: UpdateProfileDto): Observable<PublicUserResponseDto> {
    return this.api.patch<PublicUserResponseDto>('/users/me', dto);
  }
}
