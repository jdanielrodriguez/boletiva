import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent (estado vacío bonito reutilizable)', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
  });

  function setup(inputs: Record<string, unknown>): void {
    fixture = TestBed.createComponent(EmptyStateComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('renderiza título y subtítulo', () => {
    setup({ title: 'Sin boletos', subtitle: 'Explora eventos' });
    expect(el().querySelector('.empty-title')?.textContent?.trim()).toBe('Sin boletos');
    expect(el().querySelector('.empty-subtitle')?.textContent?.trim()).toBe('Explora eventos');
  });

  it('oculta el skeleton por defecto y lo muestra con skeleton=true', () => {
    setup({ title: 'X' });
    expect(el().querySelector('.empty-skeleton')).toBeNull();
    setup({ title: 'X', skeleton: true });
    expect(el().querySelectorAll('.skeleton-line').length).toBeGreaterThan(0);
  });

  it('muestra el CTA solo cuando hay etiqueta y ruta', () => {
    setup({ title: 'X' });
    expect(el().querySelector('[data-testid="empty-cta"]')).toBeNull();
    setup({ title: 'X', ctaLabel: 'Explorar eventos', ctaLink: '/' });
    const cta = el().querySelector<HTMLAnchorElement>('[data-testid="empty-cta"]');
    expect(cta?.textContent?.trim()).toBe('Explorar eventos');
    expect(cta?.getAttribute('href')).toBe('/');
  });

  it('elige la ilustración según variant', () => {
    setup({ title: 'X', variant: 'tickets' });
    expect(el().querySelector('.empty-illustration svg')).not.toBeNull();
  });
});
