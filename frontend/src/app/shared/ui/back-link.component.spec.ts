import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BackLinkComponent } from './back-link.component';

describe('BackLinkComponent (enlace "volver" estandarizado)', () => {
  let fixture: ComponentFixture<BackLinkComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
  });

  function setup(inputs: Record<string, unknown>): void {
    fixture = TestBed.createComponent(BackLinkComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  const link = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.pe-back');

  it('renderiza la etiqueta, la flecha y el destino', () => {
    setup({ link: '/configuracion', label: 'Volver a la consola' });
    expect(link()?.textContent?.trim()).toContain('Volver a la consola');
    expect(link()?.querySelector('.pe-back-arrow')).not.toBeNull();
    expect(link()?.getAttribute('href')).toBe('/configuracion');
  });

  it('usa el data-testid indicado (default back-link)', () => {
    setup({ link: '/', label: 'X' });
    expect(link()?.getAttribute('data-testid')).toBe('back-link');
    setup({ link: '/', label: 'X', testId: 'ph-back' });
    expect(link()?.getAttribute('data-testid')).toBe('ph-back');
  });

  it('acepta query params en el destino', () => {
    setup({ link: '/configuracion', label: 'X', queryParams: { tab: 'promotores' } });
    expect(link()?.getAttribute('href')).toBe('/configuracion?tab=promotores');
  });
});
