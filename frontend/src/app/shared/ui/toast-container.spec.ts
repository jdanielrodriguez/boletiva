import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ToastService } from '../../core/ui/toast.service';
import { ToastContainer } from './toast-container';

describe('ToastContainer', () => {
  let fixture: ComponentFixture<ToastContainer>;
  let toasts: ToastService;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        ToastService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    initI18nTesting();
    toasts = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(ToastContainer);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('renderiza un toast con la clase de color por severidad', () => {
    toasts.warning('cuidado', 0);
    fixture.detectChanges();
    const node = el.querySelector('[data-testid="toast-warning"]');
    expect(node).not.toBeNull();
    expect(node?.classList).toContain('toast-warning');
    expect(node?.textContent).toContain('cuidado');
  });

  it('la ✕ cierra el toast', () => {
    toasts.error('boom', 0);
    fixture.detectChanges();
    (el.querySelector('.toast-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="toast-error"]')).toBeNull();
  });

  it('muestra varios toasts a la vez', () => {
    toasts.success('a', 0);
    toasts.info('b', 0);
    fixture.detectChanges();
    expect(el.querySelectorAll('.toast').length).toBe(2);
  });

  it('cada toast lleva un icono SVG por tipo', () => {
    toasts.success('ok', 0);
    fixture.detectChanges();
    const node = el.querySelector('[data-testid="toast-success"]');
    expect(node?.querySelector('.toast-icon svg')).not.toBeNull();
  });

  it('los errores/advertencias usan role="alert"', () => {
    toasts.error('boom', 0);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="toast-error"]')?.getAttribute('role')).toBe('alert');
  });
});
