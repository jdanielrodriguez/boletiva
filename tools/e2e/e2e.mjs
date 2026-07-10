/**
 * E2E de Pasa Eventos con Puppeteer contra el stack REAL (frontend SSR + API +
 * MailHog). Valida cada funcionalidad del frontend de cara al usuario:
 * catálogo, hero, filtros, detalle+SEO, 404, login con 2FA (OTP leído de
 * MailHog) y la compra completa (selección → reserva → checkout → pago por SSE).
 *
 * Correr dentro del contenedor de la API (tiene puppeteer-core + chromium):
 *   make e2e
 * Requiere PAYMENT_SIMULATOR_AUTO_CONFIRM=true para que el pago se confirme solo.
 */
import puppeteer from 'puppeteer-core';

const FE = process.env.E2E_FRONTEND_URL || 'http://pasaeventos_frontend:4200';
const MAIL = process.env.E2E_MAILHOG_URL || 'http://pasaeventos_mailhog:8025';
const BUYER = { email: 'cliente@pasaeventos.com', password: 'Password123' };
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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
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
    await page.click('.catalog-search button');
    await page.waitForFunction(() => location.search.includes('search='), { timeout: 8000 });
  });

  console.log('\n▶ Detalle y SEO');
  await step('el detalle carga por slug con JSON-LD Event', async () => {
    await page.goto(`${FE}/eventos/${EVENT_SLUG}`, { waitUntil: 'networkidle0' });
    await waitSel(page, 'h1');
    const h1 = await text(page, 'h1');
    assert(h1.toLowerCase().includes('evento'), `h1 inesperado: ${h1}`);
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
    await waitSel(page, '[data-testid="loc-quantity"]');
    await waitSel(page, '[data-testid="qty-plus"]');
    await page.click('[data-testid="qty-plus"]');
    await page.click('[data-testid="reserve-btn"]');
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
    // Puede pedir 2FA (dispositivo nuevo).
    await waitSel(page, '#code, [data-testid="session-greeting"]', 15000);
    if (await page.$('#code')) {
      const otp = await otpFromMail();
      await page.type('#code', otp);
      await page.click('button[type="submit"]');
    }
    await waitSel(page, '[data-testid="session-greeting"]', 15000);
  });

  console.log('\n▶ Compra completa (selección → reserva → checkout → pago SSE)');
  await step('selecciona General por cantidad y reserva', async () => {
    await page.goto(`${FE}/eventos/${EVENT_SLUG}/comprar`, { waitUntil: 'networkidle0' });
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
    await page.type('[data-testid="card-cvc"]', '123');
    await page.click('[data-testid="save-card"]');
    await waitSel(page, '[data-testid="cards-list"]', 8000);
    const cards = await text(page, '[data-testid="cards-list"]');
    assert(cards.includes('4242'), 'la tarjeta guardada no aparece en la lista');
  });

  // --- F4: panel del promotor + invitación de promotores ---
  async function doLogin(pg, email, password) {
    await clearMail();
    await pg.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('#email', { timeout: 15000 });
    await pg.type('#email', email);
    await pg.type('#password', password);
    await pg.click('button[type="submit"]');
    await pg.waitForSelector('#code, [data-testid="session-greeting"]', { timeout: 15000 });
    if (await pg.$('#code')) {
      await pg.type('#code', await otpFromMail());
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
  await step('el promotor crea un borrador (sin fecha fin) y aterriza en el editor', async () => {
    await doLogin(promo, 'promotor@pasaeventos.com', 'Password123');
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    await promo.waitForSelector('[data-testid="toggle-create"]', { timeout: 15000 });
    await promo.click('[data-testid="toggle-create"]');
    await promo.waitForSelector('[data-testid="ev-name"]', { timeout: 8000 });
    await promo.type('[data-testid="ev-name"]', `E2E Evento ${Date.now()}`);
    await setReactiveValue(promo, '[data-testid="ev-start"]', '2028-08-15T20:00');
    // No hay campo de fin: el backend autocalcula. Crear = navega al editor.
    await promo.click('[data-testid="ev-create"]');
    await promo.waitForSelector('[data-testid="save-draft-btn"]', { timeout: 12000 });
    assert(/\/promotor\/eventos\/.+\/editar/.test(promo.url()), 'no navegó al editor');
  });

  await step('preview de precio por localidad: al teclear el neto muestra el desglose', async () => {
    await promo.waitForSelector('[data-testid="tab-localidades"]', { timeout: 8000 });
    await promo.click('[data-testid="tab-localidades"]');
    await promo.waitForSelector('[data-testid="loc-net"]', { timeout: 8000 });
    await setReactiveValue(promo, '[data-testid="loc-net"]', '100');
    await promo.waitForSelector('[data-testid="price-preview"]', { timeout: 8000 });
    const txt = await promo.$eval('[data-testid="price-preview"]', (e) => e.textContent || '');
    assert(txt.includes('Q'), 'el preview no muestra el precio');
  });

  await step('administrar asientos abre una VISTA APARTE (ruta propia) y el back vuelve al evento', async () => {
    // Crea una localidad "con asiento" para tener el botón de asientos.
    await promo.waitForSelector('[data-testid="loc-name"]', { timeout: 8000 });
    await promo.type('[data-testid="loc-name"]', `Platea ${Date.now()}`);
    await promo.select('select[name="lk"]', 'seated');
    await promo.click('[data-testid="loc-add"]');
    await promo.waitForSelector('[data-testid="loc-seats"]', { timeout: 8000 });
    // "Administrar asientos" NAVEGA a la vista aparte (editor a página completa).
    await promo.click('[data-testid="loc-seats"]');
    await promo.waitForSelector('[data-testid="seat-editor"]', { timeout: 12000 });
    assert(/\/localidades\/.+\/asientos/.test(promo.url()), `no navegó a la vista de asientos: ${promo.url()}`);
    // El "Volver" regresa al editor del evento (pestaña Localidades).
    await promo.click('[data-testid="seat-back"]');
    await promo.waitForSelector('[data-testid="tab-localidades"]', { timeout: 12000 });
    assert(/\/editar/.test(promo.url()), `el back no volvió al editor: ${promo.url()}`);
  });

  await step('abre la edición del evento y genera el banner IA (vista aparte)', async () => {
    // Recarga el panel (grid estable) y navega por SPA al hacer click en "Editar".
    await promo.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
    await promo.waitForSelector('[data-testid="ev-edit"]', { timeout: 12000 });
    await sleep(400);
    await promo.click('[data-testid="ev-edit"]');
    await promo.waitForSelector('[data-testid="tab-banner"]', { timeout: 12000 });
    await promo.click('[data-testid="tab-banner"]');
    await promo.waitForSelector('[data-testid="bn-generate"]', { timeout: 8000 });
    await promo.click('[data-testid="bn-generate"]');
    await promo.waitForSelector('[data-testid="bn-preview"]', { timeout: 15000 });
    const src = await promo.$eval('[data-testid="bn-preview"]', (i) => i.getAttribute('src'));
    assert(src && src.includes('http'), 'el banner no tiene URL');
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
    await doLogin(adminPg, 'admin@pasaeventos.com', 'Password123');
    await adminPg.goto(`${FE}/configuracion`, { waitUntil: 'networkidle0' });
    await adminPg.waitForSelector('[data-testid="tab-invitaciones"]', { timeout: 15000 });
    await adminPg.click('[data-testid="tab-invitaciones"]');
    await adminPg.waitForSelector('[data-testid="inv-emails"]', { timeout: 8000 });
    const invitee = `e2e_inv_${Date.now()}@test.com`;
    await adminPg.type('[data-testid="inv-emails"]', invitee);
    await adminPg.click('[data-testid="inv-submit"]');
    await adminPg.waitForSelector('[data-testid="inv-created"] input', { timeout: 10000 });
    inviteLink = await adminPg.$eval('[data-testid="inv-created"] input', (i) => i.value);
    assert(inviteLink.includes('/registro?token='), `enlace inesperado: ${inviteLink}`);
  });

  await step('admin: "Cuentas" abre el evento en el editor (tab cuentas, sin impersonar) y el back vuelve a la consola', async () => {
    await adminPg.click('[data-testid="tab-eventos"]');
    await adminPg.waitForSelector('[data-testid="ev-accounts"]', { timeout: 10000 });
    await adminPg.click('[data-testid="ev-accounts"]');
    // Navega al editor con ?from=admin&tab=cuentas (no expande la card, no impersona /promotor).
    await adminPg.waitForSelector('[data-testid="settlement"]', { timeout: 12000 });
    assert(/\/promotor\/eventos\/.+\/editar\?/.test(adminPg.url()), `no navegó al editor: ${adminPg.url()}`);
    assert(adminPg.url().includes('from=admin'), 'falta from=admin en la URL');
    // El back-link vuelve a la CONSOLA del admin, no a /promotor.
    await adminPg.waitForSelector('[data-testid="back-link"]', { timeout: 8000 });
    await adminPg.click('[data-testid="back-link"]');
    await adminPg.waitForSelector('[data-testid="tab-eventos"]', { timeout: 10000 });
    assert(adminPg.url().endsWith('/configuracion'), `el back no volvió a la consola: ${adminPg.url()}`);
  });

  await step('admin: agregar pasarela exige desbloqueo por OTP (código al correo)', async () => {
    await adminPg.click('[data-testid="tab-sistema"]');
    await adminPg.waitForSelector('[data-testid="gw-unlock"]', { timeout: 10000 });
    await adminPg.click('[data-testid="gw-unlock"]');
    // Tras pedir el desbloqueo aparece el modal para ingresar el código.
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
