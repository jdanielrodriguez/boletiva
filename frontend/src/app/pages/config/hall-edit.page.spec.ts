import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HallsApi } from '../../core/api/halls.api';
import { ToastService } from '../../core/ui/toast.service';
import { provideI18nTesting, initI18nTesting } from '../../core/i18n/testing';
import { HallEditPage } from './hall-edit.page';

const HALL = {
  id: 'h1', name: 'Teatro', city: 'Guatemala', address: 'Zona 1', lat: 14.6, lng: -90.5,
  notes: null, seatTemplateId: null, status: 'draft', createdAt: '', updatedAt: '',
};

describe('HallEditPage (v3.8)', () => {
  let fixture: ComponentFixture<HallEditPage>;
  let toasts: ToastService;

  async function setup(paramId: string | null, api: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        // Ruta comodín: `save()` navega de vuelta a la lista tras guardar; sin una
        // ruta que empareje, `router.navigate` rechaza (NG04002) y deja una promesa
        // sin capturar que tumba el navegador de karma.
        provideRouter([{ path: '**', children: [] }]),
        ToastService,
        {
          provide: HallsApi,
          useValue: {
            get: () => of(HALL),
            create: () => of(HALL),
            update: () => of(HALL),
            ...api,
          } as unknown as HallsApi,
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => paramId } } },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(HallEditPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const lastToast = () => toasts.toasts().at(-1);
  const inst = () => fixture.componentInstance as unknown as {
    isNew: boolean;
    draft: () => { name: string; status: string } | null;
    patch: (k: string, v: unknown) => void;
    save: (p?: boolean) => void;
  };

  it('modo nuevo: arranca con borrador en blanco (status draft)', async () => {
    await setup(null);
    expect(inst().isNew).toBe(true);
    expect(inst().draft()?.name).toBe('');
    expect(inst().draft()?.status).toBe('draft');
  });

  it('modo edición: carga el salón por id', async () => {
    const get = jasmine.createSpy('g').and.returnValue(of(HALL));
    await setup('h1', { get });
    expect(get).toHaveBeenCalledWith('h1');
    expect(inst().isNew).toBe(false);
    expect(inst().draft()?.name).toBe('Teatro');
  });

  it('error al cargar muestra toast y estado de error', async () => {
    await setup('h1', { get: () => throwError(() => new Error('x')) });
    expect(lastToast()?.kind).toBe('error');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="hall-edit-error"]')).not.toBeNull();
  });

  it('guardar como borrador llama create con status draft y navega', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(HALL));
    await setup(null, { create });
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    inst().patch('name', 'Nuevo Salón');
    inst().save(false);
    expect((create.calls.mostRecent().args[0] as { status: string }).status).toBe('draft');
    expect(nav).toHaveBeenCalledWith(['/configuracion/salones']);
  });

  it('guardar y publicar llama create con status published', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(HALL));
    await setup(null, { create });
    inst().patch('name', 'Nuevo Salón');
    inst().save(true);
    expect((create.calls.mostRecent().args[0] as { status: string }).status).toBe('published');
  });

  it('edición guarda con update', async () => {
    const update = jasmine.createSpy('up').and.returnValue(of(HALL));
    await setup('h1', { update });
    inst().save(false);
    expect(update).toHaveBeenCalled();
    expect(update.calls.mostRecent().args[0]).toBe('h1');
  });

  it('guardar sin nombre → warning, no llama create', async () => {
    const create = jasmine.createSpy('cr').and.returnValue(of(HALL));
    await setup(null, { create });
    inst().save(false);
    expect(create).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });
});
