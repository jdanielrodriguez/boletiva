import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * B1 · Perfil PREMIUM del promotor. Cubre: config pública (gating de UI), reglas del
 * interruptor maestro (`premium.enabled`) y de la prueba gratis (`premium.trial_enabled`),
 * upgrade/downgrade por el propio promotor (premium exige tarjeta), concesión por admin
 * (premium directo o prueba de N días), expiración de pruebas y RBAC.
 */
describe('Perfil premium (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let stamp: number;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    stamp = Date.now();
    adminToken = await loginTrusted(SEED.admin, 'prem-admin');
    await setSetting('premium.enabled', false);
    await setSetting('premium.trial_enabled', false);
    await setSetting('premium.trial_days', 7);
  });

  afterAll(async () => {
    await setSetting('premium.enabled', false);
    await setSetting('premium.trial_enabled', false);
    const users = await prisma.user.findMany({ where: { email: { contains: `_${stamp}@test.com` } } });
    const ids = users.map((u) => u.id);
    await prisma.savedCard.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function setSetting(key: string, value: unknown) {
    await prisma.setting.upsert({
      where: { key },
      update: { value: value as object },
      create: { key, value: value as object, description: 'test' },
    });
  }

  async function newPromoter(tag: string): Promise<{ id: string; email: string; token: string }> {
    const email = `prem_${tag}_${stamp}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email, password: 'Password123', firstName: tag });
    const id = res.body.user.id;
    await prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date(), roles: ['buyer', 'promoter'], promoterStatus: 'approved' },
    });
    const token = await loginTrusted(email, `dev-${tag}`);
    return { id, email, token };
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

  /** Inserta una tarjeta guardada (simula la tokenización PCI ya hecha). */
  async function giveCard(userId: string) {
    await prisma.savedCard.create({
      data: { userId, brand: 'visa', last4: '4242', token: `tok_${userId.slice(0, 8)}`, isDefault: true },
    });
  }

  it('GET /public/config expone el gating premium (defaults: apagado)', async () => {
    const res = await http().get('/api/v1/public/config').expect(200);
    expect(res.body.premium).toMatchObject({ enabled: false, trialEnabled: false });
    expect(typeof res.body.premium.trialDays).toBe('number');
    expect(res.body.chatEnabled).toBe(true); // T7a: soporte activo por defecto
  });

  it('premium APAGADO: los beneficios aplican a todos → myStatus.premiumBenefitsActive=true aunque el tier sea free', async () => {
    const p = await newPromoter('off');
    const me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
    expect(me.body.promoterTier).toBe('free');
    expect(me.body.premiumBenefitsActive).toBe(true);
  });

  it('premium ENCENDIDO: un promotor free NO tiene beneficios; upgrade a premium exige tarjeta', async () => {
    await setSetting('premium.enabled', true);
    try {
      const p = await newPromoter('paid');
      let me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
      expect(me.body.premiumBenefitsActive).toBe(false);

      // Upgrade a premium SIN tarjeta → 400.
      await http().post('/api/v1/promoters/tier').set(bearer(p.token)).send({ tier: 'premium' }).expect(400);

      // Con tarjeta registrada → 200 y beneficios activos (premium pagado, sin prueba).
      await giveCard(p.id);
      const up = await http().post('/api/v1/promoters/tier').set(bearer(p.token)).send({ tier: 'premium' }).expect(200);
      expect(up.body.promoterTier).toBe('premium');
      expect(up.body.onTrial).toBe(false);
      expect(up.body.premiumTrialEndsAt).toBeNull();

      me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
      expect(me.body.premiumBenefitsActive).toBe(true);

      // Downgrade a free → limpia y quita beneficios.
      await http().post('/api/v1/promoters/tier').set(bearer(p.token)).send({ tier: 'free' }).expect(200);
      me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
      expect(me.body.premiumBenefitsActive).toBe(false);
    } finally {
      await setSetting('premium.enabled', false);
    }
  });

  it('prueba gratis: al elegir premium en apply se activa la prueba; expira → baja a free', async () => {
    await setSetting('premium.enabled', true);
    await setSetting('premium.trial_enabled', true);
    await setSetting('premium.trial_days', 7);
    try {
      const p = await newPromoter('trial');
      await http().post('/api/v1/promoters/apply').set(bearer(p.token)).send({ tier: 'premium' }).expect(200);

      let me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
      expect(me.body.onTrial).toBe(true);
      expect(me.body.premiumBenefitsActive).toBe(true);
      expect(new Date(me.body.premiumTrialEndsAt).getTime()).toBeGreaterThan(Date.now());

      // Simula prueba vencida → el sweeper la baja a free.
      await prisma.user.update({
        where: { id: p.id },
        data: { premiumTrialEndsAt: new Date(Date.now() - 1000) },
      });
      const expired = await http().post('/api/v1/promoters/premium/expire-trials').set(bearer(adminToken)).expect(200);
      expect(expired.body.expired).toBeGreaterThanOrEqual(1);

      me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
      expect(me.body.promoterTier).toBe('free');
      expect(me.body.premiumBenefitsActive).toBe(false);
    } finally {
      await setSetting('premium.enabled', false);
      await setSetting('premium.trial_enabled', false);
    }
  });

  it('prueba DESHABILITADA: elegir premium en apply NO activa beneficios (queda intención, sin prueba)', async () => {
    await setSetting('premium.enabled', true);
    await setSetting('premium.trial_enabled', false);
    try {
      const p = await newPromoter('notrial');
      await http().post('/api/v1/promoters/apply').set(bearer(p.token)).send({ tier: 'premium' }).expect(200);
      const me = await http().get('/api/v1/promoters/me').set(bearer(p.token)).expect(200);
      expect(me.body.promoterTier).toBe('premium'); // intención registrada
      expect(me.body.premiumBenefitsActive).toBe(false); // pero sin activar (no hay prueba)
      expect(me.body.onTrial).toBe(false);
    } finally {
      await setSetting('premium.enabled', false);
    }
  });

  it('admin PATCH /promoters/:id/tier: concede prueba de N días y premium directo (sin tarjeta)', async () => {
    await setSetting('premium.enabled', true);
    try {
      const p = await newPromoter('admgrant');
      // Admin concede prueba de 30 días (sin exigir tarjeta ni trial_enabled).
      const trial = await http()
        .patch(`/api/v1/promoters/${p.id}/tier`)
        .set(bearer(adminToken))
        .send({ tier: 'premium', trialDays: 30 })
        .expect(200);
      expect(trial.body.onTrial).toBe(true);
      // Admin concede premium directo (sin tarjeta, sin prueba).
      const paid = await http()
        .patch(`/api/v1/promoters/${p.id}/tier`)
        .set(bearer(adminToken))
        .send({ tier: 'premium' })
        .expect(200);
      expect(paid.body.onTrial).toBe(false);
      expect(paid.body.premiumTrialEndsAt).toBeNull();
    } finally {
      await setSetting('premium.enabled', false);
    }
  });

  it('RBAC: /promoters/tier exige sesión; /promoters/:id/tier y expire-trials exigen admin', async () => {
    const p = await newPromoter('rbac');
    await http().post('/api/v1/promoters/tier').send({ tier: 'free' }).expect(401);
    await http().patch(`/api/v1/promoters/${p.id}/tier`).set(bearer(p.token)).send({ tier: 'premium' }).expect(403);
    await http().post('/api/v1/promoters/premium/expire-trials').set(bearer(p.token)).expect(403);
  });

  it('validación: tier inválido → 400', async () => {
    const p = await newPromoter('valid');
    await http().post('/api/v1/promoters/tier').set(bearer(p.token)).send({ tier: 'gold' }).expect(400);
  });
});
