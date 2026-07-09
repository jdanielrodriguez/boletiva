import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import { EventEditPage } from './event-edit.page';

const EVENT = {
  id: 'e1',
  name: 'Show',
  status: 'draft',
  description: 'desc',
  categoryId: null,
  address: null,
  startsAt: '2028-08-15T02:00:00.000Z',
  endsAt: '2028-08-15T05:00:00.000Z',
  gatewayId: null,
  frozenGatewayId: null,
  ivaOnNet: true,
  absorbInstallmentCost: false,
  media: [],
  localities: [],
};

describe('EventEditPage (v3)', () => {
  let fixture: ComponentFixture<EventEditPage>;
  let toasts: ToastService;

  async function setup(api: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        {
          provide: PromoterEventsApi,
          useValue: {
            get: () => of(EVENT),
            update: () => of(EVENT),
            publish: () => of({ ...EVENT, status: 'published' }),
            cancel: () => of({ ...EVENT, status: 'cancelled' }),
            remove: () => of(undefined),
            localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated' }]),
            addLocality: () => of({ id: 'l2', name: 'GA', kind: 'general' }),
            removeLocality: () => of(undefined),
            generateBanner: () => of({ url: 'http://x/b.svg' }),
            activeGateways: () => of([{ id: 'g1', name: 'Sandbox' }]),
            settlement: () => of({ net: '0.00' }),
            ...api,
          } as unknown as PromoterEventsApi,
        },
        { provide: CategoriesApi, useValue: { list: () => of([]) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'e1' } } } },
      ],
    });
    fixture = TestBed.createComponent(EventEditPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const lastToast = () => toasts.toasts().at(-1);

  it('carga el evento y lo hidrata', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Show');
    expect(fixture.componentInstance['d'].name()).toBe('Show');
  });

  it('evento inexistente muestra el estado not-found', async () => {
    await setup({ get: () => throwError(() => new Error('404')) });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="edit-notfound"]')).not.toBeNull();
  });

  it('guardar datos llama update e incluye la config', async () => {
    const update = jasmine.createSpy('u').and.returnValue(of(EVENT));
    await setup({ update });
    fixture.componentInstance['saveData']();
    expect(update).toHaveBeenCalled();
    const arg = update.calls.mostRecent().args[1] as Record<string, unknown>;
    expect(arg['ivaOnNet']).toBe(true);
    expect(lastToast()?.kind).toBe('success');
  });

  it('guardar configuración llama update con pasarela/iva/cuotas', async () => {
    const update = jasmine.createSpy('u').and.returnValue(of(EVENT));
    await setup({ update });
    fixture.componentInstance['saveConfig']();
    expect(update).toHaveBeenCalled();
  });

  it('agregar localidad sin nombre no llama al API', async () => {
    const addLocality = jasmine.createSpy('a').and.returnValue(of({}));
    await setup({ addLocality });
    fixture.componentInstance['addLocality']();
    expect(addLocality).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('agregar localidad válida llama al API', async () => {
    const addLocality = jasmine.createSpy('a').and.returnValue(of({ id: 'l2' }));
    await setup({ addLocality });
    fixture.componentInstance['locForm'].name.set('Nueva');
    fixture.componentInstance['addLocality']();
    expect(addLocality).toHaveBeenCalled();
  });

  it('generar banner arma opciones y muestra la imagen', async () => {
    const generateBanner = jasmine.createSpy('g').and.returnValue(of({ url: 'http://x/b.svg' }));
    await setup({ generateBanner });
    fixture.componentInstance['banner'].prompt.set('neón');
    fixture.componentInstance['banner'].sampleImages.set('http://a.png, http://b.png');
    fixture.componentInstance['generateBanner']();
    expect(generateBanner).toHaveBeenCalledWith('e1', jasmine.objectContaining({ prompt: 'neón', sampleImages: ['http://a.png', 'http://b.png'] }));
    expect(fixture.componentInstance['bannerUrl']()).toContain('b.svg');
  });

  it('publicar y cancelar actualizan el estado', async () => {
    await setup();
    fixture.componentInstance['publish']();
    expect(fixture.componentInstance['event']()?.status).toBe('published');
    fixture.componentInstance['cancelEvent']();
    expect(fixture.componentInstance['event']()?.status).toBe('cancelled');
  });
});
