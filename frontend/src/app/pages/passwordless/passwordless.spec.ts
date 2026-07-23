import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { AuthService } from '../../core/auth/auth.service';
import { Passwordless } from './passwordless';

describe('Passwordless (auth-H2)', () => {
  let fixture: ComponentFixture<Passwordless>;
  let navSpy: jasmine.Spy;

  function setup(token: string | null, verify?: () => Observable<unknown>) {
    const auth = {
      passwordlessToken: jasmine
        .createSpy('passwordlessToken')
        .and.callFake(verify ?? (() => of({ status: 'ok' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });
    navSpy = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(Passwordless);
    fixture.detectChanges();
    return auth;
  }

  afterEach(() => fixture?.destroy());

  it('CON token válido → canjea y redirige al inicio', () => {
    const auth = setup('tok-ok', () => of({ status: 'ok' }));
    expect(auth.passwordlessToken).toHaveBeenCalledWith('tok-ok');
    expect(navSpy).toHaveBeenCalledWith('/');
  });

  it('CON token inválido → error accesible (role=alert) y NO redirige', () => {
    setup('tok-bad', () => throwError(() => new Error('400')));
    const el = fixture.nativeElement as HTMLElement;
    const err = el.querySelector('[data-testid="pwl-error"]');
    expect(err?.getAttribute('role')).toBe('alert');
    expect(el.querySelector('[data-testid="pwl-back-login"]')).not.toBeNull();
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('SIN token → error (no llama al backend)', () => {
    const auth = setup(null);
    expect(auth.passwordlessToken).not.toHaveBeenCalled();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="pwl-error"]')).not.toBeNull();
  });
});
