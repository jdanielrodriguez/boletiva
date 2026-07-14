import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AdminApi } from '../../core/api/admin.api';
import { InvitationsApi } from '../../core/api/invitations.api';
import { PromoterEventsApi } from '../../core/api/promoter-events.api';
import { SettingsApi } from '../../core/api/settings.api';
import { HallsApi } from '../../core/api/halls.api';
import { SeatTemplatesApi } from '../../core/api/seat-templates.api';
import { AuditApi } from '../../core/api/audit.api';
import { ImpersonationService } from '../../core/auth/impersonation.service';
import { ToastService } from '../../core/ui/toast.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { ConfigPage } from './config.page';

const EVENTS = [
  { id: 'e1', name: 'Fiesta', status: 'published', startsAt: '2026-08-01T20:00:00Z', promoter: { id: 'u1', firstName: 'Ana', lastName: 'P' }, _count: { localities: 2 } },
  { id: 'e2', name: 'Feria', status: 'draft', startsAt: '2026-08-02T18:00:00Z', promoter: { id: 'u2', firstName: 'Leo', lastName: 'G' }, _count: { localities: 1 } },
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
        ...provideI18nTesting(),
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
            getPromoterCostShare: (id: string) => of({ promoterId: id, override: null, effectivePct: 0.5 }),
            resetPromoterCostShare: () => of({}),
            setPromoterNote: (id: string) => of({ id, promoterInternalNote: '' }),
            listGateways: () => of(GATEWAYS),
            updateGateway: () => of(GATEWAYS[1]),
            setGatewayStatus: () => of(GATEWAYS[1]),
            makeGatewayDefault: () => of(GATEWAYS[1]),
            deleteGateway: () => of({}),
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
        { provide: AuditApi, useValue: { confirm: () => of({ ok: true }) } },
        { provide: ImpersonationService, useValue: { start: () => of(null), active: () => false, asUser: () => null } },
        {
          provide: SettingsApi,
          useValue: {
            list: () => of([]),
            update: () => of({ key: 'k', value: 0, default: 0, type: 'pct', description: '', fallbackOnly: false }),
          } as unknown as SettingsApi,
        },
        // v3.9 · B1: los tabs Salones/Plantillas embeben app-halls-list/app-templates-list.
        {
          provide: HallsApi,
          useValue: {
            listAll: () => of([{ id: 'h1', name: 'Teatro', city: 'GT', address: null, lat: null, lng: null, notes: null, seatTemplateId: null, status: 'published', createdAt: '', updatedAt: '' }]),
          } as unknown as HallsApi,
        },
        {
          provide: SeatTemplatesApi,
          useValue: {
            listAll: () => of([{ id: 't1', name: 'Filas', kind: 'rows', isBuiltIn: true, status: 'published', hidden: false, disabled: false, layoutJson: {}, params: {}, createdAt: '', updatedAt: '' }]),
          } as unknown as SeatTemplatesApi,
        },
      ],
    });
    initI18nTesting();
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
    click('promoter-approve'); // abre el modal de confirmación
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    click('confirm-accept'); // confirma
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

  it('promotores: "Historial" navega a la página dedicada del promotor', async () => {
    await setup({ listPromoters: () => of([PROMOTERS[1]]) });
    await selectTab('tab-promotores');
    const nav = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
    click('promoter-history');
    expect(nav).toHaveBeenCalledWith(
      ['/configuracion/promotores', 'u2', 'historial'],
      { queryParams: { name: 'Leo G' } },
    );
  });

  it('promotores: cost-share válido llama API; inválido → warning', async () => {
    const setPromoterPct = jasmine.createSpy('sp').and.returnValue(of({}));
    await setup({ setPromoterPct });
    fixture.componentInstance['setPctEdit']('u1', '0.3');
    fixture.componentInstance['setPromoterPct'](PROMOTERS[0] as never);
    expect(setPromoterPct).toHaveBeenCalledWith('u1', 0.3);
    fixture.componentInstance['setPctEdit']('u1', '5');
    fixture.componentInstance['setPromoterPct'](PROMOTERS[0] as never);
    expect(lastToast()?.kind).toBe('warning');
  });

  // --- v3.8 · G2-9: nota interna persiste + reset de cost-share ---
  it('promotores: guardar nota interna llama setPromoterNote con el texto', async () => {
    const setPromoterNote = jasmine.createSpy('spn').and.returnValue(of({ id: 'u1', promoterInternalNote: 'hola' }));
    await setup({ setPromoterNote });
    fixture.componentInstance['setNote']('u1', 'hola');
    fixture.componentInstance['saveNote'](PROMOTERS[0] as never);
    expect(setPromoterNote).toHaveBeenCalledWith('u1', 'hola');
    expect(lastToast()?.kind).toBe('success');
  });

  it('promotores: cost-share con override → reset llama DELETE', async () => {
    const resetPromoterCostShare = jasmine.createSpy('rcs').and.returnValue(of({}));
    await setup({
      resetPromoterCostShare,
      getPromoterCostShare: (id: string) => of({ promoterId: id, override: 0.3, effectivePct: 0.3 }),
    });
    await selectTab('tab-promotores');
    expect(fixture.componentInstance['hasOverride']('u1')).toBe(true);
    fixture.componentInstance['resetPromoterPct'](PROMOTERS[0] as never);
    expect(resetPromoterCostShare).toHaveBeenCalledWith('u1');
  });

  // --- v3.8 · G2-4: impersonación de soporte ---
  it('promotores: "Ver como" pide confirmación e inicia la impersonación (aprobado)', async () => {
    await setup({ listPromoters: () => of([PROMOTERS[1]]) });
    await selectTab('tab-promotores');
    const start = spyOn(TestBed.inject(ImpersonationService), 'start').and.returnValue(of(null) as never);
    const nav = spyOn(fixture.componentInstance['router'], 'navigateByUrl').and.resolveTo(true);
    click('promoter-impersonate');
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    click('confirm-accept');
    expect(start).toHaveBeenCalledWith('u2');
    expect(nav).toHaveBeenCalledWith('/promotor');
  });

  // --- v3.8 · G2-3: cambiar de tab resetea los filtros ---
  it('cambia de tab y resetea los filtros (búsqueda de eventos vuelve a vacío)', async () => {
    await setup();
    fixture.componentInstance['setEventSearch']('algo');
    expect(fixture.componentInstance['eventSearch']()).toBe('algo');
    await selectTab('tab-promotores');
    await selectTab('tab-eventos');
    expect(fixture.componentInstance['eventSearch']()).toBe('');
  });

  // --- v3.8 · G2-6: invitaciones abren con el filtro "Pendientes" por defecto ---
  it('invitaciones: el filtro por defecto es "pending"', async () => {
    await setup();
    await selectTab('tab-invitaciones');
    expect(fixture.componentInstance['invFilterStatus']()).toBe('pending');
    const filter = el.querySelector('[data-testid="inv-filter"]') as HTMLSelectElement;
    expect(filter.value).toBe('pending');
  });

  it('sistema: las PASARELAS quedan arriba (autorización y reparto ahora son settings del grid)', async () => {
    await setup();
    await selectTab('tab-sistema');
    // Pasarelas primero; ya NO existen los bloques standalone de aprobación/reparto.
    expect(el.querySelector('[data-testid="gateways-list"]')?.textContent).toContain('Recurrente');
    expect(el.querySelector('[data-testid="toggle-require-approval"]')).toBeNull();
    expect(el.querySelector('[data-testid="default-pct"]')).toBeNull();
  });

  it('sistema: definir default llama makeGatewayDefault', async () => {
    const makeGatewayDefault = jasmine.createSpy('md').and.returnValue(of(GATEWAYS[1]));
    await setup({ makeGatewayDefault });
    await selectTab('tab-sistema');
    click('gw-make-default'); // el primero visible es el de g2 (no-default)
    expect(makeGatewayDefault).toHaveBeenCalledWith('g2');
  });

  it('sistema: BLOQUEADO solo permite definir default; editar/eliminar exigen desbloqueo', async () => {
    await setup();
    await selectTab('tab-sistema');
    // make-default disponible aun bloqueado; editar y eliminar deshabilitados.
    expect((el.querySelector('[data-testid="gw-edit"]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-testid="gw-delete"]') as HTMLButtonElement).disabled).toBe(true);
    // editGateway es no-op sin desbloqueo.
    fixture.componentInstance['editGateway'](GATEWAYS[1] as never);
    expect(fixture.componentInstance['gatewayDraft']()).toBeNull();
  });

  it('sistema: editar y guardar pasarela llama updateGateway', async () => {
    const updateGateway = jasmine.createSpy('ug').and.returnValue(of(GATEWAYS[1]));
    await setup({ updateGateway });
    await selectTab('tab-sistema');
    fixture.componentInstance['unlockUnlocked'].set(true); // editar exige desbloqueo (candado)
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
    fixture.componentInstance['unlockUnlocked'].set(true);
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
    click('inv-toggle'); // abre el form (oculto por defecto)
    fixture.componentInstance['emailsText'].set('a@b.com, c@d.com');
    fixture.componentInstance['inviteTestUser'].set(true);
    click('inv-toggle'); // abierto → envía
    expect(create).toHaveBeenCalledWith(['a@b.com', 'c@d.com'], true);
    expect((el.querySelector('[data-testid="inv-created"] input') as HTMLInputElement).value).toContain('registro?token=t');
  });

  it('invitaciones: correo con formato inválido NO llama al backend y avisa', async () => {
    const create = jasmine.createSpy('c').and.returnValue(of({ invitations: [] }));
    await setup({}, { create });
    await selectTab('tab-invitaciones');
    click('inv-toggle'); // abre el form
    fixture.componentInstance['emailsText'].set('a@b.com, no-es-correo');
    click('inv-toggle'); // abierto → intenta enviar
    expect(create).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('invitaciones: todos los correos válidos → SÍ llama al backend', async () => {
    const create = jasmine.createSpy('c').and.returnValue(of({ invitations: [{ id: 'i1', email: 'a@b.com', url: 'http://x/registro?token=t' }] }));
    await setup({}, { create });
    await selectTab('tab-invitaciones');
    click('inv-toggle');
    fixture.componentInstance['emailsText'].set('a@b.com c@d.com');
    click('inv-toggle');
    expect(create).toHaveBeenCalledWith(['a@b.com', 'c@d.com'], false);
  });

  it('sistema: candado → modal → OTP → habilita "Agregar" y crea la pasarela', async () => {
    const unlockGateway = jasmine.createSpy('u').and.returnValue(of({ sent: true }));
    const createGateway = jasmine.createSpy('c').and.returnValue(of(GATEWAYS[1]));
    await setup({ unlockGateway, createGateway });
    await selectTab('tab-sistema');
    // "Agregar pasarela" nace deshabilitado + candado visible.
    expect((el.querySelector('[data-testid="gw-add"]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('[data-testid="gw-lock"]')).not.toBeNull();
    // Candado → modal → enviar código.
    click('gw-lock');
    expect(el.querySelector('[data-testid="gw-unlock-modal"]')).not.toBeNull();
    click('gw-send-code');
    expect(unlockGateway).toHaveBeenCalled();
    // Valida el código → autoriza (candado desaparece, botón habilitado).
    fixture.componentInstance['unlockCode'].set('123456');
    click('gw-unlock-confirm');
    expect(el.querySelector('[data-testid="gw-lock"]')).toBeNull();
    expect((el.querySelector('[data-testid="gw-add"]') as HTMLButtonElement).disabled).toBe(false);
    // Abre el form de creación y crea.
    click('gw-add');
    fixture.componentInstance['patchNewGateway']('name', 'PayPal');
    click('gw-create');
    expect(createGateway).toHaveBeenCalled();
    expect(createGateway.calls.mostRecent().args[0].unlockCode).toBe('123456');
  });

  it('sistema: eliminar pasarela solo cuando está INACTIVA (guard + tooltip)', async () => {
    const deleteGateway = jasmine.createSpy('d').and.returnValue(of({}));
    const INACTIVE = [
      GATEWAYS[0],
      { ...GATEWAYS[1], status: 'inactive' },
    ];
    await setup({ deleteGateway, listGateways: () => of(INACTIVE) });
    await selectTab('tab-sistema');
    const c = fixture.componentInstance as unknown as {
      canDeleteGateway: (g: { status: string; isPlatformDefault: boolean }) => boolean;
      askRemoveGateway: (g: unknown) => void;
      confirm: { accept: () => void };
    };
    // Activa/default → NO borrable; inactiva no-default → borrable.
    expect(c.canDeleteGateway(INACTIVE[0] as never)).toBe(false);
    expect(c.canDeleteGateway(INACTIVE[1] as never)).toBe(true);
    c.askRemoveGateway(INACTIVE[1] as never);
    c.confirm.accept();
    expect(deleteGateway).toHaveBeenCalledWith('g2');
  });

  it('sistema: intentar borrar una pasarela activa avisa y NO llama al API', async () => {
    const deleteGateway = jasmine.createSpy('d').and.returnValue(of({}));
    await setup({ deleteGateway });
    await selectTab('tab-sistema');
    const c = fixture.componentInstance as unknown as { askRemoveGateway: (g: unknown) => void };
    c.askRemoveGateway(GATEWAYS[1] as never); // activa
    expect(deleteGateway).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('sistema: cambiar de tab CIERRA el form de edición de pasarela (punto 9)', async () => {
    await setup();
    await selectTab('tab-sistema');
    fixture.componentInstance['unlockUnlocked'].set(true);
    fixture.componentInstance['editGateway'](GATEWAYS[1] as never);
    expect(fixture.componentInstance['gatewayDraft']()).not.toBeNull();
    await selectTab('tab-eventos');
    expect(fixture.componentInstance['gatewayDraft']()).toBeNull();
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

  it('invitaciones: revocar pide confirmación (modal) antes de llamar al API', async () => {
    const revoke = jasmine.createSpy('r').and.returnValue(of({ id: 'i1', status: 'revoked' }));
    await setup({}, { revoke });
    await selectTab('tab-invitaciones');
    click('inv-revoke');
    expect(revoke).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    click('confirm-accept');
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
    fixture.componentInstance['unlockUnlocked'].set(true);
    // Antes de editar hay al menos un botón Editar visible.
    expect(el.querySelectorAll('[data-testid="gw-edit"]').length).toBeGreaterThan(0);
    fixture.componentInstance['editGateway'](GATEWAYS[1] as never);
    fixture.detectChanges();
    // El de esa pasarela ya no está (el draft coincide con su id).
    const buttons = [...el.querySelectorAll('[data-testid="gw-edit"]')];
    expect(buttons.length).toBe(GATEWAYS.length - 1);
  });

  it('sistema: el candado abre un MODAL centrado que explica la acción', async () => {
    await setup();
    await selectTab('tab-sistema');
    expect(el.querySelector('[data-testid="gw-unlock-modal"]')).toBeNull();
    click('gw-lock');
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

  // --- v3.5: filtro de eventos por promotor ---
  it('filtra eventos por promotor', async () => {
    await setup();
    const c = fixture.componentInstance as unknown as {
      setEventPromoter: (v: string) => void;
      filteredEvents: () => { id: string }[];
      eventPromoters: () => { id: string; name: string }[];
    };
    expect(c.eventPromoters().length).toBe(2);
    c.setEventPromoter('u2');
    expect(c.filteredEvents().length).toBe(1);
    expect(c.filteredEvents()[0].id).toBe('e2');
  });

  // --- v3.9 · B1: salones/plantillas muestran su LISTA dentro del tab ---
  it('salones: el tab embebe la lista de salones (app-halls-list)', async () => {
    await setup();
    await selectTab('tab-salones');
    expect(el.querySelector('app-halls-list')).not.toBeNull();
    expect(el.querySelector('[data-testid="halls-list"]')?.textContent).toContain('Teatro');
  });

  it('plantillas: el tab embebe la lista de plantillas (app-templates-list)', async () => {
    await setup();
    await selectTab('tab-plantillas');
    expect(el.querySelector('app-templates-list')).not.toBeNull();
    expect(el.querySelector('[data-testid="tpl-list"]')?.textContent).toContain('Filas');
  });

  // --- v3.7: configuraciones ahora viven bajo el tab Sistema (grid) ---
  it('sistema: guarda una configuración vía SettingsApi.update (bajo Sistema)', async () => {
    const SETTINGS = [{ key: 'costshare.default_pct', value: 0, default: 0, type: 'pct', description: 'x', fallbackOnly: false }];
    await setup();
    const settingsApi = TestBed.inject(SettingsApi);
    spyOn(settingsApi, 'list').and.returnValue(of(SETTINGS) as never);
    const update = spyOn(settingsApi, 'update').and.returnValue(of(SETTINGS[0]) as never);
    await selectTab('tab-sistema');
    const c = fixture.componentInstance as unknown as {
      setSettingValue: (k: string, v: number | boolean) => void;
      saveSetting: (s: unknown) => void;
    };
    c.setSettingValue('costshare.default_pct', 0.5);
    c.saveSetting(SETTINGS[0]);
    expect(update).toHaveBeenCalledWith('costshare.default_pct', 0.5);
  });

  // --- v3.6: recordar el tab al recargar (deep-link ?tab=) ---
  it('recuerda el tab: selectTab refleja el tab en la URL (?tab=)', async () => {
    await setup();
    const nav = spyOn(fixture.componentInstance['router'], 'navigate').and.resolveTo(true);
    fixture.componentInstance['selectTab']('sistema');
    expect(nav).toHaveBeenCalled();
    const opts = nav.calls.mostRecent().args[1] as { queryParams: { tab: string | null } };
    expect(opts.queryParams.tab).toBe('sistema');
    // 'eventos' limpia el query (tab = null).
    fixture.componentInstance['selectTab']('eventos');
    const opts2 = nav.calls.mostRecent().args[1] as { queryParams: { tab: string | null } };
    expect(opts2.queryParams.tab).toBeNull();
  });

  it('recuerda el tab: restaura desde ?tab= al cargar (queryParamMap)', async () => {
    await setup();
    await TestBed.inject(Router).navigate([], { queryParams: { tab: 'sistema' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['tab']()).toBe('sistema');
  });

  // --- v3.6: form de invitar OCULTO con toggle "Invitar" ---
  it('invitaciones: el form está oculto por defecto y "Invitar" lo abre', async () => {
    await setup();
    await selectTab('tab-invitaciones');
    expect(el.querySelector('[data-testid="inv-form"]')).toBeNull();
    click('inv-toggle');
    expect(el.querySelector('[data-testid="inv-form"]')).not.toBeNull();
  });

  it('invitaciones: abierto + correo válido invita; inválido no invita', async () => {
    const create = jasmine.createSpy('c').and.returnValue(of({ invitations: [] }));
    await setup({}, { create });
    await selectTab('tab-invitaciones');
    click('inv-toggle'); // abre el form
    // Correo vacío/mal escrito → NO invita, muestra warning.
    fixture.componentInstance['onInviteButton']();
    expect(create).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
    // Correo válido → invita.
    fixture.componentInstance['emailsText'].set('ok@x.com');
    fixture.componentInstance['onInviteButton']();
    expect(create).toHaveBeenCalledWith(['ok@x.com'], false);
  });

  it('invitaciones: "Cancelar" oculta el form y limpia el correo', async () => {
    await setup();
    await selectTab('tab-invitaciones');
    click('inv-toggle');
    fixture.componentInstance['emailsText'].set('x@y.com');
    click('inv-cancel');
    expect(el.querySelector('[data-testid="inv-form"]')).toBeNull();
    expect(fixture.componentInstance['emailsText']()).toBe('');
  });

  // --- i18n: los settings muestran un label amigable (no la key cruda) ---
  it('sistema: muestra el label amigable del setting en es y en (no la key cruda)', async () => {
    const SETTINGS = [
      { key: 'pricing.platform_fee_pct', value: 0.1, default: 0.1, type: 'pct', description: 'x', fallbackOnly: false },
    ];
    await setup();
    spyOn(TestBed.inject(SettingsApi), 'list').and.returnValue(of(SETTINGS) as never);
    await selectTab('tab-sistema');
    const list = () => el.querySelector('[data-testid="settings-list"]');
    // Español (default): label humano, sin la key cruda con puntos.
    expect(list()?.textContent).toContain('Comisión de plataforma');
    expect(list()?.textContent).not.toContain('pricing.platform_fee_pct');

    // Inglés: cambia el idioma y el label sale traducido.
    TestBed.inject(I18nService).use('en');
    fixture.detectChanges();
    expect(list()?.textContent).toContain('Platform fee');
    expect(list()?.textContent).not.toContain('pricing.platform_fee_pct');
  });

  // --- Cost-share por promotor / notas / impersonación (lógica de servicio) ---
  interface ConfigTestable {
    setPctEdit(id: string, v: string): void;
    setPromoterPct(p: { id: string; firstName: string }): void;
    resetPromoterPct(p: { id: string; firstName: string }): void;
    setNote(id: string, v: string): void;
    saveNote(p: { id: string; firstName: string }): void;
    askImpersonate(p: { id: string; firstName: string; promoterStatus: string }): void;
    impersonate(p: { id: string; firstName: string }): void;
    effectivePct(id: string): number | null;
    hasOverride(id: string): boolean;
    confirmSuspend(): void;
    confirm: { ask(v: unknown): void; request(): { onConfirm(): void } | null };
  }
  const inst = (): ConfigTestable => fixture.componentInstance as unknown as ConfigTestable;
  const P = { id: 'u2', firstName: 'Leo', lastName: 'G', promoterStatus: 'approved' };

  it('cost-share: un pct válido llama a setPromoterPct y avisa éxito', async () => {
    const setSpy = jasmine.createSpy('setPromoterPct').and.returnValue(of({}));
    await setup({ setPromoterPct: setSpy });
    inst().setPctEdit('u2', '0.3');
    inst().setPromoterPct(P);
    expect(setSpy).toHaveBeenCalledWith('u2', 0.3);
    expect(lastToast()?.kind).toBe('success');
  });

  it('cost-share: valores fuera de rango o no numéricos NO llaman al backend', async () => {
    const setSpy = jasmine.createSpy('setPromoterPct').and.returnValue(of({}));
    await setup({ setPromoterPct: setSpy });
    for (const bad of ['', 'abc', '-0.1', '1.5']) {
      inst().setPctEdit('u2', bad);
      inst().setPromoterPct(P);
    }
    expect(setSpy).not.toHaveBeenCalled();
    expect(lastToast()?.kind).toBe('warning');
  });

  it('cost-share: restablecer borra el override (info)', async () => {
    const resetSpy = jasmine.createSpy('reset').and.returnValue(of({}));
    await setup({ resetPromoterCostShare: resetSpy });
    inst().resetPromoterPct(P);
    expect(resetSpy).toHaveBeenCalledWith('u2');
    expect(lastToast()?.kind).toBe('info');
  });

  it('nota interna: guardar con éxito avisa', async () => {
    await setup();
    inst().setNote('u2', '  cliente VIP  ');
    inst().saveNote(P);
    expect(lastToast()?.kind).toBe('success');
  });

  it('nota interna: un error al guardar muestra error', async () => {
    await setup({ setPromoterNote: () => throwError(() => new Error('x')) });
    inst().setNote('u2', 'x');
    inst().saveNote(P);
    expect(lastToast()?.kind).toBe('error');
  });

  it('impersonar a un promotor NO aprobado se rechaza con aviso', async () => {
    await setup();
    inst().askImpersonate({ id: 'u1', firstName: 'Pia', promoterStatus: 'pending' });
    expect(lastToast()?.kind).toBe('warning');
    expect(inst().confirm.request()).toBeNull();
  });

  it('impersonar a un aprobado abre confirmación; al confirmar arranca la sesión y navega', async () => {
    const startSpy = jasmine.createSpy('start').and.returnValue(of(null));
    await setup();
    // El servicio ya inyectado en el componente es un stub; espiamos su start.
    spyOn(TestBed.inject(ImpersonationService), 'start').and.callFake(startSpy);
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    inst().askImpersonate(P);
    const confirmState = inst().confirm.request();
    expect(confirmState).not.toBeNull();
    confirmState?.onConfirm();
    expect(startSpy).toHaveBeenCalledWith('u2');
    expect(nav).toHaveBeenCalledWith('/promotor');
  });

  it('confirmSuspend sin objetivo seleccionado no hace nada', async () => {
    const suspendSpy = jasmine.createSpy('suspend').and.returnValue(of({}));
    await setup({ suspendPromoter: suspendSpy });
    inst().confirmSuspend(); // suspendTarget es null
    expect(suspendSpy).not.toHaveBeenCalled();
  });

  it('effectivePct/hasOverride reflejan el reparto cargado', async () => {
    await setup({ getPromoterCostShare: (id: string) => of({ promoterId: id, override: 0.25, effectivePct: 0.25 }) });
    await selectTab('tab-promotores');
    expect(inst().effectivePct('u1')).toBe(0.25);
    expect(inst().hasOverride('u1')).toBe(true);
  });
});
