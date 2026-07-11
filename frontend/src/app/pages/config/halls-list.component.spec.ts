import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HallsApi } from '../../core/api/halls.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { HallsListComponent } from './halls-list.component';

const HALLS = [
  { id: 'h1', name: 'Teatro', city: 'Guatemala', address: 'Zona 1', lat: 14.6, lng: -90.5, notes: null, seatTemplateId: null, status: 'published', createdAt: '', updatedAt: '' },
  { id: 'h2', name: 'Salón Draft', city: 'Antigua', address: null, lat: null, lng: null, notes: null, seatTemplateId: null, status: 'draft', createdAt: '', updatedAt: '' },
];

describe('HallsListComponent (v3.9 · B1)', () => {
  let fixture: ComponentFixture<HallsListComponent>;
  let el: HTMLElement;
  let toasts: ToastService;

  async function setup(api: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        ToastService,
        {
          provide: HallsApi,
          useValue: {
            listAll: () => of(HALLS),
            remove: () => of({}),
            publish: () => of({ ...HALLS[1], status: 'published' }),
            unpublish: () => of({ ...HALLS[0], status: 'draft' }),
            ...api,
          } as unknown as HallsApi,
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(HallsListComponent);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);
  const inst = () => fixture.componentInstance as unknown as {
    setStatus: (v: string) => void;
    setSearch: (v: string) => void;
    filtered: () => { id: string }[];
    hasFilter: () => boolean;
    newHall: () => void;
    editHall: (h: unknown) => void;
    publish: (h: unknown) => void;
    unpublish: (h: unknown) => void;
    askPublish: (h: unknown) => void;
    askRemove: (h: unknown) => void;
    onConfirmAccept: () => void;
  };

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
    inst().setStatus('draft');
    expect(inst().filtered().length).toBe(1);
    expect(inst().filtered()[0].id).toBe('h2');
  });

  it('busca por nombre/ciudad', async () => {
    await setup();
    inst().setSearch('antigua');
    expect(inst().filtered().length).toBe(1);
    expect(inst().filtered()[0].id).toBe('h2');
  });

  it('nuevo salón navega a la página de creación', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().newHall();
    expect(nav).toHaveBeenCalledWith(['/configuracion/salones/nuevo']);
  });

  it('editar salón navega a la página de edición', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editHall(HALLS[1]);
    expect(nav).toHaveBeenCalledWith(['/configuracion/salones', 'h2', 'editar']);
  });

  it('publicar/despublicar llaman al API', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(HALLS[1]));
    const unpublish = jasmine.createSpy('u').and.returnValue(of(HALLS[0]));
    await setup({ publish, unpublish });
    inst().publish(HALLS[1]);
    expect(publish).toHaveBeenCalledWith('h2');
    inst().unpublish(HALLS[0]);
    expect(unpublish).toHaveBeenCalledWith('h1');
  });

  it('publicar pide confirmación y solo publica al aceptar (B3)', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(HALLS[1]));
    await setup({ publish });
    inst().askPublish(HALLS[1]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
    inst().onConfirmAccept();
    expect(publish).toHaveBeenCalledWith('h2');
  });

  it('eliminar pide confirmación y llama remove', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of({}));
    await setup({ remove });
    inst().askRemove(HALLS[0]);
    inst().onConfirmAccept();
    expect(remove).toHaveBeenCalledWith('h1');
  });

  it('empty-state cuando no hay resultados de filtro', async () => {
    await setup();
    inst().setSearch('zzz-inexistente');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="halls-no-results"]')).not.toBeNull();
  });
});
