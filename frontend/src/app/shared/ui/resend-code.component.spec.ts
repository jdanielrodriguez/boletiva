import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { ResendCodeComponent } from './resend-code.component';

describe('ResendCodeComponent', () => {
  let fixture: ComponentFixture<ResendCodeComponent>;
  let comp: ResendCodeComponent;

  function setup() {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(ResendCodeComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  }

  const btn = () =>
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="resend"]') as HTMLButtonElement;

  it('emite resend al pulsar cuando no hay cooldown', () => {
    setup();
    const spy = jasmine.createSpy();
    comp.resend.subscribe(spy);
    btn().click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('startCooldown deshabilita el botón y descuenta el contador; reset lo libera', () => {
    setup();
    jasmine.clock().install();
    try {
      comp.startCooldown(3);
      fixture.detectChanges();
      expect(comp.cooldown()).toBe(3);
      expect(btn().disabled).toBeTrue();
      // Durante el cooldown un clic NO emite.
      const spy = jasmine.createSpy();
      comp.resend.subscribe(spy);
      btn().click();
      expect(spy).not.toHaveBeenCalled();
      // Avanza el reloj → baja a 0 y se habilita.
      jasmine.clock().tick(3000);
      fixture.detectChanges();
      expect(comp.cooldown()).toBe(0);
      expect(btn().disabled).toBeFalse();
      // reset() limpia el cooldown de inmediato.
      comp.startCooldown(30);
      comp.reset();
      expect(comp.cooldown()).toBe(0);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('muestra la barra de progreso y el aria-label del cronómetro durante el cooldown', () => {
    setup();
    jasmine.clock().install();
    try {
      comp.startCooldown(60);
      fixture.detectChanges();
      const countdown = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="resend-countdown"]');
      expect(countdown).not.toBeNull();
      expect(countdown?.getAttribute('aria-label')).toBeTruthy();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('no emite resend mientras resending es true', () => {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), provideZonelessChangeDetection()],
    });
    const f = TestBed.createComponent(ResendCodeComponent);
    f.componentRef.setInput('resending', true);
    f.detectChanges();
    const spy = jasmine.createSpy();
    f.componentInstance.resend.subscribe(spy);
    (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="resend"]')?.click();
    expect(spy).not.toHaveBeenCalled();
  });
});
