import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { TourComponent } from './tour.component';

/**
 * Cubre las reglas de aparición del tour: flag global, logueado (una vez por perfil)
 * y anónimo (activación aleatoria estable + "visto" en localStorage), validando que
 * NUNCA aparece con el flag apagado ni antes de que la config real cargue.
 */
describe('TourComponent', () => {
  let fixture: ComponentFixture<TourComponent>;
  const user = signal<{ toursSeen?: string[] } | null>(null);
  const tourEnabled = signal(true);
  const configLoaded = signal(false);
  const sessionLoaded = signal(true);
  const markTourSeen = jasmine.createSpy('markTourSeen').and.returnValue(of({}));

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ...provideI18nTesting(),
        { provide: SessionStore, useValue: { user, loaded: sessionLoaded, setUser: () => undefined } },
        { provide: UsersApi, useValue: { markTourSeen } },
        {
          provide: PublicConfigStore,
          useValue: { tourEnabled: tourEnabled.asReadonly(), loaded: configLoaded.asReadonly() },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(TourComponent);
    fixture.componentRef.setInput('tourKey', 'home');
    fixture.componentRef.setInput('steps', [
      { title: 'tour.home.welcomeTitle', body: 'tour.home.welcomeBody' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable(); // deja correr afterNextRender (tirada anónima)
    fixture.detectChanges();
  }

  const shown = () => !!(fixture.nativeElement as HTMLElement).querySelector('[data-testid="tour"]');

  beforeEach(() => {
    localStorage.clear();
    user.set(null);
    tourEnabled.set(true);
    configLoaded.set(false);
    sessionLoaded.set(true);
    markTourSeen.calls.reset();
  });
  afterEach(() => localStorage.clear());

  it('flag apagado → nunca se muestra (ni a logueado sin verlo)', async () => {
    tourEnabled.set(false);
    user.set({ toursSeen: [] });
    await render();
    expect(shown()).toBe(false);
  });

  it('logueado que NO lo ha visto → se muestra', async () => {
    user.set({ toursSeen: [] });
    await render();
    expect(shown()).toBe(true);
  });

  it('logueado que YA lo vio → no se muestra', async () => {
    user.set({ toursSeen: ['home'] });
    await render();
    expect(shown()).toBe(false);
  });

  it('anónimo con la config REAL sin cargar → no se muestra (default seguro / tests)', async () => {
    configLoaded.set(false);
    spyOn(Math, 'random').and.returnValue(0.1); // saldría elegido, pero config no cargó
    await render();
    expect(shown()).toBe(false);
  });

  it('anónimo elegido en la tirada (<50%) con config cargada → se muestra y persiste "visto"', async () => {
    configLoaded.set(true);
    spyOn(Math, 'random').and.returnValue(0.2); // roll 20 < 50 → elegido
    await render();
    expect(shown()).toBe(true);
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="tour-finish"]')!
      .click();
    fixture.detectChanges();
    expect(shown()).toBe(false);
    expect(localStorage.getItem('pe.tour.seen.home')).toBe('1'); // anónimo → localStorage
    expect(markTourSeen).not.toHaveBeenCalled(); // sin perfil, no pega al backend
  });

  it('anónimo NO elegido (>=50%) → no se muestra', async () => {
    configLoaded.set(true);
    spyOn(Math, 'random').and.returnValue(0.8); // roll 80 >= 50 → no elegido
    await render();
    expect(shown()).toBe(false);
  });

  it('anónimo que ya lo vio (localStorage) → no se muestra aunque saldría elegido', async () => {
    configLoaded.set(true);
    localStorage.setItem('pe.tour.seen.home', '1');
    spyOn(Math, 'random').and.returnValue(0.1);
    await render();
    expect(shown()).toBe(false);
  });
});
