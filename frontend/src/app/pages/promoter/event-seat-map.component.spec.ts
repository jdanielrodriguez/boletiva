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

  // Aísla la preferencia persistida (orden/disposición) entre tests.
  beforeEach(() => localStorage.clear());

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

  // --- v3.7: reorden + disposición ---
  const TWO = [
    [
      { id: 'l1', name: 'VIP', kind: 'seated' },
      { id: 'l2', name: 'Platea', kind: 'seated' },
    ],
    {
      l1: [{ id: 's1', label: 'A1', x: 10, y: 10, status: 'available' }],
      l2: [{ id: 's3', label: 'B1', x: 10, y: 10, status: 'available' }],
    },
  ] as const;

  it('reordenar: moveDown cambia el orden de las localidades', async () => {
    localStorage.clear();
    await setup(TWO[0] as never, TWO[1] as never);
    const c = fixture.componentInstance as unknown as {
      order: () => string[];
      moveDown: (id: string) => void;
      clusters: () => { id: string }[];
    };
    expect(c.order()).toEqual(['l1', 'l2']);
    c.moveDown('l1');
    fixture.detectChanges();
    expect(c.order()).toEqual(['l2', 'l1']);
    // Los cúmulos también quedan en el nuevo orden.
    expect(c.clusters().map((x) => x.id)).toEqual(['l2', 'l1']);
  });

  it('reordenar: moveUp en el primero no hace nada (borde)', async () => {
    localStorage.clear();
    await setup(TWO[0] as never, TWO[1] as never);
    const c = fixture.componentInstance as unknown as { order: () => string[]; moveUp: (id: string) => void; isFirst: (id: string) => boolean };
    expect(c.isFirst('l1')).toBe(true);
    c.moveUp('l1');
    expect(c.order()).toEqual(['l1', 'l2']);
  });

  it('alternar disposición horizontal↔vertical recoloca los offsets', async () => {
    localStorage.clear();
    await setup(TWO[0] as never, TWO[1] as never);
    const c = fixture.componentInstance as unknown as {
      layout: () => string;
      toggleLayout: () => void;
      clusters: () => { offsetX: number; offsetY: number }[];
    };
    // Horizontal: lado a lado → el segundo tiene offsetX > 0 y offsetY = 0.
    expect(c.layout()).toBe('horizontal');
    let cl = c.clusters();
    expect(cl[1].offsetX).toBeGreaterThan(0);
    expect(cl[1].offsetY).toBe(0);
    c.toggleLayout();
    fixture.detectChanges();
    // Vertical: apiladas → ambos con offsetX = 0 y el segundo con offsetY > 0.
    expect(c.layout()).toBe('vertical');
    cl = c.clusters();
    expect(cl[0].offsetX).toBe(0);
    expect(cl[1].offsetX).toBe(0);
    expect(cl[1].offsetY).toBeGreaterThan(0);
  });

  it('persiste la preferencia en localStorage por evento', async () => {
    localStorage.clear();
    await setup(TWO[0] as never, TWO[1] as never);
    const c = fixture.componentInstance as unknown as { moveDown: (id: string) => void; toggleLayout: () => void };
    c.moveDown('l1');
    c.toggleLayout();
    fixture.detectChanges();
    const raw = localStorage.getItem('pe.combinedMap.e1');
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!) as { order: string[]; layout: string };
    expect(saved.order).toEqual(['l2', 'l1']);
    expect(saved.layout).toBe('vertical');
  });
});
