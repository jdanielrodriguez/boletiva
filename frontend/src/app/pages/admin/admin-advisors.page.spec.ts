import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { AdvisorInvitationsApi } from '../../core/api/advisor-invitations.api';
import { AdvisorsApi, type AdvisorRow } from '../../core/api/advisors.api';
import { AdvisorApi, type AdvisorUnlockState } from '../../core/api/advisor.api';
import { AdminAdvisorsPage } from './admin-advisors.page';

const ADVISORS: AdvisorRow[] = [
  { id: 'a1', email: 'pending@test.com', firstName: 'Pen', lastName: null, status: 'active', disabled: false, forced: false, createdAt: '2026-01-01T10:00:00Z' },
  { id: 'a2', email: 'active@test.com', firstName: 'Act', lastName: null, status: 'active', disabled: false, forced: false, createdAt: '2026-01-01T10:00:00Z' },
  { id: 'a3', email: 'none@test.com', firstName: 'Non', lastName: null, status: 'active', disabled: false, forced: false, createdAt: '2026-01-01T10:00:00Z' },
];
const STATES: AdvisorUnlockState[] = [
  { advisorId: 'a1', pending: true, requestedAt: '2026-01-02T10:00:00Z', unlocked: false, expiresAt: null },
  { advisorId: 'a2', pending: false, requestedAt: null, unlocked: true, expiresAt: '2026-01-02T12:00:00Z' },
];

function setup(overrides: { listPending?: jasmine.Spy; grant?: jasmine.Spy; list?: jasmine.Spy } = {}) {
  const listPending = overrides.listPending ?? jasmine.createSpy('listPending').and.returnValue(of(STATES));
  const grant = overrides.grant ?? jasmine.createSpy('grant').and.returnValue(of({ granted: true, advisorId: 'a1', expiresAt: null }));
  const list = overrides.list ?? jasmine.createSpy('list').and.returnValue(of(ADVISORS));
  TestBed.configureTestingModule({
    providers: [
      ...provideI18nTesting(),
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AdvisorInvitationsApi, useValue: { list: () => of([]) } },
      { provide: AdvisorsApi, useValue: { list, disable: () => of({}), enable: () => of({}), remove: () => of({}), notify: () => of({}) } },
      { provide: AdvisorApi, useValue: { listPending, grant } },
    ],
  });
  const fixture = TestBed.createComponent(AdminAdvisorsPage);
  fixture.detectChanges();
  return { fixture, listPending, grant, list };
}

describe('AdminAdvisorsPage · F3 desbloqueo', () => {
  it('pinta el estado de desbloqueo por asesor (pendiente / activo)', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    // a1 pendiente → badge de solicitud + botón Desbloquear.
    expect(el.querySelector('[data-testid="adv-unlock-pending-a1"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="adv-grant-a1"]')).not.toBeNull();
    // a2 con ventana vigente → badge activo, SIN botón Desbloquear.
    expect(el.querySelector('[data-testid="adv-unlock-active-a2"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="adv-grant-a2"]')).toBeNull();
    // a3 sin estado → botón Desbloquear disponible (grant proactivo).
    expect(el.querySelector('[data-testid="adv-grant-a3"]')).not.toBeNull();
  });

  it('conceder desbloqueo llama a grant tras confirmar', () => {
    const { fixture, grant } = setup();
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="adv-grant-a1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Aparece el diálogo de confirmación → aceptar.
    const accept = el.querySelector('[data-testid="confirm-accept"]') as HTMLButtonElement | null;
    (accept ?? (el.querySelector('.confirm-accept') as HTMLButtonElement)).click();
    fixture.detectChanges();
    expect(grant).toHaveBeenCalledWith('a1');
  });

  it('el botón Actualizar recarga asesores y estados de desbloqueo (sin socket)', () => {
    const { fixture, list, listPending } = setup();
    expect(list).toHaveBeenCalledTimes(1);
    expect(listPending).toHaveBeenCalledTimes(1);
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="adv-refresh"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(list).toHaveBeenCalledTimes(2);
    expect(listPending).toHaveBeenCalledTimes(2);
  });
});
