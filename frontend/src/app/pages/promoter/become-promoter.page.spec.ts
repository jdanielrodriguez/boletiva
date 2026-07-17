import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { PromotersApi } from '../../core/api/promoters.api';
import { AuthRefreshService } from '../../core/auth/auth-refresh.service';
import { SessionStore } from '../../core/auth/session.store';
import { TokenStore } from '../../core/auth/token-store.service';
import { RecaptchaService } from '../../core/security/recaptcha.service';
import { ToastService } from '../../core/ui/toast.service';
import { BecomePromoterPage } from './become-promoter.page';

type Status = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';

/**
 * BecomePromoterPage — rediseñada como PANTALLA DE PLANES (free/premium) con
 * flujo logueado (apply con tier) y flujo de VISITANTE (register en un paso).
 */
describe('BecomePromoterPage (planes free/premium)', () => {
  let fixture: ComponentFixture<BecomePromoterPage>;
  let el: HTMLElement;
  let myStatus: jasmine.Spy;
  let apply: jasmine.Spy;
  let register: jasmine.Spy;
  let refresh: jasmine.Spy;
  let loadMe: jasmine.Spy;
  let setUser: jasmine.Spy;
  let setAccessToken: jasmine.Spy;
  let navSpy: jasmine.Spy;

  async function setup(
    opts: {
      roles?: string[];
      authenticated?: boolean;
      status?: Status;
      statusError?: boolean;
      applyStatus?: Status;
      applyError?: boolean;
      registerStatus?: Status;
      registerError?: boolean;
    } = {},
  ) {
    const authenticated = opts.authenticated ?? true;
    myStatus = jasmine
      .createSpy('myStatus')
      .and.returnValue(
        opts.statusError ? throwError(() => new Error('x')) : of({ promoterStatus: opts.status ?? 'none' }),
      );
    apply = jasmine
      .createSpy('apply')
      .and.returnValue(
        opts.applyError ? throwError(() => new Error('x')) : of({ promoterStatus: opts.applyStatus ?? 'pending' }),
      );
    register = jasmine.createSpy('register').and.returnValue(
      opts.registerError
        ? throwError(() => new Error('x'))
        : of({
            user: { id: 'u1', roles: ['buyer'] },
            tokens: { accessToken: 'acc' },
            promoter: { promoterStatus: opts.registerStatus ?? 'pending' },
          }),
    );
    refresh = jasmine.createSpy('refresh').and.returnValue(of({ accessToken: 't' }));
    loadMe = jasmine.createSpy('loadMe').and.returnValue(of({ roles: ['buyer', 'promoter'] }));
    setUser = jasmine.createSpy('setUser');
    setAccessToken = jasmine.createSpy('setAccessToken');

    const roles = opts.roles ?? [];
    const session = {
      isAuthenticated: () => authenticated,
      hasAnyRole: (rs: string[]) => rs.some((r) => roles.includes(r)),
      user: signal(null),
      setUser,
      loadMe,
    } as unknown as SessionStore;

    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: PromotersApi, useValue: { myStatus, apply, register } },
        { provide: AuthRefreshService, useValue: { refresh } },
        { provide: SessionStore, useValue: session },
        { provide: TokenStore, useValue: { setAccessToken } },
        { provide: RecaptchaService, useValue: { execute: () => Promise.resolve('') } },
      ],
    });
    navSpy = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BecomePromoterPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const click = (testid: string) => {
    (el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  /** Setea una signal del componente directamente (evita timing de ngModel). */
  const set = (name: string, value: string) => {
    const c = fixture.componentInstance as unknown as Record<string, { set: (v: string) => void }>;
    c[name].set(value);
    fixture.detectChanges();
  };
  /** Confirma un flujo async (recaptcha es una Promise → hay que estabilizar). */
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('ya es promotor → redirige a /promotor sin pedir estado', async () => {
    await setup({ roles: ['promoter'] });
    expect(navSpy).toHaveBeenCalledWith(['/promotor']);
    expect(myStatus).not.toHaveBeenCalled();
  });

  it('logueado sin solicitud → muestra el grid de planes (free + premium)', async () => {
    await setup({ status: 'none' });
    expect(el.querySelector('[data-testid="bp-plan-free"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="bp-plan-premium"]')).not.toBeNull();
  });

  it('solicitud pendiente → estado pendiente (sin planes)', async () => {
    await setup({ status: 'pending' });
    expect(el.querySelector('[data-testid="bp-pending"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="bp-plan-free"]')).toBeNull();
  });

  it('ya aprobado → estado aprobado', async () => {
    await setup({ status: 'approved' });
    expect(el.querySelector('[data-testid="bp-approved"]')).not.toBeNull();
  });

  it('logueado, elegir Free y modo pruebas: apply("free") auto-aprobado → navega', async () => {
    await setup({ status: 'none', applyStatus: 'approved' });
    click('bp-choose-free');
    expect(el.querySelector('[data-testid="bp-info-modal"]')).not.toBeNull();
    click('bp-info-confirm');
    await settle();
    expect(apply).toHaveBeenCalledWith('free', undefined);
    expect(refresh).toHaveBeenCalled();
    expect(loadMe).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/promotor']);
  });

  it('logueado, elegir Premium → apply se invoca con tier premium', async () => {
    await setup({ status: 'none', applyStatus: 'pending' });
    click('bp-choose-premium');
    click('bp-info-confirm');
    await settle();
    expect(apply).toHaveBeenCalledWith('premium', undefined);
  });

  it('logueado, requiere aprobación: modal "proceso iniciado" + pendiente', async () => {
    await setup({ status: 'none', applyStatus: 'pending' });
    click('bp-choose-free');
    click('bp-info-confirm');
    await settle();
    expect(navSpy).not.toHaveBeenCalledWith(['/promotor']);
    expect(el.querySelector('[data-testid="bp-started-modal"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="bp-pending"]')).not.toBeNull();
    click('bp-started-close');
    expect(el.querySelector('[data-testid="bp-started-modal"]')).toBeNull();
  });

  it('logueado, cancelar la modal no envía la solicitud', async () => {
    await setup({ status: 'none' });
    click('bp-choose-free');
    click('bp-info-cancel');
    expect(el.querySelector('[data-testid="bp-info-modal"]')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('logueado, error al enviar → muestra error y no navega', async () => {
    await setup({ status: 'none', applyError: true });
    click('bp-choose-free');
    click('bp-info-confirm');
    await settle();
    expect(el.querySelector('[data-testid="bp-error"]')).not.toBeNull();
    expect(navSpy).not.toHaveBeenCalledWith(['/promotor']);
  });

  it('si falla la consulta de estado igual muestra los planes', async () => {
    await setup({ statusError: true });
    expect(el.querySelector('[data-testid="bp-plan-free"]')).not.toBeNull();
  });

  // --- Flujo de VISITANTE (sin sesión) ---

  it('sin sesión → muestra planes directamente (no consulta estado)', async () => {
    await setup({ authenticated: false });
    expect(myStatus).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="bp-plan-free"]')).not.toBeNull();
  });

  it('sin sesión, elegir plan → abre el formulario de registro', async () => {
    await setup({ authenticated: false });
    click('bp-choose-premium');
    expect(el.querySelector('[data-testid="bp-register-modal"]')).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('sin sesión, registro válido y modo pruebas: crea cuenta, adopta sesión y navega', async () => {
    await setup({ authenticated: false, registerStatus: 'approved' });
    click('bp-choose-premium');
    set('regFirstName', 'Ana');
    set('regEmail', 'ana@test.com');
    set('regPassword', 'Password123');
    click('bp-reg-submit');
    await settle();
    expect(register).toHaveBeenCalled();
    const body = register.calls.mostRecent().args[0];
    expect(body).toEqual(jasmine.objectContaining({ email: 'ana@test.com', firstName: 'Ana', tier: 'premium' }));
    expect(setAccessToken).toHaveBeenCalledWith('acc');
    expect(setUser).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/promotor']);
  });

  it('sin sesión, registro con campos incompletos → error, no llama al backend', async () => {
    await setup({ authenticated: false });
    click('bp-choose-free');
    set('regFirstName', 'Ana');
    // sin correo ni password
    click('bp-reg-submit');
    expect(register).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="bp-reg-error"]')).not.toBeNull();
  });

  it('sin sesión, error del backend al registrar → muestra error', async () => {
    await setup({ authenticated: false, registerError: true });
    click('bp-choose-free');
    set('regFirstName', 'Ana');
    set('regEmail', 'ana@test.com');
    set('regPassword', 'Password123');
    click('bp-reg-submit');
    await settle();
    expect(el.querySelector('[data-testid="bp-reg-error"]')).not.toBeNull();
  });
});
