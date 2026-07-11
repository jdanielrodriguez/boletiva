import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HallsApi } from '../../core/api/halls.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { HallsPage } from './halls.page';

const HALLS = [
  { id: 'h1', name: 'Teatro', city: 'Guatemala', address: 'Zona 1', lat: 14.6, lng: -90.5, notes: null, seatTemplateId: null, status: 'published', createdAt: '', updatedAt: '' },
  { id: 'h2', name: 'Salón Draft', city: 'Antigua', address: null, lat: null, lng: null, notes: null, seatTemplateId: null, status: 'draft', createdAt: '', updatedAt: '' },
];

describe('HallsPage (v3.7)', () => {
  let fixture: ComponentFixture<HallsPage>;
  let el: HTMLElement;
  let toasts: ToastService;

  async function setup(api: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        {
          provide: HallsApi,
          useValue: {
            listAll: () => of(HALLS),
            create: () => of(HALLS[0]),
            update: () => of(HALLS[0]),
            remove: () => of({}),
            publish: () => of({ ...HALLS[1], status: 'published' }),
            unpublish: () => of({ ...HALLS[0], status: 'draft' }),
            ...api,
          } as unknown as HallsApi,
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(HallsPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);

  it('lista todos los salones (draft + publicados)', async () => {
    await setup();
    expect(el.querySelector('[data-testid="halls-list"]')?.textContent).toContain('Teatro');
    expect(el.querySelector('[data-testid="halls-list"]')?.textContent).toContain('Salón Draft');
  });

  it('error de carga muestra toast', async () => {
    await setup({ listAll: () => throwError(() => new Error('x')) });
    expect(lastToast()?.kind).toBe('error');
  });

  it('filtra por estado (solo borradores)', async () => {
    await setup();
    const inst = fixture.componentInstance as unknown as { setStatus: (v: string) => void; filtered: () => { id: string }[] };
    inst.setStatus('draft');
    expect(inst.filtered().length).toBe(1);
    expect(inst.filtered()[0].id).toBe('h2');
  });

  it('busca por nombre/ciudad', async () => {
    await setup();
    const inst = fixture.componentInstance as unknown as { setSearch: (v: string) => void; filtered: () => { id: string }[] };
    inst.setSearch('antigua');
    expect(inst.filtered().length).toBe(1);
    expect(inst.filtered()[0].id).toBe('h2');
  });

  it('guardar como borrador llama create con status draft', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(HALLS[0]));
    await setup({ create });
    const inst = fixture.componentInstance as unknown as {
      newHall: () => void; patch: (k: string, v: unknown) => void; save: (p?: boolean) => void;
    };
    inst.newHall();
    inst.patch('name', 'Nuevo Salón');
    inst.save(false);
    expect(create).toHaveBeenCalled();
    expect((create.calls.mostRecent().args[0] as { status: string }).status).toBe('draft');
  });

  it('guardar y publicar llama create con status published', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(HALLS[0]));
    await setup({ create });
    const inst = fixture.componentInstance as unknown as {
      newHall: () => void; patch: (k: string, v: unknown) => void; save: (p?: boolean) => void;
    };
    inst.newHall();
    inst.patch('name', 'Nuevo Salón');
    inst.save(true);
    expect((create.calls.mostRecent().args[0] as { status: string }).status).toBe('published');
  });

  it('publicar/despublicar llaman al API', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(HALLS[1]));
    const unpublish = jasmine.createSpy('u').and.returnValue(of(HALLS[0]));
    await setup({ publish, unpublish });
    const inst = fixture.componentInstance as unknown as { publish: (h: unknown) => void; unpublish: (h: unknown) => void };
    inst.publish(HALLS[1]);
    expect(publish).toHaveBeenCalledWith('h2');
    inst.unpublish(HALLS[0]);
    expect(unpublish).toHaveBeenCalledWith('h1');
  });

  it('eliminar pide confirmación y llama remove', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of({}));
    await setup({ remove });
    const inst = fixture.componentInstance as unknown as {
      askRemove: (h: unknown) => void; onConfirmAccept: () => void;
    };
    inst.askRemove(HALLS[0]);
    inst.onConfirmAccept();
    expect(remove).toHaveBeenCalledWith('h1');
  });

  it('guardar sin nombre → warning y no llama create', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(HALLS[0]));
    await setup({ create });
    const inst = fixture.componentInstance as unknown as { newHall: () => void; save: (p?: boolean) => void };
    inst.newHall();
    inst.save(false);
    expect(create).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });
});
