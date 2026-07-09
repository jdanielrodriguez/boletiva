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

describe('Footer', () => {
  it('invitado: muestra iniciar sesión y crear cuenta', () => {
    const el = render({ isAuthenticated: () => false, hasAnyRole: () => false } as unknown as SessionStore);
    const l = links(el);
    expect(l).toContain('Iniciar sesión');
    expect(l).toContain('Crear cuenta');
    expect(l).not.toContain('Perfil');
  });

  it('logueado (comprador): muestra perfil y convertirse en promotor', () => {
    const el = render({ isAuthenticated: () => true, hasAnyRole: () => false } as unknown as SessionStore);
    const l = links(el);
    expect(l).toContain('Perfil');
    expect(l).toContain('Convertirse en promotor');
    expect(l).not.toContain('Iniciar sesión');
  });

  it('logueado (promotor): oculta convertirse en promotor', () => {
    const el = render({
      isAuthenticated: () => true,
      hasAnyRole: (roles: string[]) => roles.includes('promoter'),
    } as unknown as SessionStore);
    const l = links(el);
    expect(l).toContain('Perfil');
    expect(l).not.toContain('Convertirse en promotor');
  });
});
