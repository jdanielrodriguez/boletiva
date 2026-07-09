import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { PasswordRecover } from './recover';

describe('PasswordRecover (recuperar contraseña)', () => {
  let fixture: ComponentFixture<PasswordRecover>;
  let el: HTMLElement;
  let toasts: ToastService;

  async function setup(auth: Partial<AuthService> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: AuthService, useValue: { forgotPassword: () => of({ message: 'ok' }), ...auth } as unknown as AuthService },
      ],
    });
    fixture = TestBed.createComponent(PasswordRecover);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);
  const submit = () => {
    (el.querySelector('[data-testid="recover-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('sin correo muestra toast de advertencia', async () => {
    await setup();
    submit();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('con correo llama forgotPassword y muestra confirmación neutra', async () => {
    const forgotPassword = jasmine.createSpy('fp').and.returnValue(of({ message: 'ok' }));
    await setup({ forgotPassword });
    fixture.componentInstance['email'].set('ana@correo.com');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(forgotPassword).toHaveBeenCalledWith({ email: 'ana@correo.com' });
    expect(el.querySelector('[data-testid="recover-sent"]')).not.toBeNull();
    expect(lastToast()?.kind).toBe('success');
  });

  it('ante error del backend sigue mostrando confirmación neutra (no revela existencia)', async () => {
    const forgotPassword = jasmine.createSpy('fp').and.returnValue(throwError(() => new Error('boom')));
    await setup({ forgotPassword });
    fixture.componentInstance['email'].set('ana@correo.com');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="recover-sent"]')).not.toBeNull();
  });
});
