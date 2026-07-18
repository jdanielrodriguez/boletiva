import { Component, signal } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideI18nTesting } from '../../core/i18n/testing';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { ReportsMaintenanceGateComponent } from './reports-maintenance-gate.component';

/** Host que proyecta contenido dentro del gate para probar el switch. */
@Component({
  standalone: true,
  imports: [ReportsMaintenanceGateComponent],
  template: `<app-reports-maintenance-gate><p data-testid="child">contenido</p></app-reports-maintenance-gate>`,
})
class HostComponent {}

describe('ReportsMaintenanceGateComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const maintenance = signal(false);
  const refresh = jasmine.createSpy('refresh');

  async function setup(active: boolean) {
    maintenance.set(active);
    refresh.calls.reset();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: PublicConfigStore, useValue: { reportsMaintenance: maintenance.asReadonly(), refresh } },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector(sel);

  it('flag OFF → proyecta el contenido del dashboard (sin panel)', async () => {
    await setup(false);
    expect(q('[data-testid="child"]')).not.toBeNull();
    expect(q('[data-testid="reports-maintenance"]')).toBeNull();
  });

  it('flag ON → muestra el panel de mantenimiento (oculta el contenido)', async () => {
    await setup(true);
    expect(q('[data-testid="reports-maintenance"]')).not.toBeNull();
    expect(q('[data-testid="child"]')).toBeNull();
  });

  it('reactivo: al activar el flag en caliente cambia a mantenimiento sin recrear', async () => {
    await setup(false);
    expect(q('[data-testid="child"]')).not.toBeNull();
    maintenance.set(true);
    fixture.detectChanges();
    expect(q('[data-testid="reports-maintenance"]')).not.toBeNull();
    expect(q('[data-testid="child"]')).toBeNull();
  });
});
