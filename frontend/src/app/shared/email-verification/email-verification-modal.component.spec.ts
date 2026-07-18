import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { EmailVerificationModal } from './email-verification-modal.component';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting } from '../../core/i18n/testing';

/** Sesión stub con estado de autenticación/verificación controlable por señales. */
function sessionStub(authed: boolean, verified: boolean) {
  return {
    isAuthenticated: signal(authed),
    isEmailVerified: signal(verified),
    user: signal(authed ? { email: 'nuevo@correo.com' } : null),
  };
}

describe('EmailVerificationModal', () => {
  let verifyEmail: jasmine.Spy;
  let resendVerification: jasmine.Spy;
  let logout: jasmine.Spy;
  let success: jasmine.Spy;

  async function setup(authed: boolean, verified: boolean, opts: { verifyOk?: boolean } = {}) {
    verifyEmail = jasmine
      .createSpy('verifyEmail')
      .and.returnValue(opts.verifyOk === false ? throwError(() => ({ error: { message: 'Código inválido' } })) : of({}));
    resendVerification = jasmine.createSpy('resendVerification').and.returnValue(of({ message: 'ok' }));
    logout = jasmine.createSpy('logout').and.returnValue(of(void 0));
    success = jasmine.createSpy('success');

    await TestBed.configureTestingModule({
      imports: [EmailVerificationModal],
      providers: [
        provideZonelessChangeDetection(),
        provideI18nTesting(),
        { provide: SessionStore, useValue: sessionStub(authed, verified) },
        { provide: AuthService, useValue: { verifyEmail, resendVerification, logout } },
        { provide: ToastService, useValue: { success, error: jasmine.createSpy('error') } },
      ],
    }).compileComponents();
    const fixture: ComponentFixture<EmailVerificationModal> = TestBed.createComponent(EmailVerificationModal);
    fixture.detectChanges();
    return fixture;
  }

  const modal = (f: ComponentFixture<EmailVerificationModal>) =>
    (f.nativeElement as HTMLElement).querySelector('[data-testid="verify-email-modal"]');

  it('NO se muestra si el correo ya está verificado', async () => {
    const f = await setup(true, true);
    expect(modal(f)).toBeNull();
  });

  it('NO se muestra sin sesión', async () => {
    const f = await setup(false, false);
    expect(modal(f)).toBeNull();
  });

  it('se muestra (encima de todo) si autenticado y SIN verificar', async () => {
    const f = await setup(true, false);
    expect(modal(f)).not.toBeNull();
  });

  it('al completar el código verifica y notifica éxito', async () => {
    const f = await setup(true, false);
    const c = f.componentInstance as unknown as { onCode(v: string): void };
    c.onCode('123456');
    expect(verifyEmail).toHaveBeenCalledWith('123456');
    expect(success).toHaveBeenCalled();
  });

  it('código inválido → muestra el error real del backend, sin notificar éxito', async () => {
    const f = await setup(true, false, { verifyOk: false });
    (f.componentInstance as unknown as { onCode(v: string): void }).onCode('000000');
    f.detectChanges();
    const err = (f.nativeElement as HTMLElement).querySelector('[data-testid="verify-modal-error"]');
    expect(err?.textContent).toContain('Código inválido');
    expect(success).not.toHaveBeenCalled();
  });

  it('reenviar código invoca al servicio', async () => {
    const f = await setup(true, false);
    (f.componentInstance as unknown as { resend(): void }).resend();
    expect(resendVerification).toHaveBeenCalled();
  });
});
