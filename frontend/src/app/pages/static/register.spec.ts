import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { InvitationsApi } from '../../core/api/invitations.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { Register } from './register';

/** Sesión falsa configurable (autenticada o no, con un correo dado). */
function sessionStub(opts: { authed?: boolean; email?: string } = {}) {
  const authed = signal(opts.authed ?? false);
  return {
    isAuthenticated: () => authed(),
    user: () => (opts.authed ? { email: opts.email ?? 'x@x.com' } : null),
  } as unknown as SessionStore;
}

describe('Register (F4/v3.5)', () => {
  let fixture: ComponentFixture<Register>;
  let el: HTMLElement;
  let signup: jasmine.Spy;
  let byToken: jasmine.Spy;
  let accept: jasmine.Spy;
  let acceptByToken: jasmine.Spy;
  let navSpy: jasmine.Spy;

  async function setup(
    token?: string,
    opts: {
      signupOk?: boolean;
      accountExists?: boolean;
      valid?: boolean;
      session?: SessionStore;
    } = {},
  ) {
    signup = jasmine
      .createSpy('signup')
      .and.returnValue(opts.signupOk === false ? throwError(() => new Error('dup')) : of({ user: {}, tokens: {} }));
    byToken = jasmine
      .createSpy('byToken')
      .and.returnValue(of({ email: 'inv@correo.com', accountExists: opts.accountExists ?? false, valid: opts.valid ?? true }));
    accept = jasmine.createSpy('accept').and.returnValue(of({ accepted: true }));
    acceptByToken = jasmine.createSpy('acceptByToken').and.returnValue(of({ accepted: true }));
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: AuthService, useValue: { signup } },
        { provide: InvitationsApi, useValue: { byToken, accept, acceptByToken } },
        { provide: SessionStore, useValue: opts.session ?? sessionStub() },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });
    // Spy ANTES de crear el componente: el redirect de "logueado sin token" ocurre
    // en el constructor.
    navSpy = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const set = (name: string, value: string) => {
    const c = fixture.componentInstance as unknown as Record<string, { set: (v: string) => void }>;
    c[name].set(value);
  };
  const submit = () => {
    (el.querySelector('[data-testid="rg-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('alta normal: signup y navega a verificar-correo', async () => {
    await setup();
    set('firstName', 'Ana');
    set('email', 'ana@correo.com');
    set('password', 'Password123');
    submit();
    expect(signup).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/verificar-correo']);
  });

  it('logueado sin token → redirige a /cuenta (no se registra)', async () => {
    await setup(undefined, { session: sessionStub({ authed: true, email: 'ya@correo.com' }) });
    expect(navSpy).toHaveBeenCalledWith(['/cuenta']);
  });

  it('validación: campos vacíos → error, no llama signup', async () => {
    await setup();
    submit();
    expect(signup).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="rg-error"]')).not.toBeNull();
  });

  it('token + cuenta NO existe: byToken precarga el correo (bloqueado) y muestra el form', async () => {
    await setup('inv-token', { accountExists: false });
    expect(byToken).toHaveBeenCalledWith('inv-token');
    expect(el.querySelector('[data-testid="invited-note"]')).not.toBeNull();
    const email = el.querySelector('[data-testid="rg-email"]') as HTMLInputElement;
    expect(email.value).toBe('inv@correo.com');
    expect(email.readOnly).toBe(true);
  });

  it('token + cuenta NO existe: tras el alta acepta la invitación y navega', async () => {
    await setup('inv-token', { accountExists: false });
    set('firstName', 'Ana');
    set('password', 'Password123');
    submit();
    expect(signup).toHaveBeenCalled();
    expect(accept).toHaveBeenCalledWith('inv-token');
    expect(navSpy).toHaveBeenCalledWith(['/verificar-correo']);
  });

  it('token + cuenta existe + sesión del correo invitado: activa de un click', async () => {
    await setup('inv-token', {
      accountExists: true,
      session: sessionStub({ authed: true, email: 'inv@correo.com' }),
    });
    const btn = el.querySelector('[data-testid="activate-btn"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();
    fixture.detectChanges();
    expect(acceptByToken).toHaveBeenCalledWith('inv-token');
    expect(navSpy).toHaveBeenCalledWith(['/promotor']);
  });

  it('token + cuenta existe SIN sesión: muestra CTA de iniciar sesión (no el form)', async () => {
    await setup('inv-token', { accountExists: true });
    expect(el.querySelector('[data-testid="activate-login"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="activate-btn"]')).toBeNull();
    expect(el.querySelector('[data-testid="rg-submit"]')).toBeNull();
  });

  it('token inválido → muestra estado inválido', async () => {
    byToken = jasmine.createSpy('byToken').and.returnValue(of({ email: '', accountExists: false, valid: false }));
    await setupWithByToken('inv-token', byToken);
    expect(el.querySelector('[data-testid="inv-invalid"]')).not.toBeNull();
  });

  it('signup falla → muestra error', async () => {
    await setup(undefined, { signupOk: false });
    set('firstName', 'Ana');
    set('email', 'dup@correo.com');
    set('password', 'Password123');
    submit();
    expect(el.querySelector('[data-testid="rg-error"]')).not.toBeNull();
  });

  // Helper para el caso de token inválido (byToken personalizado).
  async function setupWithByToken(token: string, byTokenSpy: jasmine.Spy) {
    signup = jasmine.createSpy('signup').and.returnValue(of({ user: {}, tokens: {} }));
    accept = jasmine.createSpy('accept').and.returnValue(of({ accepted: true }));
    acceptByToken = jasmine.createSpy('acceptByToken').and.returnValue(of({ accepted: true }));
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: AuthService, useValue: { signup } },
        { provide: InvitationsApi, useValue: { byToken: byTokenSpy, accept, acceptByToken } },
        { provide: SessionStore, useValue: sessionStub() },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ token }) } },
        },
      ],
    });
    navSpy = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(Register);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }
});
