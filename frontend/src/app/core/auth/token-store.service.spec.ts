import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TokenStore } from './token-store.service';

describe('TokenStore', () => {
  let store: TokenStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    store = TestBed.inject(TokenStore);
  });

  afterEach(() => localStorage.clear());

  it('arranca sin access ni marca de sesión', () => {
    expect(store.getAccessToken()).toBeNull();
    expect(store.hasSessionHint()).toBe(false);
    expect(store.hasSession()).toBe(false);
  });

  it('setAccessToken guarda access en memoria y marca la sesión (refresh en cookie)', () => {
    store.setAccessToken('acc');
    expect(store.getAccessToken()).toBe('acc');
    expect(store.hasSessionHint()).toBe(true);
    expect(localStorage.getItem('pe_session')).toBe('1');
    expect(store.hasSession()).toBe(true);
    // El refresh NUNCA se persiste en el cliente.
    expect(localStorage.getItem('pe_refresh')).toBeNull();
  });

  it('markSession marca la sesión sin fijar access', () => {
    store.markSession();
    expect(store.getAccessToken()).toBeNull();
    expect(store.hasSessionHint()).toBe(true);
    expect(store.hasSession()).toBe(true);
  });

  it('clear borra access y la marca de sesión', () => {
    store.setAccessToken('acc');
    store.clear();
    expect(store.getAccessToken()).toBeNull();
    expect(store.hasSessionHint()).toBe(false);
    expect(localStorage.getItem('pe_session')).toBeNull();
  });

  it('rehidrata la marca de sesión desde localStorage al construirse', () => {
    localStorage.setItem('pe_session', '1');
    const fresh = TestBed.runInInjectionContext(() => new TokenStore());
    expect(fresh.hasSessionHint()).toBe(true);
    expect(fresh.getAccessToken()).toBeNull(); // el access nunca se persiste
  });
});
