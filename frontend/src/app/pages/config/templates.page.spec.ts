import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { TemplatesPage } from './templates.page';

const base = { layoutJson: {}, params: { rows: 5, cols: 10 }, createdAt: '', updatedAt: '' };
const TEMPLATES = [
  { id: 't1', name: 'Filas', kind: 'rows', isBuiltIn: true, status: 'published', hidden: false, disabled: false, ...base, layoutJson: { icon: '<svg></svg>' } },
  { id: 't2', name: 'Custom draft', kind: 'grid', isBuiltIn: false, status: 'draft', hidden: false, disabled: false, ...base },
  { id: 't3', name: 'Custom hidden', kind: 'grid', isBuiltIn: false, status: 'published', hidden: true, disabled: false, ...base },
  { id: 't4', name: 'Custom disabled', kind: 'grid', isBuiltIn: false, status: 'published', hidden: false, disabled: true, ...base },
];

describe('TemplatesPage (v3.8)', () => {
  let fixture: ComponentFixture<TemplatesPage>;
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
    fixture = TestBed.createComponent(TemplatesPage);
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
    setTab: (t: 'list' | 'dashboard') => void;
    tab: () => string;
    hasFilter: () => boolean;
    filtered: () => { id: string }[];
    publish: (t: unknown) => void;
    hide: (t: unknown) => void;
    disable: (t: unknown) => void;
    newTemplate: () => void;
    editTemplate: (t: unknown) => void;
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

  it('cambiar de pestaña resetea los filtros', async () => {
    await setup();
    inst().setStatus('disabled');
    inst().setTab('dashboard');
    expect(inst().tab()).toBe('dashboard');
    inst().setTab('list');
    expect(inst().hasFilter()).toBe(false);
    expect(inst().filtered().length).toBe(TEMPLATES.length);
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

  it('preview de una plantilla publicada abre el modal', async () => {
    await setup();
    inst().openPreview(TEMPLATES[0]);
    fixture.detectChanges();
    expect(inst().preview()).not.toBeNull();
    expect(el.querySelector('[data-testid="tpl-preview-modal"]')).not.toBeNull();
  });
});
