/**
 * Capturas de pantalla de verificación (temporal). Loguea como promotor (2FA por
 * MailHog) y fotografía: sección banner (subir vs IA), botón crear→form de
 * localidad, cuadrícula 50x100, editor con plantillas, panel del promotor, y el
 * correo de invitación en MailHog. Se borra al terminar la tarea.
 */
import puppeteer from 'puppeteer-core';

const FE = 'http://pasaeventos_frontend:4200';
const MAIL = 'http://pasaeventos_mailhog:8025';
const OUT = '/tmp/shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function otpFromMail() {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      for (const m of data.items || []) {
        const body = String(m.Content?.Body || '').replace(/=\r?\n/g, '');
        const match = body.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await sleep(500);
  }
  throw new Error('no OTP');
}

async function login(page, email) {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email');
  await page.type('#email', email);
  await page.type('#password', 'Password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#code, [data-testid="session-greeting"]', { timeout: 15000 });
  if (await page.$('#code')) {
    await page.type('#code', await otpFromMail());
    await page.click('button[type="submit"]');
  }
  await page.waitForSelector('[data-testid="session-greeting"]', { timeout: 15000 });
}

async function setVal(page, sel, val) {
  await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, val);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 1000 });

  await login(page, 'promotor@pasaeventos.com');

  // Panel del promotor (botones prolijos).
  await page.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="events-grid"], [data-testid="events-empty"]', { timeout: 15000 });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/01-panel-promotor.png` });

  // Crear evento (modo nuevo).
  await page.click('[data-testid="toggle-create"]');
  await page.waitForSelector('[data-testid="ed-name"]', { timeout: 12000 });
  await page.type('[data-testid="ed-name"]', `Shot Evento ${Date.now()}`);
  await setVal(page, '[data-testid="ed-start"]', '2028-09-10T20:00');
  await page.screenshot({ path: `${OUT}/02-crear-evento-nuevo.png` });
  await page.click('[data-testid="ed-save"]');
  await page.waitForFunction(() => /\/editar/.test(location.href), { timeout: 12000 });
  await page.waitForSelector('[data-testid="tab-localidades"]', { timeout: 8000 });

  // Localidades: botón → form.
  await page.click('[data-testid="tab-localidades"]');
  await page.waitForSelector('[data-testid="loc-add-toggle"]', { timeout: 8000 });
  await page.screenshot({ path: `${OUT}/03-localidad-boton.png` });
  await page.click('[data-testid="loc-add-toggle"]');
  await page.waitForSelector('[data-testid="loc-name"]', { timeout: 8000 });
  await page.type('[data-testid="loc-name"]', 'Platea');
  await page.select('select[name="lk"]', 'seated');
  await setVal(page, '[data-testid="loc-net"]', '100');
  await page.waitForSelector('[data-testid="price-preview"]', { timeout: 8000 });
  await page.screenshot({ path: `${OUT}/04-localidad-form-preview.png` });
  await page.click('[data-testid="loc-add"]');
  await page.waitForSelector('[data-testid="loc-seats"]', { timeout: 8000 });

  // Banner: subir vs IA (desplegable).
  await page.click('[data-testid="tab-banner"]');
  await page.waitForSelector('[data-testid="bn-ai-toggle"]', { timeout: 8000 });
  await page.screenshot({ path: `${OUT}/05-banner-subir-vs-ia.png` });
  await page.click('[data-testid="bn-ai-toggle"]');
  await page.waitForSelector('[data-testid="bn-generate"]', { timeout: 8000 });
  await page.screenshot({ path: `${OUT}/06-banner-ia-form.png` });
  await page.click('[data-testid="bn-generate"]');
  await page.waitForSelector('[data-testid="bn-preview"]', { timeout: 15000 });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/07-banner-generado.png` });

  // Editor de asientos: cuadrícula 50x100 + plantillas.
  await page.click('[data-testid="tab-localidades"]');
  await page.waitForSelector('[data-testid="loc-seats"]', { timeout: 8000 });
  await page.click('[data-testid="loc-seats"]');
  await page.waitForSelector('[data-testid="seat-editor"]', { timeout: 12000 });
  await setVal(page, '[data-testid="se-rows"]', '50');
  await setVal(page, '[data-testid="se-cols"]', '100');
  await page.click('[data-testid="se-generate"]');
  await page.waitForFunction(
    () => /5000/.test(document.querySelector('[data-testid="se-count"]')?.textContent || ''),
    { timeout: 8000 },
  );
  await sleep(800);
  await page.screenshot({ path: `${OUT}/08-cuadricula-50x100.png` });
  await page.click('[data-testid="tpl-toggle"]');
  await page.waitForSelector('[data-testid="tpl-menu"]', { timeout: 6000 });
  await page.screenshot({ path: `${OUT}/09-plantillas-dropdown.png` });
  await page.click('[data-testid="tpl-theater"]');
  await sleep(800);
  await page.screenshot({ path: `${OUT}/10-plantilla-teatro.png` });

  // Canvas del cliente a todo el ancho (evento demo publicado).
  await page.goto(`${FE}/eventos/evento-demo-pasaeventos/comprar`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/11-compra-canvas.png` });

  await browser.close();
  console.log('shots OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
