import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
// I-04: no anunciar la tecnología del servidor (fingerprinting). El API ya lo hace.
app.disable('x-powered-by');
const angularApp = new AngularNodeAppEngine();

/**
 * Cabeceras de seguridad del ORIGEN que sirve el HTML/JS de sesión (auditoría A3).
 * El helmet del API solo protege el origen del API (JSON); el SSR de Angular no emitía
 * ninguna. Añadimos anti-clickjacking, nosniff, HSTS, Referrer-Policy y una CSP. La CSP
 * permite `'unsafe-inline'` en script/style porque Angular SSR inyecta estilos inline y
 * el index.html lleva un script anti-parpadeo inline. Permite el script/motor/iframe de
 * reCAPTCHA v3 (google/gstatic) y bloquea cualquier otro origen, además del embebido en
 * iframes ajenos (frame-ancestors 'none'). `connect-src` incluye el API (mismo host:8080
 * en local; en prod el mismo dominio). Endurecer a nonce = follow-up.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  // Imágenes/QRs/banners vienen de storage por URL firmada (local: http://localhost:45660;
  // prod: GCS https). Se permite http: y https: y blob:/data: para no bloquear los assets.
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob: https: http:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // reCAPTCHA v3: el loader (api.js) viene de www.google.com y su MOTOR de
  // www.gstatic.com. Sin permitirlos, grecaptcha.execute() falla → token vacío →
  // el backend responde 403 "Captcha inválido".
  "script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
  // reCAPTCHA v3 monta un iframe invisible de challenge desde www.google.com.
  "frame-src 'self' https://www.google.com",
  // API + SSE + storage (local http, prod https).
  "connect-src 'self' https: http:",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  // La PWA de validación en puerta (/validar) usa la CÁMARA para escanear QRs, así que se
  // permite `camera` al PROPIO origen (self). Con `camera=()` (allowlist vacía) el navegador
  // bloqueaba getUserMedia incluso con el permiso concedido. micrófono/geoloc siguen off.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  next();
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * I-03: recursos "bien conocidos" reales (rutas explícitas → deterministas, sin depender
 * del copiado de assets). `robots.txt` guía a los crawlers; `security.txt` (RFC 9116)
 * publica un contacto de seguridad.
 */
app.get('/robots.txt', (_req, res) => {
  res
    .type('text/plain')
    .send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /cuenta',
        'Disallow: /checkout',
        'Disallow: /admin',
        'Disallow: /promotor',
        'Disallow: /validar',
        'Disallow: /login',
        'Disallow: /verificar-correo',
        'Disallow: /passwordless',
        '',
      ].join('\n'),
    );
});
app.get('/.well-known/security.txt', (_req, res) => {
  res
    .type('text/plain')
    .send(
      [
        'Contact: mailto:security@boletiva.com',
        'Expires: 2027-07-19T00:00:00.000Z',
        'Preferred-Languages: es, en',
        'Canonical: https://boletiva.com/.well-known/security.txt',
        '',
      ].join('\n'),
    );
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Cache en el edge/CDN. Regla SEGURA POR DEFECTO (QA): TODO va `no-store` salvo una
 * ALLOWLIST explícita de rutas públicas y anónimas. Antes era al revés (una denylist de
 * prefijos privados) y rutas autenticadas fuera de la lista (/checkout, /configuracion,
 * /soporte, /reserva, /transferencias) recibían `public, s-maxage=60` — hoy inofensivo
 * porque el SSR es anónimo, pero el día que se hidrate la sesión en el servidor filtraría
 * HTML privado a la cache pública del CDN. Invertida, una ruta nueva es privada por
 * defecto y solo se cachea si se agrega aquí a conciencia.
 */
const PUBLIC_CACHEABLE_PREFIXES = ['/eventos', '/terminos'];
const isPublicCacheable = (path: string): boolean =>
  path === '/' || PUBLIC_CACHEABLE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader(
      'Cache-Control',
      isPublicCacheable(req.path)
        ? 'public, s-maxage=60, stale-while-revalidate=300'
        : 'no-store',
    );
  }
  next();
});

/**
 * I-03: 404 REAL para archivos estáticos inexistentes. `express.static` ya corrió; si un
 * path con extensión de asset llega hasta aquí es que NO existe → devolvemos 404 en vez
 * de dejar que el catch-all del SPA responda 200 con el index (que enmascara recursos y
 * dificulta distinguir lo que existe). Las rutas del SPA no tienen extensión → pasan.
 */
const STATIC_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|txt|json|woff2?|ttf|eot|xml|webmanifest|pdf)$/i;
app.use((req, res, next) => {
  if (req.method === 'GET' && STATIC_EXT.test(req.path)) {
    res.status(404).type('txt').send('Not found');
    return;
  }
  next();
});

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
