import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { CategoriesApi } from '../../core/api/categories.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { HallsApi } from '../../core/api/halls.api';
import { MediaApi } from '../../core/api/media.api';
import { ToastService } from '../../core/ui/toast.service';
import { SessionStore } from '../../core/auth/session.store';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { EventEditPage } from './event-edit.page';

/** Sesión de prueba: por defecto el promotor DUEÑO del evento (id 'owner-1'). */
function sessionMock(user: { id: string; roles: string[] }): SessionStore {
  return {
    user: () => user,
    hasRole: (r: string) => user.roles.includes(r),
  } as unknown as SessionStore;
}

const EVENT = {
  id: 'e1',
  promoterId: 'owner-1',
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
  // Con banner (cover) → publicable si además hay localidades OK.
  media: [{ kind: 'cover', url: 'http://x/cover.svg' }],
  localities: [],
};
// Localidad general con aforo → no exige asientos (publicable).
const OK_LOCS = [{ id: 'l1', name: 'General', kind: 'general', capacity: 10 }];

describe('EventEditPage (v3)', () => {
  let fixture: ComponentFixture<EventEditPage>;
  let toasts: ToastService;

  let queryParams: Record<string, string> = {};

  async function setup(
    api: Record<string, unknown> = {},
    qp: Record<string, string> = {},
    paramId: string | null = 'e1',
    session: { id: string; roles: string[] } = { id: 'owner-1', roles: ['promoter'] },
  ) {
    queryParams = qp;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        provideRouter([]),
        ToastService,
        { provide: SessionStore, useValue: sessionMock(session) },
        {
          provide: PromoterEventsApi,
          useValue: {
            get: () => of(EVENT),
            create: () => of(EVENT),
            update: () => of(EVENT),
            publish: () => of({ ...EVENT, status: 'published' }),
            cancel: () => of({ ...EVENT, status: 'cancelled' }),
            remove: () => of(undefined),
            localities: () => of(OK_LOCS),
            addLocality: () => of({ id: 'l2', name: 'GA', kind: 'general' }),
            removeLocality: () => of(undefined),
            generateBanner: () => of({ url: 'http://x/b.svg' }),
            activeGateways: () => of([{ id: 'g1', name: 'Sandbox' }]),
            settlement: () => of({ net: '0.00' }),
            seats: () => of([]),
            transactions: () => of({ items: [], nextCursor: null }),
            updateLocality: () => of({ id: 'l1' }),
            quote: () => of({ quote: { net: '100.00', platformFee: '10.00', gatewayFee: '6.48', iva: '13.20', serviceFee: '29.68', total: '129.68' } }),
            ...api,
          } as unknown as PromoterEventsApi,
        },
        { provide: CategoriesApi, useValue: { list: () => of([]) } },
        { provide: HallsApi, useValue: { list: () => of([]) } as unknown as HallsApi },
        {
          provide: MediaApi,
          useValue: { uploadBanner: () => of({ id: 'm1', key: 'k', kind: 'cover' }) } as unknown as MediaApi,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => paramId },
              queryParamMap: { get: (k: string) => queryParams[k] ?? null },
            },
          },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(EventEditPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const lastToast = () => toasts.toasts().at(-1);
  const inst = () => fixture.componentInstance as unknown as Record<string, () => unknown>;

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

  // --- Modo CREACIÓN (ruta /promotor/eventos/nuevo, sin id) ---
  it('modo nuevo: formulario en blanco, sin tabs y Publicar bloqueado', async () => {
    await setup({}, {}, null);
    expect(inst()['isNew']()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="new-badge"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="tab-localidades"]')).toBeNull(); // sin tabs hasta guardar
    expect(inst()['canPublish']()).toBe(false);
  });

  it('modo nuevo: Guardar llama create y navega a la vista de edición', async () => {
    const create = jasmine.createSpy('c').and.returnValue(of(EVENT));
    await setup({ create }, {}, null);
    const nav = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.componentInstance['d'].name.set('Mi evento');
    fixture.componentInstance['d'].startsAt.set('2028-08-15T20:00');
    fixture.componentInstance['saveData']();
    expect(create).toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(['/promotor/eventos', 'e1', 'editar'], jasmine.objectContaining({ replaceUrl: true }));
  });

  it('modo nuevo: Guardar sin nombre no llama create', async () => {
    const create = jasmine.createSpy('c').and.returnValue(of(EVENT));
    await setup({ create }, {}, null);
    fixture.componentInstance['d'].name.set('');
    fixture.componentInstance['saveData']();
    expect(create).not.toHaveBeenCalled();
  });

  // --- Gating de publicación ---
  it('publicar HABILITADO con banner + localidades ok', async () => {
    await setup();
    expect(inst()['canPublish']()).toBe(true);
    expect(inst()['publishBlock']()).toBeNull();
  });

  it('publicar HABILITADO con cover SIN url firmada (detalle gestionable) — no requiere recarga', async () => {
    // El detalle gestionable trae el cover por `key` pero SIN `url` firmada:
    // el gate debe reconocer el banner igual (bug: quedaba bloqueado tras subir).
    await setup({ get: () => of({ ...EVENT, media: [{ kind: 'cover', key: 'k1' }] }) });
    expect(inst()['hasBanner']()).toBe(true);
    expect(inst()['canPublish']()).toBe(true);
    expect(inst()['publishBlock']()).toBeNull();
  });

  it('subir banner: askPublish abre la modal (no la bloquea el estado del gate)', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of({ ...EVENT, status: 'published' }));
    // Reload tras subir devuelve el cover sin url (como el backend real).
    await setup({ publish, get: () => of({ ...EVENT, media: [{ kind: 'cover', key: 'k1' }] }) });
    fixture.componentInstance['askPublish']();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('publicar BLOQUEADO sin banner (mensaje pide agregar banner)', async () => {
    await setup({ get: () => of({ ...EVENT, media: [] }) });
    expect(inst()['canPublish']()).toBe(false);
    expect(String(inst()['publishBlock']())).toMatch(/banner/i);
  });

  it('publicar BLOQUEADO si una localidad seated no tiene asientos (nombra la localidad)', async () => {
    await setup({ localities: () => of([{ id: 'l9', name: 'Platea', kind: 'seated', capacity: 0 }]) });
    expect(inst()['canPublish']()).toBe(false);
    expect(String(inst()['publishBlock']())).toMatch(/Platea/);
  });

  it('publish() no llama al API si está bloqueado (avisa el motivo)', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of(EVENT));
    await setup({ publish, get: () => of({ ...EVENT, media: [] }) });
    fixture.componentInstance['publish']();
    expect(publish).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  // --- Localidades: patrón botón → form ---
  it('crear localidad: el form está plegado y se abre con el botón', async () => {
    await setup();
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="loc-add-form"]')).toBeNull();
    expect(el.querySelector('[data-testid="loc-add-toggle"]')).not.toBeNull();
    fixture.componentInstance['toggleLocForm']();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="loc-add-form"]')).not.toBeNull();
  });

  it('agregar localidad sin nombre no llama al API', async () => {
    const addLocality = jasmine.createSpy('a').and.returnValue(of({}));
    await setup({ addLocality });
    fixture.componentInstance['addLocality']();
    expect(addLocality).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('agregar localidad válida llama al API y cierra el form', async () => {
    const addLocality = jasmine.createSpy('a').and.returnValue(of({ id: 'l2' }));
    await setup({ addLocality });
    fixture.componentInstance['toggleLocForm']();
    fixture.componentInstance['locForm'].name.set('Nueva');
    fixture.componentInstance['addLocality']();
    expect(addLocality).toHaveBeenCalled();
    expect(inst()['showLocForm']()).toBe(false);
  });

  // --- Banner: subir + IA ---
  it('banner: el form de IA está oculto y se abre desde el desplegable', async () => {
    await setup();
    fixture.componentInstance['selectTab']('banner');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="bn-ai-form"]')).toBeNull();
    expect(el.querySelector('[data-testid="bn-ai-toggle"]')).not.toBeNull();
    fixture.componentInstance['toggleAiForm']();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="bn-ai-form"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="bn-generate"]')).not.toBeNull();
  });

  it('banner: elegir un archivo muestra PREVIEW y NO sube todavía', async () => {
    const uploadBanner = jasmine.createSpy('ub').and.returnValue(of({ id: 'm1', key: 'k', kind: 'cover' }));
    await setup({}, {}, 'e1');
    (fixture.componentInstance as unknown as { media: { uploadBanner: typeof uploadBanner } }).media = { uploadBanner };
    fixture.componentInstance['selectTab']('banner');
    const file = new File(['x'], 'banner.png', { type: 'image/png' });
    fixture.componentInstance['onBannerFile']({ target: { files: [file], value: '' } } as unknown as Event);
    fixture.detectChanges();
    // No sube; muestra el bloque de preview con Guardar/Cancelar (arriba del generar-IA).
    expect(uploadBanner).not.toHaveBeenCalled();
    expect(fixture.componentInstance['pendingBannerUrl']()).not.toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    const pending = el.querySelector('[data-testid="bn-preview-pending"]');
    const aiToggle = el.querySelector('[data-testid="bn-ai-toggle"]');
    expect(pending).not.toBeNull();
    expect(aiToggle).not.toBeNull();
    // La preview va ANTES del bloque "Generar con IA" en el DOM.
    expect(pending!.compareDocumentPosition(aiToggle!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('banner: Guardar el preview sube con MediaApi.uploadBanner y limpia el preview', async () => {
    const uploadBanner = jasmine.createSpy('ub').and.returnValue(of({ id: 'm1', key: 'k', kind: 'cover' }));
    await setup({}, {}, 'e1');
    (fixture.componentInstance as unknown as { media: { uploadBanner: typeof uploadBanner } }).media = { uploadBanner };
    const file = new File(['x'], 'banner.png', { type: 'image/png' });
    fixture.componentInstance['onBannerFile']({ target: { files: [file], value: '' } } as unknown as Event);
    fixture.componentInstance['saveBannerPreview']();
    expect(uploadBanner).toHaveBeenCalledWith('e1', file);
    expect(fixture.componentInstance['pendingBannerUrl']()).toBeNull();
    expect(fixture.componentInstance['bannerUrl']()).not.toBeNull();
  });

  it('banner: Cancelar el preview lo descarta sin subir', async () => {
    const uploadBanner = jasmine.createSpy('ub').and.returnValue(of({ id: 'm1', key: 'k', kind: 'cover' }));
    await setup({}, {}, 'e1');
    (fixture.componentInstance as unknown as { media: { uploadBanner: typeof uploadBanner } }).media = { uploadBanner };
    const file = new File(['x'], 'banner.png', { type: 'image/png' });
    fixture.componentInstance['onBannerFile']({ target: { files: [file], value: '' } } as unknown as Event);
    expect(fixture.componentInstance['pendingBannerUrl']()).not.toBeNull();
    fixture.componentInstance['cancelBannerPreview']();
    expect(fixture.componentInstance['pendingBannerUrl']()).toBeNull();
    expect(uploadBanner).not.toHaveBeenCalled();
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
    expect(quote).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 400));
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
          { id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 },
          { id: 'l2', name: 'General', kind: 'general', capacity: 10 },
        ]),
    });
    const c = fixture.componentInstance as unknown as {
      locSearchOpen: () => boolean;
      locSearch: { set: (v: string) => void };
      filteredLocalities: () => { id: string }[];
      toggleLocSearch: () => void;
    };
    expect(c.locSearchOpen()).toBe(false);
    c.toggleLocSearch();
    expect(c.locSearchOpen()).toBe(true);
    c.locSearch.set('vip');
    fixture.detectChanges();
    expect(c.filteredLocalities().length).toBe(1);
    expect(c.filteredLocalities()[0].id).toBe('l1');
    c.toggleLocSearch();
    expect(c.filteredLocalities().length).toBe(2);
  });

  it('localidades: seated muestra "Administrar asientos"; general muestra la nota de aforo', async () => {
    await setup({
      localities: () =>
        of([
          { id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 },
          { id: 'l2', name: 'General', kind: 'general', capacity: 10 },
        ]),
    });
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="loc-seats"]')?.textContent).toContain('Administrar asientos');
    expect(el.querySelector('[data-testid="loc-general-note"]')?.textContent).toContain('aforo');
  });

  it('localidades: "Administrar asientos" es un enlace a la vista de asientos (no inline)', async () => {
    await setup({ localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 }]) });
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="loc-seats"]');
    expect(link?.tagName.toLowerCase()).toBe('a');
    expect(link?.getAttribute('href')).toBe('/promotor/eventos/e1/localidades/l1/asientos');
    expect(fixture.componentInstance['seatsLink']({ id: 'l1' } as never)).toEqual([
      '/promotor/eventos',
      'e1',
      'localidades',
      'l1',
      'asientos',
    ]);
  });

  it('localidades: como admin (?from=admin) el enlace a asientos preserva el origen', async () => {
    await setup(
      { localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 }]) },
      { from: 'admin' },
    );
    expect(fixture.componentInstance['seatsQuery']()).toEqual({ from: 'admin' });
  });

  // --- v3.6: admin bloqueado puede VER el mapa (enlace habilitado) ---
  it('admin NO dueño (bloqueado): el enlace a asientos sigue presente (ver mapa)', async () => {
    await setup(
      { localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 }]) },
      {},
      'e1',
      { id: 'admin-9', roles: ['admin'] },
    );
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    expect(fixture.componentInstance['locked']()).toBe(true);
    const link = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="loc-seats"]');
    // Es un <a> (no un <button> deshabilitado por el fieldset) → clickable.
    expect(link?.tagName.toLowerCase()).toBe('a');
    expect(link?.getAttribute('href')).toBe('/promotor/eventos/e1/localidades/l1/asientos');
  });

  // --- v3.6: editar localidad oculta sus botones Editar / Administrar asientos ---
  it('editar una localidad oculta su enlace de asientos y su botón Editar', async () => {
    await setup({ localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 }]) });
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="loc-seats"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="loc-edit"]')).not.toBeNull();
    fixture.componentInstance['startEditLocality']({
      id: 'l1',
      name: 'VIP',
      kind: 'seated',
      capacity: 5,
    } as never);
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="loc-seats"]')).toBeNull();
    expect(el.querySelector('[data-testid="loc-edit"]')).toBeNull();
    // Al cancelar el form, los botones regresan.
    fixture.componentInstance['toggleLocForm']();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="loc-seats"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="loc-edit"]')).not.toBeNull();
  });

  // --- v3.6: mapa combinado (solo lectura) bajo las localidades ---
  it('localidades con asientos: muestra el bloque del mapa combinado con su toggle', async () => {
    await setup({ localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 }]) });
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="combined-map-block"]')).not.toBeNull();
    // Visible por defecto.
    expect(fixture.componentInstance['showCombinedMap']()).toBe(true);
    expect(el.querySelector('[data-testid="combined-map"]')).not.toBeNull();
    fixture.componentInstance['toggleCombinedMap']();
    fixture.detectChanges();
    expect(fixture.componentInstance['showCombinedMap']()).toBe(false);
    expect(el.querySelector('[data-testid="combined-map"]')).toBeNull();
  });

  it('sin localidades seated: no se muestra el bloque del mapa combinado', async () => {
    await setup({ localities: () => of([{ id: 'l1', name: 'General', kind: 'general', capacity: 10 }]) });
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="combined-map-block"]')).toBeNull();
  });

  // --- v3.6: tab Cuentas con tabla de transacciones ---
  it('tab Cuentas: carga y muestra la tabla de transacciones, con enlace al detalle', async () => {
    const transactions = jasmine.createSpy('tx').and.returnValue(
      of({
        items: [
          {
            id: 'o1',
            buyerName: 'Ana López',
            buyerEmail: 'ana@x.com',
            status: 'paid',
            total: '129.68',
            currency: 'GTQ',
            itemCount: 2,
            localities: ['VIP'],
            createdAt: '2026-07-01T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    );
    await setup({ transactions });
    const nav = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
    fixture.componentInstance['selectTab']('cuentas');
    fixture.detectChanges();
    expect(transactions).toHaveBeenCalledWith('e1', undefined, 100);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="tx-table"]')).not.toBeNull();
    const row = el.querySelector('[data-testid="tx-row"]') as HTMLElement;
    expect(row?.textContent).toContain('Ana López');
    row.click();
    expect(nav).toHaveBeenCalledWith(['/cuenta/transaccion', 'o1']);
  });

  it('tab Cuentas sin transacciones muestra el estado vacío', async () => {
    await setup({ transactions: () => of({ items: [], nextCursor: null }) });
    fixture.componentInstance['selectTab']('cuentas');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="tx-empty"]')).not.toBeNull();
  });

  it('eliminar evento pide confirmación (modal) antes de borrar', async () => {
    const remove = jasmine.createSpy('r').and.returnValue(of(undefined));
    await setup({ remove });
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
    await setup({ removeLocality, localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated', capacity: 5 }]) });
    fixture.componentInstance['askRemoveLocality']({ id: 'l1', name: 'VIP', kind: 'seated' } as never);
    expect(removeLocality).not.toHaveBeenCalled();
    fixture.componentInstance['onConfirmAccept']();
    expect(removeLocality).toHaveBeenCalledWith('l1');
  });

  // --- v3.5: publicar con confirmación ---
  it('askPublish pide confirmación (modal) antes de publicar', async () => {
    const publish = jasmine.createSpy('p').and.returnValue(of({ ...EVENT, status: 'published' }));
    await setup({ publish, localities: () => of(OK_LOCS) });
    fixture.componentInstance['askPublish']();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
    fixture.componentInstance['onConfirmAccept']();
    expect(publish).toHaveBeenCalled();
  });

  // --- v3.5: desbloqueo de edición por DUEÑO real (no por ?from=admin) ---
  it('promotor dueño: NO bloquea', async () => {
    await setup();
    expect(fixture.componentInstance['locked']()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="lock-banner"]')).toBeNull();
  });

  it('admin que ES el dueño: NO bloquea', async () => {
    await setup({}, {}, 'e1', { id: 'owner-1', roles: ['admin'] });
    expect(fixture.componentInstance['locked']()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="lock-banner"]')).toBeNull();
  });

  it('admin NO dueño: arranca bloqueado y muestra el botón desbloquear', async () => {
    await setup({}, {}, 'e1', { id: 'admin-9', roles: ['admin'] });
    expect(fixture.componentInstance['locked']()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="lock-banner"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="unlock-btn"]')).not.toBeNull();
  });

  it('guardar bloqueado (admin no dueño) avisa y NO llama update', async () => {
    const update = jasmine.createSpy('u').and.returnValue(of(EVENT));
    await setup({ update }, {}, 'e1', { id: 'admin-9', roles: ['admin'] });
    fixture.componentInstance['saveData']();
    expect(update).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  // --- v3.7: barra superior del admin — Guardar deshabilitado hasta desbloquear ---
  it('admin bloqueado: el botón Guardar de la cabecera está DESHABILITADO', async () => {
    await setup({}, {}, 'e1', { id: 'admin-9', roles: ['admin'] });
    const save = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="save-draft-btn"]',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('admin: al desbloquear, el botón Guardar de la cabecera se HABILITA', async () => {
    const verifyEditUnlock = jasmine
      .createSpy('v')
      .and.returnValue(of({ token: 'tok', expiresAt: new Date(Date.now() + 300000).toISOString() }));
    await setup({ verifyEditUnlock }, {}, 'e1', { id: 'admin-9', roles: ['admin'] });
    const el = fixture.nativeElement as HTMLElement;
    expect((el.querySelector('[data-testid="save-draft-btn"]') as HTMLButtonElement).disabled).toBe(true);
    (fixture.componentInstance['unlockCode'] as unknown as { set: (v: string) => void }).set('123456');
    fixture.componentInstance['verifyUnlock']();
    fixture.detectChanges();
    expect((el.querySelector('[data-testid="save-draft-btn"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('promotor dueño: el botón Guardar de la cabecera está HABILITADO', async () => {
    await setup();
    const save = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="save-draft-btn"]',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('verificar OTP desbloquea (persiste) y deja de bloquear', async () => {
    const verifyEditUnlock = jasmine
      .createSpy('v')
      .and.returnValue(of({ token: 'tok', expiresAt: new Date(Date.now() + 300000).toISOString() }));
    await setup({ verifyEditUnlock }, {}, 'e1', { id: 'admin-9', roles: ['admin'] });
    (fixture.componentInstance['unlockCode'] as unknown as { set: (v: string) => void }).set('123456');
    fixture.componentInstance['verifyUnlock']();
    fixture.detectChanges();
    expect(verifyEditUnlock).toHaveBeenCalledWith('e1', '123456');
    expect(fixture.componentInstance['locked']()).toBe(false);
  });

  // --- v3.5: salón prefija dirección ---
  it('elegir salón prefija dirección y coordenadas', async () => {
    await setup();
    fixture.componentInstance['halls'].set([
      { id: 'h1', name: 'Teatro', address: 'Zona 1', lat: 14.6, lng: -90.5, city: 'GT', notes: null, seatTemplateId: null, status: 'published', createdAt: '', updatedAt: '' },
    ]);
    fixture.componentInstance['onHallChange']('h1');
    expect(fixture.componentInstance['d'].address()).toBe('Zona 1');
    expect(fixture.componentInstance['d'].lat()).toBe(14.6);
  });

  // --- v3.5: editar localidad (PATCH) ---
  it('editar localidad hace PATCH con updateLocality', async () => {
    const updateLocality = jasmine.createSpy('ul').and.returnValue(of({ id: 'l1' }));
    await setup({ updateLocality, localities: () => of([{ id: 'l1', name: 'VIP', kind: 'general', capacity: 5, desiredNet: 100 }]) });
    fixture.componentInstance['startEditLocality']({ id: 'l1', name: 'VIP', kind: 'general', capacity: 5, desiredNet: 100 } as never);
    expect(fixture.componentInstance['editingLoc']()).not.toBeNull();
    fixture.componentInstance['addLocality']();
    expect(updateLocality).toHaveBeenCalledWith('l1', jasmine.objectContaining({ name: 'VIP' }));
  });

  // --- v3.7: suspensión de evento ---
  it('publicado: muestra Suspender y Cancelar (no Publicar/Eliminar)', async () => {
    await setup({ get: () => of({ ...EVENT, status: 'published' }) });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="suspend-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cancel-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="publish-btn"]')).toBeNull();
    expect(el.querySelector('[data-testid="delete-btn"]')).toBeNull();
    expect(inst()['canEditLayout']()).toBe(false);
  });

  it('askSuspend abre la modal y al aceptar llama suspend()', async () => {
    const suspend = jasmine.createSpy('s').and.returnValue(of({ ...EVENT, status: 'suspended' }));
    await setup({ suspend, get: () => of({ ...EVENT, status: 'published' }) });
    fixture.componentInstance['askSuspend']();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    expect(suspend).not.toHaveBeenCalled();
    fixture.componentInstance['onConfirmAccept']();
    expect(suspend).toHaveBeenCalledWith('e1');
    expect(fixture.componentInstance['event']()?.status).toBe('suspended');
  });

  it('suspendido: es reconfigurable (canEditLayout) y ofrece Volver a publicar + Cancelar', async () => {
    await setup({ get: () => of({ ...EVENT, status: 'suspended' }) });
    expect(inst()['isSuspended']()).toBe(true);
    expect(inst()['canEditLayout']()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="publish-btn"]')?.textContent).toContain('Volver a publicar');
    expect(el.querySelector('[data-testid="cancel-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="suspended-note"]')).not.toBeNull();
    // Editable: en el tab localidades aparece el botón de agregar localidad.
    fixture.componentInstance['selectTab']('localidades');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="loc-add-toggle"]')).not.toBeNull();
  });

  it('aviso de boletos vendidos: banner visible en varias tabs con link a T&C (#reembolsos)', async () => {
    await setup({ get: () => of({ ...EVENT, status: 'suspended', soldTicketsCount: 3 }) });
    const el = fixture.nativeElement as HTMLElement;
    const warn = el.querySelector('[data-testid="sold-warning"]');
    expect(warn).not.toBeNull();
    expect(warn?.textContent).toContain('boletos vendidos');
    const link = el.querySelector('[data-testid="sold-warning-link"]');
    expect(link?.getAttribute('href')).toBe('/terminos#reembolsos');
    // Sigue visible al cambiar de tab (está fuera del switch de tabs).
    fixture.componentInstance['selectTab']('config');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="sold-warning"]')).not.toBeNull();
  });

  it('sin boletos vendidos: no se muestra el aviso', async () => {
    await setup({ get: () => of({ ...EVENT, status: 'published', soldTicketsCount: 0 }) });
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="sold-warning"]')).toBeNull();
  });

  // --- i18n: cambiar el idioma traduce los textos ---
  it('traduce los textos al inglés al cambiar el idioma', async () => {
    await setup();
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // La pestaña "Datos" pasa a "Details".
    expect(el.querySelector('[data-testid="tab-datos"]')?.textContent).toContain('Details');
  });
});
