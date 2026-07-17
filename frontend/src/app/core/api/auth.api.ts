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

  login(dto: LoginDto, captchaToken?: string): Observable<LoginResponseDto> {
    return this.api.post<LoginResponseDto>('/auth/login', dto, undefined, captchaOpts(captchaToken));
  }

  verify2fa(dto: TwoFactorVerifyDto): Observable<AuthSessionResponseDto> {
    return this.api.post<AuthSessionResponseDto>('/auth/2fa/verify', dto);
  }

  signup(dto: SignupDto, captchaToken?: string): Observable<SignupResponseDto> {
    return this.api.post<SignupResponseDto>('/auth/signup', dto, undefined, captchaOpts(captchaToken));
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
  forgotPassword(dto: ForgotPasswordDto, captchaToken?: string): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>(
      '/auth/forgot-password',
      dto,
      undefined,
      captchaOpts(captchaToken),
    );
  }

  /** Restablece la contraseña con el token del correo. */
  resetPassword(dto: ResetPasswordDto): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>('/auth/reset-password', dto);
  }

  // --- 2FA con app autenticadora (TOTP) ---
  /** Inicia el alta de TOTP: devuelve la URL otpauth, el QR (data URL) y el secret. */
  totpSetup(): Observable<{ otpauthUrl: string; qrDataUrl: string; secret: string }> {
    return this.api.post<{ otpauthUrl: string; qrDataUrl: string; secret: string }>('/auth/2fa/totp/setup', {});
  }

  /** Confirma TOTP con un código de la app → el 2FA pasa a ser por app autenticadora. */
  totpEnable(code: string): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>('/auth/2fa/totp/enable', { code });
  }

  /** Vuelve al segundo factor por correo (OTP por email). */
  useEmail2fa(): Observable<MessageResponseDto> {
    return this.api.post<MessageResponseDto>('/auth/2fa/use-email', {});
  }
}

/**
 * Construye las opciones de request con el header `x-captcha-token` cuando hay un
 * token. Sin token (dev/test/no configurado) devuelve `undefined` → petición normal
 * y el backend OMITE la verificación.
 */
function captchaOpts(token?: string): { headers: Record<string, string> } | undefined {
  return token ? { headers: { 'x-captcha-token': token } } : undefined;
}
