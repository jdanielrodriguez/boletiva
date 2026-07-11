import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingComponent } from './loading.component';

describe('LoadingComponent (indicador de carga reutilizable)', () => {
  let fixture: ComponentFixture<LoadingComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  function setup(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(LoadingComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  it('muestra un spinner por defecto', () => {
    setup();
    expect(el().querySelector('.pe-spinner')).not.toBeNull();
    expect(el().querySelector('.pe-skel')).toBeNull();
  });

  it('muestra skeleton cuando variant=skeleton', () => {
    setup({ variant: 'skeleton' });
    expect(el().querySelector('.pe-spinner')).toBeNull();
    expect(el().querySelectorAll('.pe-skel-line').length).toBeGreaterThan(0);
  });

  it('respeta el número de filas del skeleton', () => {
    setup({ variant: 'skeleton', skeletonRows: [50, 80] });
    expect(el().querySelectorAll('.pe-skel-line').length).toBe(2);
  });

  it('renderiza la etiqueta cuando se provee', () => {
    setup({ label: 'Cargando…' });
    expect(el().querySelector('.pe-loading-label')?.textContent?.trim()).toBe('Cargando…');
  });

  it('activa el overlay a pantalla completa con fullscreen', () => {
    setup({ fullscreen: true });
    expect(el().querySelector('.pe-loading--fullscreen')).not.toBeNull();
    setup({ fullscreen: false });
    expect(el().querySelector('.pe-loading--fullscreen')).toBeNull();
    expect(el().querySelector('.pe-loading--block')).not.toBeNull();
  });
});
