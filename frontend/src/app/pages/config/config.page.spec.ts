import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminApi } from '../../core/api/admin.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { ToastService } from '../../core/ui/toast.service';
import { ConfigPage } from './config.page';

const EVENTS = [
  { id: 'e1', name: 'Fiesta', status: 'published', startsAt: '2026-08-01T20:00:00Z', promoter: { firstName: 'Ana', lastName: 'P' }, _count: { localities: 2 } },
  { id: 'e2', name: 'Feria', status: 'draft', startsAt: '2026-08-02T18:00:00Z', promoter: { firstName: 'Leo', lastName: 'G' }, _count: { localities: 1 } },
];
const PROMOTERS = [
  { id: 'u1', email: 'p@x.com', firstName: 'Pia', lastName: 'R', roles: ['buyer'], promoterStatus: 'pending' },
  { id: 'u2', email: 'aprobado@x.com', firstName: 'Leo', lastName: 'G', roles: ['promoter'], promoterStatus: 'approved' },
];
const GATEWAYS = [
  { id: 'g1', name: 'Sandbox', provider: 'simulator', status: 'active', isPlatformDefault: true, feePct: '0.05', transactionFixedFee: '0.00', minCostSharePct: '0.00', installmentFixedFee: null, installmentRates: null },
  { id: 'g2', name: 'Recurrente', provider: 'recurrente', status: 'active', isPlatformDefault: false, feePct: '0.045', transactionFixedFee: '1.20', minCostSharePct: '0.00', installmentFixedFee: '2.00', installmentRates: { '3': 0.08 } },
];

describe('ConfigPage (v3, admin console)', () => {
  let fixture: ComponentFixture<ConfigPage>;
  let el: HTMLElement;
  let toasts: ToastService;

  async function setup(admin: Record<string, unknown> = {}, inv: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
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
            listGateways: () => of(GATEWAYS),
            updateGateway: () => of(GATEWAYS[1]),
            setGatewayStatus: () => of(GATEWAYS[1]),
            makeGatewayDefault: () => of(GATEWAYS[1]),
            unlockGateway: () => of({ sent: true }),
            createGateway: () => of(GATEWAYS[1]),
            promoterHistory: () => of([{ id: 'h1', promoterId: 'u2', adminId: 'a1', statusFrom: 'approved', statusTo: 'suspended', reason: 'motivo', createdAt: '2026-08-01T10:00:00Z' }]),
            ...admin,
          } as unknown as AdminApi,
        },
        {
          provide: InvitationsApi,
          useValue: {
            list: () => of([{ id: 'i1', email: 'a@b.com', status: 'pending' }]),
            create: () => of({ invitations: [{ id: 'i1', email: 'a@b.com', url: 'http://x/registro?token=t' }] }),
            revoke: () => of({ id: 'i1', status: 'revoked' }),
            ...inv,
          } as unknown as InvitationsApi,
        },
        { provide: PromoterEventsApi, useValue: { settlement: () => of({ net: '0.00' }) } },
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
  const selectTab = async (t: string) => {
    click(t);
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('muestra los eventos en un grid con su promotor', async () => {
    await setup();
    const events = el.querySelector('[data-testid="admin-events"]');
    expect(events?.textContent).toContain('Fiesta');
    expect(events?.textContent).toContain('Ana');
    expect(events?.querySelectorAll('[data-testid="ev-card"]').length).toBe(2);
  });

  it('error al cargar eventos muestra toast', async () => {
    await setup({ listAllEvents: () => throwError(() => new Error('x')) });
    expect(lastToast()?.kind).toBe('error');
  });

  it('promotores: lista, busca y aprueba (acción contextual)', async () => {
    const approvePromoter = jasmine.createSpy('ap').and.returnValue(of({}));
    await setup({ approvePromoter });
    await selectTab('tab-promotores');
    expect(el.querySelector('[data-testid="promoters-list"]')?.textContent).toContain('p@x.com');
    click('promoter-approve');
    expect(approvePromoter).toHaveBeenCalledWith('u1');
    expect(lastToast()?.kind).toBe('success');
  });

  it('promotores: el aprobado no muestra botón Aprobar', async () => {
    await setup({ listPromoters: () => of([PROMOTERS[1]]) });
    await selectTab('tab-promotores');
    expect(el.querySelector('[data-testid="promoter-approve"]')).toBeNull();
    expect(el.querySelector('[data-testid="promoter-suspend"]')).not.toBeNull();
  });

  it('promotores: búsqueda filtra por nombre/correo', async () => {
    await setup();
    await selectTab('tab-promotores');
    fixture.componentInstance['promoterSearch'].set('aprobado');
    fixture.detectChanges();
    expect(fixture.componentInstance['filteredPromoters']().length).toBe(1);
  });

  it('promotores: rechazar con nota; suspender por MODAL con motivo', async () => {
    const rejectPromoter = jasmine.createSpy('r').and.returnValue(of({}));
    const suspendPromoter = jasmine.createSpy('s').and.returnValue(of({}));
    await setup({ rejectPromoter, suspendPromoter });
    fixture.componentInstance['setNote']('u1', 'motivo');
    fixture.componentInstance['reject'](PROMOTERS[0] as never);
    expect(rejectPromoter).toHaveBeenCalledWith('u1', 'motivo');
    // Suspender abre modal → escribe motivo → confirma.
    fixture.componentInstance['openSuspend'](PROMOTERS[1] as never);
    fixture.componentInstance['suspendReason'].set('incumplimiento');
    fixture.componentInstance['confirmSuspend']();
    expect(suspendPromoter).toHaveBeenCalledWith('u2', 'incumplimiento');
  });

  it('promotores: el modal de suspensión aparece solo al pulsar Suspender', async () => {
    await setup({ listPromoters: () => of([PROMOTERS[1]]) });
    await selectTab('tab-promotores');
    expect(el.querySelector('[data-testid="suspend-modal"]')).toBeNull();
    click('promoter-suspend');
    expect(el.querySelector('[data-testid="suspend-modal"]')).not.toBeNull();
  });

  it('promotores: ver historial carga las transiciones', async () => {
    const promoterHistory = jasmine.createSpy('ph').and.returnValue(
      of([{ id: 'h1', promoterId: 'u2', adminId: 'a1', statusFrom: 'approved', statusTo: 'suspended', reason: 'x', createdAt: '2026-08-01T10:00:00Z' }]),
    );
    await setup({ promoterHistory, listPromoters: () => of([PROMOTERS[1]]) });
    await selectTab('tab-promotores');
    click('promoter-history');
    expect(promoterHistory).toHaveBeenCalledWith('u2');
    expect(el.querySelector('[data-testid="promoter-history-list"]')).not.toBeNull();
  });

  it('promotores: cost-share válido llama API; inválido → warning', async () => {
    const setPromoterPct = jasmine.createSpy('sp').and.returnValue(of({}));
    await setup({ setPromoterPct });
    fixture.componentInstance['setPromoterPct'](PROMOTERS[0] as never, '0.3');
    expect(setPromoterPct).toHaveBeenCalledWith('u1', 0.3);
    fixture.componentInstance['setPromoterPct'](PROMOTERS[0] as never, '5');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('sistema: carga pasarelas y alterna require-approval', async () => {
    const setRequireApproval = jasmine.createSpy('sra').and.returnValue(of({ requireApproval: false }));
    await setup({ setRequireApproval });
    await selectTab('tab-sistema');
    expect(el.querySelector('[data-testid="gateways-list"]')?.textContent).toContain('Recurrente');
    click('toggle-require-approval');
    expect(setRequireApproval).toHaveBeenCalledWith(false);
  });

  it('sistema: guardar reparto por defecto (válido persiste; inválido → warning)', async () => {
    const setDefaultPct = jasmine.createSpy('sd').and.returnValue(of({}));
    await setup({ setDefaultPct });
    await selectTab('tab-sistema');
    fixture.componentInstance['saveDefaultPct']('0.4');
    expect(setDefaultPct).toHaveBeenCalledWith(0.4);
    fixture.componentInstance['saveDefaultPct']('2');
    expect(lastToast()?.kind).toBe('warning');
  });

  it('sistema: definir default llama makeGatewayDefault', async () => {
    const makeGatewayDefault = jasmine.createSpy('md').and.returnValue(of(GATEWAYS[1]));
    await setup({ makeGatewayDefault });
    await selectTab('tab-sistema');
    click('gw-make-default'); // el primero visible es el de g2 (no-default)
    expect(makeGatewayDefault).toHaveBeenCalledWith('g2');
  });

  it('sistema: editar y guardar pasarela llama updateGateway', async () => {
    const updateGateway = jasmine.createSpy('ug').and.returnValue(of(GATEWAYS[1]));
    await setup({ updateGateway });
    await selectTab('tab-sistema');
    fixture.componentInstance['editGateway'](GATEWAYS[1] as never);
    fixture.detectChanges();
    fixture.componentInstance['patchDraft']('feePct', 0.06);
    fixture.componentInstance['saveGateway']();
    expect(updateGateway).toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('success');
  });

  it('sistema: JSON de cuotas inválido → warning y NO guarda', async () => {
    const updateGateway = jasmine.createSpy('ug').and.returnValue(of(GATEWAYS[1]));
    await setup({ updateGateway });
    fixture.componentInstance['editGateway'](GATEWAYS[1] as never);
    fixture.componentInstance['patchDraft']('installmentRatesJson', 'no-json');
    fixture.componentInstance['saveGateway']();
    expect(updateGateway).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('invitaciones: parsea correos y llama create (con flag de usuario de prueba)', async () => {
    const create = jasmine.createSpy('c').and.returnValue(of({ invitations: [{ id: 'i1', email: 'a@b.com', url: 'http://x/registro?token=t' }] }));
    await setup({}, { create });
    await selectTab('tab-invitaciones');
    fixture.componentInstance['emailsText'].set('a@b.com, c@d.com');
    fixture.componentInstance['inviteTestUser'].set(true);
    click('inv-submit');
    expect(create).toHaveBeenCalledWith(['a@b.com', 'c@d.com'], true);
    expect((el.querySelector('[data-testid="inv-created"] input') as HTMLInputElement).value).toContain('registro?token=t');
  });

  it('sistema: agregar pasarela con desbloqueo por OTP', async () => {
    const unlockGateway = jasmine.createSpy('u').and.returnValue(of({ sent: true }));
    const createGateway = jasmine.createSpy('c').and.returnValue(of(GATEWAYS[1]));
    await setup({ unlockGateway, createGateway });
    await selectTab('tab-sistema');
    click('gw-unlock');
    expect(unlockGateway).toHaveBeenCalled();
    fixture.componentInstance['unlockCode'].set('123456');
    click('gw-unlock-confirm');
    fixture.componentInstance['patchNewGateway']('name', 'PayPal');
    click('gw-create');
    expect(createGateway).toHaveBeenCalled();
    expect(createGateway.calls.mostRecent().args[0].unlockCode).toBe('123456');
  });

  it('eventos: abrir un evento navega al editor como admin (?from=admin)', async () => {
    await setup();
    const nav = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
    fixture.componentInstance['openEvent']('e1', 'cuentas');
    expect(nav).toHaveBeenCalledWith(['/promotor/eventos', 'e1', 'editar'], {
      queryParams: { from: 'admin', tab: 'cuentas' },
    });
  });

  it('invitaciones: revocar llama al API', async () => {
    const revoke = jasmine.createSpy('r').and.returnValue(of({ id: 'i1', status: 'revoked' }));
    await setup({}, { revoke });
    fixture.componentInstance['revoke']({ id: 'i1', email: 'a@b.com', status: 'pending' } as never);
    expect(revoke).toHaveBeenCalledWith('i1');
  });

  it('sistema: el buscador de pasarelas filtra por nombre', async () => {
    await setup();
    await selectTab('tab-sistema');
    const c = fixture.componentInstance as unknown as {
      gatewaySearch: { set: (v: string) => void };
      filteredGateways: () => { id: string }[];
    };
    c.gatewaySearch.set('recurrente');
    fixture.detectChanges();
    expect(c.filteredGateways().length).toBe(1);
    expect(c.filteredGateways()[0].id).toBe('g2');
  });

  it('sistema: al editar una pasarela se oculta su botón Editar', async () => {
    await setup();
    await selectTab('tab-sistema');
    // Antes de editar hay al menos un botón Editar visible.
    expect(el.querySelectorAll('[data-testid="gw-edit"]').length).toBeGreaterThan(0);
    fixture.componentInstance['editGateway'](GATEWAYS[1] as never);
    fixture.detectChanges();
    // El de esa pasarela ya no está (el draft coincide con su id).
    const buttons = [...el.querySelectorAll('[data-testid="gw-edit"]')];
    expect(buttons.length).toBe(GATEWAYS.length - 1);
  });

  it('sistema: el desbloqueo por código aparece en un MODAL centrado', async () => {
    const unlockGateway = jasmine.createSpy('u').and.returnValue(of({ sent: true }));
    await setup({ unlockGateway });
    await selectTab('tab-sistema');
    expect(el.querySelector('[data-testid="gw-unlock-modal"]')).toBeNull();
    click('gw-unlock');
    const modal = el.querySelector('[data-testid="gw-unlock-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.classList.contains('modal-backdrop')).toBe(true);
    // Cancelar cierra el modal.
    fixture.componentInstance['cancelUnlock']();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="gw-unlock-modal"]')).toBeNull();
  });

  it('invitaciones: pagina el grid (9 por página) y navega', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `i${i}`,
      email: `p${i}@x.com`,
      status: 'pending',
    }));
    await setup({}, { list: () => of(many) });
    await selectTab('tab-invitaciones');
    const c = fixture.componentInstance as unknown as {
      pageInvitations: () => unknown[];
      invTotalPages: () => number;
      goToInvPage: (p: number) => void;
      invPage: () => number;
    };
    expect(c.pageInvitations().length).toBe(9);
    expect(c.invTotalPages()).toBe(3);
    c.goToInvPage(3);
    expect(c.invPage()).toBe(3);
    expect(c.pageInvitations().length).toBe(2);
    // El pager se renderiza.
    expect(el.querySelector('[data-testid="inv-pager"]')).not.toBeNull();
  });

  it('invitaciones: buscar reinicia a la página 1', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, email: `p${i}@x.com`, status: 'pending' }));
    await setup({}, { list: () => of(many) });
    await selectTab('tab-invitaciones');
    const c = fixture.componentInstance as unknown as {
      goToInvPage: (p: number) => void;
      setInvSearch: (v: string) => void;
      invPage: () => number;
    };
    c.goToInvPage(2);
    expect(c.invPage()).toBe(2);
    c.setInvSearch('p1');
    expect(c.invPage()).toBe(1);
  });
});
