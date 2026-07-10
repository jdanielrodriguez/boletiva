import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { SeatManagerPage } from './seat-manager.page';

describe('SeatManagerPage (vista de asientos a página completa)', () => {
  let fixture: ComponentFixture<SeatManagerPage>;
  let queryParams: Record<string, string> = {};

  async function setup(api: Record<string, unknown> = {}, qp: Record<string, string> = {}) {
    queryParams = qp;
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: PromoterEventsApi,
          useValue: {
            get: () => of({ id: 'e1', name: 'Show', status: 'draft', media: [] }),
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

  it('evento publicado → asientos en solo lectura', async () => {
    await setup({ get: () => of({ id: 'e1', name: 'Show', status: 'published', media: [] }) });
    expect(fixture.componentInstance['readonly']()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seat-readonly-note"]')).not.toBeNull();
  });

  it('evento inexistente muestra el estado not-found', async () => {
    await setup({ get: () => throwError(() => new Error('404')) });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seat-notfound"]')).not.toBeNull();
  });
});
