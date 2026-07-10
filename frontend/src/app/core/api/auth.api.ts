import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../http/api-client.service';
import type {
  AuthSessionResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  MessageResponseDto,
  ProvidersResponseDto,
  PublicUserResponseDto,
  ResetPasswordDto,
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

  /** Rota el refresh: el token viaja en la cookie httpOnly (no en el body). */
  refresh(): Observable<TokenPairResponseDto> {
    return this.api.post<TokenPairResponseDto>('/auth/refresh', {});
  }

  /** Cierra la sesión: la cookie httpOnly identifica la familia a revocar. */
  logout(): Observable<void> {
    return this.api.post<void>('/auth/logout', {});
  }

  /** Cambia la contraseña del usuario autenticado (requiere la contraseña actual). */
  changePassword(dto: ChangePasswordDto): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>('/auth/change-password', dto);
  }

  /** Solicita el enlace de recuperación al correo (respuesta neutra: no revela existencia). */
  forgotPassword(dto: ForgotPasswordDto): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>('/auth/forgot-password', dto);
  }

  /** Restablece la contraseña con el token del correo. */
  resetPassword(dto: ResetPasswordDto): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>('/auth/reset-password', dto);
  }
}
