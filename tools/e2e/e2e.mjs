/**
 * E2E de Boletiva con Puppeteer contra el stack REAL (frontend SSR + API +
 * MailHog). Valida cada funcionalidad del frontend de cara al usuario:
 * catálogo, hero, filtros, detalle+SEO, 404, login con 2FA (OTP leído de
 * MailHog) y la compra completa (selección → reserva → checkout → pago por SSE).
 *
 * Correr dentro del contenedor de la API (tiene puppeteer-core + chromium):
 *   make e2e
 * Requiere PAYMENT_SIMULATOR_AUTO_CONFIRM=true para que el pago se confirme solo.
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

// La página se sirve desde un origen `localhost` (mapeado al contenedor del
// frontend vía host-resolver) para quedar SAME-SITE con el API en localhost:8080,
// tal como el navegador real del usuario. Es requisito para que la cookie
// httpOnly del refresh (SameSite=Lax) viaje entre navegaciones. Ver launch args.
const FE = process.env.E2E_FRONTEND_URL || 'http://localhost:4200';
const MAIL = process.env.E2E_MAILHOG_URL || 'http://pasaeventos_mailhog:8025';
const BUYER = { email: 'cliente@boletiva.com', password: 'Password123' };
const EVENT_SLUG = 'evento-demo-pasaeventos';

let pass = 0;
let fail = 0;
const failures = [];

async function step(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name} — ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitSel(page, sel, timeout = 15000) {
  await page.waitForSelector(sel, { timeout });
}

async function text(page, sel) {
  return page.$eval(sel, (el) => el.textContent?.trim() ?? '').catch(() => '');
}

/**
 * Selecciona una localidad por su nombre (chip). Con el mapa único (B0) la compra
 * aterriza en la vista LEJANA sin localidad activa: hay que elegir la zona primero.
 */
async function clickLocTab(page, name) {
  await waitSel(page, '[data-testid="loc-tab"]');
  const clicked = await page.$$eval(
    '[data-testid="loc-tab"]',
    (btns, n) => {
      const b = btns.find((x) => (x.textContent || '').includes(n));
      if (b) {
        b.click();
        return true;
      }
      return false;
    },
    name,
  );
  if (!clicked) throw new Error(`no se encontró la localidad "${name}"`);
}

async function clearMail() {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
}

/** Lee el OTP de 6 dígitos del último correo en MailHog (poll hasta ~10s). */
async function otpFromMail() {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      const items = data.items || [];
      for (const m of items) {
        const body = (m.Content && m.Content.Body) || '';
        const decoded = body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
        const match = decoded.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await sleep(500);
  }
  throw new Error('no llegó el OTP a MailHog');
}

/**
 * Limpia las claves de anti-abuso (`res:ip:*` reservas y `rl:*` rate-limit). En local
 * todo corre desde una sola IP de contenedor, así que los contadores de una corrida
 * previa bloquearían la siguiente (429). Best-effort: si no hay ioredis/Redis, se ignora.
 */
async function flushReservationLimit() {
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(process.env.REDIS_URL || 'redis://pasaeventos_redis:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    await client.connect();
    const keys = [...(await client.keys('res:ip:*')), ...(await client.keys('rl:*'))];
    if (keys.length) await client.del(...keys);
    await client.quit();
  } catch {
    /* sin Redis disponible → el feature no está activo o no aplica */
  }
}

async function main() {
  await flushReservationLimit();
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      // localhost:4200 → contenedor del frontend; localhost:8080 sigue siendo el
      // API local → mismo site (localhost) → la cookie SameSite=Lax viaja.
      `--host-resolver-rules=MAP localhost:4200 ${process.env.E2E_FRONTEND_HOST || 'pasaeventos_frontend:4200'}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  console.log('\n▶ Catálogo');
  await step('el catálogo carga con hero y tarjetas', async () => {
    await page.goto(`${FE}/`, { waitUntil: 'networkidle0' });
    await waitSel(page, '.event-card');
    assert((await page.$('.hero')) !== null, 'no hay hero slider');
    const cards = await page.$$('.event-card');
    assert(cards.length > 0, 'no hay tarjetas de evento');
    assert((await text(page, '[data-testid="catalog-count"]')).length > 0, 'sin conteo');
  });

  await step('el filtro por categoría cambia el query param', async () => {
    const btns = await page.$$('.catalog-categories button');
    assert(btns.length > 1, 'no hay categorías');
    await btns[1].click();
    await page.waitForFunction(() => location.search.includes('category='), { timeout: 8000 });
  });

  await step('la búsqueda cambia el query param', async () => {
    await page.goto(`${FE}/`, { waitUntil: 'networkidle0' });
    await waitSel(page, '.catalog-search input');
    await page.type('.catalog-search input', 'demo');
    // Enter busca (ruta primaria del search-field v3.10). El clic en la lupita hace
    // lo mismo (mismo emitSearch); se valida por unit del componente.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.search.includes('search='), { timeout: 8000 });
  });

  console.log('\n▶ Detalle y SEO');
  await step('el detalle carga por slug con JSON-LD Event', async () => {
    await page.goto(`${FE}/eventos/${EVENT_SLUG}`, { waitUntil: 'networkidle0' });
    await waitSel(page, 'h1');
    const h1 = await text(page, 'h1');
    assert(h1.length > 0, `h1 vacío`); // el @type=Event de abajo confirma que es detalle de evento
    const ld = await page.$('#pe-jsonld');
    assert(ld !== null, 'falta JSON-LD');
    const type = await page.$eval('#pe-jsonld', (el) => JSON.parse(el.textContent)['@type']);
    assert(type === 'Event', `@type=${type}`);
    // Las localidades son enlaces (CTA) que llevan a comprar esa localidad.
    const row = await page.$('[data-testid="locality-row"]');
    assert(row !== null, 'faltan filas de localidad');
    const href = await page.$eval('[data-testid="locality-row"]', (a) => a.getAttribute('href'));
    assert(href && href.includes('/comprar'), `la localidad no enlaza a comprar: ${href}`);
  });

  await step('slug inexistente devuelve 404 y muestra no-encontrado', async () => {
    const resp = await page.goto(`${FE}/eventos/no-existe-xyz-000`, { waitUntil: 'networkidle0' });
    assert(resp.status() === 404, `status=${resp.status()}`);
    await waitSel(page, '[data-testid="event-notfound"]', 8000);
  });

  console.log('\n▶ Reserva anónima compartible');
  let shareLink = '';
  await step('reserva SIN login y genera link para compartir', async () => {
    await page.goto(`${FE}/eventos/${EVENT_SLUG}/comprar`, { waitUntil: 'networkidle0' });
    await clickLocTab(page, 'General'); // mapa único: elegir la zona GA para ver el stepper
    await waitSel(page, '[data-testid="loc-quantity"]');
    await waitSel(page, '[data-testid="qty-plus"]');
    await page.click('[data-testid="qty-plus"]');
    await page.click('[data-testid="reserve-btn"]');
    // Reservar pide confirmación de la selección → aceptar en el modal.
    await waitSel(page, '[data-testid="confirm-accept"]', 8000);
    await page.click('[data-testid="confirm-accept"]');
    await waitSel(page, '[data-testid="share-box"]', 15000);
    const wa = await page.$eval('.share-btn.wa', (a) => a.href);
    const m = decodeURIComponent(wa).match(/\/reserva\/[^\s]+/);
    assert(m, 'no se encontró el link de reserva');
    shareLink = `${FE}${m[0]}`;
  });

  await step('abrir el link muestra la reserva y pide login al pagar', async () => {
    await page.goto(shareLink, { waitUntil: 'networkidle0' });
    await waitSel(page, '[data-testid="pay-btn"]');
    assert(
      (await page.$('[data-testid="reservation-items"]')) !== null,
      'no se ven los ítems de la reserva',
    );
    await page.click('[data-testid="pay-btn"]');
    await waitSel(page, '[data-testid="login-modal"]', 8000);
  });

  console.log('\n▶ Login con 2FA (OTP por MailHog)');
  await step('login con contraseña + 2FA inicia sesión', async () => {
    await clearMail();
    await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
    await waitSel(page, '#email');
    await page.type('#email', BUYER.email);
    await page.type('#password', BUYER.password);
    await page.click('button[type="submit"]');
    // Puede pedir 2FA (dispositivo nuevo). El código ahora es un app-otp-input
    // (casillas por dígito): se llena dígito por dígito en cada otp-box-<i>.
    await waitSel(page, '[data-testid="otp-box-0"], [data-testid="session-greeting"]', 15000);
    if (await page.$('[data-testid="otp-box-0"]')) {
      const otp = await otpFromMail();
      for (let i = 0; i < otp.length; i++) await page.type(`[data-testid="otp-box-${i}"]`, otp[i]);
      await page.click('button[type="submit"]');
    }
    await waitSel(page, '[data-testid="session-greeting"]', 15000);
  });

  console.log('\n▶ Compra completa (selección → reserva → checkout → pago SSE)');
  await step('selecciona General por cantidad y reserva', async () => {
    await page.goto(`${FE}/eventos/${EVENT_SLUG}/comprar`, { waitUntil: 'networkidle0' });
    await clickLocTab(page, 'General'); // mapa único: elegir la zona GA para ver el stepper
    await waitSel(page, '[data-testid="loc-quantity"]');
    // Stepper +/− (reemplazó al <select> nativo): sube a 2, esperando el re-render
    // (zoneless) entre clics para no perder ninguna pulsación.
    const plus = await page.$('[data-testid="qty-plus"]');
    assert(plus !== null, 'no hay selector de cantidad para General');
    await page.click('[data-testid="qty-plus"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="qty-value"]')?.textContent.trim() === '1',
      { timeout: 5000 },
    );
    await page.click('[data-testid="qty-plus"]');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="qty-value"]')?.textContent.trim() === '2',
      { timeout: 5000 },
    );
    await page.click('[data-testid="reserve-btn"]');
    await waitSel(page, '[data-testid="confirm-accept"]', 8000);
    await page.click('[data-testid="confirm-accept"]');
    await waitSel(page, '[data-testid="countdown"]', 15000);
  });

  await step('continúa al checkout y muestra el desglose', async () => {
    await page.click('[data-testid="pay-btn"]');
    await page.waitForFunction(() => location.pathname.startsWith('/checkout/'), { timeout: 15000 });
    await waitSel(page, '[data-testid="breakdown"]');
    assert((await text(page, '[data-testid="service-fee"]')).includes('Q'), 'sin cuota de servicio');
    assert((await text(page, '[data-testid="total"]')).includes('Q'), 'sin total');
  });

  await step('paga y el estado pasa a pagado por SSE', async () => {
    // v3.8: si el cliente tiene una tarjeta guardada, el checkout arranca en modo
    // 'saved' y exige CVV para habilitar el pago; llénalo si el campo está presente
    // (con tarjeta nueva no aparece → el paso sigue funcionando).
    const cvv = await page.$('[data-testid="saved-cvv"]');
    if (cvv) {
      await cvv.type('123');
    }
    await page.click('[data-testid="pay-confirm"]');
    await waitSel(page, '[data-testid="status-paid"]', 20000);
  });

  console.log('\n▶ Cuenta (F3): perfil, wallet, boletos');
  await step('el guard de invitado saca de /login estando logueado', async () => {
    await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
    // guestGuard redirige al inicio: no debe quedar en /login ni mostrar el form.
    await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 8000 });
  });

  await step('la cuenta muestra el perfil (correo) y permite guardar', async () => {
    await page.goto(`${FE}/cuenta`, { waitUntil: 'networkidle0' });
    // Navegación en frío: la sesión se re-hidrata por refresh y el router re-evalúa
    // el guard → esperar primero el menú de la cuenta, luego el botón de guardar.
    await waitSel(page, '.account-menu', 25000);
    await waitSel(page, '[data-testid="save-profile"]', 10000);
    assert((await page.content()).includes(BUYER.email), 'no se ve el correo del usuario');
  });

  await step('la sección wallet carga el saldo', async () => {
    await page.click('[data-testid="menu-wallet"]');
    await waitSel(page, '[data-testid="wallet-balance"]', 8000);
    assert((await text(page, '[data-testid="wallet-balance"]')).includes('Q'), 'sin saldo');
  });

  await step('menú NO se desincroniza: header→wallet, lateral→perfil, header→wallet re-despliega', async () => {
    // Repro del bug reportado: entrar por el dropdown a Wallet, cambiar por el menú
    // lateral a Perfil, y volver por el dropdown a Wallet → debe mostrar Wallet.
    const ddWallet = async () => {
      await page.click('[data-testid="user-menu-trigger"]');
      await waitSel(page, '[data-testid="dd-wallet"]', 5000);
      await page.click('[data-testid="dd-wallet"]');
    };
    await ddWallet();
    await waitSel(page, '[data-testid="wallet-balance"]', 8000);
    // Menú lateral → Perfil (primer botón del .account-menu).
    await page.$$eval('.account-menu button', (b) => b[0].click());
    await waitSel(page, '[data-testid="save-profile"]', 8000);
    // Header → Wallet otra vez: antes se quedaba en Perfil (navegación nula).
    await ddWallet();
    await waitSel(page, '[data-testid="wallet-balance"]', 8000);
    assert((await page.$('[data-testid="save-profile"]')) === null, 'la vista quedó atascada en Perfil (desync)');
  });

  await step('los boletos activos aparecen tras la compra (emisión async)', async () => {
    let ok = false;
    for (let i = 0; i < 25 && !ok; i++) {
      await page.goto(`${FE}/cuenta`, { waitUntil: 'networkidle0' });
      await waitSel(page, '.account-menu', 20000);
      await page.click('[data-testid="menu-activos"]');
      // Espera a que aparezca el botón de transferir (hay boleto) o el mensaje vacío.
      await page
        .waitForSelector('[data-testid="ticket-transfer"], .ticket-list, .account-content .muted', { timeout: 4000 })
        .catch(() => {});
      ok = (await page.$('[data-testid="ticket-transfer"]')) !== null;
      if (!ok) await sleep(1500);
    }
    assert(ok, 'los boletos activos (con transferir) no aparecieron tras la compra');
  });

  await step('el QR se muestra por defecto y su URL usa el host público (fix del QR)', async () => {
    // El QR arranca visible (auto-carga la media, que se genera async tras emitir).
    // Chromium corre DENTRO del contenedor api, donde el host público de storage no
    // resuelve; por eso no descargamos la imagen sino que verificamos que la URL
    // firmada apunta al endpoint PÚBLICO (no al host interno de docker). El navegador
    // real del usuario (en el host) sí resuelve ese endpoint (verificado aparte).
    let src = null;
    for (let i = 0; i < 20 && !src; i++) {
      await page.goto(`${FE}/cuenta?s=activos`, { waitUntil: 'networkidle0' });
      await waitSel(page, '.account-menu', 20000);
      const img = await page.$('.poster-qr img');
      if (img) src = await page.evaluate((el) => el.getAttribute('src'), img);
      if (!src) await sleep(1500);
    }
    assert(src, 'el QR no apareció (media aún no generada)');
    assert(!src.includes('pasaeventos_localstack'), `la URL del QR usa el host interno de docker: ${src}`);
    assert(/localhost:45660|https?:\/\//.test(src), `la URL del QR no parece pública: ${src}`);
  });

  await step('la facturación muestra la compra y su cadena blockchain verificable', async () => {
    await page.goto(`${FE}/cuenta?s=facturacion`, { waitUntil: 'networkidle0' });
    await waitSel(page, '.account-menu', 20000);
    await waitSel(page, '[data-testid="orders-list"]', 10000);
    await page.click('[data-testid="toggle-chain"]');
    await waitSel(page, '[data-testid="ledger-chain"]', 8000);
    const chain = await text(page, '[data-testid="ledger-chain"]');
    assert(chain.includes('íntegra'), 'la cadena de la transacción no se verificó como íntegra');
  });

  await step('métodos de pago: guarda una tarjeta tokenizada (el PAN no sale del navegador)', async () => {
    await page.goto(`${FE}/cuenta?s=metodos`, { waitUntil: 'networkidle0' });
    await waitSel(page, '.account-menu', 20000);
    await page.click('[data-testid="add-method"]');
    await waitSel(page, '[data-testid="card-number"]', 6000);
    await page.type('[data-testid="card-number"]', '4242424242424242');
    // B6: mes (01–12) y año (>= actual) son obligatorios para habilitar Guardar;
    // el CVV es de 3 dígitos para Visa/MC (4 solo Amex).
    await page.type('[data-testid="card-exp-m"]', '12');
    await page.type('[data-testid="card-exp-y"]', '30');
    await page.type('[data-testid="card-cvc"]', '123');
    await page.click('[data-testid="save-card"]');
    await waitSel(page, '[data-testid="cards-list"]', 8000);
    const cards = await text(page, '[data-testid="cards-list"]');
    assert(cards.includes('4242'), 'la tarjeta guardada no aparece en la lista');
  });

  console.log('\n▶ Conviértete en promotor (v3.6)');
  await step('el cliente ve "Conviértete en promotor" en el footer y llega al formulario', async () => {
    await page.goto(`${FE}/`, { waitUntil: 'networkidle0' });
    await waitSel(page, '.footer-menu', 10000);
    const links = await page.$$eval('.footer-menu a', (as) => as.map((a) => a.textContent.trim()));
    assert(
      links.some((t) => /Conviértete en promotor/i.test(t)),
      `el cliente debería ver el CTA en el footer: ${links.join(' | ')}`,
    );
    await page.click('.footer-menu a.footer-cta');
    await page.waitForFunction(() => location.pathname === '/conviertete-en-promotor', { timeout: 12000 });
  });

  await step('el cliente envía la solicitud de promotor (require_approval → pendiente)', async () => {
    await page.goto(`${FE}/conviertete-en-promotor`, { waitUntil: 'networkidle0' });
    // Pantalla de PLANES (free/premium) la primera vez, o el estado pendiente
    // en corridas previas. Elegir un plan estando logueado abre la modal de
    // instrucciones; confirmar dentro (bp-info-confirm) envía la solicitud.
    await waitSel(page, '[data-testid="bp-choose-free"], [data-testid="bp-pending"]', 12000);
    if (await page.$('[data-testid="bp-choose-free"]')) {
      await page.click('[data-testid="bp-choose-free"]');
      await waitSel(page, '[data-testid="bp-info-confirm"]', 12000);
      await page.click('[data-testid="bp-info-confirm"]');
    }
    await waitSel(page, '[data-testid="bp-pending"]', 12000);
  });

  // --- F4: panel del promotor + invitación de promotores ---
  async function doLogin(pg, email, password) {
    await clearMail();
    await pg.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('#email', { timeout: 15000 });
    await pg.type('#email', email);
    await pg.type('#password', password);
    await pg.click('button[type="submit"]');
    await pg.waitForSelector('[data-testid="otp-box-0"], [data-testid="session-greeting"]', { timeout: 15000 });
    if (await pg.$('[data-testid="otp-box-0"]')) {
      const otp = await otpFromMail();
      for (let i = 0; i < otp.length; i++) await pg.type(`[data-testid="otp-box-${i}"]`, otp[i]);
      await pg.click('button[type="submit"]');
    }
    await pg.waitForSelector('[data-testid="session-greeting"]', { timeout: 15000 });
  }

  // Fija el valor de un <input> reactivo (datetime-local) y dispara el evento
  // input para que ngModel lo capture (page.type no sirve en datetime-local).
  async function setReactiveValue(pg, sel, val) {
    await pg.$eval(
      sel,
      (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      val,
    );
  }

  console.log('\n▶ Panel del promotor (F4/v3)');
  const promoCtx = await browser.createBrowserContext();
  const promo = await promoCtx.newPage();
  await step('"Nuevo evento" abre la vista de edición en MODO NUEVO (form en blanco) y Guardar crea', async () => {
    await doLogin(promo, 'promotor@boletiva.com', 'Password123');
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    await promo.waitForSelector('[data-testid="toggle-create"]', { timeout: 15000 });
    // El botón navega a /promotor/eventos/nuevo (misma página de edición, en blanco).
    await promo.click('[data-testid="toggle-create"]');
    await promo.waitForSelector('[data-testid="new-badge"]', { timeout: 12000 });
    assert(/\/promotor\/eventos\/nuevo/.test(promo.url()), `no navegó a nuevo: ${promo.url()}`);
    // Publicar aún no existe (evento sin crear).
    assert((await promo.$('[data-testid="publish-btn"]')) === null, 'Publicar no debería existir en modo nuevo');
    await promo.waitForSelector('[data-testid="ed-name"]', { timeout: 8000 });
    await promo.type('[data-testid="ed-name"]', `E2E Evento ${Date.now()}`);
    await setReactiveValue(promo, '[data-testid="ed-start"]', '2028-08-15T20:00');
    // Guardar = crea y pasa a modo edición (URL con id real).
    await promo.click('[data-testid="ed-save"]');
    await promo.waitForFunction(() => /\/promotor\/eventos\/.+\/editar/.test(location.href), { timeout: 12000 });
    await promo.waitForSelector('[data-testid="tab-localidades"]', { timeout: 8000 });
  });

  await step('recién creado: Publicar está DESHABILITADO y explica qué falta', async () => {
    await promo.waitForSelector('[data-testid="publish-btn"]', { timeout: 8000 });
    const disabled = await promo.$eval('[data-testid="publish-btn"]', (b) => b.disabled);
    assert(disabled === true, 'Publicar debería estar deshabilitado sin banner/localidades');
    const block = await text(promo, '[data-testid="publish-block"]');
    assert(block.length > 0, 'debería explicar qué falta para publicar');
  });

  await step('preview de precio por localidad: al abrir el form y teclear el neto muestra el desglose', async () => {
    await promo.click('[data-testid="tab-localidades"]');
    // Patrón botón→form: el form de localidad está plegado; se abre con el botón.
    await promo.waitForSelector('[data-testid="loc-add-toggle"]', { timeout: 8000 });
    await promo.click('[data-testid="loc-add-toggle"]');
    await promo.waitForSelector('[data-testid="loc-net"]', { timeout: 8000 });
    await setReactiveValue(promo, '[data-testid="loc-net"]', '100');
    await promo.waitForSelector('[data-testid="price-preview"]', { timeout: 8000 });
    const txt = await promo.$eval('[data-testid="price-preview"]', (e) => e.textContent || '');
    assert(txt.includes('Q'), 'el preview no muestra el precio');
  });

  await step('administrar asientos abre una VISTA APARTE con plantillas y guardado (cuadrícula 50x100)', async () => {
    // Crea una localidad "con asiento" (form ya abierto del paso anterior).
    await promo.waitForSelector('[data-testid="loc-name"]', { timeout: 8000 });
    await promo.type('[data-testid="loc-name"]', `Platea ${Date.now()}`);
    await promo.select('select[name="lk"]', 'seated');
    await promo.click('[data-testid="loc-add"]');
    await promo.waitForSelector('[data-testid="loc-seats"]', { timeout: 8000 });
    await promo.click('[data-testid="loc-seats"]');
    await promo.waitForSelector('[data-testid="seat-editor"]', { timeout: 12000 });
    assert(/\/localidades\/.+\/asientos/.test(promo.url()), `no navegó a la vista de asientos: ${promo.url()}`);
    // Bug corregido: 50 filas × 100 asientos por fila (antes lo rechazaba por max chico).
    await setReactiveValue(promo, '[data-testid="se-rows"]', '50');
    await setReactiveValue(promo, '[data-testid="se-cols"]', '100');
    await promo.click('[data-testid="se-generate"]');
    await promo.waitForFunction(
      () => /5000/.test(document.querySelector('[data-testid="se-count"]')?.textContent || ''),
      { timeout: 8000 },
    );
    // El menú "Generar" abre el desplegable de generadores + plantillas (v3.5).
    await promo.click('[data-testid="gen-toggle"]');
    await promo.waitForSelector('[data-testid="gen-menu"]', { timeout: 6000 });
    await promo.click('[data-testid="tpl-theater"]');
    await promo.waitForFunction(
      () => !/5000/.test(document.querySelector('[data-testid="se-count"]')?.textContent || ''),
      { timeout: 6000 },
    );
    // Guarda la disposición (bulk) y vuelve al editor.
    await promo.click('[data-testid="se-save"]');
    await sleep(1500);
    await promo.click('[data-testid="seat-back"]');
    await promo.waitForSelector('[data-testid="tab-localidades"]', { timeout: 12000 });
    assert(/\/editar/.test(promo.url()), `el back no volvió al editor: ${promo.url()}`);
  });

  await step('banner: la IA está tras un desplegable y genera el banner del evento', async () => {
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    await promo.waitForSelector('[data-testid="ev-edit"]', { timeout: 12000 });
    await sleep(400);
    await promo.click('[data-testid="ev-edit"]');
    await promo.waitForSelector('[data-testid="tab-banner"]', { timeout: 12000 });
    await promo.click('[data-testid="tab-banner"]');
    // El form de IA NO está visible hasta abrir el desplegable.
    await promo.waitForSelector('[data-testid="bn-ai-toggle"]', { timeout: 8000 });
    assert((await promo.$('[data-testid="bn-generate"]')) === null, 'el form de IA no debería estar visible aún');
    await promo.click('[data-testid="bn-ai-toggle"]');
    await promo.waitForSelector('[data-testid="bn-generate"]', { timeout: 8000 });
    await promo.click('[data-testid="bn-generate"]');
    await promo.waitForSelector('[data-testid="bn-preview"]', { timeout: 15000 });
    const src = await promo.$eval('[data-testid="bn-preview"]', (i) => i.getAttribute('src'));
    assert(src && src.includes('http'), 'el banner no tiene URL');
  });

  await step('banner: elegir imagen muestra PREVIEW (Guardar/Cancelar) antes de subir; Cancelar la descarta', async () => {
    // Sigue en el tab banner del mismo evento. Escribe una imagen mínima válida.
    const imgPath = '/tmp/e2e-banner.png';
    writeFileSync(
      imgPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const input = await promo.$('[data-testid="bn-file"]');
    await input.uploadFile(imgPath);
    // NO sube todavía: aparece la PREVIEW con Guardar/Cancelar, ARRIBA del generar-IA.
    await promo.waitForSelector('[data-testid="bn-preview-pending"]', { timeout: 8000 });
    assert((await promo.$('[data-testid="bn-preview-save"]')) !== null, 'falta el botón Guardar del preview');
    assert((await promo.$('[data-testid="bn-preview-cancel"]')) !== null, 'falta el botón Cancelar del preview');
    // La preview está antes del desplegable de IA en el DOM.
    const beforeAi = await promo.evaluate(() => {
      const p = document.querySelector('[data-testid="bn-preview-pending"]');
      const ai = document.querySelector('[data-testid="bn-ai-toggle"]');
      return !!(p && ai && p.compareDocumentPosition(ai) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert(beforeAi, 'la preview debería ir arriba del bloque "Generar con IA"');
    // Cancelar descarta el preview sin subir nada (la subida real a S3 no es
    // alcanzable desde el navegador E2E; el Guardar está cubierto por unit test).
    await promo.click('[data-testid="bn-preview-cancel"]');
    await promo.waitForFunction(
      () => !document.querySelector('[data-testid="bn-preview-pending"]'),
      { timeout: 8000 },
    );
  });

  await step('publicar queda habilitado solo con banner + asientos (gate del backend)', async () => {
    // Tras generar banner y guardar asientos, el gate se cumple → Publicar habilitado.
    await promo.waitForSelector('[data-testid="publish-btn"]', { timeout: 8000 });
    const disabled = await promo.$eval('[data-testid="publish-btn"]', (b) => b.disabled);
    assert(disabled === false, 'Publicar debería estar habilitado con banner + asientos');
  });

  await step('eliminar un evento pide confirmación (modal); cancelar no borra', async () => {
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    await promo.waitForSelector('[data-testid="ev-delete"]', { timeout: 12000 });
    const before = (await promo.$$('[data-testid="ev-card"]')).length;
    await promo.click('[data-testid="ev-delete"]');
    await promo.waitForSelector('[data-testid="confirm-dialog"]', { timeout: 8000 });
    await promo.click('[data-testid="confirm-cancel"]');
    await sleep(300);
    const after = (await promo.$$('[data-testid="ev-card"]')).length;
    assert(after === before, 'cancelar la confirmación no debería borrar el evento');
  });

  await step('suspender un evento publicado lo despublica, lo deja editable y re-publicable (v3.7)', async () => {
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    // Filtra por nombre para apuntar SOLO al evento demo (hay otros publicados de
    // corridas previas). Con el filtro activo, la única card es la del demo.
    await promo.waitForSelector('[data-testid="panel-search"]', { timeout: 15000 });
    await promo.type('[data-testid="panel-search"]', 'Evento Demo');
    await promo.waitForFunction(
      () => {
        const c = [...document.querySelectorAll('[data-testid="ev-card"]')];
        return c.length === 1 && /Evento Demo/i.test(c[0].textContent || '');
      },
      { timeout: 8000 },
    );
    await promo.waitForSelector('[data-testid="ev-suspend"]', { timeout: 8000 });
    await promo.screenshot({ path: '/tmp/e2e-suspend-01-panel.png' });
    await promo.click('[data-testid="ev-suspend"]');
    await promo.waitForSelector('[data-testid="confirm-dialog"]', { timeout: 8000 });
    await promo.screenshot({ path: '/tmp/e2e-suspend-02-confirm.png' });
    await promo.click('[data-testid="confirm-accept"]');
    // v3.13 · W8: el filtro por defecto "Futuros" oculta los suspendidos → tras
    // suspender hay que ver "Todos" para encontrar la card del demo.
    await promo.select('[data-testid="panel-filter-status"]', 'all');
    await sleep(400);
    // Tras suspender, la card del demo pasa a ofrecer "Publicar" (re-publicar) y ya no "Suspender".
    await promo.waitForFunction(
      () => {
        const c = document.querySelector('[data-testid="ev-card"]');
        return !!c && !c.querySelector('[data-testid="ev-suspend"]') && !!c.querySelector('[data-testid="ev-publish"]');
      },
      { timeout: 12000 },
    );

    // Ya NO es visible públicamente: el detalle por slug responde 404.
    const resp = await promo.goto(`${FE}/eventos/${EVENT_SLUG}`, { waitUntil: 'networkidle0' });
    assert(resp.status() === 404, `el evento suspendido debería dar 404 público; status=${resp.status()}`);
    await waitSel(promo, '[data-testid="event-notfound"]', 8000);

    // Abre el editor del demo: badge "Suspendido", nota de reconfiguración y (por la
    // compra del flujo del comprador) el AVISO grande de boletos vendidos con link a T&C.
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    await promo.waitForSelector('[data-testid="panel-search"]', { timeout: 12000 });
    // El demo quedó suspendido → filtro "Todos" para verlo (default oculta suspendidos, W8).
    await promo.select('[data-testid="panel-filter-status"]', 'all');
    await promo.type('[data-testid="panel-search"]', 'Evento Demo');
    await promo.waitForFunction(
      () => document.querySelectorAll('[data-testid="ev-card"]').length === 1,
      { timeout: 8000 },
    );
    await promo.click('[data-testid="ev-edit"]');
    await promo.waitForSelector('[data-testid="ev-status-badge"]', { timeout: 12000 });
    const badge = await text(promo, '[data-testid="ev-status-badge"]');
    assert(/suspendid/i.test(badge), `el badge debería decir Suspendido; fue "${badge}"`);
    assert((await promo.$('[data-testid="suspended-note"]')) !== null, 'falta la nota de suspendido');
    const warn = await promo.$('[data-testid="sold-warning"]');
    assert(warn !== null, 'debería mostrarse el aviso de boletos vendidos (hubo una compra)');
    const tcHref = await promo.$eval('[data-testid="sold-warning-link"]', (a) => a.getAttribute('href'));
    assert(tcHref === '/terminos#reembolsos', `el link de T&C es incorrecto: ${tcHref}`);
    await promo.screenshot({ path: '/tmp/e2e-suspend-03-editor-datos.png' });

    // Reconfigurable: el aviso persiste en otras tabs y las localidades son editables.
    await promo.click('[data-testid="tab-localidades"]');
    await promo.waitForSelector('[data-testid="loc-add-toggle"]', { timeout: 8000 });
    assert((await promo.$('[data-testid="sold-warning"]')) !== null, 'el aviso debería verse también en Localidades');
    await promo.screenshot({ path: '/tmp/e2e-suspend-04-localidades.png' });

    // Asegura un banner (el demo semilla no trae cover) generándolo con la IA stub
    // → registra un media `cover` para que el gate de publicar se cumpla.
    await promo.click('[data-testid="tab-banner"]');
    await promo.waitForSelector('[data-testid="bn-ai-toggle"]', { timeout: 8000 });
    await promo.click('[data-testid="bn-ai-toggle"]');
    await promo.waitForSelector('[data-testid="bn-generate"]', { timeout: 8000 });
    await promo.click('[data-testid="bn-generate"]');
    await promo.waitForSelector('[data-testid="bn-preview"]', { timeout: 15000 });

    // Vuelve a publicar (restaura el estado del demo para el resto de la suite).
    await promo.click('[data-testid="tab-datos"]');
    await promo.waitForFunction(
      () => {
        const b = document.querySelector('[data-testid="publish-btn"]');
        return b && !b.disabled;
      },
      { timeout: 10000 },
    );
    await promo.click('[data-testid="publish-btn"]');
    await promo.waitForSelector('[data-testid="confirm-dialog"]', { timeout: 8000 });
    await promo.click('[data-testid="confirm-accept"]');
    await promo.waitForFunction(
      () => /publicad/i.test(document.querySelector('[data-testid="ev-status-badge"]')?.textContent || ''),
      { timeout: 12000 },
    );
  });

  await step('el promotor NO ve el enlace de invitaciones (exclusivo admin)', async () => {
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    // Espera la hidratación de la sesión (el saludo solo aparece autenticado en cliente).
    await promo.waitForSelector('[data-testid="session-greeting"]', { timeout: 20000 });
    await promo.click('[data-testid="user-menu-trigger"]');
    await promo.waitForSelector('[data-testid="user-dropdown"]', { timeout: 8000 });
    const cfg = await promo.$('[data-testid="config-link"]');
    assert(cfg === null, 'el promotor no debería ver Configuración (admin)');
    const panel = await promo.$('[data-testid="promoter-link"]');
    assert(panel !== null, 'el promotor debería ver el enlace del panel del promotor');
  });
  await promoCtx.close();

  console.log('\n▶ Consola de administración (v3)');
  const adminCtx = await browser.createBrowserContext();
  const adminPg = await adminCtx.newPage();
  let inviteLink = '';
  await step('el admin invita a un promotor por correo y obtiene el enlace con token', async () => {
    await doLogin(adminPg, 'admin@boletiva.com', 'Password123');
    await adminPg.goto(`${FE}/configuracion`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="tab-invitaciones"]', { timeout: 15000 });
    await adminPg.click('[data-testid="tab-invitaciones"]');
    // v3.6: el form está oculto; el botón "Invitar" lo abre antes de escribir.
    await adminPg.waitForSelector('[data-testid="inv-toggle"]', { timeout: 8000 });
    await adminPg.click('[data-testid="inv-toggle"]');
    await adminPg.waitForSelector('[data-testid="inv-emails"]', { timeout: 8000 });
    const invitee = `e2e_inv_${Date.now()}@test.com`;
    await clearMail();
    await adminPg.type('[data-testid="inv-emails"]', invitee);
    await adminPg.click('[data-testid="inv-toggle"]'); // abierto → envía
    await adminPg.waitForSelector('[data-testid="inv-created"] input', { timeout: 10000 });
    inviteLink = await adminPg.$eval('[data-testid="inv-created"] input', (i) => i.value);
    assert(inviteLink.includes('/registro?token='), `enlace inesperado: ${inviteLink}`);
    // El correo de invitación DEBE llegar a MailHog con el enlace de registro.
    let body = null;
    for (let i = 0; i < 15 && !body; i++) {
      const r = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
      if (r && r.ok) {
        const data = await r.json();
        for (const m of data.items || []) {
          const to = (m.Content?.Headers?.To || []).join(',');
          if (to.includes(invitee)) body = String(m.Content?.Body || '').replace(/=\r?\n/g, '');
        }
      }
      if (!body) await sleep(400);
    }
    assert(body, 'no llegó el correo de invitación a MailHog');
    assert(body.includes('/registro?token='), 'el correo de invitación no trae el enlace de registro');
  });

  await step('admin: "Cuentas" abre el evento en el editor (tab cuentas, sin impersonar) y el back vuelve a la consola', async () => {
    await adminPg.click('[data-testid="tab-eventos"]');
    await adminPg.waitForSelector('[data-testid="ev-accounts"]', { timeout: 10000 });
    await adminPg.click('[data-testid="ev-accounts"]');
    // Navega al editor con ?from=admin&tab=cuentas (no expande la card, no impersona /promotor).
    // B1 (v3.13): el ADMIN REAL AHORA SÍ ve el detalle de cuentas/transacciones SIN
    // impersonar, y la sección de finalizar SIEMPRE está visible (el botón se deshabilita
    // según el estado del evento). Validamos navegación + detalle de cuentas + sección de
    // cierre con el botón coherente con el estado (deshabilitado ⇔ hay aviso).
    await adminPg.waitForSelector('[data-testid="tab-cuentas"]', { timeout: 12000 });
    assert(/\/promotor\/eventos\/.+\/editar\?/.test(adminPg.url()), `no navegó al editor: ${adminPg.url()}`);
    assert(adminPg.url().includes('from=admin'), 'falta from=admin en la URL');
    // Detalle de cuentas del evento visible para el admin real (tabla de transacciones).
    await adminPg.waitForSelector('[data-testid="tx-block"]', { timeout: 12000 });
    // Sección de cierre de caja SIEMPRE visible para el admin real.
    await adminPg.waitForSelector('[data-testid="cash-transfer"]', { timeout: 12000 });
    // El botón finalizar es coherente: si está deshabilitado, hay aviso; si está
    // habilitado (evento suspendido/cancelado/completado), no hay aviso.
    const finalizeDisabled = await adminPg.$eval('[data-testid="cash-transfer-btn"]', (b) => b.disabled);
    const lockedHint = await adminPg.$('[data-testid="cash-transfer-locked-hint"]');
    assert(
      finalizeDisabled === !!lockedHint,
      `botón finalizar (disabled=${finalizeDisabled}) incoherente con el aviso (hint=${!!lockedHint})`,
    );
    // El back-link vuelve a la CONSOLA del admin, no a /promotor.
    await adminPg.waitForSelector('[data-testid="back-link"]', { timeout: 8000 });
    await adminPg.click('[data-testid="back-link"]');
    await adminPg.waitForSelector('[data-testid="tab-eventos"]', { timeout: 10000 });
    assert(adminPg.url().endsWith('/configuracion'), `el back no volvió a la consola: ${adminPg.url()}`);
  });

  await step('admin: "Agregar pasarela" nace bloqueado; el candado abre el modal con OTP', async () => {
    await adminPg.click('[data-testid="tab-sistema"]');
    // El botón "Agregar pasarela" está deshabilitado y hay un candado al lado (v3.7).
    await adminPg.waitForSelector('[data-testid="gw-add"]', { timeout: 10000 });
    const disabled = await adminPg.$eval('[data-testid="gw-add"]', (b) => b.disabled);
    assert(disabled === true, 'el botón Agregar pasarela debería nacer deshabilitado');
    await adminPg.waitForSelector('[data-testid="gw-lock"]', { timeout: 8000 });
    await adminPg.click('[data-testid="gw-lock"]');
    // El modal explica la acción y permite enviar el código al correo.
    await adminPg.waitForSelector('[data-testid="gw-unlock-modal"]', { timeout: 10000 });
    await adminPg.click('[data-testid="gw-send-code"]');
    // Tras enviar aparece el input del código.
    await adminPg.waitForSelector('[data-testid="gw-unlock-code"]', { timeout: 10000 });
  });

  await step('abrir el enlace de invitación precarga el correo en el registro', async () => {
    const guestCtx = await browser.createBrowserContext();
    const guest = await guestCtx.newPage();
    // El enlace trae el host interno del backend; se usa la ruta contra el FE.
    const path = inviteLink.slice(inviteLink.indexOf('/registro'));
    await guest.goto(`${FE}${path}`, { waitUntil: 'networkidle0' });
    await guest.waitForSelector('[data-testid="invited-note"]', { timeout: 12000 });
    const email = await guest.$eval('[data-testid="rg-email"]', (i) => i.value);
    assert(email.includes('e2e_inv_'), `correo no precargado: ${email}`);
    const ro = await guest.$eval('[data-testid="rg-email"]', (i) => i.readOnly);
    assert(ro === true, 'el correo de la invitación debería estar bloqueado');
    await guestCtx.close();
  });

  await step('v3.9 admin: Salones/Plantillas son TABS con la lista embebida (sin "Gestionar")', async () => {
    await adminPg.goto(`${FE}/configuracion`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="tab-salones"]', { timeout: 12000 });
    assert((await adminPg.$('[data-testid="tab-plantillas"]')) !== null, 'falta la tab Plantillas');
    // Ya NO hay tab Configuraciones separada (se integró en Sistema).
    assert((await adminPg.$('[data-testid="tab-ajustes"]')) === null, 'la tab Configuraciones ya no debería existir');
    await adminPg.click('[data-testid="tab-salones"]');
    // v3.9: la lista vive DENTRO del tab (no una tarjeta "Gestionar" a página aparte).
    await adminPg.waitForSelector('[data-testid="halls-list"]', { timeout: 8000 });
    assert((await adminPg.$('[data-testid="halls-manage"]')) === null, 'ya no debería existir el botón Gestionar');
  });

  await step('v3.9 admin: tab Salones (crear borrador → publicar)', async () => {
    await adminPg.goto(`${FE}/configuracion?tab=salones`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="hall-new"]', { timeout: 10000 });
    await adminPg.waitForSelector('[data-testid="hall-status-filter"]', { timeout: 8000 });
    await adminPg.click('[data-testid="hall-new"]');
    await adminPg.waitForSelector('[data-testid="hall-form"]', { timeout: 8000 });
    await adminPg.type('[data-testid="hall-name"]', `Salón E2E ${Date.now()}`);
    await adminPg.click('[data-testid="hall-save-draft"]');
    await adminPg.waitForSelector('[data-testid="hall-card"]', { timeout: 10000 });
    // El borrador ofrece el botón Publicar.
    assert((await adminPg.$('[data-testid="hall-publish"]')) !== null, 'falta el botón Publicar del salón borrador');
  });

  await step('v3.9 admin: tab Plantillas (filtros + botones por estado)', async () => {
    await adminPg.goto(`${FE}/configuracion?tab=plantillas`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="tpl-list"]', { timeout: 12000 });
    await adminPg.waitForSelector('[data-testid="tpl-status-filter"]', { timeout: 8000 });
    // Las built-in (publicadas) ofrecen "Ver" y NO se pueden eliminar (sin botón de borrado habilitado).
    assert((await adminPg.$('[data-testid="tpl-view"]')) !== null, 'una plantilla publicada debería tener botón Ver');
    await adminPg.click('[data-testid="tpl-view"]');
    await adminPg.waitForSelector('[data-testid="tpl-preview-modal"]', { timeout: 8000 });
    await adminPg.click('[data-testid="tpl-preview-close"]');
  });

  await step('v3.7 admin: configuraciones (settings) bajo Sistema, editables', async () => {
    await adminPg.goto(`${FE}/configuracion?tab=sistema`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="settings-list"]', { timeout: 15000 });
    const rows = (await adminPg.$$('[data-testid="setting-row"]')).length;
    assert(rows >= 10, `se esperaban ≥10 configuraciones, hay ${rows}`);
  });

  await step('v3.5 admin: filtro de eventos por promotor', async () => {
    await adminPg.click('[data-testid="tab-eventos"]');
    await adminPg.waitForSelector('[data-testid="event-promoter-filter"]', { timeout: 10000 });
    // El grid de eventos se carga async (muchos eventos): espera a que el <select>
    // tenga las opciones ("Todos" + ≥1 promotor) antes de contar.
    await adminPg.waitForFunction(
      () => (document.querySelectorAll('[data-testid="event-promoter-filter"] option') || []).length >= 2,
      { timeout: 12000 },
    );
    const opts = await adminPg.$$eval('[data-testid="event-promoter-filter"] option', (o) => o.length);
    assert(opts >= 2, 'el filtro de promotor debería tener al menos "Todos" + un promotor');
  });

  await step('v3.5 admin: editar un evento desde la consola arranca BLOQUEADO (desbloqueo)', async () => {
    await adminPg.click('[data-testid="tab-eventos"]');
    await adminPg.waitForSelector('[data-testid="ev-open-btn"]', { timeout: 10000 });
    await adminPg.click('[data-testid="ev-open-btn"]');
    await adminPg.waitForSelector('[data-testid="lock-banner"]', { timeout: 12000 });
    assert((await adminPg.$('[data-testid="unlock-btn"]')) !== null, 'falta el botón Desbloquear');
    // v3.7: bloqueado → el botón Guardar de la cabecera está DESHABILITADO.
    const saveDisabled = await adminPg.$eval('[data-testid="save-draft-btn"]', (b) => b.disabled);
    assert(saveDisabled === true, 'Guardar debería estar deshabilitado hasta desbloquear');
    assert((await adminPg.$('[data-testid="lock-banner"]')) !== null, 'debería seguir bloqueado');
  });

  await step('v3.5 invitación a cuenta existente: el link ofrece iniciar sesión para activar', async () => {
    // Invita al correo del cliente (ya existe) y abre el link como invitado.
    await adminPg.goto(`${FE}/configuracion`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="tab-invitaciones"]', { timeout: 12000 });
    await adminPg.click('[data-testid="tab-invitaciones"]');
    // v3.6: abre el form oculto con el botón "Invitar".
    await adminPg.waitForSelector('[data-testid="inv-toggle"]', { timeout: 8000 });
    await adminPg.click('[data-testid="inv-toggle"]');
    await adminPg.waitForSelector('[data-testid="inv-emails"]', { timeout: 8000 });
    await adminPg.type('[data-testid="inv-emails"]', 'cliente@pasaeventos.com');
    await adminPg.click('[data-testid="inv-toggle"]'); // abierto → envía
    await adminPg.waitForSelector('[data-testid="inv-created"] input', { timeout: 10000 });
    const link = await adminPg.$eval('[data-testid="inv-created"] input', (i) => i.value);
    const guestCtx = await browser.createBrowserContext();
    const guest = await guestCtx.newPage();
    await guest.goto(`${FE}${link.slice(link.indexOf('/registro'))}`, { waitUntil: 'networkidle0' });
    // Cuenta existente sin sesión → CTA de iniciar sesión (no el form de registro).
    await guest.waitForSelector('[data-testid="activate-login"]', { timeout: 12000 });
    assert((await guest.$('[data-testid="rg-submit"]')) === null, 'no debería mostrar el form de registro');
    await guestCtx.close();
  });

  await adminCtx.close();
  await browser.close();

  console.log(`\n=== E2E: ${pass} pasaron, ${fail} fallaron ===`);
  if (fail > 0) {
    console.log(failures.map((f) => ` - ${f}`).join('\n'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('E2E abortado:', err);
  process.exit(1);
});
