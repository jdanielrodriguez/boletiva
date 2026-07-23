import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { AuthService } from '../../core/auth/auth.service';
import { VerifyEmail } from './verify-email';

describe('VerifyEmail (D2 + auth-H1)', () => {
  let fixture: ComponentFixture<VerifyEmail>;
  let navSpy: jasmine.Spy;

  function setup(token: string | null, verify?: () => Observable<unknown>) {
    const auth = { verifyEmailToken: jasmine.createSpy('verifyEmailToken').and.callFake(verify ?? (() => of({}))) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: Router, useValue: { navigateByUrl: () => Promise.resolve(true) } },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });
    navSpy = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(VerifyEmail);
    fixture.detectChanges();
    return auth;
  }

  beforeEach(() => jasmine.clock().install());
  afterEach(() => {
    fixture?.destroy();
    jasmine.clock().uninstall();
  });

  it('SIN token → pantalla de confirmación con loader de redirección', () => {
    setup(null);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="confirmation-splash"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="splash-redirect"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="verify-back-home"]')).not.toBeNull();
  });

  it('SIN token → NO redirige antes de los 20s, sí a los ~20s', () => {
    setup(null);
    jasmine.clock().tick(19000);
    expect(navSpy).not.toHaveBeenCalled();
    jasmine.clock().tick(1000);
    expect(navSpy).toHaveBeenCalledWith('/');
  });

  it('CON token válido → verifica y muestra "verificado"', () => {
    const auth = setup('tok-ok', () => of({}));
    expect(auth.verifyEmailToken).toHaveBeenCalledWith('tok-ok');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="verify-back-home"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="verify-error"]')).toBeNull();
  });

  it('CON token inválido/expirado → muestra error accesible (role=alert) y NO redirige', () => {
    setup('tok-bad', () => throwError(() => new Error('400')));
    const el = fixture.nativeElement as HTMLElement;
    const err = el.querySelector('[data-testid="verify-error"]');
    expect(err).not.toBeNull();
    expect(err?.getAttribute('role')).toBe('alert');
    jasmine.clock().tick(21000);
    expect(navSpy).not.toHaveBeenCalled(); // el error no arma redirección
  });
});
