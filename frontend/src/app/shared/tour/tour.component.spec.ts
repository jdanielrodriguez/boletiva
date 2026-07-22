import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { UsersApi } from '../../core/api/users.api';
import { PublicConfigStore } from '../../core/config/public-config.store';
import { initI18nTesting, provideI18nTesting } from '../../core/i18n/testing';
import { TourComponent } from './tour.component';

/**
 * Rework del tour: PROMPT (¿sí/no?) → SPOTLIGHT invasivo, con persistencia por navegador
 * (status/at/views) → se reofrece tras `tourResetDays` y se calla tras 3 ofertas.
 */
describe('TourComponent', () => {
  let fixture: ComponentFixture<TourComponent>;
  const user = signal<{ toursSeen?: string[] } | null>(null);
  const tourEnabled = signal(true);
  const tourResetDays = signal(30);
  const configLoaded = signal(true);
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
          useValue: {
            tourEnabled: tourEnabled.asReadonly(),
            tourResetDays: tourResetDays.asReadonly(),
            loaded: configLoaded.asReadonly(),
          },
        },
      ],
    });
    initI18nTesting();
    fixture = TestBed.createComponent(TourComponent);
    fixture.componentRef.setInput('tourKey', 'home');
    fixture.componentRef.setInput('steps', [
      { title: 'tour.home.welcomeTitle', body: 'tour.home.welcomeBody' },
      { title: 'tour.home.buyTitle', body: 'tour.home.buyBody' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable(); // afterNextRender
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const shown = () => !!el().querySelector('[data-testid="tour"]');
  const click = (id: string) => el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click();

  beforeEach(() => {
    localStorage.clear();
    user.set({ toursSeen: [] });
    tourEnabled.set(true);
    tourResetDays.set(30);
    configLoaded.set(true);
    sessionLoaded.set(true);
    markTourSeen.calls.reset();
  });
  afterEach(() => localStorage.clear());

  it('flag apagado → nunca ofrece el tour', async () => {
    tourEnabled.set(false);
    await render();
    expect(shown()).toBe(false);
  });

  it('logueado sin registro → OFRECE el prompt (¿sí/no?)', async () => {
    await render();
    expect(shown()).toBe(true);
    expect(el().querySelector('[data-testid="tour-yes"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="tour-no"]')).not.toBeNull();
  });

  it('aceptar → entra al modo guiado (tarjeta con pasos: next/finish)', async () => {
    await render();
    click('tour-yes');
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="tour-next"]')).not.toBeNull();
    // Avanza al último paso y termina → persiste "done".
    click('tour-next');
    fixture.detectChanges();
    click('tour-finish');
    fixture.detectChanges();
    expect(shown()).toBe(false);
    const rec = JSON.parse(localStorage.getItem('pe.tour.v2.home')!);
    expect(rec.status).toBe('done');
    expect(markTourSeen).toHaveBeenCalled();
  });

  it('rechazar (No, gracias) → se guarda "dismissed" y no reaparece dentro de la ventana', async () => {
    await render();
    click('tour-no');
    fixture.detectChanges();
    expect(shown()).toBe(false);
    const rec = JSON.parse(localStorage.getItem('pe.tour.v2.home')!);
    expect(rec.status).toBe('dismissed');
  });

  it('registro reciente (dentro de tourResetDays) → no se ofrece', async () => {
    localStorage.setItem('pe.tour.v2.home', JSON.stringify({ status: 'done', at: Date.now(), views: 1 }));
    await render();
    expect(shown()).toBe(false);
  });

  it('registro VIEJO (más allá de la ventana) → se reofrece', async () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 días > 30
    localStorage.setItem('pe.tour.v2.home', JSON.stringify({ status: 'done', at: old, views: 1 }));
    await render();
    expect(shown()).toBe(true);
  });

  it('ofrecido 3 veces sin interactuar → se calla', async () => {
    localStorage.setItem('pe.tour.v2.home', JSON.stringify({ views: 3 }));
    await render();
    expect(shown()).toBe(false);
  });

  it('anónimo NO elegido en la tirada → no se ofrece', async () => {
    user.set(null);
    spyOn(Math, 'random').and.returnValue(0.8); // roll 80 >= 50
    await render();
    expect(shown()).toBe(false);
  });

  it('anónimo elegido (<50%) con config cargada → ofrece el prompt', async () => {
    user.set(null);
    spyOn(Math, 'random').and.returnValue(0.2); // roll 20 < 50
    await render();
    expect(shown()).toBe(true);
    expect(markTourSeen).not.toHaveBeenCalled(); // sin sesión no pega al backend
  });
});
