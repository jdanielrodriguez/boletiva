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

  async function setup(opts: { authed?: boolean; roles?: string[]; logout?: unknown } = {}) {
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
            user: () => ({ firstName: 'Ana' }),
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

  it('cliente ve accesos rápidos y NO ve Configuración', async () => {
    await setup({ roles: [] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="dd-metodos"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="config-link"]')).toBeNull();
  });

  it('promotor/admin ve el enlace de Configuración', async () => {
    await setup({ roles: ['promoter'] });
    comp.toggleMenu();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="config-link"]')).not.toBeNull();
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
