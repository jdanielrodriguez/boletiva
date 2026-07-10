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

  let queryParams: Record<string, string> = {};

  async function setup(api: Record<string, unknown> = {}, qp: Record<string, string> = {}) {
    queryParams = qp;
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
            quote: () => of({ quote: { net: '100.00', platformFee: '10.00', gatewayFee: '6.48', iva: '13.20', serviceFee: '29.68', total: '129.68' } }),
            ...api,
          } as unknown as PromoterEventsApi,
        },
        { provide: CategoriesApi, useValue: { list: () => of([]) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => 'e1' },
              queryParamMap: { get: (k: string) => queryParams[k] ?? null },
            },
          },
        },
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

  it('guardar datos NO envía endsAt (se autocalcula en backend)', async () => {
    const update = jasmine.createSpy('u').and.returnValue(of(EVENT));
    await setup({ update });
    fixture.componentInstance['saveData']();
    const arg = update.calls.mostRecent().args[1] as Record<string, unknown>;
    expect('endsAt' in arg).toBe(false);
  });

  it('preview de precio: teclear el neto cotiza con DEBOUNCE (~300ms) y muestra el desglose', async () => {
    const quote = jasmine
      .createSpy('q')
      .and.returnValue(of({ quote: { net: '100.00', platformFee: '10.00', gatewayFee: '6.48', iva: '13.20', serviceFee: '29.68', total: '129.68' } }));
    await setup({ quote });
    const c = fixture.componentInstance as unknown as { onNetChange: (v: number) => void };
    c.onNetChange(100);
    expect(quote).not.toHaveBeenCalled(); // aún no: espera el debounce
    await new Promise((r) => setTimeout(r, 400)); // supera los 300ms del debounce
    expect(quote).toHaveBeenCalledWith(100);
    fixture.detectChanges();
    expect(fixture.componentInstance['pricePreview']()?.total).toBe('129.68');
  });

  it('back-link vuelve a la consola cuando el origen es admin (?from=admin)', async () => {
    await setup({}, { from: 'admin' });
    expect(fixture.componentInstance['backLink']()).toBe('/configuracion');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="back-link"]')?.getAttribute('href')).toBe('/configuracion');
  });

  it('abre el tab indicado por ?tab=cuentas', async () => {
    await setup({}, { tab: 'cuentas' });
    expect(fixture.componentInstance['tab']()).toBe('cuentas');
  });

  it('localidades: el buscador es opcional (toggle) y filtra por nombre', async () => {
    await setup({
      localities: () =>
        of([
          { id: 'l1', name: 'VIP', kind: 'seated' },
          { id: 'l2', name: 'General', kind: 'general' },
        ]),
    });
    const c = fixture.componentInstance as unknown as {
      locSearchOpen: () => boolean;
      locSearch: { set: (v: string) => void };
      filteredLocalities: () => { id: string }[];
      toggleLocSearch: () => void;
    };
    // Oculto por defecto.
    expect(c.locSearchOpen()).toBe(false);
    c.toggleLocSearch();
    expect(c.locSearchOpen()).toBe(true);
    c.locSearch.set('vip');
    fixture.detectChanges();
    expect(c.filteredLocalities().length).toBe(1);
    expect(c.filteredLocalities()[0].id).toBe('l1');
    // Cerrar el buscador limpia el término.
    c.toggleLocSearch();
    expect(c.filteredLocalities().length).toBe(2);
  });

  it('localidades: seated muestra "Administrar asientos"; general muestra la nota de aforo', async () => {
    await setup({
      localities: () =>
        of([
          { id: 'l1', name: 'VIP', kind: 'seated' },
          { id: 'l2', name: 'General', kind: 'general' },
        ]),
    });
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="loc-seats"]')?.textContent).toContain('Administrar asientos');
    expect(el.querySelector('[data-testid="loc-general-note"]')?.textContent).toContain('aforo');
  });

  it('localidades: "Administrar asientos" navega a la vista de asientos (no inline)', async () => {
    await setup({ localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated' }]) });
    const nav = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
    fixture.componentInstance['manageSeats']({ id: 'l1', name: 'VIP', kind: 'seated' } as never);
    expect(nav).toHaveBeenCalledWith(
      ['/promotor/eventos', 'e1', 'localidades', 'l1', 'asientos'],
      { queryParams: {} },
    );
  });

  it('localidades: como admin (?from=admin) la navegación a asientos preserva el origen', async () => {
    await setup({ localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated' }]) }, { from: 'admin' });
    const nav = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
    fixture.componentInstance['manageSeats']({ id: 'l1', name: 'VIP', kind: 'seated' } as never);
    expect(nav).toHaveBeenCalledWith(
      ['/promotor/eventos', 'e1', 'localidades', 'l1', 'asientos'],
      { queryParams: { from: 'admin' } },
    );
  });

  it('eliminar evento pide confirmación (modal) antes de borrar', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of(undefined));
    await setup({ remove });
    // Al eliminar con éxito navega al listado; se espía para no chocar con las rutas vacías.
    spyOn(fixture.componentInstance['router'], 'navigateByUrl').and.resolveTo(true);
    fixture.componentInstance['askRemove']();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(remove).not.toHaveBeenCalled();
    fixture.componentInstance['onConfirmAccept']();
    expect(remove).toHaveBeenCalled();
  });

  it('eliminar localidad pide confirmación antes de borrar', async () => {
    const removeLocality = jasmine.createSpy('rl').and.returnValue(of(undefined));
    await setup({ removeLocality, localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated' }]) });
    fixture.componentInstance['askRemoveLocality']({ id: 'l1', name: 'VIP', kind: 'seated' } as never);
    expect(removeLocality).not.toHaveBeenCalled();
    fixture.componentInstance['onConfirmAccept']();
    expect(removeLocality).toHaveBeenCalledWith('l1');
  });
});
