import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionStore } from '../../core/auth/session.store';
import { Footer } from './footer';

function render(session: Partial<SessionStore>): HTMLElement {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: SessionStore, useValue: session },
    ],
  });
  const fixture = TestBed.createComponent(Footer);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const links = (el: HTMLElement) =>
  [...el.querySelectorAll('.footer-menu a')].map((a) => a.textContent?.trim());

const allLinks = (el: HTMLElement) =>
  [...el.querySelectorAll('.footer-inner a')].map((a) => a.textContent?.trim());

describe('Footer', () => {
  it('invitado: muestra iniciar sesión y crear cuenta (y Términos abajo)', () => {
    const el = render({ isAuthenticated: () => false, hasAnyRole: () => false } as unknown as SessionStore);
    const l = links(el);
    expect(l).toContain('Iniciar sesión');
    expect(l).toContain('Crear cuenta');
    expect(l).not.toContain('Perfil');
    expect(allLinks(el)).toContain('Términos y condiciones');
  });

  it('logueado (comprador): solo Perfil en el menú, sin Configuración', () => {
    const el = render({ isAuthenticated: () => true, hasAnyRole: () => false } as unknown as SessionStore);
    const l = links(el);
    expect(l).toContain('Perfil');
    expect(l).not.toContain('Configuración');
    expect(l).not.toContain('Iniciar sesión');
  });

  it('logueado (promotor): Perfil + Configuración', () => {
    const el = render({
      isAuthenticated: () => true,
      hasAnyRole: (roles: string[]) => roles.includes('promoter'),
    } as unknown as SessionStore);
    const l = links(el);
    expect(l).toContain('Perfil');
    expect(l).toContain('Configuración');
  });

  it('Términos y condiciones va en el bloque legal (hasta abajo), no en el menú', () => {
    const el = render({ isAuthenticated: () => false, hasAnyRole: () => false } as unknown as SessionStore);
    expect(links(el)).not.toContain('Términos y condiciones');
    const legal = [...el.querySelectorAll('.footer-legal a')].map((a) => a.textContent?.trim());
    expect(legal).toContain('Términos y condiciones');
  });
});
