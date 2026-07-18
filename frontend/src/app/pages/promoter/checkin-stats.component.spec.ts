import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import { CheckinStatsComponent } from './checkin-stats.component';
import { ValidatorsApi, type CheckinStats } from '../../core/api/validators.api';
import { provideI18nTesting } from '../../core/i18n/testing';

const STATS: CheckinStats = {
  eventId: 'ev-1',
  total: 3,
  checkedIn: 2,
  pending: 1,
  transferred: 0,
  revoked: 0,
  conflicts: 1,
  percent: 66.7,
  byLocality: [{ localityId: 'l1', name: 'General', total: 3, checkedIn: 2 }],
  byValidator: [{ operatorId: 'op1', email: 'v@x.com', name: 'Val', count: 2 }],
  recent: [{ serial: 'PEABC', locality: 'General', validator: 'v@x.com', at: '2028-01-01T00:00:00Z' }],
  updatedAt: '2028-01-01T00:00:00Z',
};

async function setup(ok = true): Promise<ComponentFixture<CheckinStatsComponent>> {
  const checkinStats = ok
    ? jasmine.createSpy().and.returnValue(of(STATS))
    : jasmine.createSpy().and.returnValue(throwError(() => new Error('x')));
  await TestBed.configureTestingModule({
    imports: [CheckinStatsComponent],
    providers: [provideZonelessChangeDetection(), provideI18nTesting(), { provide: ValidatorsApi, useValue: { checkinStats } }],
  }).compileComponents();
  const f = TestBed.createComponent(CheckinStatsComponent);
  f.componentRef.setInput('eventId', 'ev-1');
  f.detectChanges();
  await new Promise((r) => queueMicrotask(() => r(null)));
  f.detectChanges();
  return f;
}

describe('CheckinStatsComponent', () => {
  it('muestra el avance (%, ingresos, conflictos) y el desglose por validador', async () => {
    const f = await setup();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="checkin-percent"]')?.textContent).toContain('66.7');
    expect(el.querySelector('[data-testid="checkin-live"]')).not.toBeNull();
    expect(el.textContent).toContain('v@x.com'); // por validador
    expect(el.textContent).toContain('General'); // por localidad
  });

  it('si falla la carga inicial muestra error', async () => {
    const f = await setup(false);
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="checkin-stats-error"]')).not.toBeNull();
  });
});
