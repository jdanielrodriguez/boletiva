import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HallsApi } from '../../core/api/halls.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { HallsListComponent } from './halls-list.component';

const base = { notes: null, seatTemplateId: null, createdAt: '', updatedAt: '' };
const HALLS = [
  { id: 'h1', name: 'Teatro', city: 'Guatemala', address: 'Zona 1', lat: 14.6, lng: -90.5, status: 'published', hidden: false, disabled: false, ...base },
  { id: 'h2', name: 'Salón Draft', city: 'Antigua', address: null, lat: null, lng: null, status: 'draft', hidden: false, disabled: false, ...base },
  { id: 'h3', name: 'Salón Oculto', city: 'Xela', address: null, lat: null, lng: null, status: 'published', hidden: true, disabled: false, ...base },
  { id: 'h4', name: 'Salón Deshabilitado', city: 'Petén', address: null, lat: null, lng: null, status: 'published', hidden: false, disabled: true, ...base },
];

describe('HallsListComponent (v3.9 · B1 + v3.10 · FE-3)', () => {
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
            hide: () => of(HALLS[0]),
            unhide: () => of(HALLS[2]),
            disable: () => of(HALLS[0]),
            enable: () => of(HALLS[3]),
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
    list: {
      displayState: (h: unknown) => string;
      setStatus: (v: string) => void;
      setSearch: (v: string) => void;
      filtered: () => { id: string }[];
      hasFilter: () => boolean;
    };
    canDelete: (h: unknown) => boolean;
    canEditState: (h: unknown) => boolean;
    newHall: () => void;
    editHall: (h: unknown) => void;
    publish: (h: unknown) => void;
    unpublish: (h: unknown) => void;
    hide: (h: unknown) => void;
    disable: (h: unknown) => void;
    askPublish: (h: unknown) => void;
    askUnpublish: (h: unknown) => void;
    askDisable: (h: unknown) => void;
    askRemove: (h: unknown) => void;
    confirm: { accept: () => void };
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

  it('displayState prioriza disabled > hidden > status', async () => {
    await setup();
    expect(inst().list.displayState(HALLS[0])).toBe('published');
    expect(inst().list.displayState(HALLS[1])).toBe('draft');
    expect(inst().list.displayState(HALLS[2])).toBe('hidden');
    expect(inst().list.displayState(HALLS[3])).toBe('disabled');
  });

  it('filtra por estado (solo borradores)', async () => {
    await setup();
    inst().list.setStatus('draft');
    expect(inst().list.filtered().length).toBe(1);
    expect(inst().list.filtered()[0].id).toBe('h2');
  });

  it('filtra por estado deshabilitado', async () => {
    await setup();
    inst().list.setStatus('disabled');
    expect(inst().list.filtered().length).toBe(1);
    expect(inst().list.filtered()[0].id).toBe('h4');
  });

  it('busca por nombre/ciudad', async () => {
    await setup();
    inst().list.setSearch('antigua');
    expect(inst().list.filtered().length).toBe(1);
    expect(inst().list.filtered()[0].id).toBe('h2');
  });

  it('canEditState: draft y disabled sí; publicado-visible no', async () => {
    await setup();
    expect(inst().canEditState(HALLS[0])).toBe(false); // publicado visible
    expect(inst().canEditState(HALLS[1])).toBe(true); // draft
    expect(inst().canEditState(HALLS[2])).toBe(false); // publicado oculto
    expect(inst().canEditState(HALLS[3])).toBe(true); // deshabilitado
  });

  it('canDelete: solo deshabilitado', async () => {
    await setup();
    expect(inst().canDelete(HALLS[0])).toBe(false);
    expect(inst().canDelete(HALLS[2])).toBe(false); // oculto pero no deshabilitado
    expect(inst().canDelete(HALLS[3])).toBe(true);
  });

  it('nuevo salón navega a la página de creación', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().newHall();
    expect(nav).toHaveBeenCalledWith(['/configuracion/salones/nuevo']);
  });

  it('editar salón draft navega a la página de edición', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editHall(HALLS[1]);
    expect(nav).toHaveBeenCalledWith(['/configuracion/salones', 'h2', 'editar']);
  });

  it('editar salón publicado avisa y NO navega', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editHall(HALLS[0]);
    expect(nav).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('editar salón deshabilitado navega (paridad v3.10 · FE-3)', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editHall(HALLS[3]);
    expect(nav).toHaveBeenCalledWith(['/configuracion/salones', 'h4', 'editar']);
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

  it('hide/disable llaman al API', async () => {
    const hide = jasmine.createSpy('h').and.returnValue(of(HALLS[0]));
    const disable = jasmine.createSpy('d').and.returnValue(of(HALLS[0]));
    await setup({ hide, disable });
    inst().hide(HALLS[0]);
    expect(hide).toHaveBeenCalledWith('h1');
    inst().disable(HALLS[0]);
    expect(disable).toHaveBeenCalledWith('h1');
  });

  it('publicar pide confirmación y solo publica al aceptar (B3)', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(HALLS[1]));
    await setup({ publish });
    inst().askPublish(HALLS[1]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
    inst().confirm.accept();
    expect(publish).toHaveBeenCalledWith('h2');
  });

  it('desactivar pide confirmación y solo deshabilita al aceptar (B2)', async () => {
    const disable = jasmine.createSpy('d').and.returnValue(of(HALLS[0]));
    await setup({ disable });
    inst().askDisable(HALLS[0]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(disable).not.toHaveBeenCalled();
    inst().confirm.accept();
    expect(disable).toHaveBeenCalledWith('h1');
  });

  it('volver a borrador pide confirmación y solo despublica al aceptar (B2)', async () => {
    const unpublish = jasmine.createSpy('u').and.returnValue(of(HALLS[0]));
    await setup({ unpublish });
    inst().askUnpublish(HALLS[0]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(unpublish).not.toHaveBeenCalled();
    inst().confirm.accept();
    expect(unpublish).toHaveBeenCalledWith('h1');
  });

  it('askRemove bloquea si no es borrable (warning, sin API)', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of({}));
    await setup({ remove });
    inst().askRemove(HALLS[2]); // oculto, no deshabilitado
    expect(remove).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('askRemove permite eliminar un deshabilitado (confirma → API)', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of({}));
    await setup({ remove });
    inst().askRemove(HALLS[3]);
    inst().confirm.accept();
    expect(remove).toHaveBeenCalledWith('h4');
  });

  it('el botón Eliminar se muestra habilitado para un salón deshabilitado', async () => {
    await setup();
    inst().list.setStatus('disabled');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const del = el.querySelector('[data-testid="hall-remove"]') as HTMLButtonElement | null;
    expect(del).not.toBeNull();
    expect(del?.disabled).toBe(false);
  });

  it('muestra botón Editar para un salón deshabilitado', async () => {
    await setup();
    inst().list.setStatus('disabled');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="hall-edit"]')).not.toBeNull();
  });

  it('empty-state cuando no hay resultados de filtro', async () => {
    await setup();
    inst().list.setSearch('zzz-inexistente');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="halls-no-results"]')).not.toBeNull();
  });
});
