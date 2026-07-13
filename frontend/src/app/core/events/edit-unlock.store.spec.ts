import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { EditUnlockStore } from './edit-unlock.store';

describe('EditUnlockStore (desbloqueo de edición admin)', () => {
  let store: EditUnlockStore;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    store = TestBed.inject(EditUnlockStore);
  });

  const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
  const past = () => new Date(Date.now() - 1000).toISOString();

  it('sin token: no está desbloqueado y el header es null', () => {
    store.setCurrentEvent('e1');
    expect(store.isUnlocked('e1')).toBe(false);
    expect(store.headerToken()).toBeNull();
  });

  it('setUnlock vigente: desbloquea y expone el token para el evento activo', () => {
    store.setCurrentEvent('e1');
    store.setUnlock('e1', 'tok-123', future());
    expect(store.isUnlocked('e1')).toBe(true);
    expect(store.headerToken()).toBe('tok-123');
  });

  it('token de otro evento no se envía como header del evento activo', () => {
    store.setUnlock('e2', 'tok-otro', future());
    store.setCurrentEvent('e1');
    expect(store.headerToken()).toBeNull();
    expect(store.isUnlocked('e2')).toBe(true);
  });

  it('token expirado no desbloquea (re-bloqueo)', () => {
    store.setCurrentEvent('e1');
    store.setUnlock('e1', 'viejo', past());
    expect(store.isUnlocked('e1')).toBe(false);
    expect(store.headerToken()).toBeNull();
  });

  it('el desbloqueo persiste al cambiar de evento activo y volver (entre tabs/asientos)', () => {
    store.setUnlock('e1', 'tok', future());
    store.setCurrentEvent('e1');
    expect(store.headerToken()).toBe('tok');
    store.clearCurrentEvent(); // salir de la vista
    expect(store.headerToken()).toBeNull();
    store.setCurrentEvent('e1'); // volver
    expect(store.headerToken()).toBe('tok'); // sigue desbloqueado
  });

  it('clearUnlock descarta el desbloqueo del evento', () => {
    store.setCurrentEvent('e1');
    store.setUnlock('e1', 'tok', future());
    store.clearUnlock('e1');
    expect(store.isUnlocked('e1')).toBe(false);
  });

  describe('persistencia en sessionStorage (W4 · sobrevive al F5)', () => {
    afterEach(() => sessionStorage.clear());

    /** Simula un F5: nueva instancia del store leyendo el sessionStorage vigente. */
    function reboot(): EditUnlockStore {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
      return TestBed.inject(EditUnlockStore);
    }

    it('setUnlock persiste; un F5 rehidrata el desbloqueo vigente con su token', () => {
      store.setUnlock('e1', 'tok-persist', future());
      expect(sessionStorage.getItem('pe_edit_unlock:e1')).toContain('tok-persist');

      const rebooted = reboot();
      rebooted.setCurrentEvent('e1');
      expect(rebooted.isUnlocked('e1')).toBe(true);
      expect(rebooted.headerToken()).toBe('tok-persist');
      expect(rebooted.remainingMs('e1')).toBeGreaterThan(0);
    });

    it('un F5 descarta (y purga) los desbloqueos vencidos', () => {
      sessionStorage.setItem(
        'pe_edit_unlock:e1',
        JSON.stringify({ token: 'viejo', expiresAt: Date.now() - 1000 }),
      );
      const rebooted = reboot();
      expect(rebooted.isUnlocked('e1')).toBe(false);
      expect(sessionStorage.getItem('pe_edit_unlock:e1')).toBeNull();
    });

    it('clearUnlock también borra la entrada de sessionStorage', () => {
      store.setUnlock('e1', 'tok', future());
      store.clearUnlock('e1');
      expect(sessionStorage.getItem('pe_edit_unlock:e1')).toBeNull();
    });

    it('clearCurrentEvent NO borra el desbloqueo persistido (navegar entre vistas)', () => {
      store.setUnlock('e1', 'tok', future());
      store.setCurrentEvent('e1');
      store.clearCurrentEvent();
      expect(sessionStorage.getItem('pe_edit_unlock:e1')).toContain('tok');
      // Tras un F5 sigue disponible.
      const rebooted = reboot();
      rebooted.setCurrentEvent('e1');
      expect(rebooted.headerToken()).toBe('tok');
    });
  });
});
