import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SessionStore } from '../../core/auth/session.store';
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

  it('logout navega al inicio', async () => {
    await setup({ logout: of(undefined) });
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    comp.logout();
    expect(nav).toHaveBeenCalledWith('/');
  });

  it('logout con error también navega al inicio', async () => {
    await setup({ logout: EMPTY });
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    comp.logout();
    // EMPTY completa → complete handler navega.
    expect(nav).toHaveBeenCalledWith('/');
  });
});
