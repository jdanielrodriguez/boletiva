import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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

  function build(platform: 'browser' | 'server'): { svc: OrderStreamService; http: HttpTestingController } {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    return { svc: TestBed.inject(OrderStreamService), http: TestBed.inject(HttpTestingController) };
  }

  beforeEach(() => {
    originalES = (globalThis as { EventSource: typeof EventSource }).EventSource;
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = originalES;
  });

  /** Responde el POST del ticket y espera un tick para que se abra el EventSource. */
  async function flushTicketAndOpen(http: HttpTestingController, orderId: string, ticket = 'TKT'): Promise<void> {
    const req = http.expectOne(`${BASE}/orders/${orderId}/stream-ticket`);
    expect(req.request.method).toBe('POST');
    req.flush({ ticket, expiresIn: 60 });
    await new Promise((r) => setTimeout(r)); // deja correr el .then que abre EventSource
  }

  it('en SSR devuelve un Observable que no abre EventSource ni pide ticket', () => {
    const { svc, http } = build('server');
    let emitted = false;
    const sub = svc.stream('o1').subscribe(() => (emitted = true));
    http.expectNone(`${BASE}/orders/o1/stream-ticket`);
    expect(FakeEventSource.instances.length).toBe(0);
    expect(emitted).toBe(false);
    sub.unsubscribe();
  });

  it('H4: pide un ticket (POST) y abre EventSource con ?ticket= (sin access token en la URL)', async () => {
    const { svc, http } = build('browser');
    const sub = svc.stream('o1').subscribe();
    await flushTicketAndOpen(http, 'o1', 'a b/c');
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(`${BASE}/orders/o1/stream?ticket=${encodeURIComponent('a b/c')}`);
    expect(es.url).not.toContain('access_token');
    sub.unsubscribe();
  });

  it('reenvía y parsea JSON de snapshot/order/seat/wallet', async () => {
    const { svc, http } = build('browser');
    const events: OrderStreamEvent[] = [];
    const sub = svc.stream('o1').subscribe((e) => events.push(e));
    await flushTicketAndOpen(http, 'o1');
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

  it('si el data no es JSON válido reenvía el texto crudo', async () => {
    const { svc, http } = build('browser');
    const events: OrderStreamEvent[] = [];
    const sub = svc.stream('o1').subscribe((e) => events.push(e));
    await flushTicketAndOpen(http, 'o1');
    FakeEventSource.instances[0].emit('order', 'no-es-json');
    expect(events[0].data).toBe('no-es-json');
    sub.unsubscribe();
  });

  it('onerror completa el stream solo si el servidor cerró (readyState CLOSED)', async () => {
    const { svc, http } = build('browser');
    let completed = false;
    const sub = svc.stream('o1').subscribe({ complete: () => (completed = true) });
    await flushTicketAndOpen(http, 'o1');
    const es = FakeEventSource.instances[0];

    es.readyState = 0; // reconectando: no completa
    es.onerror?.();
    expect(completed).toBe(false);

    es.readyState = FakeEventSource.CLOSED;
    es.onerror?.();
    expect(completed).toBe(true);
    sub.unsubscribe();
  });

  it('al desuscribir cierra el EventSource', async () => {
    const { svc, http } = build('browser');
    const sub = svc.stream('o1').subscribe();
    await flushTicketAndOpen(http, 'o1');
    const es = FakeEventSource.instances[0];
    expect(es.closed).toBe(false);
    sub.unsubscribe();
    expect(es.closed).toBe(true);
  });
});
