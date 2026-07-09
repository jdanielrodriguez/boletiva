import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { OrdersApi } from './orders.api';
import { TicketsApi } from './tickets.api';
import { TransfersApi } from './transfers.api';
import { UsersApi } from './users.api';
import { WalletApi } from './wallet.api';

const BASE = 'http://api.test/api/v1';

/** Contrato del SDK de la cuenta (F3): verbo + ruta + cuerpo de cada método. */
describe('SDK de cuenta (F3)', () => {
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: BASE },
      ],
    });
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  const on = (pred: (r: HttpRequest<unknown>) => boolean) => mock.expectOne(pred);

  it('UsersApi.updateMe → PATCH /users/me con el cuerpo', () => {
    TestBed.inject(UsersApi).updateMe({ firstName: 'Ana' }).subscribe();
    const req = on((r) => r.url === `${BASE}/users/me`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ firstName: 'Ana' });
    req.flush({});
  });

  it('WalletApi.balance → GET /wallet', () => {
    TestBed.inject(WalletApi).balance().subscribe();
    const req = on((r) => r.url === `${BASE}/wallet`);
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('WalletApi.withdrawals → GET /wallet/withdrawals con limit', () => {
    TestBed.inject(WalletApi).withdrawals().subscribe();
    const req = on((r) => r.url === `${BASE}/wallet/withdrawals`);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ items: [], nextCursor: null });
  });

  it('WalletApi.requestWithdrawal → POST /wallet/withdrawals con monto', () => {
    TestBed.inject(WalletApi).requestWithdrawal({ amount: 100 }).subscribe();
    const req = on((r) => r.url === `${BASE}/wallet/withdrawals`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ amount: 100 });
    req.flush({});
  });

  it('WalletApi.cancelWithdrawal → DELETE /wallet/withdrawals/:id', () => {
    TestBed.inject(WalletApi).cancelWithdrawal('w1').subscribe();
    const req = on((r) => r.url === `${BASE}/wallet/withdrawals/w1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('TicketsApi.list → GET /tickets con limit', () => {
    TestBed.inject(TicketsApi).list().subscribe();
    const req = on((r) => r.url === `${BASE}/tickets`);
    expect(req.request.params.get('limit')).toBe('100');
    req.flush({ items: [], nextCursor: null });
  });

  it('TicketsApi.media → GET /tickets/:id/media', () => {
    TestBed.inject(TicketsApi).media('t1').subscribe();
    on((r) => r.url === `${BASE}/tickets/t1/media`).flush({});
  });

  it('TicketsApi.transfer → POST /tickets/:id/transfer', () => {
    TestBed.inject(TicketsApi).transfer('t1').subscribe();
    const req = on((r) => r.url === `${BASE}/tickets/t1/transfer`);
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('TransfersApi.claim → POST /tickets/transfers/claim con código', () => {
    TestBed.inject(TransfersApi).claim('ABC123').subscribe();
    const req = on((r) => r.url === `${BASE}/tickets/transfers/claim`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ code: 'ABC123' });
    req.flush({});
  });

  it('TransfersApi.outgoing → GET /tickets/transfers/outgoing', () => {
    TestBed.inject(TransfersApi).outgoing().subscribe();
    on((r) => r.url === `${BASE}/tickets/transfers/outgoing`).flush([]);
  });

  it('TransfersApi.cancel → DELETE /tickets/transfers/:id', () => {
    TestBed.inject(TransfersApi).cancel('tr1').subscribe();
    const req = on((r) => r.url === `${BASE}/tickets/transfers/tr1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});
  });

  it('OrdersApi.list → GET /orders con limit', () => {
    TestBed.inject(OrdersApi).list().subscribe();
    const req = on((r) => r.url === `${BASE}/orders`);
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ items: [], nextCursor: null });
  });
});
