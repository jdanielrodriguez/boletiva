import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * v3.5 · Panel admin de configuraciones. GET lista el catálogo con valores; PATCH
 * valida tipo/rango y solo acepta claves conocidas. Cubre RBAC, 404 de clave
 * desconocida, validación (pct fuera de rango, tipo incorrecto, entero) y happy.
 * Restaura los valores mutados para no contaminar la suite serial.
 */
describe('Configuraciones (settings) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let promoterToken: string;
  let snapshot: Array<{ key: string; value: unknown; description: string | null }>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    promoterToken = await login(app, SEED.promoter);
    snapshot = await prisma.setting.findMany();
    // Determinismo: borra los flags/temas que otras suites pudieron dejar cambiados
    // (la suite serial comparte BD) → publicConfig cae a los defaults del catálogo, así
    // los asserts de "defaults" no dependen del estado previo. El afterAll restaura todo.
    await prisma.setting.deleteMany({
      where: {
        key: {
          in: [
            'i18n.allow_visitor_switch',
            'home.show_categories',
            'theme.slot.dia',
            'theme.slot.noche',
            'theme.default_franja',
            'theme.allow_visitor_switch',
          ],
        },
      },
    });
  });

  afterAll(async () => {
    for (const s of snapshot) {
      await prisma.setting.upsert({
        where: { key: s.key },
        update: { value: s.value as object },
        create: { key: s.key, value: s.value as object, description: s.description },
      });
    }
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('admin lista el catálogo (16 claves, con value/default/type)', async () => {
    const res = await http().get('/api/v1/settings').set(bearer(adminToken)).expect(200);
    expect(res.body.length).toBe(16);
    const item = res.body.find((s: { key: string }) => s.key === 'costshare.default_pct');
    expect(item).toBeDefined();
    expect(item.type).toBe('pct');
    expect(item).toHaveProperty('default');
    // Los flags nuevos de UI están en el catálogo como bool con su default.
    const lang = res.body.find((s: { key: string }) => s.key === 'i18n.allow_visitor_switch');
    expect(lang).toMatchObject({ type: 'bool', default: false });
    const cats = res.body.find((s: { key: string }) => s.key === 'home.show_categories');
    expect(cats).toMatchObject({ type: 'bool', default: true });
    // Los settings de tema son enum con sus opciones (rebranding Boletiva).
    const slotNoche = res.body.find((s: { key: string }) => s.key === 'theme.slot.noche');
    expect(slotNoche).toMatchObject({ type: 'enum', default: 'pulso' });
    expect(slotNoche.options).toEqual(['pulso', 'marquesina']);
  });

  it('GET /public/config: SIN login → defaults + asignación de tema por franja', async () => {
    const res = await http().get('/api/v1/public/config').expect(200);
    expect(res.body).toMatchObject({ allowVisitorLangSwitch: false, showHomeCategories: true });
    expect(res.body.theme).toMatchObject({
      slots: { dia: 'marquesina', noche: 'pulso' },
      defaultFranja: 'noche',
      allowVisitorSwitch: true,
    });
  });

  it('enum (tema): admin voltea las franjas y /public/config lo refleja; valor inválido → 400', async () => {
    // Voltear: noche → marquesina, día → pulso.
    await http()
      .patch('/api/v1/settings/theme.slot.noche')
      .set(bearer(adminToken))
      .send({ value: 'marquesina' })
      .expect(200);
    await http()
      .patch('/api/v1/settings/theme.slot.dia')
      .set(bearer(adminToken))
      .send({ value: 'pulso' })
      .expect(200);
    const res = await http().get('/api/v1/public/config').expect(200);
    expect(res.body.theme.slots).toMatchObject({ dia: 'pulso', noche: 'marquesina' });
    // Valor fuera del enum → 400.
    await http()
      .patch('/api/v1/settings/theme.slot.noche')
      .set(bearer(adminToken))
      .send({ value: 'inexistente' })
      .expect(400);
    // Tipo incorrecto (number a un enum) → 400.
    await http()
      .patch('/api/v1/settings/theme.default_franja')
      .set(bearer(adminToken))
      .send({ value: 5 })
      .expect(400);
  });

  it('config pública refleja la edición admin de los flags (RBAC del PATCH incluido)', async () => {
    // Un promotor no puede tocar los flags.
    await http()
      .patch('/api/v1/settings/i18n.allow_visitor_switch')
      .set(bearer(promoterToken))
      .send({ value: true })
      .expect(403);
    // El admin los activa/ajusta.
    await http()
      .patch('/api/v1/settings/i18n.allow_visitor_switch')
      .set(bearer(adminToken))
      .send({ value: true })
      .expect(200);
    await http()
      .patch('/api/v1/settings/home.show_categories')
      .set(bearer(adminToken))
      .send({ value: false })
      .expect(200);
    const res = await http().get('/api/v1/public/config').expect(200);
    expect(res.body).toMatchObject({ allowVisitorLangSwitch: true, showHomeCategories: false });
  });

  it('RBAC: sin token → 401; promotor → 403', async () => {
    await http().get('/api/v1/settings').expect(401);
    await http().get('/api/v1/settings').set(bearer(promoterToken)).expect(403);
  });

  it('GET :key conocida → 200; desconocida → 404', async () => {
    await http().get('/api/v1/settings/wallet.pass_fee').set(bearer(adminToken)).expect(200);
    await http().get('/api/v1/settings/no.existe').set(bearer(adminToken)).expect(404);
  });

  it('PATCH válido (pct e int)', async () => {
    const r1 = await http()
      .patch('/api/v1/settings/wallet.pass_fee')
      .set(bearer(adminToken))
      .send({ value: 0.02 })
      .expect(200);
    expect(r1.body.value).toBe(0.02);
    const r2 = await http()
      .patch('/api/v1/settings/transfer.max_per_ticket_default')
      .set(bearer(adminToken))
      .send({ value: 3 })
      .expect(200);
    expect(r2.body.value).toBe(3);
    // Persistió en BD.
    const row = await prisma.setting.findUnique({ where: { key: 'wallet.pass_fee' } });
    expect(row?.value).toBe(0.02);
  });

  it('PATCH inválido: pct fuera de rango, tipo incorrecto, entero, clave desconocida', async () => {
    await http().patch('/api/v1/settings/wallet.pass_fee').set(bearer(adminToken)).send({ value: 1.5 }).expect(400);
    await http().patch('/api/v1/settings/wallet.pass_fee').set(bearer(adminToken)).send({ value: true }).expect(400);
    await http()
      .patch('/api/v1/settings/promoters.require_approval')
      .set(bearer(adminToken))
      .send({ value: 5 })
      .expect(400); // bool espera booleano
    await http()
      .patch('/api/v1/settings/transfer.max_per_ticket_default')
      .set(bearer(adminToken))
      .send({ value: 2.5 })
      .expect(400); // int no acepta decimales
    await http().patch('/api/v1/settings/no.existe').set(bearer(adminToken)).send({ value: 1 }).expect(404);
  });

  it('PATCH bool válido', async () => {
    const r = await http()
      .patch('/api/v1/settings/promoters.require_approval')
      .set(bearer(adminToken))
      .send({ value: true })
      .expect(200);
    expect(r.body.value).toBe(true);
  });

  it('promotor no puede PATCH (403)', async () => {
    await http()
      .patch('/api/v1/settings/wallet.pass_fee')
      .set(bearer(promoterToken))
      .send({ value: 0 })
      .expect(403);
  });
});
