import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  AuthSessionResponseDto,
  LoginDto,
  LoginResponseDto,
  ProvidersResponseDto,
  PublicUserResponseDto,
  SignupDto,
  SignupResponseDto,
  TokenPairResponseDto,
  TwoFactorVerifyDto,
} from './types';

/**
 * Servicio del SDK para el módulo auth. Solo transporta: request/response
 * tipados desde el OpenAPI. La orquestación de sesión (guardar tokens, cargar
 * usuario) vive en AuthService.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  login(dto: LoginDto): Observable<LoginResponseDto> {
    return this.api.post<LoginResponseDto>('/auth/login', dto);
  }

  verify2fa(dto: TwoFactorVerifyDto): Observable<AuthSessionResponseDto> {
    return this.api.post<AuthSessionResponseDto>('/auth/2fa/verify', dto);
  }

  signup(dto: SignupDto): Observable<SignupResponseDto> {
    return this.api.post<SignupResponseDto>('/auth/signup', dto);
  }

  me(): Observable<PublicUserResponseDto> {
    return this.api.get<PublicUserResponseDto>('/auth/me');
  }

  providers(): Observable<ProvidersResponseDto> {
    return this.api.get<ProvidersResponseDto>('/auth/providers');
  }

  refresh(refreshToken: string): Observable<TokenPairResponseDto> {
    return this.api.post<TokenPairResponseDto>('/auth/refresh', { refreshToken });
  }

  logout(refreshToken: string): Observable<void> {
    return this.api.post<void>('/auth/logout', { refreshToken });
  }
}
