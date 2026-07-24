import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';
import { CANON } from './canon';

/**
 * Cobertura de endpoints de gestión de eventos (la mayoría de suites crean eventos
 * vía Prisma directo y NO ejercen el controller). Cubre: enforcement de promotor
 * aprobado en publish, cancel, delete, detalle por slug (404), 409 por pasarela
 * congelada, validación de pasarela y de entrada, /mine, /manage, RBAC y 401.
 */
describe('Eventos: gestión (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let promoterToken: string; // seed (aprobado)
  let promoterId: string;
  let promoterBToken: string; // segundo promotor aprobado
  let promoterBId: string;
  let pendingPromoterToken: string; // rol promoter pero NO aprobado
  let pendingPromoterId: string;
  let buyerToken: string;
  let adminToken: string;
  let stamp: number;
  let inactiveGatewayId: string;

  const body = (over: Record<string, unknown> = {}) => ({
    name: `Ev ${Date.now()}`,
    startsAt: new Date('2027-10-01T20:00:00-06:00').toISOString(),
    endsAt: new Date('2027-10-01T23:00:00-06:00').toISOString(),
    ...over,
  });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    stamp = Date.now();

    const promoter = await prisma.user.findUniqueOrThrow({ where: { email: SEED.promoter } });
    promoterId = promoter.id;
    promoterToken = await loginTrusted(SEED.promoter, 'ev-prom');
    buyerToken = await loginTrusted(SEED.buyer, 'ev-buyer');
    adminToken = await loginTrusted(SEED.admin, 'ev-admin');

    promoterBId = (await mkUser('evpromb', { roles: ['promoter'], promoterStatus: 'approved' })).id;
    promoterBToken = await loginTrusted(`evpromb_${stamp}@test.com`, 'ev-promb');

    pendingPromoterId = (await mkUser('evpend', { roles: ['promoter'], promoterStatus: 'pending' })).id;
    pendingPromoterToken = await loginTrusted(`evpend_${stamp}@test.com`, 'ev-pend');

    const gw = await prisma.paymentGateway.create({
      data: { name: `EvInactive ${stamp}`, provider: 'simulator', feePct: '0.05000', status: 'inactive' },
    });
    inactiveGatewayId = gw.id;
  });

  async function mkUser(tag: string, data: Record<string, unknown>) {
    const email = `${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    return prisma.user.update({
      where: { id: res.body.user.id },
      data: { emailVerifiedAt: new Date(), ...data },
    });
  }

  async function loginTrusted(rawEmail: string, deviceId: string): Promise<string> {
    const email = rawEmail.toLowerCase().trim();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.device.upsert({
      where: { userId_deviceHash: { userId: user.id, deviceHash: sha256(deviceId) } },
      update: { trustedAt: new Date() },
      create: { userId: user.id, deviceHash: sha256(deviceId), trustedAt: new Date() },
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Device-Id', deviceId)
      .send({ email, password: 'Password123' })
      .expect(200);
    return res.body.tokens.accessToken;
  }

  afterAll(async () => {
    const ids = [promoterBId, pendingPromoterId];
    await prisma.event.deleteMany({ where: { promoterId: { in: [promoterId, ...ids] }, slug: { contains: String(stamp) } } });
    await prisma.event.deleteMany({ where: { name: { startsWith: 'Ev ' }, promoterId: { in: ids } } });
    await prisma.paymentGateway.deleteMany({ where: { name: { contains: String(stamp) } } });
    await prisma.paymentGateway.deleteMany({ where: { id: inactiveGatewayId } });
    await prisma.hall.deleteMany({ where: { name: { contains: `Salón ${stamp}` } } });
    await prisma.hall.deleteMany({ where: { name: { contains: `Hall ${stamp}` } } });
    await prisma.category.deleteMany({ where: { slug: { contains: `ev-cat-${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const createEvent = async (token: string, over = {}) =>
    (await http().post('/api/v1/events').set(bearer(token)).send(body(over)).expect(201)).body;

  /** Publicar exige banner: crea una media `cover` para el evento (aislado del flujo IA). */
  const addBanner = (eventId: string) =>
    prisma.eventMedia.create({
      data: { eventId, key: `events/${eventId}/cover-${Date.now()}.svg`, kind: 'cover', position: 0 },
    });

  it('publicar exige promotor aprobado: rol promoter pero pending → 403', async () => {
    // Evento propiedad del promotor no-aprobado (insertado directo para aislar publish).
    const ev = await prisma.event.create({
      data: {
        promoterId: pendingPromoterId,
        name: 'Pend Ev',
        slug: `pend-ev-${stamp}`,
        startsAt: new Date('2027-10-01T20:00:00-06:00'),
        endsAt: new Date('2027-10-01T23:00:00-06:00'),
      },
    });
    await prisma.locality.create({
      data: { eventId: ev.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 5 },
    });
    await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(pendingPromoterToken)).expect(403);
  });

  it('crear sin endsAt: el backend autocalcula startsAt + 12h', async () => {
    const startsAt = new Date('2027-10-01T20:00:00-06:00');
    const res = await http()
      .post('/api/v1/events')
      .set(bearer(promoterToken))
      .send({ name: `Sin fin ${Date.now()}`, startsAt: startsAt.toISOString() })
      .expect(201);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(ev.endsAt.getTime()).toBe(startsAt.getTime() + 12 * 60 * 60 * 1000);
  });

  it('usuario de PRUEBA: su evento queda anclado a Sandbox aunque elija otra pasarela', async () => {
    // Marca al promotor semilla como usuario de prueba (solo para este caso).
    const promoter = await prisma.user.findFirstOrThrow({ where: { email: SEED.promoter.toLowerCase().trim() } });
    await prisma.user.update({ where: { id: promoter.id }, data: { isTestUser: true } });
    try {
      const real = await prisma.paymentGateway.create({
        data: { name: `Real_${stamp}`, provider: 'pagalo', feePct: 0.03, status: 'active', sandbox: false },
      });
      const res = await http()
        .post('/api/v1/events')
        .set(bearer(promoterToken))
        .send(body({ gatewayId: real.id }))
        .expect(201);
      const ev = await prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
      // No quedó anclado a la pasarela REAL elegida: se forzó una Sandbox.
      expect(ev.gatewayId).not.toBe(real.id);
      const usedGw = await prisma.paymentGateway.findUniqueOrThrow({
        where: { id: ev.gatewayId as string },
      });
      expect(usedGw.sandbox).toBe(true);
      await prisma.event.delete({ where: { id: ev.id } });
      await prisma.paymentGateway.delete({ where: { id: real.id } });
    } finally {
      await prisma.user.update({ where: { id: promoter.id }, data: { isTestUser: false } });
    }
  });

  it('detalle por slug: inexistente → 404; borrador no es visible → 404', async () => {
    await http().get('/api/v1/events/no-existe-slug').expect(404);
    const draft = await createEvent(promoterToken);
    await http().get(`/api/v1/events/${draft.slug}`).expect(404); // draft no publicado
  });

  it('ciclo de vida por fecha: un evento ya iniciado NO va al inicio y cierra ventas', async () => {
    // Publicado pero con fecha PASADA (en curso/concluido).
    const past = await prisma.event.create({
      data: {
        promoterId,
        name: `Ev Pasado ${stamp}`,
        slug: `ev-pasado-${stamp}`,
        startsAt: new Date('2020-01-01T20:00:00-06:00'),
        endsAt: new Date('2020-01-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    // NO aparece en el listado público (solo eventos por venir).
    const list = await http().get('/api/v1/events?take=100').expect(200);
    expect(list.body.items.some((e: { id: string }) => e.id === past.id)).toBe(false);
    // Ventas cerradas: la disponibilidad responde 409.
    await http().get(`/api/v1/events/${past.id}/availability`).expect(409);
  });

  it('evento CONCLUIDO (fecha pasada): no se edita/suspende/cancela/elimina (409); solo ver cuentas', async () => {
    const past = await prisma.event.create({
      data: {
        promoterId,
        name: `Ev Concluido ${stamp}`,
        slug: `ev-concluido-${stamp}`,
        startsAt: new Date('2020-01-01T20:00:00-06:00'),
        endsAt: new Date('2020-01-01T23:00:00-06:00'),
        status: 'published',
      },
    });
    const t = bearer(promoterToken);
    await http().patch(`/api/v1/events/${past.id}`).set(t).send({ name: 'nuevo' }).expect(409);
    await http().post(`/api/v1/events/${past.id}/suspend`).set(t).expect(409);
    await http().post(`/api/v1/events/${past.id}/cancel`).set(t).expect(409);
    await http().delete(`/api/v1/events/${past.id}`).set(t).expect(409);
    // Las cuentas (transacciones) SÍ se pueden ver.
    await http().get(`/api/v1/events/${past.id}/transactions`).set(t).expect(200);
  });

  describe('Admin crea evento a nombre de un promotor (v3.8)', () => {
    it('admin con promoterId aprobado → evento del promotor + createdByAdminId auditado', async () => {
      // Nombre por defecto `Ev …` para que el afterAll (limpia por nombre) lo borre
      // y no bloquee la eliminación del promotor B por FK.
      const res = await http()
        .post('/api/v1/events')
        .set(bearer(adminToken))
        .send(body({ promoterId: promoterBId }))
        .expect(201);
      expect(res.body.promoterId).toBe(promoterBId); // dueño = el promotor elegido
      expect(res.body.promoter?.email).toBeDefined(); // devuelve el promotor dueño
      const ev = await prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: SEED.admin } });
      expect(ev.createdByAdminId).toBe(admin.id); // rastro de quién lo originó
    });

    it('admin con promoterId de un usuario NO promotor (buyer) → 422', async () => {
      const buyer = await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } });
      await http()
        .post('/api/v1/events')
        .set(bearer(adminToken))
        .send(body({ promoterId: buyer.id }))
        .expect(422);
    });

    it('admin con promoterId de un promotor NO aprobado (pending) → 422', async () => {
      await http()
        .post('/api/v1/events')
        .set(bearer(adminToken))
        .send(body({ promoterId: pendingPromoterId }))
        .expect(422);
    });

    it('admin con promoterId inexistente → 404', async () => {
      await http()
        .post('/api/v1/events')
        .set(bearer(adminToken))
        .send(body({ promoterId: '00000000-0000-0000-0000-000000000000' }))
        .expect(404);
    });

    it('promotor NO puede asignar dueño ajeno: ignora promoterId y crea a su nombre', async () => {
      const res = await http()
        .post('/api/v1/events')
        .set(bearer(promoterToken))
        .send(body({ promoterId: promoterBId }))
        .expect(201);
      expect(res.body.promoterId).toBe(promoterId); // se creó a su propio nombre
      const ev = await prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(ev.createdByAdminId).toBeNull(); // no lo originó un admin
    });
  });

  it('crear con pasarela inactiva → 400', async () => {
    await http()
      .post('/api/v1/events')
      .set(bearer(promoterToken))
      .send(body({ gatewayId: inactiveGatewayId }))
      .expect(400);
  });

  it('validación de entrada al crear → 400 (name corto, categoryId/lat inválidos)', async () => {
    await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ name: 'ab' })).expect(400);
    await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ categoryId: 'no-uuid' })).expect(400);
    await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ lat: 200 })).expect(400);
  });

  it('PATCH sobre evento con pasarela congelada → 409', async () => {
    const ev = await createEvent(promoterToken);
    const gw = await prisma.paymentGateway.findFirstOrThrow({ where: { isPlatformDefault: true } });
    await prisma.event.update({ where: { id: ev.id }, data: { frozenGatewayId: gw.id } });
    await http().patch(`/api/v1/events/${ev.id}`).set(bearer(promoterToken)).send({ ivaOnNet: false }).expect(409);
  });

  it('cancelar: dueño publicado → cancelled; ajeno → 403', async () => {
    const ev = await createEvent(promoterToken);
    await prisma.locality.create({
      data: { eventId: ev.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 5 },
    });
    await addBanner(ev.id);
    await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(200);
    await http().post(`/api/v1/events/${ev.id}/cancel`).set(bearer(promoterBToken)).expect(403); // ajeno
    const res = await http().post(`/api/v1/events/${ev.id}/cancel`).set(bearer(promoterToken)).expect(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('publicar SIN banner → 422 (pide agregar banner)', async () => {
    const ev = await createEvent(promoterToken);
    await prisma.locality.create({
      data: { eventId: ev.id, name: 'GA', slug: `ga-nb-${stamp}`, kind: 'general', capacity: 5 },
    });
    const res = await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(422);
    expect(String(res.body.message)).toMatch(/banner/i);
  });

  it('publicar con localidad seated SIN asientos colocados → 422 (nombra la localidad)', async () => {
    const ev = await createEvent(promoterToken);
    await addBanner(ev.id);
    await prisma.locality.create({
      data: { eventId: ev.id, name: 'Platea VIP', slug: `platea-${stamp}`, kind: 'seated', capacity: 0 },
    });
    const res = await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(422);
    expect(String(res.body.message)).toMatch(/Platea VIP/);
  });

  it('publicar con banner + localidad seated CON asientos colocados → 200', async () => {
    const ev = await createEvent(promoterToken);
    await addBanner(ev.id);
    const loc = await prisma.locality.create({
      data: { eventId: ev.id, name: 'Platea', slug: `platea-ok-${stamp}`, kind: 'seated', capacity: 1 },
    });
    await prisma.seat.create({
      data: { localityId: loc.id, label: `A-1-${stamp}`, section: 'Platea', row: 'A', x: 30, y: 30, status: 'available' },
    });
    const res = await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(200);
    expect(res.body.status).toBe('published');
  });

  it('eliminar: borrador OK (204); publicado → 400; ajeno → 403; inexistente → 404', async () => {
    const draft = await createEvent(promoterToken);
    await http().delete(`/api/v1/events/${draft.id}`).set(bearer(promoterBToken)).expect(403); // ajeno
    await http().delete(`/api/v1/events/${draft.id}`).set(bearer(promoterToken)).expect(204); // dueño draft

    const pub = await createEvent(promoterToken);
    await prisma.locality.create({
      data: { eventId: pub.id, name: 'GA', slug: 'ga', kind: 'general', capacity: 5 },
    });
    await addBanner(pub.id);
    await http().post(`/api/v1/events/${pub.id}/publish`).set(bearer(promoterToken)).expect(200);
    await http().delete(`/api/v1/events/${pub.id}`).set(bearer(promoterToken)).expect(400); // publicado

    await http()
      .delete('/api/v1/events/00000000-0000-0000-0000-000000000000')
      .set(bearer(promoterToken))
      .expect(404);
  });

  it('GET /events/mine: promotor ve los suyos; buyer → 403; sin token → 401', async () => {
    await createEvent(promoterBToken);
    const mine = await http().get('/api/v1/events/mine').set(bearer(promoterBToken)).expect(200);
    expect(Array.isArray(mine.body)).toBe(true);
    expect(mine.body.every((e: { promoterId: string }) => e.promoterId === promoterBId)).toBe(true);
    await http().get('/api/v1/events/mine').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/events/mine').expect(401);
  });

  it('GET /events/all: admin ve todos con su promotor; promotor/buyer → 403; sin token → 401', async () => {
    await createEvent(promoterToken);
    const all = await http().get('/api/v1/events/all').set(bearer(adminToken)).expect(200);
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.length).toBeGreaterThan(0);
    expect(all.body[0].promoter).toBeDefined(); // incluye el promotor
    expect(all.body[0].promoter.email).toBeDefined();
    await http().get('/api/v1/events/all').set(bearer(promoterToken)).expect(403);
    await http().get('/api/v1/events/all').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/events/all').expect(401);
  });

  it('GET /events/:id/manage: dueño 200; ajeno 403; inexistente 404', async () => {
    const ev = await createEvent(promoterToken);
    await http().get(`/api/v1/events/${ev.id}/manage`).set(bearer(promoterToken)).expect(200);
    await http().get(`/api/v1/events/${ev.id}/manage`).set(bearer(promoterBToken)).expect(403);
    await http()
      .get('/api/v1/events/00000000-0000-0000-0000-000000000000/manage')
      .set(bearer(promoterToken))
      .expect(404);
  });

  it('localidades bloqueadas en evento publicado: add/patch/delete → 409', async () => {
    const ev = await createEvent(promoterToken);
    const loc = await http()
      .post(`/api/v1/events/${ev.id}/localities`)
      .set(bearer(promoterToken))
      .send({ name: 'GA', kind: 'general', capacity: 10, desiredNet: 100 })
      .expect(201);
    await addBanner(ev.id);
    await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(200);
    // Ya publicado: crear/editar/borrar localidades queda bloqueado.
    await http()
      .post(`/api/v1/events/${ev.id}/localities`)
      .set(bearer(promoterToken))
      .send({ name: 'Otra', kind: 'general', capacity: 5 })
      .expect(409);
    await http()
      .patch(`/api/v1/localities/${loc.body.id}`)
      .set(bearer(promoterToken))
      .send({ name: 'Nuevo nombre' })
      .expect(409);
    await http().delete(`/api/v1/localities/${loc.body.id}`).set(bearer(promoterToken)).expect(409);
  });

  describe('Suspensión de evento (v3.7)', () => {
    /** Publica un evento con banner + 1 localidad GA para poder suspenderlo. */
    const publishReady = async () => {
      const ev = await createEvent(promoterToken);
      await prisma.locality.create({
        data: { eventId: ev.id, name: 'GA', slug: `ga-sus-${ev.id.slice(0, 8)}`, kind: 'general', capacity: 5 },
      });
      await addBanner(ev.id);
      await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(200);
      return ev;
    };

    it('suspender despublica: desaparece de listados y detalle públicos', async () => {
      const ev = await publishReady();
      const before = await http().get(`/api/v1/events/${ev.slug}`).expect(200);
      expect(before.body.status).toBe('published');

      const res = await http().post(`/api/v1/events/${ev.id}/suspend`).set(bearer(promoterToken)).expect(200);
      expect(res.body.status).toBe('suspended');

      // Ya no es visible públicamente (ni por slug ni en disponibilidad).
      await http().get(`/api/v1/events/${ev.slug}`).expect(404);
      await http().get(`/api/v1/events/${ev.id}/availability`).expect(404);
    });

    it('suspendido es reconfigurable: permite crear localidades (published NO); luego re-publica', async () => {
      const ev = await publishReady();
      // Publicado: bloqueado.
      await http()
        .post(`/api/v1/events/${ev.id}/localities`)
        .set(bearer(promoterToken))
        .send({ name: 'Extra', kind: 'general', capacity: 3 })
        .expect(409);
      // Suspendido: permitido.
      await http().post(`/api/v1/events/${ev.id}/suspend`).set(bearer(promoterToken)).expect(200);
      await http()
        .post(`/api/v1/events/${ev.id}/localities`)
        .set(bearer(promoterToken))
        .send({ name: 'Extra', kind: 'general', capacity: 3 })
        .expect(201);
      // Re-publicable (pasa el gate: banner + localidades).
      const re = await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(200);
      expect(re.body.status).toBe('published');
    });

    it('cambiar salón: bloqueado en publicado (409), permitido en suspendido', async () => {
      const hall = await prisma.hall.create({
        data: { name: `Salón ${stamp}-${Math.random().toString(36).slice(2, 6)}`, address: 'Zona 1' },
      });
      const ev = await publishReady();
      await http()
        .patch(`/api/v1/events/${ev.id}`)
        .set(bearer(promoterToken))
        .send({ hallId: hall.id })
        .expect(409);
      await http().post(`/api/v1/events/${ev.id}/suspend`).set(bearer(promoterToken)).expect(200);
      const ok = await http()
        .patch(`/api/v1/events/${ev.id}`)
        .set(bearer(promoterToken))
        .send({ hallId: hall.id })
        .expect(200);
      expect(ok.body.hallId).toBe(hall.id);
    });

    it('cancelar es terminal: un cancelado no se suspende ni re-publica → 409', async () => {
      const ev = await publishReady();
      await http().post(`/api/v1/events/${ev.id}/cancel`).set(bearer(promoterToken)).expect(200);
      await http().post(`/api/v1/events/${ev.id}/suspend`).set(bearer(promoterToken)).expect(409);
      await http().post(`/api/v1/events/${ev.id}/publish`).set(bearer(promoterToken)).expect(409);
    });

    it('suspender un borrador → 409 (solo aplica a publicados)', async () => {
      const draft = await createEvent(promoterToken);
      await http().post(`/api/v1/events/${draft.id}/suspend`).set(bearer(promoterToken)).expect(409);
    });

    it('RBAC/ownership: ajeno → 403; sin token → 401', async () => {
      const ev = await publishReady();
      await http().post(`/api/v1/events/${ev.id}/suspend`).set(bearer(promoterBToken)).expect(403);
      await http().post(`/api/v1/events/${ev.id}/suspend`).expect(401);
    });

    it('GET /manage expone soldTicketsCount server-authoritative', async () => {
      const ev = await createEvent(promoterToken);
      const loc = await prisma.locality.create({
        data: { eventId: ev.id, name: 'GA', slug: `ga-sold-${ev.id.slice(0, 8)}`, kind: 'general', capacity: 10, desiredNet: 100 },
      });
      const seat = await prisma.seat.create({
        data: { localityId: loc.id, label: 'GA-0000001', section: 'GA', status: 'sold' },
      });
      const zero = await http().get(`/api/v1/events/${ev.id}/manage`).set(bearer(promoterToken)).expect(200);
      expect(zero.body.soldTicketsCount).toBe(0);
      await prisma.order.create({
        data: {
          buyerId: promoterId,
          eventId: ev.id,
          status: 'paid',
          net: '100.00',
          fixedFees: '0.00',
          platformFee: '10.00',
          taxableBase: '110.00',
          iva: '13.20',
          gatewayFee: '6.48',
          total: '129.68',
          items: {
            create: [
              { localityId: loc.id, seatId: seat.id, label: 'GA-0000001', net: '100.00', total: '129.68', quote: {}, quoteHash: 'h', active: true },
            ],
          },
        },
      });
      const one = await http().get(`/api/v1/events/${ev.id}/manage`).set(bearer(promoterToken)).expect(200);
      expect(one.body.soldTicketsCount).toBe(1);
    });
  });

  describe('GET /events/:id/settlement (liquidación)', () => {
    it('owner ve las cuentas de sus órdenes pagadas; ajeno 403; sin token 401', async () => {
      const ev = await createEvent(promoterToken);
      const loc = await prisma.locality.create({
        data: { eventId: ev.id, name: 'GA', slug: `ga-set-${stamp}`, kind: 'general', capacity: 10, desiredNet: 100 },
      });
      const seat = await prisma.seat.create({
        data: { localityId: loc.id, label: 'GA-0000001', section: 'GA', status: 'sold' },
      });
      // Orden PAGADA con snapshot de precios (129.68 = neto 100).
      await prisma.order.create({
        data: {
          buyerId: promoterId,
          eventId: ev.id,
          status: 'paid',
          net: '100.00',
          fixedFees: '0.00',
          platformFee: '10.00',
          taxableBase: '110.00',
          iva: '13.20',
          gatewayFee: '6.48',
          total: '129.68',
          items: {
            create: [
              { localityId: loc.id, seatId: seat.id, label: 'GA-0000001', net: '100.00', total: '129.68', quote: {}, quoteHash: 'h', active: true },
            ],
          },
        },
      });
      const res = await http().get(`/api/v1/events/${ev.id}/settlement`).set(bearer(promoterToken)).expect(200);
      expect(res.body.paidOrders).toBe(1);
      expect(res.body.ticketsSold).toBe(1);
      expect(res.body.net).toBe('100.00');
      expect(res.body.gatewayFee).toBe('6.48');
      expect(res.body.serviceFee).toBe('16.48'); // 10 + 6.48 + 0 (sin IVA)
      expect(res.body.services).toBe('29.68'); // 10 + 6.48 + 0 + 13.20 (IVA incluido)
      // Identidad exacta: gross = services + net (129.68 = 29.68 + 100.00).
      expect(res.body.services).toBe((Number(res.body.gross) - Number(res.body.net)).toFixed(2));
      expect(res.body.gross).toBe('129.68');
      // Ajeno → 403; sin token → 401.
      await http().get(`/api/v1/events/${ev.id}/settlement`).set(bearer(promoterBToken)).expect(403);
      await http().get(`/api/v1/events/${ev.id}/settlement`).expect(401);
    });

    it('admin ve la liquidación de cualquier evento; evento inexistente → 404', async () => {
      const ev = await createEvent(promoterToken);
      const res = await http().get(`/api/v1/events/${ev.id}/settlement`).set(bearer(adminToken)).expect(200);
      expect(res.body.paidOrders).toBe(0);
      expect(res.body.net).toBe('0.00');
      await http()
        .get('/api/v1/events/00000000-0000-0000-0000-000000000000/settlement')
        .set(bearer(adminToken))
        .expect(404);
    });
  });

  describe('Disponibilidad, destacados y ubicación (cobertura de negocio)', () => {
    /** Crea un evento PUBLICADO directamente (evita el gate de publicar) para
     * ejercer los endpoints públicos de solo-lectura. Slug con `stamp` → limpiado. */
    const mkPublished = (over: Record<string, unknown> = {}) =>
      prisma.event.create({
        data: {
          promoterId,
          name: `Ev Pub ${stamp}-${Math.random().toString(36).slice(2, 7)}`,
          slug: `ev-pub-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
          startsAt: new Date('2028-01-01T20:00:00-06:00'),
          endsAt: new Date('2028-01-01T23:00:00-06:00'),
          status: 'published',
          ...over,
        },
      });

    it('availability: precio all-in por localidad, asientos con coordenadas y marca held (hold Redis)', async () => {
      const ev = await mkPublished();
      const seated = await prisma.locality.create({
        data: { eventId: ev.id, name: 'Platea', slug: `platea-av-${stamp}`, kind: 'seated', capacity: 2, desiredNet: 100 },
      });
      const s1 = await prisma.seat.create({
        data: { localityId: seated.id, label: `AV-A1-${stamp}`, section: 'Platea', row: 'A', x: 10, y: 10, status: 'available' },
      });
      const s2 = await prisma.seat.create({
        data: { localityId: seated.id, label: `AV-A2-${stamp}`, section: 'Platea', row: 'A', x: 20, y: 10, status: 'available' },
      });
      // Localidad general SIN precio (desiredNet null) → price null en la respuesta.
      await prisma.locality.create({
        data: { eventId: ev.id, name: 'GA', slug: `ga-av-${stamp}`, kind: 'general', capacity: 5 },
      });

      // Otro usuario reserva s2 en Redis: para el comprador s2 aparece como 'held'.
      await redis.getClient().set(`hold:${ev.id}:${s2.id}`, 'otro-holder', 'EX', 60);

      const res = await http().get(`/api/v1/events/${ev.id}/availability`).expect(200);

      const plat = res.body.localities.find((l: { id: string }) => l.id === seated.id);
      expect(plat.price.net).toBe('100.00');
      expect(plat.price.total).toBe(CANON.total); // server-authoritative
      expect(plat.price).toHaveProperty('serviceFee');
      expect(plat.available).toBe(1); // s1 libre; s2 reservado en Redis no cuenta

      const ga = res.body.localities.find((l: { name: string }) => l.name === 'GA');
      expect(ga.price).toBeNull();

      const seat1 = res.body.seats.find((s: { id: string }) => s.id === s1.id);
      const seat2 = res.body.seats.find((s: { id: string }) => s.id === s2.id);
      expect(seat1.status).toBe('available');
      expect(seat1.x).toBe(10);
      expect(seat1.owned).toBe(false); // anónimo → ningún asiento marcado como propio
      expect(seat2.status).toBe('held'); // remapeado por el hold ajeno

      await redis.getClient().del(`hold:${ev.id}:${s2.id}`);
    });

    it('availability marca owned=true en los asientos que el usuario logueado ya compró (azul)', async () => {
      const ev = await mkPublished();
      const seated = await prisma.locality.create({
        data: { eventId: ev.id, name: 'Platea', slug: `platea-own-${stamp}`, kind: 'seated', capacity: 2, desiredNet: 100 },
      });
      const mineSeat = await prisma.seat.create({
        data: { localityId: seated.id, label: `OWN-A1-${stamp}`, x: 10, y: 10, status: 'sold' },
      });
      const otherSeat = await prisma.seat.create({
        data: { localityId: seated.id, label: `OWN-A2-${stamp}`, x: 20, y: 10, status: 'sold' },
      });
      const buyer = await prisma.user.findUniqueOrThrow({ where: { email: SEED.buyer } });
      const order = await prisma.order.create({
        data: {
          buyerId: buyer.id, eventId: ev.id, status: 'paid',
          net: '100.00', platformFee: '10.00', fixedFees: '0.00', taxableBase: '110.00',
          iva: '13.20', gatewayFee: '6.48', total: CANON.total, paidAt: new Date(),
        },
      });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id, localityId: seated.id, seatId: mineSeat.id, label: mineSeat.label,
          net: '100.00', total: CANON.total, quote: {}, quoteHash: `own-${stamp}`, active: true,
        },
      });
      await prisma.ticket.create({
        data: {
          orderItemId: item.id, orderId: order.id, eventId: ev.id, localityId: seated.id, seatId: mineSeat.id,
          ownerId: buyer.id, status: 'valid', serial: `OWN-${stamp}`, totpSecret: 'x', signature: 'x', signingKeyId: 'x',
        },
      });

      // Anónimo: nada es "owned".
      const anon = await http().get(`/api/v1/events/${ev.id}/availability`).expect(200);
      expect(anon.body.seats.find((s: { id: string }) => s.id === mineSeat.id).owned).toBe(false);

      // Con sesión del comprador: su asiento owned=true; el ajeno vendido owned=false.
      const auth = await http().get(`/api/v1/events/${ev.id}/availability`).set(bearer(buyerToken)).expect(200);
      expect(auth.body.seats.find((s: { id: string }) => s.id === mineSeat.id).owned).toBe(true);
      expect(auth.body.seats.find((s: { id: string }) => s.id === otherSeat.id).owned).toBe(false);

      // Limpieza: la orden referencia al evento (FK) → borrarla (cascada a ítems/boletos)
      // para que el afterAll pueda eliminar el evento y sus asientos.
      await prisma.order.delete({ where: { id: order.id } });
    });

    it('availability sin asientos disponibles: seats vacío y available 0 (heldSet corta en []).', async () => {
      const ev = await mkPublished();
      await prisma.locality.create({
        data: { eventId: ev.id, name: 'GA', slug: `ga-empty-${stamp}`, kind: 'general', capacity: 3, desiredNet: 50 },
      });
      const res = await http().get(`/api/v1/events/${ev.id}/availability`).expect(200);
      expect(res.body.seats).toEqual([]);
      const ga = res.body.localities.find((l: { name: string }) => l.name === 'GA');
      expect(ga.available).toBe(0);
      expect(ga.price.total).toBeDefined();
    });

    it('availability de un borrador o inexistente → 404', async () => {
      const draft = await createEvent(promoterToken);
      await http().get(`/api/v1/events/${draft.id}/availability`).expect(404);
      await http().get('/api/v1/events/00000000-0000-0000-0000-000000000000/availability').expect(404);
    });

    it('GET /events/promoted: solo publicados con prioridad, ordenados ascendente', async () => {
      const a = await mkPublished({ promotedPriority: 2 });
      const b = await mkPublished({ promotedPriority: 1 });
      await mkPublished(); // sin prioridad → no aparece
      const res = await http().get('/api/v1/events/promoted').expect(200);
      const ids = res.body.map((e: { id: string }) => e.id);
      const ia = ids.indexOf(a.id);
      const ib = ids.indexOf(b.id);
      expect(ia).toBeGreaterThanOrEqual(0);
      expect(ib).toBeGreaterThanOrEqual(0);
      expect(ib).toBeLessThan(ia); // prioridad 1 va antes que 2
    });

    it('PATCH /events/:id/promote: dueño destaca (premium off = todos), NO dueño 403; toggle entra/sale del slider', async () => {
      const ev = await mkPublished(); // futuro publicado, sin prioridad → no está en el slider
      // Un promotor tampoco puede autopromocionarse por el update genérico (se ignora).
      await http()
        .patch(`/api/v1/events/${ev.id}`)
        .set(bearer(promoterToken))
        .send({ promotedPriority: 0 })
        .expect(200);
      const afterUpdate = await prisma.event.findUniqueOrThrow({ where: { id: ev.id } });
      expect(afterUpdate.promotedPriority).toBeNull();
      // Un promotor NO dueño → 403 por ownership.
      await http()
        .patch(`/api/v1/events/${ev.id}/promote`)
        .set(bearer(promoterBToken))
        .send({ featured: true })
        .expect(403);
      // Gobernanza: el promotor solo destaca si el flag global está ENCENDIDO (default off).
      await http().patch('/api/v1/settings/promoter.can_feature_events').set(bearer(adminToken)).send({ value: true }).expect(200);
      try {
        // El DUEÑO destaca su propio evento (premium.enabled=false → beneficios para todos).
        await http().patch(`/api/v1/events/${ev.id}/promote`).set(bearer(promoterToken)).send({ featured: true }).expect(200);
        let promoted = await http().get('/api/v1/events/promoted').expect(200);
        expect(promoted.body.some((e: { id: string }) => e.id === ev.id)).toBe(true);
        // Admin quita → sale del slider.
        await http().patch(`/api/v1/events/${ev.id}/promote`).set(bearer(adminToken)).send({ featured: false }).expect(200);
        promoted = await http().get('/api/v1/events/promoted').expect(200);
        expect(promoted.body.some((e: { id: string }) => e.id === ev.id)).toBe(false);
      } finally {
        await http().patch('/api/v1/settings/promoter.can_feature_events').set(bearer(adminToken)).send({ value: false }).expect(200);
      }
    });

    it('PATCH /events/:id/promote: con premium ENCENDIDO, un promotor free NO destaca (403) hasta ser premium', async () => {
      const ev = await mkPublished();
      // Enciende la distinción premium + el flag de gobernanza; deja al dueño en free.
      await http().patch('/api/v1/settings/premium.enabled').set(bearer(adminToken)).send({ value: true }).expect(200);
      await http().patch('/api/v1/settings/promoter.can_feature_events').set(bearer(adminToken)).send({ value: true }).expect(200);
      await prisma.user.update({ where: { id: promoterId }, data: { promoterTier: 'free', premiumSince: null, premiumTrialEndsAt: null } });
      try {
        // free + premium on → destacar es beneficio premium → 403.
        await http().patch(`/api/v1/events/${ev.id}/promote`).set(bearer(promoterToken)).send({ featured: true }).expect(403);
        // El admin lo hace premium a mano → ahora sí destaca.
        await http().patch(`/api/v1/promoters/${promoterId}/tier`).set(bearer(adminToken)).send({ tier: 'premium' }).expect(200);
        await http().patch(`/api/v1/events/${ev.id}/promote`).set(bearer(promoterToken)).send({ featured: true }).expect(200);
      } finally {
        // Restaura el estado global (suite serial): premium off + flag off + dueño free.
        await http().patch('/api/v1/settings/premium.enabled').set(bearer(adminToken)).send({ value: false }).expect(200);
        await http().patch('/api/v1/settings/promoter.can_feature_events').set(bearer(adminToken)).send({ value: false }).expect(200);
        await prisma.user.update({ where: { id: promoterId }, data: { promoterTier: 'free', premiumSince: null, premiumTrialEndsAt: null } });
        await prisma.event.update({ where: { id: ev.id }, data: { promotedPriority: null } });
      }
    });

    it('GET /events?category=<slug>: filtra por categoría', async () => {
      const cat = await prisma.category.create({
        data: { name: `Ev Cat ${stamp}`, slug: `ev-cat-${stamp}`, createdById: promoterId },
      });
      const ev = await mkPublished({ categoryId: cat.id });
      const res = await http().get(`/api/v1/events?category=ev-cat-${stamp}`).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((e: { category?: { slug: string } }) => e.category?.slug === `ev-cat-${stamp}`)).toBe(true);
      expect(res.body.items.some((e: { id: string }) => e.id === ev.id)).toBe(true);
    });

    it('crear con hallId (sin address): prefija address/lat/lng del salón', async () => {
      const hall = await prisma.hall.create({
        data: { name: `Hall ${stamp}`, address: 'Av. Reforma 1-23', lat: 14.6, lng: -90.5 },
      });
      const res = await http()
        .post('/api/v1/events')
        .set(bearer(promoterToken))
        .send(body({ hallId: hall.id }))
        .expect(201);
      const ev = await prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(ev.hallId).toBe(hall.id);
      expect(ev.address).toBe('Av. Reforma 1-23'); // heredado del salón
      expect(ev.lat).toBe(14.6);
      expect(ev.lng).toBe(-90.5);
    });

    it('B3: hallId se expone en la respuesta de crear y en /manage; un re-guardado sin hallId lo conserva', async () => {
      const hall = await prisma.hall.create({
        data: { name: `Hall B3 ${stamp}`, address: 'Zona 10', lat: 14.59, lng: -90.51 },
      });
      // Crear con salón → la respuesta lleva hallId.
      const created = await http()
        .post('/api/v1/events')
        .set(bearer(promoterToken))
        .send(body({ hallId: hall.id }))
        .expect(201);
      expect(created.body.hallId).toBe(hall.id);

      // El detalle gestionable refleja el salón asignado (el frontend lo lee al recargar).
      const manage = await http()
        .get(`/api/v1/events/${created.body.id}/manage`)
        .set(bearer(promoterToken))
        .expect(200);
      expect(manage.body.hallId).toBe(hall.id);

      // Re-guardar SIN enviar hallId (solo cambia el nombre) NO lo desasigna.
      const resaved = await http()
        .patch(`/api/v1/events/${created.body.id}`)
        .set(bearer(promoterToken))
        .send({ name: `Ev B3 rename ${stamp}` })
        .expect(200);
      expect(resaved.body.hallId).toBe(hall.id);
      const persisted = await prisma.event.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(persisted.hallId).toBe(hall.id);
    });

    it('crear con hallId inexistente → 400', async () => {
      await http()
        .post('/api/v1/events')
        .set(bearer(promoterToken))
        .send(body({ hallId: '00000000-0000-0000-0000-000000000000' }))
        .expect(400);
    });

    it('crear con pasarela que exige más colaboración de la del promotor → 400', async () => {
      const gw = await prisma.paymentGateway.create({
        data: {
          name: `Premium ${stamp}`,
          provider: 'pagalo',
          feePct: '0.03000',
          status: 'active',
          sandbox: false,
          minCostSharePct: '0.90000', // el promotor semilla (0.5) no califica
        },
      });
      await http()
        .post('/api/v1/events')
        .set(bearer(promoterToken))
        .send(body({ gatewayId: gw.id }))
        .expect(400);
    });

    it('nombre duplicado al crear → slug desambiguado con sufijo (uniqueSlug)', async () => {
      const name = `Ev Dup ${stamp}`;
      const a = await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ name })).expect(201);
      const b = await http().post('/api/v1/events').set(bearer(promoterToken)).send(body({ name })).expect(201);
      expect(b.body.slug).not.toBe(a.body.slug);
      expect(b.body.slug.startsWith(a.body.slug)).toBe(true);
    });

    it('PATCH mueve startsAt más allá del fin actual: recalcula endsAt (+12h) sin 400', async () => {
      const ev = await createEvent(promoterToken);
      const newStart = new Date('2028-06-01T20:00:00-06:00');
      const res = await http()
        .patch(`/api/v1/events/${ev.id}`)
        .set(bearer(promoterToken))
        .send({ startsAt: newStart.toISOString() })
        .expect(200);
      const updated = await prisma.event.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(updated.endsAt.getTime()).toBe(newStart.getTime() + 12 * 60 * 60 * 1000);
    });

    it('PATCH gatewayId válido en evento no congelado → 200 (resuelve la pasarela)', async () => {
      const ev = await createEvent(promoterToken);
      const gw = await prisma.paymentGateway.findFirstOrThrow({ where: { isPlatformDefault: true } });
      const res = await http()
        .patch(`/api/v1/events/${ev.id}`)
        .set(bearer(promoterToken))
        .send({ gatewayId: gw.id })
        .expect(200);
      expect(res.body.gatewayId).toBe(gw.id);
    });
  });
});
