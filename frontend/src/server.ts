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
const angularApp = new AngularNodeAppEngine();

/**
 * Cabeceras de seguridad del ORIGEN que sirve el HTML/JS de sesión (auditoría A3).
 * El helmet del API solo protege el origen del API (JSON); el SSR de Angular no emitía
 * ninguna. Añadimos anti-clickjacking, nosniff, HSTS, Referrer-Policy y una CSP. La CSP
 * permite `'unsafe-inline'` en script/style porque Angular SSR inyecta estilos inline y
 * el index.html lleva un script anti-parpadeo inline; aun así bloquea scripts de OTROS
 * orígenes y el embebido en iframes (frame-ancestors 'none'). `connect-src` incluye el
 * API (mismo host:8080 en local; en prod el mismo dominio). Endurecer a nonce = follow-up.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' http://localhost:8080 https:",
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
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
 * Cache en el edge/CDN para páginas PÚBLICAS renderizadas por SSR. El contenido
 * público es anónimo (la sesión se hidrata en el cliente), así que es cacheable.
 * `s-maxage` aplica al CDN; `stale-while-revalidate` sirve una versión vieja
 * mientras revalida. Las rutas con estado de usuario van `no-store`.
 */
const PRIVATE_PREFIXES = ['/login', '/verificar-correo', '/403', '/mi', '/cuenta', '/admin', '/promotor'];

app.use((req, res, next) => {
  if (req.method === 'GET') {
    const path = req.path;
    const isPrivate = PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    res.setHeader(
      'Cache-Control',
      isPrivate
        ? 'no-store'
        : 'public, s-maxage=60, stale-while-revalidate=300',
    );
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
