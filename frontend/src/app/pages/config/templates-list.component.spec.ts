import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { TemplatesListComponent } from './templates-list.component';

const base = { layoutJson: {}, params: { rows: 5, cols: 10 }, createdAt: '', updatedAt: '' };
const TEMPLATES = [
  { id: 't1', name: 'Filas', kind: 'rows', isBuiltIn: true, status: 'published', hidden: false, disabled: false, ...base, layoutJson: { icon: '<svg></svg>' } },
  { id: 't2', name: 'Custom draft', kind: 'grid', isBuiltIn: false, status: 'draft', hidden: false, disabled: false, ...base },
  { id: 't3', name: 'Custom hidden', kind: 'grid', isBuiltIn: false, status: 'published', hidden: true, disabled: false, ...base },
  { id: 't4', name: 'Custom disabled', kind: 'grid', isBuiltIn: false, status: 'published', hidden: false, disabled: true, ...base },
];

describe('TemplatesListComponent (v3.9 · B1)', () => {
  let fixture: ComponentFixture<TemplatesListComponent>;
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
          provide: SeatTemplatesApi,
          useValue: {
            listAll: () => of(TEMPLATES),
            remove: () => of({}),
            publish: () => of(TEMPLATES[1]),
            unpublish: () => of(TEMPLATES[1]),
            hide: () => of(TEMPLATES[1]),
            unhide: () => of(TEMPLATES[1]),
            disable: () => of(TEMPLATES[1]),
            enable: () => of(TEMPLATES[1]),
            ...api,
          } as unknown as SeatTemplatesApi,
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(TemplatesListComponent);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);
  const inst = () => fixture.componentInstance as unknown as {
    displayState: (t: unknown) => string;
    canDelete: (t: unknown) => boolean;
    setStatus: (v: string) => void;
    hasFilter: () => boolean;
    filtered: () => { id: string }[];
    publish: (t: unknown) => void;
    askPublish: (t: unknown) => void;
    hide: (t: unknown) => void;
    disable: (t: unknown) => void;
    newTemplate: () => void;
    editTemplate: (t: unknown) => void;
    canEditState: (t: unknown) => boolean;
    askRemove: (t: unknown) => void;
    onConfirmAccept: () => void;
    openPreview: (t: unknown) => void;
    preview: () => unknown;
  };

  it('lista todas las plantillas', async () => {
    await setup();
    const txt = el.querySelector('[data-testid="tpl-list"]')?.textContent;
    expect(txt).toContain('Filas');
    expect(txt).toContain('Custom draft');
  });

  it('error de carga muestra toast', async () => {
    await setup({ listAll: () => throwError(() => new Error('x')) });
    expect(lastToast()?.kind).toBe('error');
  });

  it('displayState prioriza disabled > hidden > status', async () => {
    await setup();
    expect(inst().displayState(TEMPLATES[0])).toBe('published');
    expect(inst().displayState(TEMPLATES[1])).toBe('draft');
    expect(inst().displayState(TEMPLATES[2])).toBe('hidden');
    expect(inst().displayState(TEMPLATES[3])).toBe('disabled');
  });

  it('filtra por estado deshabilitada', async () => {
    await setup();
    inst().setStatus('disabled');
    expect(inst().filtered().length).toBe(1);
    expect(inst().filtered()[0].id).toBe('t4');
  });

  it('canDelete: solo deshabilitada y no built-in', async () => {
    await setup();
    expect(inst().canDelete(TEMPLATES[0])).toBe(false); // built-in
    expect(inst().canDelete(TEMPLATES[1])).toBe(false); // habilitada
    expect(inst().canDelete(TEMPLATES[2])).toBe(false); // oculta pero no deshabilitada
    expect(inst().canDelete(TEMPLATES[3])).toBe(true); // deshabilitada
  });

  it('askRemove bloquea si no es borrable (warning, sin API)', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of({}));
    await setup({ remove });
    inst().askRemove(TEMPLATES[2]); // oculta, no deshabilitada
    expect(remove).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('askRemove permite eliminar una deshabilitada (confirma → API)', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of({}));
    await setup({ remove });
    inst().askRemove(TEMPLATES[3]);
    inst().onConfirmAccept();
    expect(remove).toHaveBeenCalledWith('t4');
  });

  it('el botón Eliminar se muestra habilitado para una plantilla deshabilitada', async () => {
    await setup();
    inst().setStatus('disabled');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const del = el.querySelector('[data-testid="tpl-remove"]') as HTMLButtonElement | null;
    expect(del).not.toBeNull();
    expect(del?.disabled).toBe(false);
  });

  it('nueva plantilla navega a la página de creación', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().newTemplate();
    expect(nav).toHaveBeenCalledWith(['/configuracion/plantillas/nuevo']);
  });

  it('editar built-in avisa y NO navega', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editTemplate(TEMPLATES[0]);
    expect(nav).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('editar custom draft navega a la página de edición', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editTemplate(TEMPLATES[1]);
    expect(nav).toHaveBeenCalledWith(['/configuracion/plantillas', 't2', 'editar']);
  });

  it('editar custom DESACTIVADA navega (paridad v3.10 · GII)', async () => {
    await setup();
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().editTemplate(TEMPLATES[3]);
    expect(nav).toHaveBeenCalledWith(['/configuracion/plantillas', 't4', 'editar']);
  });

  it('canEditState: draft y disabled sí; built-in y publicada-visible no', async () => {
    await setup();
    expect(inst().canEditState(TEMPLATES[0])).toBe(false); // built-in publicada
    expect(inst().canEditState(TEMPLATES[1])).toBe(true); // custom draft
    expect(inst().canEditState(TEMPLATES[2])).toBe(false); // custom publicada oculta
    expect(inst().canEditState(TEMPLATES[3])).toBe(true); // custom desactivada
  });

  it('muestra botón Editar para una plantilla desactivada', async () => {
    await setup();
    inst().setStatus('disabled');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const edit = el.querySelector('[data-testid="tpl-edit"]');
    expect(edit).not.toBeNull();
  });

  it('publish/hide/disable llaman al API', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(TEMPLATES[1]));
    const hide = jasmine.createSpy('h').and.returnValue(of(TEMPLATES[1]));
    const disable = jasmine.createSpy('d').and.returnValue(of(TEMPLATES[1]));
    await setup({ publish, hide, disable });
    inst().publish(TEMPLATES[1]);
    expect(publish).toHaveBeenCalledWith('t2');
    inst().hide(TEMPLATES[1]);
    expect(hide).toHaveBeenCalledWith('t2');
    inst().disable(TEMPLATES[1]);
    expect(disable).toHaveBeenCalledWith('t2');
  });

  it('publicar pide confirmación y solo publica al aceptar (B3)', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(TEMPLATES[1]));
    await setup({ publish });
    inst().askPublish(TEMPLATES[1]);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
    inst().onConfirmAccept();
    expect(publish).toHaveBeenCalledWith('t2');
  });

  it('preview de una plantilla publicada abre el modal', async () => {
    await setup();
    inst().openPreview(TEMPLATES[0]);
    fixture.detectChanges();
    expect(inst().preview()).not.toBeNull();
    expect(el.querySelector('[data-testid="tpl-preview-modal"]')).not.toBeNull();
  });
});
