import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { AdminApi } from './admin.api';
import { AuthApi } from './auth.api';
import { EventsApi } from './events.api';
import { InventoryApi } from './inventory.api';
import { InvitationsApi } from './invitations.api';
import { OrdersApi } from './orders.api';
import { PaymentMethodsApi } from './payment-methods.api';
import { PromoterEventsApi } from './promoter-events.api';
import { ReservationsApi } from './reservations.api';

const BASE = 'http://api.test/api/v1';

/** Contrato del SDK (verbo + ruta) de los módulos aún sin cobertura dedicada. */
describe('SDK — contrato de rutas', () => {
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
  const hit = (method: string, path: string) => {
    const req = on((r) => r.url === `${BASE}${path}`);
    expect(req.request.method).toBe(method);
    req.flush({});
  };

  it('AuthApi cubre todos los verbos/rutas', () => {
    const a = TestBed.inject(AuthApi);
    a.login({ email: 'a@x.com', password: 'x' }).subscribe();
    hit('POST', '/auth/login');
    a.verify2fa({ preauthToken: 't', code: '1' } as never).subscribe();
    hit('POST', '/auth/2fa/verify');
    a.signup({ email: 'a@x.com', password: 'x', firstName: 'A' } as never).subscribe();
    hit('POST', '/auth/signup');
    a.me().subscribe();
    hit('GET', '/auth/me');
    a.providers().subscribe();
    hit('GET', '/auth/providers');
    a.refresh('r').subscribe();
    hit('POST', '/auth/refresh');
    a.logout('r').subscribe();
    hit('POST', '/auth/logout');
    a.changePassword({ currentPassword: 'a', newPassword: 'bbbbbbbb' }).subscribe();
    hit('POST', '/auth/change-password');
    a.forgotPassword({ email: 'a@x.com' }).subscribe();
    hit('POST', '/auth/forgot-password');
    a.resetPassword({ token: 't', password: 'bbbbbbbb' }).subscribe();
    hit('POST', '/auth/reset-password');
  });

  it('OrdersApi cubre create/list/get/paymentOptions/pay/ledgerChain', () => {
    const o = TestBed.inject(OrdersApi);
    o.create('e1', { seatIds: ['s1'] }).subscribe();
    hit('POST', '/events/e1/orders');
    o.list().subscribe();
    on((r) => r.url === `${BASE}/orders`).flush({ items: [], nextCursor: null });
    o.get('o1').subscribe();
    hit('GET', '/orders/o1');
    o.paymentOptions('o1').subscribe();
    hit('GET', '/orders/o1/payment-options');
    o.pay('o1', { gatewayId: 'g1' } as never).subscribe();
    hit('POST', '/orders/o1/pay');
    o.ledgerChain('o1').subscribe();
    hit('GET', '/orders/o1/ledger');
  });

  it('PaymentMethodsApi cubre list/add/setDefault/remove', () => {
    const p = TestBed.inject(PaymentMethodsApi);
    p.list().subscribe();
    hit('GET', '/payment-methods');
    p.add({ nonce: 'n', brand: 'visa', last4: '4242' }).subscribe();
    hit('POST', '/payment-methods');
    p.setDefault('c1').subscribe();
    hit('POST', '/payment-methods/c1/default');
    p.remove('c1').subscribe();
    hit('DELETE', '/payment-methods/c1');
  });

  it('AdminApi cubre promotores/cost-share/gateways/eventos', () => {
    const a = TestBed.inject(AdminApi);
    a.listPromoters('pending').subscribe();
    on((r) => r.url === `${BASE}/promoters`).flush([]);
    a.approvePromoter('u1').subscribe();
    hit('POST', '/promoters/u1/approve');
    a.rejectPromoter('u1', 'no').subscribe();
    hit('POST', '/promoters/u1/reject');
    a.suspendPromoter('u1').subscribe();
    hit('POST', '/promoters/u1/suspend');
    a.getRequireApproval().subscribe();
    hit('GET', '/promoters/settings');
    a.setRequireApproval(true).subscribe();
    hit('PATCH', '/promoters/settings');
    a.getDefaultPct().subscribe();
    hit('GET', '/cost-share/default');
    a.setDefaultPct(0.5).subscribe();
    hit('PATCH', '/cost-share/default');
    a.setPromoterPct('u1', 0.3).subscribe();
    hit('PATCH', '/cost-share/promoter/u1');
    a.listGateways().subscribe();
    on((r) => r.url === `${BASE}/payment-gateways`).flush([]);
    a.listAllEvents().subscribe();
    on((r) => r.url === `${BASE}/events/all`).flush([]);
  });

  it('EventsApi cubre listPublic/getBySlug/promoted/availability', () => {
    const e = TestBed.inject(EventsApi);
    e.listPublic({ skip: 0, take: 10, category: 'c', search: 'q' }).subscribe();
    on((r) => r.url === `${BASE}/events`).flush({ items: [], total: 0 });
    e.getBySlug('slug').subscribe();
    hit('GET', '/events/slug');
    e.promoted().subscribe();
    on((r) => r.url === `${BASE}/events/promoted`).flush([]);
    e.availability('e1').subscribe();
    hit('GET', '/events/e1/availability');
  });

  it('InventoryApi cubre hold/release', () => {
    const i = TestBed.inject(InventoryApi);
    i.hold('e1', { seatIds: ['s1'] } as never).subscribe();
    hit('POST', '/events/e1/holds');
    i.release('e1', ['s1']).subscribe();
    const req = on((r) => r.url === `${BASE}/events/e1/holds` && r.method === 'DELETE');
    req.flush({ released: 1 });
  });

  it('ReservationsApi cubre create/getByToken/checkout', () => {
    const r = TestBed.inject(ReservationsApi);
    r.create('e1', { items: [] } as never).subscribe();
    hit('POST', '/events/e1/reservations');
    r.getByToken('tok').subscribe();
    hit('GET', '/reservations/tok');
    r.checkout('tok', {} as never).subscribe();
    hit('POST', '/reservations/tok/checkout');
  });

  it('InvitationsApi cubre create/list/revoke/peek/accept', () => {
    const inv = TestBed.inject(InvitationsApi);
    inv.create(['a@x.com']).subscribe();
    hit('POST', '/promoters/invitations');
    inv.list().subscribe();
    on((r) => r.url === `${BASE}/promoters/invitations`).flush([]);
    inv.revoke('i1').subscribe();
    hit('DELETE', '/promoters/invitations/i1');
    inv.peek('tok').subscribe();
    on((r) => r.url === `${BASE}/promoters/invitations/peek`).flush({});
    inv.accept('tok').subscribe();
    hit('POST', '/promoters/invitations/accept');
  });

  it('PromoterEventsApi cubre CRUD + banner + localidades', () => {
    const p = TestBed.inject(PromoterEventsApi);
    p.mine().subscribe();
    on((r) => r.url === `${BASE}/events/mine`).flush([]);
    p.get('e1').subscribe();
    hit('GET', '/events/e1/manage');
    p.create({ name: 'X' } as never).subscribe();
    on((r) => r.url === `${BASE}/events`).flush({});
    p.update('e1', {} as never).subscribe();
    hit('PATCH', '/events/e1');
    p.publish('e1').subscribe();
    hit('POST', '/events/e1/publish');
    p.cancel('e1').subscribe();
    hit('POST', '/events/e1/cancel');
    p.generateBanner('e1').subscribe();
    hit('POST', '/events/e1/banner');
    p.localities('e1').subscribe();
    on((r) => r.url === `${BASE}/events/e1/localities`).flush([]);
    p.addLocality('e1', { name: 'VIP' } as never).subscribe();
    on((r) => r.url === `${BASE}/events/e1/localities` && r.method === 'POST').flush({});
  });
});
