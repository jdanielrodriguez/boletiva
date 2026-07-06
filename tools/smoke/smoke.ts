/**
 * Smoke E2E de la Ola 0 — valida el sistema levantado "como una persona":
 *  1. Liveness responde.
 *  2. Health completo: PostgreSQL, Redis, RabbitMQ, storage y mail en verde.
 *  3. Contrato de error uniforme en una ruta inexistente (404).
 *  4. Un navegador headless (Puppeteer) abre la UI de Swagger y confirma que carga.
 *
 * Se ejecuta DENTRO del contenedor api (usa el chromium del sistema).
 * Uso: npm run smoke   (o: make smoke)
 */
import axios from 'axios';
import puppeteer from 'puppeteer-core';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium-browser';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function waitForApi(retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await axios.get(`${BASE}/api/v1/health/live`, { timeout: 2000 });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`La API no respondió en ${BASE} tras ${retries}s`);
}

async function main(): Promise<void> {
  console.log(`\n== Smoke E2E Ola 0 → ${BASE} ==\n`);
  await waitForApi();

  // 1. Liveness
  const live = await axios.get(`${BASE}/api/v1/health/live`);
  check('GET /api/v1/health/live responde 200', live.status === 200 && live.data.status === 'ok');

  // 2. Health completo
  const health = await axios.get(`${BASE}/api/v1/health`, { validateStatus: () => true });
  check('GET /api/v1/health responde 200 (todo sano)', health.status === 200, `status=${health.data?.status}`);
  const checks = health.data?.checks ?? {};
  for (const dep of ['postgres', 'redis', 'rabbitmq', 'storage', 'mail']) {
    check(`  dependencia ${dep} en verde`, checks[dep]?.ok === true, checks[dep]?.detail ?? `${checks[dep]?.latencyMs}ms`);
  }

  // 3. Contrato de error 404
  const notFound = await axios.get(`${BASE}/api/v1/ruta-inexistente`, { validateStatus: () => true });
  check(
    'Ruta inexistente devuelve 404 con contrato de error',
    notFound.status === 404 && typeof notFound.data?.message !== 'undefined' && !!notFound.data?.timestamp,
  );

  // 4. Swagger UI en un navegador real
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const resp = await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle2', timeout: 20000 });
    check('GET /docs responde 200', !!resp && resp.status() === 200);
    await page.waitForSelector('.swagger-ui', { timeout: 15000 });
    const title = await page.title();
    check('Swagger UI se renderiza en el navegador', true, `title="${title}"`);
  } finally {
    await browser.close();
  }

  console.log(`\n== Resultado: ${failures === 0 ? 'TODO OK ✅' : `${failures} fallo(s) ❌`} ==\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Smoke abortado:', err.message);
  process.exit(1);
});
