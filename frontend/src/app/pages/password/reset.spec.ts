import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../core/ui/toast.service';
import { PasswordReset } from './reset';

describe('PasswordReset (restablecer contraseña)', () => {
  let fixture: ComponentFixture<PasswordReset>;
  let el: HTMLElement;
  let toasts: ToastService;
  let navigate: jasmine.Spy;

  async function setup(token: string | null, auth: Partial<AuthService> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: AuthService, useValue: { resetPassword: () => of({ message: 'ok' }), ...auth } as unknown as AuthService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(PasswordReset);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);
  const submit = () => {
    (el.querySelector('[data-testid="reset-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('sin token muestra aviso y no expone el formulario', async () => {
    await setup(null);
    expect(el.querySelector('[data-testid="reset-no-token"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="reset-submit"]')).toBeNull();
  });

  it('contraseña corta muestra toast de advertencia', async () => {
    await setup('tok123');
    fixture.componentInstance['password'].set('123');
    fixture.componentInstance['confirm'].set('123');
    submit();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('confirmación distinta muestra toast de advertencia', async () => {
    await setup('tok123');
    fixture.componentInstance['password'].set('NuevaClave456');
    fixture.componentInstance['confirm'].set('otra12345');
    submit();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('éxito llama resetPassword y navega a /login', async () => {
    const resetPassword = jasmine.createSpy('rp').and.returnValue(of({ message: 'ok' }));
    await setup('tok123', { resetPassword });
    fixture.componentInstance['password'].set('NuevaClave456');
    fixture.componentInstance['confirm'].set('NuevaClave456');
    submit();
    expect(resetPassword).toHaveBeenCalledWith({ token: 'tok123', password: 'NuevaClave456' });
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(lastToast()?.kind).toBe('success');
  });

  it('token expirado/usado muestra toast de error', async () => {
    const resetPassword = jasmine.createSpy('rp').and.returnValue(throwError(() => new Error('gone')));
    await setup('tok123', { resetPassword });
    fixture.componentInstance['password'].set('NuevaClave456');
    fixture.componentInstance['confirm'].set('NuevaClave456');
    submit();
    expect(lastToast()?.kind).toBe('error');
  });
});
