import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import { SeatEditorComponent } from './seat-editor.component';

describe('SeatEditorComponent (editor de asientos)', () => {
  let fixture: ComponentFixture<SeatEditorComponent>;
  let bulkSeats: jasmine.Spy;
  let deleteSeats: jasmine.Spy;

  async function setup(): Promise<void> {
    bulkSeats = jasmine.createSpy('bulkSeats').and.returnValue(of({ created: 0, capacity: 0 }));
    deleteSeats = jasmine.createSpy('deleteSeats').and.returnValue(of({ deleted: 0, capacity: 0 }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: PromoterEventsApi,
          useValue: { seats: () => of([]), bulkSeats, deleteSeats } as unknown as PromoterEventsApi,
        },
        {
          provide: ToastService,
          useValue: {
            success: () => undefined,
            error: () => undefined,
            info: () => undefined,
            warning: () => undefined,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SeatEditorComponent);
    fixture.componentRef.setInput('localityId', 'l1');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const inst = () => fixture.componentInstance as unknown as {
    draft: () => unknown[];
    dirty: () => boolean;
    seatCount: () => number;
    applyTemplate: (id: string) => void;
    applyGenerator: (id: string) => void;
    generate: () => void;
    rows: { set: (n: number) => void };
    cols: { set: (n: number) => void };
    perTable: { set: (n: number) => void };
    save: () => void;
    mode: () => string;
    setMode: (m: string) => void;
    showGenerator: { set: (v: boolean) => void } & (() => boolean);
    toggleGenerator: () => void;
    generatorSearch: { set: (v: string) => void };
    filteredGenerators: () => { id: string }[];
    filteredTemplates: () => { id: string }[];
    onDocumentClick: (ev: Event) => void;
  };

  it('aplica una plantilla → llena el borrador y marca cambios sin guardar', async () => {
    await setup();
    inst().applyTemplate('rows');
    expect(inst().seatCount()).toBe(96); // 8 filas × 12
    expect(inst().dirty()).toBe(true);
  });

  it('generar cuadrícula 50×100 (bug corregido) produce 5000 asientos en el borrador', async () => {
    await setup();
    inst().rows.set(50);
    inst().cols.set(100);
    inst().generate();
    expect(inst().seatCount()).toBe(5000);
  });

  it('guardar persiste el borrador vía bulkSeats', async () => {
    await setup();
    inst().applyTemplate('rows');
    inst().save();
    expect(bulkSeats).toHaveBeenCalledWith('l1', jasmine.any(Array));
    expect(bulkSeats.calls.mostRecent().args[1].length).toBe(96);
  });

  it('cambia de herramienta (mover/agregar/línea/eliminar)', async () => {
    await setup();
    expect(inst().mode()).toBe('move');
    inst().setMode('add');
    expect(inst().mode()).toBe('add');
    inst().setMode('line');
    expect(inst().mode()).toBe('line');
    inst().setMode('delete');
    expect(inst().mode()).toBe('delete');
  });

  it('genera mesas con asientos-por-mesa configurable', async () => {
    await setup();
    inst().rows.set(3); // 3 mesas
    inst().perTable.set(6);
    inst().applyGenerator('tables');
    expect(inst().seatCount()).toBe(18);
    expect(inst().dirty()).toBe(true);
  });

  it('genera línea (cols asientos en una fila)', async () => {
    await setup();
    inst().cols.set(12);
    inst().applyGenerator('line');
    expect(inst().seatCount()).toBe(12);
  });

  it('el buscador filtra generadores y plantillas del menú', async () => {
    await setup();
    inst().generatorSearch.set('mesa');
    expect(inst().filteredGenerators().some((g) => g.id === 'tables')).toBe(true);
    expect(inst().filteredGenerators().some((g) => g.id === 'grid')).toBe(false);
    inst().generatorSearch.set('teatro');
    expect(inst().filteredTemplates().some((t) => t.id === 'theater')).toBe(true);
  });

  it('el menú "Generar" se cierra al hacer click fuera del contenedor', async () => {
    await setup();
    inst().showGenerator.set(true);
    // Click fuera (un nodo suelto no contenido en el wrap del editor).
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    inst().onDocumentClick({ target: outside } as unknown as Event);
    expect(inst().showGenerator()).toBe(false);
    outside.remove();
  });
});
