import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EMPTY, of, Subject } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
import { NotificationsApi } from '../../core/api/notifications.api';
import { NotificationsSocketService } from '../../core/notifications/notifications-socket.service';
import { provideI18nTesting } from '../../core/i18n/testing';
import { Header } from './header';

describe('Header', () => {
  let fixture: ComponentFixture<Header>;
  let comp: Header;

  async function setup(
    opts: { authed?: boolean; roles?: string[]; logout?: unknown; avatarUrl?: string | null } = {},
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        ...provideI18nTesting(),
        {
          provide: AuthService,
          useValue: { logout: () => (opts.logout ?? of(undefined)) } as unknown as AuthService,
        },
        {
          provide: SessionStore,
          useValue: {
            isAuthenticated: () => opts.authed ?? true,
            user: () => ({ firstName: 'Ana', avatarUrl: opts.avatarUrl ?? null }),
            hasAnyRole: (r: string[]) => (opts.roles ?? []).some((x) => r.includes(x)),
          },
        },
        // La campanita (montada en el header) necesita sus deps stubbeadas.
        { provide: NotificationsApi, useValue: { unreadCount: () => of({ count: 0 }), list: () => of({ items: [], nextCursor: null }) } },
        { provide: NotificationsSocketService, useValue: { connect: () => Promise.resolve(), disconnect: () => undefined, notification$: new Subject(), unread$: new Subject() } },
      ],
    });
    fixture = TestBed.createComponent(Header);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('toggle abre y cierra el menú', async () => {
    await setup();
    comp.toggleMenu();
    expect(comp['menuOpen']()).toBe(true);
    comp.closeMenu();
    expect(comp['menuOpen']()).toBe(false);
  });

  it('un click FUERA del menú lo cierra; DENTRO no', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    comp.toggleMenu();
    fixture.detectChanges();
    // Click dentro del .user-menu (el trigger) NO cierra.
    const trigger = el.querySelector('[data-testid="user-menu-trigger"]') as HTMLElement;
    comp.onDocumentClick({ target: trigger } as unknown as MouseEvent);
    expect(comp['menuOpen']()).toBe(true);
    // Click en el document fuera del menú → cierra.
    comp.onDocumentClick({ target: document.body } as unknown as MouseEvent);
    expect(comp['menuOpen']()).toBe(false);
  });

  it('un click fuera con el menú cerrado no hace nada', async () => {
    await setup();
    expect(comp['menuOpen']()).toBe(false);
    comp.onDocumentClick({ target: document.body } as unknown as MouseEvent);
    expect(comp['menuOpen']()).toBe(false);
  });

  it('Escape cierra el menú abierto', async () => {
    await setup();
    comp.toggleMenu();
    expect(comp['menuOpen']()).toBe(true);
    comp.onEscape();
    expect(comp['menuOpen']()).toBe(false);
  });

  it('cliente ve accesos rápidos y NO ve panel/configuración', async () => {
    await setup({ roles: [] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="dd-metodos"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="promoter-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="config-link"]')).toBeNull();
  });

  it('promotor ve el panel del promotor pero NO Configuración (admin)', async () => {
    await setup({ roles: ['promoter'] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="promoter-link"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="config-link"]')).toBeNull();
  });

  it('admin ve Configuración (admin) pero NO el panel del promotor (no impersona)', async () => {
    await setup({ roles: ['admin'] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="promoter-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="config-link"]')).not.toBeNull();
  });

  it('admin ve TODO el menú de gobernanza (soporte + notificaciones + asesores + invitaciones)', async () => {
    await setup({ roles: ['admin'] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="support-link"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-notif-link"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-advisors-link"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-invitations-link"]')).not.toBeNull();
  });

  it('advisor (asesor) ve Configuración + Soporte, pero NO Notificaciones/Asesores/Invitaciones (Fix 1)', async () => {
    // Separación de privilegios de Fix 1: soporte lo ven admin+asesor; el resto de la
    // gobernanza (enviar notificaciones, gestionar asesores, invitaciones) es solo admin.
    await setup({ roles: ['advisor'] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="config-link"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="support-link"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="admin-notif-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="admin-advisors-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="admin-invitations-link"]')).toBeNull();
  });

  const cta = () => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="become-promoter-link"]');

  it('CTA "Conviértete en promotor": visible para visitante', async () => {
    await setup({ authed: false, roles: [] });
    expect(cta()).not.toBeNull();
  });

  it('CTA "Conviértete en promotor": visible para cliente logueado', async () => {
    await setup({ authed: true, roles: [] });
    expect(cta()).not.toBeNull();
  });

  it('CTA "Conviértete en promotor": oculto a promotor', async () => {
    await setup({ authed: true, roles: ['promoter'] });
    expect(cta()).toBeNull();
  });

  it('CTA "Conviértete en promotor": oculto a admin', async () => {
    await setup({ authed: true, roles: ['admin'] });
    expect(cta()).toBeNull();
  });

  it('el saludo va FUERA del botón trigger', async () => {
    await setup();
    const el = fixture.nativeElement as HTMLElement;
    const greeting = el.querySelector('[data-testid="session-greeting"]');
    const trigger = el.querySelector('[data-testid="user-menu-trigger"]');
    expect(greeting).not.toBeNull();
    expect(trigger?.contains(greeting)).toBe(false);
  });

  it('sin avatar el trigger muestra el icono de persona', async () => {
    await setup({ avatarUrl: null });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="user-avatar-icon"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="user-avatar"]')).toBeNull();
  });

  it('con avatar el trigger muestra la foto del usuario', async () => {
    await setup({ avatarUrl: 'https://cdn/x.png' });
    const el = fixture.nativeElement as HTMLElement;
    const img = el.querySelector('[data-testid="user-avatar"]') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn/x.png');
    expect(el.querySelector('[data-testid="user-avatar-icon"]')).toBeNull();
  });

  it('el dropdown incluye Facturación', async () => {
    await setup({ roles: [] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="dd-facturacion"]')).not.toBeNull();
  });

  it('logout navega al inicio tras la espera mínima de 3s', async () => {
    await setup({ logout: of(undefined) });
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    jasmine.clock().install();
    try {
      comp.logout();
      expect(nav).not.toHaveBeenCalled(); // aún no: espera los 3s
      jasmine.clock().tick(3001);
      expect(nav).toHaveBeenCalledWith('/');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('logout que completa sin emitir (204/EMPTY) igual navega al inicio', async () => {
    await setup({ logout: EMPTY });
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    jasmine.clock().install();
    try {
      comp.logout();
      jasmine.clock().tick(3001);
      expect(nav).toHaveBeenCalledWith('/');
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
