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

  it('arranca sin tokens', () => {
    expect(store.getAccessToken()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
    expect(store.hasSession()).toBe(false);
  });

  it('setTokens guarda access en memoria y refresh en localStorage', () => {
    store.setTokens('acc', 'ref');
    expect(store.getAccessToken()).toBe('acc');
    expect(store.getRefreshToken()).toBe('ref');
    expect(localStorage.getItem('pe_refresh')).toBe('ref');
    expect(store.hasSession()).toBe(true);
  });

  it('setAccessToken solo cambia el access', () => {
    store.setTokens('acc', 'ref');
    store.setAccessToken('acc2');
    expect(store.getAccessToken()).toBe('acc2');
    expect(store.getRefreshToken()).toBe('ref');
  });

  it('clear borra todo, incluido localStorage', () => {
    store.setTokens('acc', 'ref');
    store.clear();
    expect(store.getAccessToken()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('pe_refresh')).toBeNull();
  });

  it('rehidrata el refresh desde localStorage al construirse', () => {
    localStorage.setItem('pe_refresh', 'persisted');
    const fresh = TestBed.runInInjectionContext(() => new TokenStore());
    expect(fresh.getRefreshToken()).toBe('persisted');
  });
});
