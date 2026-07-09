import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AdminApi } from '../../core/api/admin.api';
import { CategoriesApi } from '../../core/api/categories.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { ConfigPage } from './config.page';

const EVENTS = [
  { id: 'e1', name: 'Fiesta', status: 'published', startsAt: '2026-08-01T20:00:00Z', promoter: { firstName: 'Ana', lastName: 'P' }, _count: { localities: 2 } },
  { id: 'e2', name: 'Feria', status: 'draft', startsAt: '2026-08-01T18:00:00Z', promoter: { firstName: 'Leo', lastName: 'G' }, _count: { localities: 1 } },
];
const PROMOTERS = [
  { id: 'u1', email: 'p@x.com', firstName: 'Pia', lastName: 'R', roles: ['buyer'], promoterStatus: 'pending' },
];

describe('ConfigPage (F7)', () => {
  let fixture: ComponentFixture<ConfigPage>;
  let el: HTMLElement;
  let toasts: ToastService;

  async function setup(isAdmin: boolean, admin: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ToastService,
        {
          provide: AdminApi,
          useValue: {
            listAllEvents: () => of(EVENTS),
            listPromoters: () => of(PROMOTERS),
            approvePromoter: () => of({}),
            rejectPromoter: () => of({}),
            suspendPromoter: () => of({}),
            getRequireApproval: () => of({ requireApproval: true }),
            setRequireApproval: (v: boolean) => of({ requireApproval: v }),
            getDefaultPct: () => of({ defaultPct: 0.5 }),
            setDefaultPct: () => of({}),
            setPromoterPct: () => of({}),
            listGateways: () => of([{ id: 'g1', name: 'Sandbox', status: 'active', isPlatformDefault: true }]),
            ...admin,
          } as unknown as AdminApi,
        },
        { provide: SessionStore, useValue: { hasAnyRole: (r: string[]) => (isAdmin ? r.includes('admin') : r.includes('promoter')) } },
        // Deps de PromoterPanel (rama promotor):
        { provide: PromoterEventsApi, useValue: { mine: () => of([]) } },
        { provide: CategoriesApi, useValue: { list: () => of([]) } },
        { provide: InvitationsApi, useValue: { list: () => of([]) } },
      ],
    });
    fixture = TestBed.createComponent(ConfigPage);
    toasts = TestBed.inject(ToastService);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const lastToast = () => toasts.toasts().at(-1);
  const click = (testid: string) => {
    (el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('promotor: reutiliza el panel del promotor (no muestra tabs de admin)', async () => {
    await setup(false);
    expect(el.querySelector('app-promoter-panel')).not.toBeNull();
    // tab-sistema es exclusivo del panel admin de ConfigPage (no del panel promotor).
    expect(el.querySelector('[data-testid="tab-sistema"]')).toBeNull();
  });

  it('admin: muestra los eventos agrupados por fecha', async () => {
    await setup(true);
    const events = el.querySelector('[data-testid="admin-events"]');
    expect(events?.textContent).toContain('Fiesta');
    expect(events?.textContent).toContain('Feria');
    // e1 y e2 comparten fecha → un solo grupo.
    expect(events?.querySelectorAll('.date-group').length).toBe(1);
  });

  it('admin: pestaña promotores lista y aprueba', async () => {
    const approvePromoter = jasmine.createSpy('ap').and.returnValue(of({}));
    await setup(true, { approvePromoter });
    click('tab-promotores');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="promoters-list"]')?.textContent).toContain('p@x.com');
    click('promoter-approve');
    expect(approvePromoter).toHaveBeenCalledWith('u1');
    expect(lastToast()?.kind).toBe('success');
  });

  it('admin: pestaña sistema carga y alterna require-approval', async () => {
    const setRequireApproval = jasmine.createSpy('sra').and.returnValue(of({ requireApproval: false }));
    await setup(true, { setRequireApproval });
    click('tab-sistema');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="gateways-list"]')?.textContent).toContain('Sandbox');
    click('toggle-require-approval');
    expect(setRequireApproval).toHaveBeenCalledWith(false);
  });

  it('admin: guardar reparto por defecto inválido muestra warning', async () => {
    await setup(true);
    click('tab-sistema');
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance['saveDefaultPct']('2');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('admin: error al cargar eventos muestra toast', async () => {
    await setup(true, { listAllEvents: () => throwError(() => new Error('x')) });
    expect(lastToast()?.kind).toBe('error');
  });

  it('admin: rechazar y suspender promotor llaman al API', async () => {
    const rejectPromoter = jasmine.createSpy('r').and.returnValue(of({}));
    const suspendPromoter = jasmine.createSpy('s').and.returnValue(of({}));
    await setup(true, { rejectPromoter, suspendPromoter });
    fixture.componentInstance['reject']('u1');
    fixture.componentInstance['suspend']('u1');
    expect(rejectPromoter).toHaveBeenCalledWith('u1');
    expect(suspendPromoter).toHaveBeenCalledWith('u1');
  });

  it('admin: reparto de promotor válido llama al API; inválido → warning', async () => {
    const setPromoterPct = jasmine.createSpy('sp').and.returnValue(of({}));
    await setup(true, { setPromoterPct });
    fixture.componentInstance['setPromoterPct']('u1', '0.3');
    expect(setPromoterPct).toHaveBeenCalledWith('u1', 0.3);
    fixture.componentInstance['setPromoterPct']('u1', '5');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('admin: guardar reparto por defecto válido persiste', async () => {
    const setDefaultPct = jasmine.createSpy('sd').and.returnValue(of({}));
    await setup(true, { setDefaultPct });
    fixture.componentInstance['saveDefaultPct']('0.4');
    expect(setDefaultPct).toHaveBeenCalledWith(0.4);
    expect(lastToast()?.kind).toBe('success');
  });

  it('admin: cambiar filtro de promotores recarga la lista', async () => {
    const listPromoters = jasmine.createSpy('lp').and.returnValue(of(PROMOTERS));
    await setup(true, { listPromoters });
    fixture.componentInstance['promoterFilter'].set('approved');
    fixture.componentInstance['loadPromoters']();
    expect(listPromoters).toHaveBeenCalledWith('approved');
  });

  it('admin: errores de acciones de promotor muestran toast', async () => {
    await setup(true, {
      approvePromoter: () => throwError(() => new Error('x')),
      listPromoters: () => throwError(() => new Error('x')),
    });
    fixture.componentInstance['approve']('u1');
    expect(lastToast()?.kind).toBe('error');
    fixture.componentInstance['loadPromoters']();
    expect(lastToast()?.kind).toBe('error');
  });
});
