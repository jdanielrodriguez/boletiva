import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import type { LocalityView } from '../../core/api/types';
import { EventSeatMapComponent } from './event-seat-map.component';

/**
 * Spec del mapa combinado (solo lectura): agrega los asientos de las localidades
 * `seated` en cúmulos y expone total + leyenda. No se afirma el render Konva (canvas
 * browser-only); se valida la lógica de datos.
 */
describe('EventSeatMapComponent (mapa combinado read-only)', () => {
  let fixture: ComponentFixture<EventSeatMapComponent>;

  async function setup(localities: Partial<LocalityView>[], seatsByLoc: Record<string, unknown[]>) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        {
          provide: PromoterEventsApi,
          useValue: {
            seats: (id: string) => of(seatsByLoc[id] ?? []),
          } as unknown as PromoterEventsApi,
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(EventSeatMapComponent);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.componentRef.setInput('localities', localities as LocalityView[]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const inst = () => fixture.componentInstance as unknown as Record<string, () => unknown>;

  it('junta los asientos de las localidades seated y cuenta el total', async () => {
    await setup(
      [
        { id: 'l1', name: 'VIP', kind: 'seated' },
        { id: 'l2', name: 'Platea', kind: 'seated' },
        { id: 'l3', name: 'General', kind: 'general' },
      ],
      {
        l1: [
          { id: 's1', label: 'A1', x: 10, y: 10, status: 'available' },
          { id: 's2', label: 'A2', x: 40, y: 10, status: 'available' },
        ],
        l2: [{ id: 's3', label: 'B1', x: 10, y: 10, status: 'available' }],
      },
    );
    // 2 cúmulos (solo seated con asientos), 3 asientos en total.
    expect((inst()['clusters']() as unknown[]).length).toBe(2);
    expect(inst()['totalSeats']()).toBe(3);
    const legend = inst()['legend']() as { name: string; count: number }[];
    expect(legend.map((l) => l.name)).toEqual(['VIP', 'Platea']);
    expect(legend[0].count).toBe(2);
  });

  it('sin localidades seated con asientos → estado vacío', async () => {
    await setup([{ id: 'l1', name: 'General', kind: 'general' }], {});
    expect((inst()['clusters']() as unknown[]).length).toBe(0);
    expect(fixture.nativeElement.querySelector('[data-testid="esm-empty"]')).not.toBeNull();
  });
});
