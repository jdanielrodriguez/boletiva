import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { MaintenancePageComponent } from './maintenance-page.component';

describe('MaintenancePageComponent', () => {
  let fixture: ComponentFixture<MaintenancePageComponent>;
  let el: HTMLElement;

  async function setup() {
    TestBed.configureTestingModule({
      providers: [...provideI18nTesting(), provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(MaintenancePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  it('muestra la página con título e icono, texto por defecto sin mensaje', async () => {
    await setup();
    expect(el.querySelector('[data-testid="maintenance-page"]')).not.toBeNull();
    expect(el.querySelector('.mnt-icon app-icon')).not.toBeNull();
    expect(el.textContent).toContain('mantenimiento');
    // Sin mensaje del backend → NO se renderiza el bloque de mensaje del backend.
    expect(el.querySelector('[data-testid="maintenance-message"]')).toBeNull();
  });

  it('muestra el mensaje del backend cuando viene', async () => {
    await setup();
    fixture.componentRef.setInput('message', 'Volvemos a las 3pm');
    fixture.detectChanges();
    await fixture.whenStable();
    const msg = el.querySelector('[data-testid="maintenance-message"]');
    expect(msg).not.toBeNull();
    expect(msg?.textContent).toContain('Volvemos a las 3pm');
  });
});
