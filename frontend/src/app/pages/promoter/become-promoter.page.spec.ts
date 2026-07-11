import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { provideI18nTesting } from '../../core/i18n/testing';
import { PromotersApi } from '../../core/api/promoters.api';
import { AuthRefreshService } from '../../core/auth/auth-refresh.service';
import { SessionStore } from '../../core/auth/session.store';
import { ToastService } from '../../core/ui/toast.service';
import { BecomePromoterPage } from './become-promoter.page';

type Status = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';

describe('BecomePromoterPage (v3.6)', () => {
  let fixture: ComponentFixture<BecomePromoterPage>;
  let el: HTMLElement;
  let myStatus: jasmine.Spy;
  let apply: jasmine.Spy;
  let refresh: jasmine.Spy;
  let loadMe: jasmine.Spy;
  let navSpy: jasmine.Spy;

  async function setup(
    opts: {
      roles?: string[];
      status?: Status;
      statusError?: boolean;
      applyStatus?: Status;
      applyError?: boolean;
    } = {},
  ) {
    myStatus = jasmine
      .createSpy('myStatus')
      .and.returnValue(
        opts.statusError
          ? throwError(() => new Error('x'))
          : of({ promoterStatus: opts.status ?? 'none' }),
      );
    apply = jasmine
      .createSpy('apply')
      .and.returnValue(
        opts.applyError
          ? throwError(() => new Error('x'))
          : of({ promoterStatus: opts.applyStatus ?? 'pending' }),
      );
    refresh = jasmine.createSpy('refresh').and.returnValue(of({ accessToken: 't' }));
    loadMe = jasmine.createSpy('loadMe').and.returnValue(of({ roles: ['buyer', 'promoter'] }));

    const roles = opts.roles ?? [];
    const session = {
      hasAnyRole: (rs: string[]) => rs.some((r) => roles.includes(r)),
      loadMe,
    } as unknown as SessionStore;

    TestBed.configureTestingModule({
      providers: [
        ...provideI18nTesting(),
        provideZonelessChangeDetection(),
        provideRouter([]),
        ToastService,
        { provide: PromotersApi, useValue: { myStatus, apply } },
        { provide: AuthRefreshService, useValue: { refresh } },
        { provide: SessionStore, useValue: session },
      ],
    });
    navSpy = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(BecomePromoterPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  /** Abre la modal de instrucciones (el envío ya no es one-click). */
  const openInfo = () => {
    (el.querySelector('[data-testid="bp-submit"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  /** Flujo completo: abrir modal + confirmar → dispara apply(). */
  const submit = () => {
    openInfo();
    (el.querySelector('[data-testid="bp-info-confirm"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('ya es promotor → redirige a /promotor sin pedir estado', async () => {
    await setup({ roles: ['promoter'] });
    expect(navSpy).toHaveBeenCalledWith(['/promotor']);
    expect(myStatus).not.toHaveBeenCalled();
  });

  it('cliente sin solicitud previa → muestra el formulario', async () => {
    await setup({ status: 'none' });
    expect(el.querySelector('[data-testid="bp-submit"]')).not.toBeNull();
  });

  it('solicitud pendiente → muestra estado pendiente (sin form)', async () => {
    await setup({ status: 'pending' });
    expect(el.querySelector('[data-testid="bp-pending"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="bp-submit"]')).toBeNull();
  });

  it('ya aprobado (estado) → muestra estado aprobado', async () => {
    await setup({ status: 'approved' });
    expect(el.querySelector('[data-testid="bp-approved"]')).not.toBeNull();
  });

  it('enviar y modo pruebas (auto-aprobado): refresca rol y navega a /promotor', async () => {
    await setup({ status: 'none', applyStatus: 'approved' });
    submit();
    expect(apply).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(loadMe).toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/promotor']);
  });

  it('pulsar el botón NO envía: abre la modal de instrucciones', async () => {
    await setup({ status: 'none' });
    openInfo();
    expect(el.querySelector('[data-testid="bp-info-modal"]')).not.toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('cancelar en la modal de instrucciones no envía la solicitud', async () => {
    await setup({ status: 'none' });
    openInfo();
    (el.querySelector('[data-testid="bp-info-cancel"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="bp-info-modal"]')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('enviar y requiere aprobación: modal de "proceso iniciado" + estado pendiente', async () => {
    await setup({ status: 'none', applyStatus: 'pending' });
    submit();
    expect(apply).toHaveBeenCalled();
    expect(navSpy).not.toHaveBeenCalledWith(['/promotor']);
    expect(el.querySelector('[data-testid="bp-started-modal"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="bp-pending"]')).not.toBeNull();
    (el.querySelector('[data-testid="bp-started-close"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="bp-started-modal"]')).toBeNull();
  });

  it('error al enviar → muestra error y no navega', async () => {
    await setup({ status: 'none', applyError: true });
    submit();
    expect(el.querySelector('[data-testid="bp-error"]')).not.toBeNull();
    expect(navSpy).not.toHaveBeenCalledWith(['/promotor']);
  });
});
