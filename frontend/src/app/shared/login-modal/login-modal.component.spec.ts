import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { LoginModal } from './login-modal.component';

describe('LoginModal', () => {
  let fixture: ComponentFixture<LoginModal>;
  let comp: LoginModal;

  async function setup(auth: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: { login: () => of({ status: 'ok' }), verify2fa: () => of({}), ...auth } as unknown as AuthService,
        },
      ],
    });
    fixture = TestBed.createComponent(LoginModal);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('login ok emite loggedIn', async () => {
    await setup({ login: () => of({ status: 'ok' } as never) });
    const spy = jasmine.createSpy();
    comp.loggedIn.subscribe(spy);
    comp['submit']();
    expect(spy).toHaveBeenCalled();
  });

  it('login con 2fa_required activa el segundo paso', async () => {
    await setup({ login: () => of({ status: '2fa_required', method: 'email', preauthToken: 'p' } as never) });
    comp['submit']();
    expect(comp['needs2fa']()).toBe(true);
    expect(comp['method']()).toBe('email');
  });

  it('login con error muestra credenciales inválidas', async () => {
    await setup({ login: () => throwError(() => new Error('x')) });
    comp['submit']();
    expect(comp['error']()).toContain('inválidas');
  });

  it('verify sin preauthToken no hace nada', async () => {
    const verify2fa = jasmine.createSpy('v').and.returnValue(of({}));
    await setup({ verify2fa });
    comp['verify']();
    expect(verify2fa).not.toHaveBeenCalled();
  });

  it('verify ok emite loggedIn; error muestra mensaje', async () => {
    await setup({ login: () => of({ status: '2fa_required', preauthToken: 'p' } as never), verify2fa: () => of({}) });
    comp['submit']();
    const spy = jasmine.createSpy();
    comp.loggedIn.subscribe(spy);
    comp['verify']();
    expect(spy).toHaveBeenCalled();
  });

  it('verify con error muestra código inválido', async () => {
    await setup({ login: () => of({ status: '2fa_required', preauthToken: 'p' } as never), verify2fa: () => throwError(() => new Error('x')) });
    comp['submit']();
    comp['verify']();
    expect(comp['error']()).toContain('inválido');
  });

  it('close emite dismiss', async () => {
    await setup();
    const spy = jasmine.createSpy();
    comp.dismiss.subscribe(spy);
    comp['close']();
    expect(spy).toHaveBeenCalled();
  });

  it('F2: en el paso 2FA reenvía el código (resend2fa) y muestra el aviso', async () => {
    const resend2fa = jasmine.createSpy('resend2fa').and.returnValue(of({ method: 'email', resent: true }));
    await setup({ login: () => of({ status: '2fa_required', method: 'email', preauthToken: 'p' } as never), resend2fa });
    comp['submit']();
    comp['resendCode']();
    expect(resend2fa).toHaveBeenCalledWith('p');
    expect(comp['info']()).toContain('reenviamos');
  });

  it('F2: reenviar sin preauthToken no llama al servicio', async () => {
    const resend2fa = jasmine.createSpy('resend2fa').and.returnValue(of({ method: 'email', resent: true }));
    await setup({ resend2fa });
    comp['resendCode']();
    expect(resend2fa).not.toHaveBeenCalled();
  });
});
