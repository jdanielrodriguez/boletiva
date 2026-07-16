import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PublicConfigStore } from '../config/public-config.store';
import type { ThemeConfig } from '../api/public-config.api';
import { ThemeService } from './theme.service';

const CFG: ThemeConfig = {
  slots: { dia: 'marquesina', noche: 'pulso' },
  defaultFranja: 'noche',
  allowVisitorSwitch: true,
};

describe('ThemeService', () => {
  let theme: ThemeService;
  let themeSig: WritableSignal<ThemeConfig>;

  function setup(cfg: ThemeConfig = CFG): void {
    themeSig = signal<ThemeConfig>(cfg);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: PublicConfigStore, useValue: { theme: themeSig.asReadonly() } },
      ],
    });
    theme = TestBed.inject(ThemeService);
  }

  afterEach(() => {
    theme?.stopAuto();
    document.documentElement.removeAttribute('data-theme');
  });

  it('init aplica la franja por defecto (noche → pulso) y estampa data-theme', () => {
    setup();
    theme.init();
    expect(theme.franja()).toBe('noche');
    expect(theme.theme()).toBe('pulso');
    expect(document.documentElement.getAttribute('data-theme')).toBe('pulso');
  });

  it('use("dia") resuelve el tema asignado a la franja día (marquesina)', () => {
    setup();
    theme.use('dia');
    expect(theme.franja()).toBe('dia');
    expect(theme.theme()).toBe('marquesina');
    expect(document.documentElement.getAttribute('data-theme')).toBe('marquesina');
  });

  it('toggle alterna noche↔día', () => {
    setup();
    theme.init(); // noche
    theme.toggle();
    expect(theme.franja()).toBe('dia');
    theme.toggle();
    expect(theme.franja()).toBe('noche');
  });

  it('respeta la asignación admin volteada (noche→marquesina)', () => {
    setup({ ...CFG, slots: { dia: 'pulso', noche: 'marquesina' } });
    theme.init();
    expect(theme.theme()).toBe('marquesina'); // noche ahora apunta a marquesina
  });

  it('reapply re-resuelve la MISMA franja cuando el admin cambia el slot en vivo', () => {
    setup();
    theme.use('noche');
    expect(theme.theme()).toBe('pulso');
    // El admin reasigna la franja noche a marquesina.
    themeSig.update((t) => ({ ...t, slots: { ...t.slots, noche: 'marquesina' } }));
    theme.reapply();
    expect(theme.franja()).toBe('noche'); // la franja NO cambia
    expect(theme.theme()).toBe('marquesina'); // el tema resuelto SÍ
    expect(document.documentElement.getAttribute('data-theme')).toBe('marquesina');
  });

  it('canSwitch refleja el flag admin', () => {
    setup({ ...CFG, allowVisitorSwitch: false });
    expect(theme.canSwitch()).toBe(false);
  });

  it('tema automático por hora: oculta el botón (canSwitch=false) aunque el switch esté ON', () => {
    setup({ ...CFG, allowVisitorSwitch: true, autoByHour: true });
    expect(theme.autoByHour()).toBe(true);
    expect(theme.canSwitch()).toBe(false);
  });

  it('startAuto con franja DÍA todo el día (0–24) resuelve día→marquesina', () => {
    setup({ ...CFG, autoByHour: true, dayStartHour: 0, dayEndHour: 24 });
    theme.startAuto();
    expect(theme.autoFranja()).toBe('dia');
    expect(theme.franja()).toBe('dia');
    expect(theme.theme()).toBe('marquesina');
    expect(document.documentElement.getAttribute('data-theme')).toBe('marquesina');
  });

  it('startAuto con rango de día vacío (0–0) resuelve noche→pulso', () => {
    setup({ ...CFG, autoByHour: true, dayStartHour: 0, dayEndHour: 0 });
    theme.startAuto();
    expect(theme.autoFranja()).toBe('noche');
    expect(theme.franja()).toBe('noche');
    expect(theme.theme()).toBe('pulso');
  });

  it('hydrate(null) fuerza la franja por defecto de la plataforma', () => {
    setup({ ...CFG, defaultFranja: 'dia' });
    theme.use('noche');
    theme.hydrate(null);
    expect(theme.franja()).toBe('dia');
    expect(theme.theme()).toBe('marquesina');
  });
});
