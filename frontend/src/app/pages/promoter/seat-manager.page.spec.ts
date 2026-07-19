import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { SessionStore } from '../../core/auth/session.store';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { SeatManagerPage } from './seat-manager.page';

describe('SeatManagerPage (vista de asientos a página completa)', () => {
  let fixture: ComponentFixture<SeatManagerPage>;
  let queryParams: Record<string, string> = {};

  async function setup(
    api: Record<string, unknown> = {},
    qp: Record<string, string> = {},
    session: { id: string; roles: string[] } = { id: 'owner-1', roles: ['promoter'] },
  ) {
    queryParams = qp;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        provideRouter([]),
        {
          provide: SessionStore,
          useValue: {
            user: () => session as never,
            hasRole: (r: string) => session.roles.includes(r),
          },
        },
        {
          provide: PromoterEventsApi,
          useValue: {
            get: () => of({ id: 'e1', promoterId: 'owner-1', name: 'Show', status: 'draft', media: [] }),
            localities: () => of([{ id: 'l1', name: 'VIP', kind: 'seated' }]),
            seats: () => of([]),
            ...api,
          } as unknown as PromoterEventsApi,
        },
        {
          provide: SeatTemplatesApi,
          useValue: { list: () => of([]) } as unknown as SeatTemplatesApi,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: (k: string) => ({ eventId: 'e1', localityId: 'l1' })[k] ?? null },
              queryParamMap: { get: (k: string) => queryParams[k] ?? null },
            },
          },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(SeatManagerPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('muestra el encabezado con el evento y la localidad, y el editor de asientos', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Administrar asientos');
    expect(el.textContent).toContain('Show');
    expect(el.textContent).toContain('VIP');
    expect(el.querySelector('[data-testid="seat-editor"]')).not.toBeNull();
  });

  it('el back-link vuelve al editor en la pestaña Localidades', async () => {
    await setup();
    expect(fixture.componentInstance['backLink']()).toBe('/promotor/eventos/e1/editar');
    expect(fixture.componentInstance['backQuery']()).toEqual({ tab: 'localidades' });
  });

  it('preserva ?from=admin en el back-link', async () => {
    await setup({}, { from: 'admin' });
    expect(fixture.componentInstance['backQuery']()).toEqual({ tab: 'localidades', from: 'admin' });
  });

  it('dueño en evento PUBLICADO → SÍ puede editar asientos (v3.10 · GIV, sin gate por status)', async () => {
    await setup({ get: () => of({ id: 'e1', promoterId: 'owner-1', name: 'Show', status: 'published', media: [] }) });
    // El dueño edita SIEMPRE: el gate por status ya NO bloquea.
    expect(fixture.componentInstance['readonly']()).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seat-admin-locked"]')).toBeNull();
  });

  it('dueño en evento CONCLUIDO (endsAt pasado) → SOLO LECTURA (no edita un evento pasado)', async () => {
    await setup({
      get: () =>
        of({
          id: 'e1',
          promoterId: 'owner-1',
          name: 'Show',
          status: 'published',
          endsAt: '2020-01-01T00:00:00.000Z',
          media: [],
        }),
    });
    expect(fixture.componentInstance['isConcluded']()).toBe(true);
    expect(fixture.componentInstance['readonly']()).toBe(true);
  });

  it('admin NO dueño en evento PUBLICADO → bloqueado hasta desbloquear', async () => {
    await setup(
      { get: () => of({ id: 'e1', promoterId: 'owner-1', name: 'Show', status: 'published', media: [] }) },
      {},
      { id: 'admin-9', roles: ['admin'] },
    );
    expect(fixture.componentInstance['readonly']()).toBe(true);
  });

  it('admin NO dueño → bloqueado (solo lectura) por propiedad real', async () => {
    await setup({}, {}, { id: 'admin-9', roles: ['admin'] });
    expect(fixture.componentInstance['adminLocked']()).toBe(true);
    expect(fixture.componentInstance['readonly']()).toBe(true);
  });

  it('admin que ES el dueño → NO bloqueado', async () => {
    await setup({}, {}, { id: 'owner-1', roles: ['admin'] });
    expect(fixture.componentInstance['adminLocked']()).toBe(false);
    expect(fixture.componentInstance['readonly']()).toBe(false);
  });

  it('admin IMPERSONANDO al dueño → edita libre (session.user() es el promotor)', async () => {
    // Impersonación: /auth/me resuelve al promotor dueño → nunca bloqueado.
    await setup({}, {}, { id: 'owner-1', roles: ['promoter'] });
    expect(fixture.componentInstance['adminLocked']()).toBe(false);
    expect(fixture.componentInstance['readonly']()).toBe(false);
  });

  it('evento inexistente muestra el estado not-found', async () => {
    await setup({ get: () => throwError(() => new Error('404')) });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seat-notfound"]')).not.toBeNull();
  });

  // --- i18n: cambiar el idioma traduce los textos ---
  it('traduce los textos al inglés al cambiar el idioma', async () => {
    await setup();
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // "Administrar asientos" pasa a "Manage seats".
    expect(el.textContent).toContain('Manage seats');
  });
});
