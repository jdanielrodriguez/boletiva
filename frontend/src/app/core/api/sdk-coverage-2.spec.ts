import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../config/api.tokens';
import { AdminApi } from './admin.api';
import { HallsApi } from './halls.api';
import { MediaApi } from './media.api';
import { PromoterEventsApi } from './promoter-events.api';
import { SeatTemplatesApi } from './seat-templates.api';
import { UsersApi } from './users.api';

const BASE = 'http://api.test/api/v1';

/**
 * Contrato del SDK (verbo + ruta + body + params) de los métodos aún sin cobertura
 * dedicada tras `sdk-coverage.spec.ts`. Verifica comportamiento real: método HTTP,
 * URL exacta, cuerpo enviado y query params.
 */
describe('SDK — contrato de rutas (2)', () => {
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

  describe('AdminApi — métodos no cubiertos', () => {
    let a: AdminApi;
    beforeEach(() => (a = TestBed.inject(AdminApi)));

    it('listPromoters con y sin status arma el query param', () => {
      a.listPromoters().subscribe();
      const noFilter = on((r) => r.url === `${BASE}/promoters`);
      expect(noFilter.request.params.has('status')).toBe(false);
      noFilter.flush([]);

      a.listPromoters('pending').subscribe();
      const filtered = on((r) => r.url === `${BASE}/promoters`);
      expect(filtered.request.params.get('status')).toBe('pending');
      filtered.flush([]);
    });

    it('rejectPromoter y suspendPromoter mandan la nota en el body', () => {
      a.rejectPromoter('u1', 'motivo').subscribe();
      const rej = on((r) => r.url === `${BASE}/promoters/u1/reject`);
      expect(rej.request.method).toBe('POST');
      expect(rej.request.body).toEqual({ note: 'motivo' });
      rej.flush({});

      a.suspendPromoter('u2').subscribe();
      const sus = on((r) => r.url === `${BASE}/promoters/u2/suspend`);
      expect(sus.request.body).toEqual({ note: undefined });
      sus.flush({});
    });

    it('promoterHistory pega al historial del promotor', () => {
      a.promoterHistory('u1').subscribe();
      const req = on((r) => r.url === `${BASE}/promoters/u1/history`);
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });

    it('cost-share: get/reset override del promotor', () => {
      a.getPromoterCostShare('u1').subscribe();
      const g = on((r) => r.url === `${BASE}/cost-share/promoter/u1`);
      expect(g.request.method).toBe('GET');
      g.flush({});

      a.resetPromoterCostShare('u1').subscribe();
      const d = on((r) => r.url === `${BASE}/cost-share/promoter/u1`);
      expect(d.request.method).toBe('DELETE');
      d.flush({});
    });

    it('setPromoterPct manda pct en el body', () => {
      a.setPromoterPct('u1', 0.3).subscribe();
      const req = on((r) => r.url === `${BASE}/cost-share/promoter/u1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ pct: 0.3 });
      req.flush({});
    });

    it('setPromoterNote manda la nota', () => {
      a.setPromoterNote('u1', 'apunte').subscribe();
      const req = on((r) => r.url === `${BASE}/promoters/u1/note`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ note: 'apunte' });
      req.flush({});
    });

    it('pasarelas: unlock/create/update/setStatus/makeDefault/delete', () => {
      a.unlockGateway().subscribe();
      on((r) => r.url === `${BASE}/payment-gateways/unlock` && r.method === 'POST').flush({});

      a.createGateway({ name: 'Pagalo', installmentRates: { '3': 0.08 } } as never).subscribe();
      const c = on((r) => r.url === `${BASE}/payment-gateways` && r.method === 'POST');
      expect((c.request.body as { name: string }).name).toBe('Pagalo');
      c.flush({});

      a.updateGateway('g1', { feePct: 0.05 } as never).subscribe();
      const u = on((r) => r.url === `${BASE}/payment-gateways/g1`);
      expect(u.request.method).toBe('PATCH');
      u.flush({});

      a.setGatewayStatus('g1', 'maintenance').subscribe();
      const s = on((r) => r.url === `${BASE}/payment-gateways/g1/status`);
      expect(s.request.method).toBe('PATCH');
      expect(s.request.body).toEqual({ status: 'maintenance' });
      s.flush({});

      a.makeGatewayDefault('g1').subscribe();
      on((r) => r.url === `${BASE}/payment-gateways/g1/make-default` && r.method === 'POST').flush({});

      a.deleteGateway('g1').subscribe();
      on((r) => r.url === `${BASE}/payment-gateways/g1` && r.method === 'DELETE').flush({});
    });
  });

  describe('PromoterEventsApi — métodos no cubiertos', () => {
    let p: PromoterEventsApi;
    beforeEach(() => (p = TestBed.inject(PromoterEventsApi)));

    it('suspend/remove del evento', () => {
      p.suspend('e1').subscribe();
      on((r) => r.url === `${BASE}/events/e1/suspend` && r.method === 'POST').flush({});
      p.remove('e1').subscribe();
      on((r) => r.url === `${BASE}/events/e1` && r.method === 'DELETE').flush({});
    });

    it('generateBanner sin opciones manda body vacío', () => {
      p.generateBanner('e1').subscribe();
      const req = on((r) => r.url === `${BASE}/events/e1/banner`);
      expect(req.request.body).toEqual({});
      req.flush({});
    });

    it('generateBanner con opciones manda el prompt', () => {
      p.generateBanner('e1', { prompt: 'neón' } as never).subscribe();
      const req = on((r) => r.url === `${BASE}/events/e1/banner`);
      expect(req.request.body).toEqual({ prompt: 'neón' });
      req.flush({});
    });

    it('settlement/activeGateways', () => {
      p.settlement('e1').subscribe();
      on((r) => r.url === `${BASE}/events/e1/settlement` && r.method === 'GET').flush({});
      p.activeGateways().subscribe();
      on((r) => r.url === `${BASE}/payment-gateways/active`).flush([]);
    });

    it('transactions arma cursor+limit (con y sin cursor)', () => {
      p.transactions('e1').subscribe();
      const noCursor = on((r) => r.url === `${BASE}/events/e1/transactions`);
      expect(noCursor.request.params.has('cursor')).toBe(false);
      expect(noCursor.request.params.get('limit')).toBe('20');
      noCursor.flush({});

      p.transactions('e1', 'c9', 50).subscribe();
      const withCursor = on((r) => r.url === `${BASE}/events/e1/transactions`);
      expect(withCursor.request.params.get('cursor')).toBe('c9');
      expect(withCursor.request.params.get('limit')).toBe('50');
      withCursor.flush({});
    });

    it('quote codifica el neto en la query', () => {
      p.quote(129.68).subscribe();
      const req = on((r) => r.url === `${BASE}/pricing/quote?net=129.68`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });

    it('localidades: update/remove', () => {
      p.updateLocality('l1', { name: 'VIP' }).subscribe();
      const u = on((r) => r.url === `${BASE}/localities/l1`);
      expect(u.request.method).toBe('PATCH');
      u.flush({});
      p.removeLocality('l1').subscribe();
      on((r) => r.url === `${BASE}/localities/l1` && r.method === 'DELETE').flush({});
    });

    it('asientos: list/bulk/delete-con-cuerpo', () => {
      p.seats('l1').subscribe();
      on((r) => r.url === `${BASE}/localities/l1/seats` && r.method === 'GET').flush([]);

      p.bulkSeats('l1', [{ label: 'A1' }]).subscribe();
      const b = on((r) => r.url === `${BASE}/localities/l1/seats` && r.method === 'POST');
      expect(b.request.body).toEqual({ seats: [{ label: 'A1' }] });
      b.flush({ created: 1, capacity: 1 });

      p.deleteSeats('l1', ['s1', 's2']).subscribe();
      const d = on((r) => r.url === `${BASE}/localities/l1/seats` && r.method === 'DELETE');
      expect(d.request.body).toEqual({ ids: ['s1', 's2'] });
      d.flush({ deleted: 2, capacity: 0 });
    });
  });

  describe('SeatTemplatesApi — ciclo de vida', () => {
    let t: SeatTemplatesApi;
    beforeEach(() => (t = TestBed.inject(SeatTemplatesApi)));

    it('listAll y las transiciones publish/unpublish/hide/unhide/disable/enable', () => {
      t.listAll().subscribe();
      on((r) => r.url === `${BASE}/seat-templates/all`).flush([]);
      for (const verb of ['publish', 'unpublish', 'hide', 'unhide', 'disable', 'enable'] as const) {
        (t[verb] as (id: string) => { subscribe(): void })('t1').subscribe();
        on((r) => r.url === `${BASE}/seat-templates/t1/${verb}` && r.method === 'POST').flush({});
      }
    });
  });

  describe('HallsApi — ciclo de vida', () => {
    let h: HallsApi;
    beforeEach(() => (h = TestBed.inject(HallsApi)));

    it('listAll y publish/unpublish', () => {
      h.listAll().subscribe();
      on((r) => r.url === `${BASE}/halls/all`).flush([]);
      h.publish('h1').subscribe();
      on((r) => r.url === `${BASE}/halls/h1/publish` && r.method === 'POST').flush({});
      h.unpublish('h1').subscribe();
      on((r) => r.url === `${BASE}/halls/h1/unpublish` && r.method === 'POST').flush({});
    });
  });

  describe('MediaApi — presign/register/put/uploadBanner', () => {
    let m: MediaApi;
    beforeEach(() => (m = TestBed.inject(MediaApi)));

    it('presign manda filename+contentType', () => {
      m.presign('e1', { filename: 'a.png', contentType: 'image/png' }).subscribe();
      const req = on((r) => r.url === `${BASE}/events/e1/media/presign`);
      expect(req.request.body).toEqual({ filename: 'a.png', contentType: 'image/png' });
      req.flush({ key: 'k', uploadUrl: 'https://s3/put' });
    });

    it('register asocia la key al evento', () => {
      m.register('e1', { key: 'k', kind: 'cover', position: 0 }).subscribe();
      const req = on((r) => r.url === `${BASE}/events/e1/media`);
      expect(req.request.body).toEqual({ key: 'k', kind: 'cover', position: 0 });
      req.flush({});
    });

    it('put sube el archivo a la URL firmada con su content-type (sin baseUrl)', () => {
      const file = new File(['x'], 'a.png', { type: 'image/png' });
      m.put('https://s3/put', file).subscribe();
      const req = on((r) => r.url === 'https://s3/put' && r.method === 'PUT');
      expect(req.request.headers.get('Content-Type')).toBe('image/png');
      req.flush({});
    });

    it('uploadBanner encadena presign → PUT a S3 → register como cover', () => {
      const file = new File(['x'], 'banner.jpg', { type: 'image/jpeg' });
      let result: { key: string } | undefined;
      m.uploadBanner('e1', file).subscribe((r) => (result = r as { key: string }));

      const presign = on((r) => r.url === `${BASE}/events/e1/media/presign`);
      expect(presign.request.body).toEqual({ filename: 'banner.jpg', contentType: 'image/jpeg' });
      presign.flush({ key: 'K1', uploadUrl: 'https://s3/put-K1' });

      const put = on((r) => r.url === 'https://s3/put-K1' && r.method === 'PUT');
      put.flush({});

      const register = on((r) => r.url === `${BASE}/events/e1/media` && r.method === 'POST');
      expect(register.request.body).toEqual({ key: 'K1', kind: 'cover', position: 0 });
      register.flush({ key: 'K1', id: 'm1' });

      expect(result?.key).toBe('K1');
    });
  });

  describe('UsersApi — avatar', () => {
    let u: UsersApi;
    beforeEach(() => (u = TestBed.inject(UsersApi)));

    it('uploadAvatar encadena presign → PUT al storage → confirma la key', () => {
      const file = new File(['x'], 'foto.png', { type: 'image/png' });
      let result: { id?: string } | undefined;
      u.uploadAvatar(file).subscribe((r) => (result = r as { id?: string }));

      const presign = on((r) => r.url === `${BASE}/users/me/avatar/presign` && r.method === 'POST');
      expect(presign.request.body).toEqual({ filename: 'foto.png', contentType: 'image/png' });
      presign.flush({ key: 'avatars/u1/x.png', uploadUrl: 'https://s3/put-av' });

      const put = on((r) => r.url === 'https://s3/put-av' && r.method === 'PUT');
      expect(put.request.headers.get('Content-Type')).toBe('image/png');
      put.flush({});

      const confirm = on((r) => r.url === `${BASE}/users/me/avatar` && r.method === 'PATCH');
      expect(confirm.request.body).toEqual({ key: 'avatars/u1/x.png' });
      confirm.flush({ id: 'u1', avatarUrl: 'https://s3/get-av' });

      expect(result?.id).toBe('u1');
    });

    it('clearAvatar hace DELETE /users/me/avatar', () => {
      u.clearAvatar().subscribe();
      const req = on((r) => r.url === `${BASE}/users/me/avatar` && r.method === 'DELETE');
      req.flush({ id: 'u1', avatarUrl: null });
    });
  });
});
