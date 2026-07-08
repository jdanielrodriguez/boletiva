import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, SEED } from './utils';
import { sha256 } from '../../common/utils/crypto';

/**
 * Ola 6.5 · Ticket 2 — Paginación KEYSET (cursor).
 * Verifica la mecánica compartida (common/utils/pagination) sobre el listado admin
 * de usuarios (el seed crea >100): páginas sin solape ni saltos, `nextCursor`
 * correcto, fin de listado (null), clamp/validación de `limit` y cursor inválido.
 */
describe('Paginación keyset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await loginTrusted(SEED.admin, 'pg-admin');
  });

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
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const users = (qs: string) => http().get(`/api/v1/users${qs}`).set(bearer(adminToken));

  it('respeta el límite y entrega nextCursor cuando hay más', async () => {
    const res = await users('?limit=5').expect(200);
    expect(res.body.items).toHaveLength(5);
    expect(typeof res.body.nextCursor).toBe('string'); // hay más (>100 usuarios)
  });

  it('recorre páginas SIN solape ni saltos y termina en nextCursor=null', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let last: string[] = [];
    do {
      const qs: string = cursor ? `?limit=25&cursor=${cursor}` : '?limit=25';
      const res = await users(qs).expect(200);
      const ids: string[] = res.body.items.map((u: { id: string }) => u.id);
      for (const id of ids) {
        expect(seen.has(id)).toBe(false); // 0 duplicados entre páginas
        seen.add(id);
      }
      last = ids;
      cursor = res.body.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(50); // guardia anti-bucle
    } while (cursor);
    // La última página trajo menos que el límite (o el conteo total es múltiplo).
    expect(last.length).toBeLessThanOrEqual(25);
    // Cubrió a TODOS los usuarios activos existentes (keyset no pierde filas).
    const total = await prisma.user.count();
    expect(seen.size).toBe(total);
  });

  it('el orden es estable (createdAt desc, id desc) y consistente entre páginas', async () => {
    const p1 = await users('?limit=10').expect(200);
    const p2 = await users(`?limit=10&cursor=${p1.body.nextCursor}`).expect(200);
    const firstOfP2 = p2.body.items[0];
    const lastOfP1 = p1.body.items[p1.body.items.length - 1];
    // La primera fila de la página 2 es <= (más antigua o igual) que la última de la 1.
    expect(new Date(firstOfP2.createdAt).getTime()).toBeLessThanOrEqual(
      new Date(lastOfP1.createdAt).getTime(),
    );
  });

  it('validación: limit 0 → 400, limit > 100 → 400, cursor no-uuid → 400', async () => {
    await users('?limit=0').expect(400);
    await users('?limit=101').expect(400);
    await users('?cursor=no-es-uuid').expect(400);
  });

  it('búsqueda + keyset conviven (search filtra y pagina)', async () => {
    const res = await users('?search=pasaeventos&limit=2').expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
  });
});
