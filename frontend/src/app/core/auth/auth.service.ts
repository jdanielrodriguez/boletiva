import { Injectable, inject } from '@angular/core';
import { EMPTY, Observable, catchError, from, switchMap, tap } from 'rxjs';
import { AuthApi } from '../api/auth.api';
import { RecaptchaService } from '../security/recaptcha.service';
import type {
  AuthSessionResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  MessageResponseDto,
  PublicUserResponseDto,
  ResetPasswordDto,
  SignupDto,
  SignupResponseDto,
  TwoFactorVerifyDto,
} from '../api/types';
import { SessionStore, type SessionUser } from './session.store';
import { TokenStore } from './token-store.service';
import { ImpersonationService } from './impersonation.service';
import { I18nService } from '../i18n/i18n.service';

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
  private readonly impersonation = inject(ImpersonationService);
  private readonly i18n = inject(I18nService);
  private readonly recaptcha = inject(RecaptchaService);

  /**
   * Login por contraseña. Si el backend responde `ok` con tokens, arranca la
   * sesión; si responde `2fa_required`, devuelve el resultado para que la UI
   * pida el segundo factor.
   */
  login(dto: LoginDto): Observable<LoginResponseDto> {
    return from(this.recaptcha.execute('login')).pipe(
      switchMap((token) => this.authApi.login(dto, token)),
      tap((res) => this.applyLogin(res)),
    );
  }

  /** Completa el login de 2 pasos con el segundo factor. */
  verify2fa(dto: TwoFactorVerifyDto): Observable<AuthSessionResponseDto> {
    return this.authApi.verify2fa(dto).pipe(tap((res) => this.applyLogin(res)));
  }

  /** Registro; el backend devuelve usuario + tokens (correo aún sin verificar). */
  signup(dto: SignupDto): Observable<SignupResponseDto> {
    return from(this.recaptcha.execute('signup')).pipe(
      switchMap((token) => this.authApi.signup(dto, token)),
      tap((res) => {
        this.tokens.setAccessToken(res.tokens.accessToken);
        this.session.setUser(res.user);
        this.applyUserLanguage(res.user);
      }),
    );
  }

  /** Verifica el correo con el código; al confirmar, refresca la sesión (emailVerified=true). */
  verifyEmail(code: string): Observable<PublicUserResponseDto> {
    const email = this.session.user()?.email ?? '';
    return this.authApi.verifyEmail({ email, code }).pipe(tap((user) => this.session.setUser(user)));
  }

  /** Reenvía el código de verificación al correo de la sesión actual (captcha 'resend'). */
  resendVerification(): Observable<MessageResponseDto> {
    const email = this.session.user()?.email ?? '';
    return from(this.recaptcha.execute('resend')).pipe(
      switchMap((token) => this.authApi.resendVerification({ email }, token)),
    );
  }

  /** Cierra la sesión: revoca el refresh en el backend y limpia el estado local. */
  logout(): Observable<void> {
    const hadSession = this.tokens.hasSessionHint();
    // Descarta cualquier impersonación persistida: al cerrar sesión no debe quedar
    // un token que reviva la vista impersonada en el próximo boot (W9).
    this.impersonation.clearStored();
    this.session.clear();
    // Al cerrar sesión SIEMPRE se vuelve a español y se borra la preferencia de
    // idioma del visitante (v3.10 · GI): aunque el usuario recién salido tuviera
    // inglés, la app queda en español para el siguiente anónimo.
    this.i18n.reset();
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
    return from(this.recaptcha.execute('forgot_password')).pipe(
      switchMap((token) => this.authApi.forgotPassword(dto, token)),
    );
  }

  /** Restablece la contraseña con el token del correo (flujo no autenticado). */
  resetPassword(dto: ResetPasswordDto): Observable<MessageResponseDto> {
    return this.authApi.resetPassword(dto);
  }

  private applyLogin(res: LoginResponseDto | AuthSessionResponseDto): void {
    if (res.status === 'ok' && res.tokens && res.user) {
      this.tokens.setAccessToken(res.tokens.accessToken);
      this.session.setUser(res.user);
      this.applyUserLanguage(res.user);
    }
  }

  /**
   * Aplica el idioma GUARDADO del usuario al iniciar sesión (v3.9 · E3): así, si
   * su preferencia en BD es inglés, la UI cambia de una vez sin re-seleccionar la
   * bandera. `i18n.use` persiste la preferencia y es no-op en SSR.
   */
  private applyUserLanguage(user: SessionUser): void {
    const lang = user.language;
    if (lang === 'es' || lang === 'en') this.i18n.use(lang);
  }
}
