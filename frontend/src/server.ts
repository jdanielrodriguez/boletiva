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
