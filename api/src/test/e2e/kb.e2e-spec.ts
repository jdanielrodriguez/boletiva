import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { createTestApp, login, SEED } from './utils';

/**
 * T6 · Base de Conocimientos (KB). Cubre: FAQ público (solo publicado+público, filtros,
 * detalle por slug + viewCount, 404 de draft/internal), búsqueda/autoresponder (ranking,
 * solo público; agente incluye internos), gestión admin (CRUD, RBAC, publish/unpublish,
 * slug autogenerado + único), saneo de HTML (anti-XSS) y validación de entrada.
 * Idempotente: usa slugs propios con prefijo y limpia al final.
 */
describe('Base de Conocimientos (kb) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let buyerToken: string;

  const PFX = 'e2e-kb-';
  const clean = () => prisma.kbArticle.deleteMany({ where: { slug: { startsWith: PFX } } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await login(app, SEED.admin);
    buyerToken = await login(app, SEED.buyer);
    await clean();
  });

  afterAll(async () => {
    await clean();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** Crea un artículo vía API admin y devuelve su body. */
  const createArticle = async (over: Record<string, unknown> = {}) => {
    const res = await http()
      .post('/api/v1/kb')
      .set(bearer(adminToken))
      .send({
        question: 'Pregunta de prueba',
        answerHtml: '<p>Respuesta</p>',
        slug: `${PFX}${Math.random().toString(36).slice(2, 8)}`,
        category: 'account',
        ...over,
      })
      .expect(201);
    return res.body;
  };

  // ---- RBAC de gestión ----
  it('crear/editar/listar-admin requieren admin (buyer → 403; anónimo → 401)', async () => {
    await http().post('/api/v1/kb').send({ question: 'x', answerHtml: '<p>y</p>' }).expect(401);
    await http()
      .post('/api/v1/kb')
      .set(bearer(buyerToken))
      .send({ question: 'x', answerHtml: '<p>y</p>' })
      .expect(403);
    await http().get('/api/v1/kb/admin').set(bearer(buyerToken)).expect(403);
    await http().get('/api/v1/kb/admin').set(bearer(adminToken)).expect(200);
  });

  it('validación: pregunta corta / answerHtml vacío → 400', async () => {
    await http().post('/api/v1/kb').set(bearer(adminToken)).send({ question: 'a', answerHtml: '<p>y</p>' }).expect(400);
    await http().post('/api/v1/kb').set(bearer(adminToken)).send({ question: 'válida', answerHtml: '' }).expect(400);
  });

  // ---- Saneo de HTML (anti-XSS) ----
  it('el answerHtml se SANEA: elimina <script> y atributos peligrosos, conserva formato', async () => {
    const a = await createArticle({
      answerHtml:
        '<p>Hola <strong>mundo</strong></p><script>alert(1)</script>' +
        '<img src=x onerror="alert(2)"><a href="javascript:alert(3)">x</a>',
    });
    expect(a.answerHtml).toContain('<strong>mundo</strong>');
    expect(a.answerHtml).not.toMatch(/<script/i);
    expect(a.answerHtml).not.toMatch(/onerror/i);
    expect(a.answerHtml).not.toMatch(/javascript:/i);
  });

  // ---- Slug autogenerado + único ----
  it('slug: se autogenera desde la pregunta y se hace único ante colisión', async () => {
    const q = `${PFX}Cómo Reservar un Lugar`;
    const a1 = await http()
      .post('/api/v1/kb')
      .set(bearer(adminToken))
      .send({ question: q, answerHtml: '<p>r</p>' })
      .expect(201);
    const a2 = await http()
      .post('/api/v1/kb')
      .set(bearer(adminToken))
      .send({ question: q, answerHtml: '<p>r</p>' })
      .expect(201);
    expect(a1.body.slug).toMatch(/^e2e-kb-como-reservar-un-lugar$/);
    expect(a2.body.slug).not.toBe(a1.body.slug); // sufijo -2
  });

  // ---- Ciclo de publicación + FAQ público ----
  it('draft NO aparece en el FAQ; al publicar aparece; al despublicar desaparece', async () => {
    const a = await createArticle({ question: 'Publicable', answerHtml: '<p>contenido publicable</p>' });
    const slug = a.slug;

    // draft → no en público (list ni detalle)
    let list = await http().get('/api/v1/kb').expect(200);
    expect(list.body.find((x: { slug: string }) => x.slug === slug)).toBeUndefined();
    await http().get(`/api/v1/kb/${slug}`).expect(404);

    // publicar → aparece
    await http().post(`/api/v1/kb/${a.id}/publish`).set(bearer(adminToken)).expect(200);
    list = await http().get('/api/v1/kb').expect(200);
    expect(list.body.find((x: { slug: string }) => x.slug === slug)).toBeDefined();
    const detail = await http().get(`/api/v1/kb/${slug}`).expect(200);
    expect(detail.body.answerHtml).toContain('publicable');

    // despublicar → desaparece
    await http().post(`/api/v1/kb/${a.id}/unpublish`).set(bearer(adminToken)).expect(200);
    await http().get(`/api/v1/kb/${slug}`).expect(404);
  });

  it('artículo INTERNO publicado no aparece en el FAQ público, pero sí en el asistente del agente', async () => {
    const a = await createArticle({
      question: 'Procedimiento interno de reembolso xyzzy',
      answerHtml: '<p>pasos internos xyzzy</p>',
      visibility: 'internal',
    });
    await http().post(`/api/v1/kb/${a.id}/publish`).set(bearer(adminToken)).expect(200);

    // FAQ público (list y búsqueda) NO lo incluye
    const pub = await http().get('/api/v1/kb/search?q=xyzzy').expect(200);
    expect(pub.body.find((s: { slug: string }) => s.slug === a.slug)).toBeUndefined();

    // asistente del agente (incluye internos) SÍ
    const agent = await http().get('/api/v1/kb/admin/suggest?q=xyzzy').set(bearer(adminToken)).expect(200);
    expect(agent.body.find((s: { slug: string }) => s.slug === a.slug)).toBeDefined();
  });

  // ---- Filtros del FAQ ----
  it('filtra por categoría y por búsqueda de texto', async () => {
    const uniq = `zebrahippo${Date.now()}`;
    const a = await createArticle({
      question: `Pregunta ${uniq}`,
      answerHtml: `<p>respuesta ${uniq}</p>`,
      category: 'technical',
    });
    await http().post(`/api/v1/kb/${a.id}/publish`).set(bearer(adminToken)).expect(200);

    const byCat = await http().get('/api/v1/kb?category=technical').expect(200);
    expect(byCat.body.every((x: { category: string }) => x.category === 'technical')).toBe(true);
    expect(byCat.body.find((x: { slug: string }) => x.slug === a.slug)).toBeDefined();

    const byText = await http().get(`/api/v1/kb?q=${uniq}`).expect(200);
    expect(byText.body.find((x: { slug: string }) => x.slug === a.slug)).toBeDefined();
  });

  // ---- Autoresponder (ranking) ----
  it('search rankea por relevancia (match en la pregunta pesa más que en la respuesta)', async () => {
    const tok = `refund${Date.now()}`;
    const strong = await createArticle({ question: `Cómo pedir ${tok}`, answerHtml: '<p>info</p>' });
    const weak = await createArticle({ question: 'Otra cosa', answerHtml: `<p>menciona ${tok} de pasada</p>` });
    await http().post(`/api/v1/kb/${strong.id}/publish`).set(bearer(adminToken)).expect(200);
    await http().post(`/api/v1/kb/${weak.id}/publish`).set(bearer(adminToken)).expect(200);

    const res = await http().get(`/api/v1/kb/search?q=${tok}`).expect(200);
    const idxStrong = res.body.findIndex((s: { slug: string }) => s.slug === strong.slug);
    const idxWeak = res.body.findIndex((s: { slug: string }) => s.slug === weak.slug);
    expect(idxStrong).toBeGreaterThanOrEqual(0);
    expect(idxStrong).toBeLessThan(idxWeak); // la pregunta rankea antes que la respuesta
    expect(res.body[idxStrong].answerText).toBeDefined(); // texto plano para el bot
  });

  it('search: query demasiado corta → 400 (validación)', async () => {
    await http().get('/api/v1/kb/search?q=a').expect(400);
  });

  // ---- viewCount ----
  it('el detalle público incrementa viewCount', async () => {
    const a = await createArticle({ answerHtml: '<p>vistas</p>' });
    await http().post(`/api/v1/kb/${a.id}/publish`).set(bearer(adminToken)).expect(200);
    await http().get(`/api/v1/kb/${a.slug}`).expect(200);
    await http().get(`/api/v1/kb/${a.slug}`).expect(200);
    const row = await prisma.kbArticle.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.viewCount).toBeGreaterThanOrEqual(2);
  });

  // ---- update / delete / adminGet ----
  it('update edita y re-sanea; delete elimina; adminGet 404 tras borrar', async () => {
    const a = await createArticle();
    await http()
      .patch(`/api/v1/kb/${a.id}`)
      .set(bearer(adminToken))
      .send({ question: 'Editada', answerHtml: '<p>nueva</p><script>x()</script>' })
      .expect(200);
    const got = await http().get(`/api/v1/kb/admin/${a.id}`).set(bearer(adminToken)).expect(200);
    expect(got.body.question).toBe('Editada');
    expect(got.body.answerHtml).not.toMatch(/<script/i);
    expect(got.body.answerText).toBe('nueva'); // texto plano derivado

    await http().delete(`/api/v1/kb/${a.id}`).set(bearer(adminToken)).expect(200);
    await http().get(`/api/v1/kb/admin/${a.id}`).set(bearer(adminToken)).expect(404);
  });

  it('adminGet / update / delete de id inexistente → 404', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    await http().get(`/api/v1/kb/admin/${ghost}`).set(bearer(adminToken)).expect(404);
    await http().patch(`/api/v1/kb/${ghost}`).set(bearer(adminToken)).send({ question: 'x y z' }).expect(404);
    await http().delete(`/api/v1/kb/${ghost}`).set(bearer(adminToken)).expect(404);
  });
});
