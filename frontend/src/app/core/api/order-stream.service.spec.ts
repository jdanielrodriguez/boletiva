import { provideHttpClient } from '@angular/common/http';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TokenStore } from '../auth/token-store.service';
import { API_BASE_URL } from '../config/api.tokens';
import { OrderStreamEvent, OrderStreamService } from './order-stream.service';

const BASE = 'http://api.test/api/v1';

/** EventSource falso: captura listeners y expone helpers para emitir eventos. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 0;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, (ev: MessageEvent) => void>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
    this.listeners.set(type, cb);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data } as MessageEvent);
  }
}

describe('OrderStreamService', () => {
  let originalES: typeof EventSource;

  function build(platform: 'browser' | 'server'): { svc: OrderStreamService; tokens: TokenStore } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        { provide: API_BASE_URL, useValue: BASE },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    return { svc: TestBed.inject(OrderStreamService), tokens: TestBed.inject(TokenStore) };
  }

  beforeEach(() => {
    originalES = (globalThis as { EventSource: typeof EventSource }).EventSource;
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalES;
  });

  it('en SSR devuelve un Observable que no abre EventSource', () => {
    const { svc } = build('server');
    let emitted = false;
    const sub = svc.stream('o1').subscribe(() => (emitted = true));
    expect(FakeEventSource.instances.length).toBe(0);
    expect(emitted).toBe(false);
    sub.unsubscribe();
  });

  it('abre EventSource con el access_token codificado en la query', () => {
    const { svc, tokens } = build('browser');
    tokens.setAccessToken('a b/c');
    const sub = svc.stream('o1').subscribe();
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(`${BASE}/orders/o1/stream?access_token=${encodeURIComponent('a b/c')}`);
    sub.unsubscribe();
  });

  it('sin token usa cadena vacía', () => {
    const { svc } = build('browser');
    const sub = svc.stream('o1').subscribe();
    expect(FakeEventSource.instances[0].url).toContain('access_token=');
    expect(FakeEventSource.instances[0].url.endsWith('access_token=')).toBe(true);
    sub.unsubscribe();
  });

  it('reenvía y parsea JSON de snapshot/order/seat/wallet', () => {
    const { svc } = build('browser');
    const events: OrderStreamEvent[] = [];
    const sub = svc.stream('o1').subscribe((e) => events.push(e));
    const es = FakeEventSource.instances[0];
    es.emit('snapshot', '{"status":"pending"}');
    es.emit('order', '{"status":"paid"}');
    es.emit('seat', '{"sold":["s1"]}');
    es.emit('wallet', '{"balance":100}');
    expect(events.map((e) => e.type)).toEqual(['snapshot', 'order', 'seat', 'wallet']);
    expect(events[1].data).toEqual({ status: 'paid' });
    expect(events[3].data).toEqual({ balance: 100 });
    sub.unsubscribe();
  });

  it('si el data no es JSON válido reenvía el texto crudo', () => {
    const { svc } = build('browser');
    const events: OrderStreamEvent[] = [];
    const sub = svc.stream('o1').subscribe((e) => events.push(e));
    FakeEventSource.instances[0].emit('order', 'no-es-json');
    expect(events[0].data).toBe('no-es-json');
    sub.unsubscribe();
  });

  it('onerror completa el stream solo si el servidor cerró (readyState CLOSED)', () => {
    const { svc } = build('browser');
    let completed = false;
    const sub = svc.stream('o1').subscribe({ complete: () => (completed = true) });
    const es = FakeEventSource.instances[0];

    es.readyState = 0; // reconectando: no completa
    es.onerror?.();
    expect(completed).toBe(false);

    es.readyState = FakeEventSource.CLOSED;
    es.onerror?.();
    expect(completed).toBe(true);
    sub.unsubscribe();
  });

  it('al desuscribir cierra el EventSource', () => {
    const { svc } = build('browser');
    const sub = svc.stream('o1').subscribe();
    const es = FakeEventSource.instances[0];
    expect(es.closed).toBe(false);
    sub.unsubscribe();
    expect(es.closed).toBe(true);
  });
});
