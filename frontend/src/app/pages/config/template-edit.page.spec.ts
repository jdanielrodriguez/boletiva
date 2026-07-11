import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { TemplateEditPage } from './template-edit.page';

const base = { layoutJson: {}, createdAt: '', updatedAt: '' };
const CUSTOM = { id: 't2', name: 'Custom', kind: 'grid', isBuiltIn: false, status: 'draft', hidden: false, disabled: false, params: { rows: 5, cols: 10 }, ...base };
const BUILTIN = { id: 't1', name: 'Filas', kind: 'rows', isBuiltIn: true, status: 'published', hidden: false, disabled: false, params: { rows: 3, cols: 4 }, ...base };

describe('TemplateEditPage (v3.8)', () => {
  let fixture: ComponentFixture<TemplateEditPage>;
  let toasts: ToastService;

  async function setup(paramId: string | null, api: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', children: [] }]),
        ToastService,
        {
          provide: SeatTemplatesApi,
          useValue: {
            get: () => of(CUSTOM),
            create: () => of(CUSTOM),
            update: () => of(CUSTOM),
            ...api,
          } as unknown as SeatTemplatesApi,
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => paramId } } },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(TemplateEditPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const lastToast = () => toasts.toasts().at(-1);
  const inst = () => fixture.componentInstance as unknown as {
    isNew: boolean;
    builtIn: () => boolean;
    draft: () => { name: string; paramsJson: string } | null;
    patch: (k: string, v: unknown) => void;
    save: () => void;
  };

  it('modo nuevo: borrador en blanco', async () => {
    await setup(null);
    expect(inst().isNew).toBe(true);
    expect(inst().draft()?.name).toBe('');
  });

  it('modo edición: carga la plantilla por id', async () => {
    const get = jasmine.createSpy('g').and.returnValue(of(CUSTOM));
    await setup('t2', { get });
    expect(get).toHaveBeenCalledWith('t2');
    expect(inst().draft()?.name).toBe('Custom');
  });

  it('cargar built-in la marca de solo lectura y bloquea guardar', async () => {
    const update = jasmine.createSpy('up').and.returnValue(of(BUILTIN));
    await setup('t1', { get: () => of(BUILTIN), update });
    expect(inst().builtIn()).toBe(true);
    inst().save();
    expect(update).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('error al cargar muestra toast', async () => {
    await setup('t2', { get: () => throwError(() => new Error('x')) });
    expect(lastToast()?.kind).toBe('error');
  });

  it('guardar nuevo llama create y navega', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(CUSTOM));
    await setup(null, { create });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().patch('name', 'Nueva plantilla');
    inst().save();
    expect(create).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(['/configuracion'], { queryParams: { tab: 'plantillas' } });
  });

  it('JSON inválido → warning, no llama create', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(CUSTOM));
    await setup(null, { create });
    inst().patch('name', 'X plantilla');
    inst().patch('paramsJson', '{no-json');
    inst().save();
    expect(create).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('guardar sin nombre → warning', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(CUSTOM));
    await setup(null, { create });
    inst().patch('name', '');
    inst().save();
    expect(create).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });
});
