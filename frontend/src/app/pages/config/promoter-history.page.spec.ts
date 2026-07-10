import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminApi } from '../../core/api/admin.api';
import { ToastService } from '../../core/ui/toast.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { PromoterHistoryPage } from './promoter-history.page';

const HISTORY = [
  { id: 'h1', promoterId: 'u2', adminId: 'a1', statusFrom: 'pending', statusTo: 'approved', reason: 'ok', createdAt: '2026-08-01T10:00:00Z' },
  { id: 'h2', promoterId: 'u2', adminId: 'a1', statusFrom: 'approved', statusTo: 'suspended', reason: 'incumplimiento', createdAt: '2026-08-05T12:00:00Z' },
  { id: 'h3', promoterId: 'u2', adminId: null, statusFrom: 'suspended', statusTo: 'approved', reason: null, createdAt: '2026-08-10T09:00:00Z' },
];

describe('PromoterHistoryPage (v3.6)', () => {
  let fixture: ComponentFixture<PromoterHistoryPage>;
  let el: HTMLElement;
  let toasts: ToastService;

  async function setup(promoterHistory: () => unknown = () => of(HISTORY)) {
    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: AdminApi, useValue: { promoterHistory } as unknown as AdminApi },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ id: 'u2' }),
              queryParamMap: convertToParamMap({ name: 'Leo G' }),
            },
          },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(PromoterHistoryPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);

  it('carga el historial y lo pinta en la tabla', async () => {
    await setup();
    expect(el.querySelector('[data-testid="ph-table"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="ph-row"]').length).toBe(3);
    expect(el.textContent).toContain('Leo G'); // nombre por query param
  });

  it('filtra por estado destino', async () => {
    await setup();
    const c = fixture.componentInstance as unknown as {
      statusFilter: { set: (v: string) => void };
      filtered: () => unknown[];
    };
    c.statusFilter.set('approved');
    fixture.detectChanges();
    expect(c.filtered().length).toBe(2);
  });

  it('busca por motivo', async () => {
    await setup();
    const c = fixture.componentInstance as unknown as {
      search: { set: (v: string) => void };
      filtered: () => { id: string }[];
    };
    c.search.set('incumplimiento');
    fixture.detectChanges();
    expect(c.filtered().length).toBe(1);
    expect(c.filtered()[0].id).toBe('h2');
  });

  it('ordena por fecha (desc por defecto; alterna a asc)', async () => {
    await setup();
    const c = fixture.componentInstance as unknown as {
      filtered: () => { id: string }[];
      toggleSort: () => void;
    };
    expect(c.filtered()[0].id).toBe('h3'); // más reciente primero
    c.toggleSort();
    fixture.detectChanges();
    expect(c.filtered()[0].id).toBe('h1'); // más antiguo primero
  });

  it('error al cargar → toast de error', async () => {
    await setup(() => throwError(() => new Error('x')));
    expect(lastToast()?.kind).toBe('error');
  });
});
