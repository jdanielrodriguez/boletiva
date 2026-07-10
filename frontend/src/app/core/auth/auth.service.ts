import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, tap } from 'rxjs';
import { AuthApi } from '../api/auth.api';
import type {
  AuthSessionResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  MessageResponseDto,
  ResetPasswordDto,
  SignupDto,
  SignupResponseDto,
  TwoFactorVerifyDto,
} from '../api/types';
import { SessionStore } from './session.store';
import { TokenStore } from './token-store.service';

/**
 * Orquesta la autenticación: enlaza el SDK (AuthApi) con el estado local (tokens
 * + sesión). Los componentes usan este servicio; no tocan tokens ni la sesión a
 * mano.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly authApi = inject(AuthApi);
  private readonly tokens = inject(TokenStore);
  private readonly session = inject(SessionStore);

  /**
   * Login por contraseña. Si el backend responde `ok` con tokens, arranca la
   * sesión; si responde `2fa_required`, devuelve el resultado para que la UI
   * pida el segundo factor.
   */
  login(dto: LoginDto): Observable<LoginResponseDto> {
    return this.authApi.login(dto).pipe(tap((res) => this.applyLogin(res)));
  }

  /** Completa el login de 2 pasos con el segundo factor. */
  verify2fa(dto: TwoFactorVerifyDto): Observable<AuthSessionResponseDto> {
    return this.authApi.verify2fa(dto).pipe(tap((res) => this.applyLogin(res)));
  }

  /** Registro; el backend devuelve usuario + tokens (correo aún sin verificar). */
  signup(dto: SignupDto): Observable<SignupResponseDto> {
    return this.authApi.signup(dto).pipe(
      tap((res) => {
        this.tokens.setAccessToken(res.tokens.accessToken);
        this.session.setUser(res.user);
      }),
    );
  }

  /** Cierra la sesión: revoca el refresh en el backend y limpia el estado local. */
  logout(): Observable<void> {
    const hadSession = this.tokens.hasSessionHint();
    this.session.clear();
    if (!hadSession) return EMPTY;
    // El estado local ya está limpio; la cookie httpOnly identifica la sesión a
    // revocar en el backend. Ignoramos errores de red del logout remoto.
    return this.authApi.logout().pipe(catchError(() => EMPTY));
  }

  /** Cambia la contraseña estando autenticado (transporta al SDK). */
  changePassword(dto: ChangePasswordDto): Observable<MessageResponseDto> {
    return this.authApi.changePassword(dto);
  }

  /** Solicita el enlace de recuperación (flujo no autenticado). */
  forgotPassword(dto: ForgotPasswordDto): Observable<MessageResponseDto> {
    return this.authApi.forgotPassword(dto);
  }

  /** Restablece la contraseña con el token del correo (flujo no autenticado). */
  resetPassword(dto: ResetPasswordDto): Observable<MessageResponseDto> {
    return this.authApi.resetPassword(dto);
  }

  private applyLogin(res: LoginResponseDto | AuthSessionResponseDto): void {
    if (res.status === 'ok' && res.tokens && res.user) {
      this.tokens.setAccessToken(res.tokens.accessToken);
      this.session.setUser(res.user);
    }
  }
}
