import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideI18nTesting } from '../../core/i18n/testing';
import { VerifyEmail } from './verify-email';

describe('VerifyEmail (D2)', () => {
  let fixture: ComponentFixture<VerifyEmail>;
  let navSpy: jasmine.Spy;

  beforeEach(() => {
    jasmine.clock().install();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: Router, useValue: { navigateByUrl: () => Promise.resolve(true) } },
      ],
    });
    navSpy = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    fixture = TestBed.createComponent(VerifyEmail);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    jasmine.clock().uninstall();
  });

  it('muestra la pantalla de confirmación con loader de redirección', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="confirmation-splash"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="splash-redirect"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="verify-back-home"]')).not.toBeNull();
  });

  it('NO redirige antes de los 20s', () => {
    jasmine.clock().tick(19000);
    expect(navSpy).not.toHaveBeenCalled();
  });

  it('redirige al inicio tras ~20s', () => {
    jasmine.clock().tick(20000);
    expect(navSpy).toHaveBeenCalledWith('/');
  });
});
