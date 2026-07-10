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
          useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
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
    generate: () => void;
    rows: { set: (n: number) => void };
    cols: { set: (n: number) => void };
    save: () => void;
    mode: () => string;
    setMode: (m: string) => void;
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

  it('cambia de herramienta (mover/agregar/eliminar)', async () => {
    await setup();
    expect(inst().mode()).toBe('move');
    inst().setMode('add');
    expect(inst().mode()).toBe('add');
    inst().setMode('delete');
    expect(inst().mode()).toBe('delete');
  });
});
