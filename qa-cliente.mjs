import puppeteer from 'puppeteer-core';

const FE = 'http://pasaeventos_frontend:4200';
const MAIL = 'http://pasaeventos_mailhog:8025';
const BUYER = { email: 'cliente@pasaeventos.com', password: 'Password123' };
const OUT = '/tmp/qa-shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });

const consoleLogs = [];
const pageErrors = [];

async function clearMail() { await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {}); }
async function otpFromMail() {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      for (const m of (data.items || [])) {
        const body = (m.Content && m.Content.Body) || '';
        const decoded = body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
        const match = decoded.match(/\b(\d{6})\b/);
        if (match) return match[1];
      }
    }
    await sleep(500);
  }
  throw new Error('no OTP');
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch((e)=>console.log('shot err',name,e.message));
  console.log('  📸', name);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  page.on('console', (m) => { if (['error','warning'].includes(m.type())) consoleLogs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // 1. Catálogo / inicio
  console.log('\n▶ Catálogo/inicio');
  await page.goto(`${FE}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.event-card', { timeout: 20000 }).catch(()=>{});
  await sleep(1500);
  await shot(page, '01-catalogo');
  const cardCount = await page.$$eval('.event-card', els => els.length).catch(()=>0);
  const hasHero = await page.$('.hero') !== null;
  console.log('  cards:', cardCount, 'hero:', hasHero);

  // 2. Detalle
  console.log('\n▶ Detalle evento');
  await page.goto(`${FE}/eventos/evento-demo-pasaeventos`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1', { timeout: 15000 }).catch(()=>{});
  await sleep(1000);
  await shot(page, '02-detalle');

  // 3. Login con 2FA
  console.log('\n▶ Login 2FA');
  await clearMail();
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email', { timeout: 15000 });
  await page.type('#email', BUYER.email);
  await page.type('#password', BUYER.password);
  await shot(page, '03-login');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#code, [data-testid="session-greeting"]', { timeout: 20000 });
  if (await page.$('#code')) {
    const otp = await otpFromMail();
    await shot(page, '04-2fa');
    await page.type('#code', otp);
    await page.click('button[type="submit"]');
  }
  await page.waitForSelector('[data-testid="session-greeting"]', { timeout: 20000 });
  console.log('  login OK');

  // 4. Flujo de compra
  console.log('\n▶ Compra');
  await page.goto(`${FE}/eventos/evento-demo-pasaeventos/comprar`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="loc-quantity"]', { timeout: 15000 }).catch(()=>{});
  await sleep(800);
  await shot(page, '05-comprar-seleccion');
  // stepper
  const plus = await page.$('[data-testid="qty-plus"]');
  if (plus) {
    await page.click('[data-testid="qty-plus"]');
    await sleep(400);
    await page.click('[data-testid="qty-plus"]');
    await sleep(400);
    await shot(page, '06-comprar-stepper');
    await page.click('[data-testid="reserve-btn"]');
    await page.waitForSelector('[data-testid="countdown"]', { timeout: 15000 }).catch(()=>{});
    await sleep(800);
    await shot(page, '07-comprar-reserva-countdown');
    // checkout
    const payBtn = await page.$('[data-testid="pay-btn"]');
    if (payBtn) {
      await page.click('[data-testid="pay-btn"]');
      await page.waitForFunction(() => location.pathname.startsWith('/checkout/'), { timeout: 15000 }).catch(()=>{});
      await page.waitForSelector('[data-testid="breakdown"]', { timeout: 12000 }).catch(()=>{});
      await sleep(1000);
      await shot(page, '08-checkout');
      const sf = await page.$eval('[data-testid="service-fee"]', e=>e.textContent).catch(()=>'(none)');
      const tot = await page.$eval('[data-testid="total"]', e=>e.textContent).catch(()=>'(none)');
      console.log('  serviceFee:', sf, 'total:', tot);
      // pagar
      const confirm = await page.$('[data-testid="pay-confirm"]');
      if (confirm) {
        await page.click('[data-testid="pay-confirm"]');
        await page.waitForSelector('[data-testid="status-paid"]', { timeout: 25000 }).catch(()=>{});
        await sleep(800);
        await shot(page, '09-checkout-pagado');
      }
    }
  } else {
    console.log('  NO stepper found');
  }

  // 5. /cuenta - Perfil
  console.log('\n▶ /cuenta Perfil');
  await page.goto(`${FE}/cuenta`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu', { timeout: 25000 }).catch(()=>{});
  await sleep(1000);
  await shot(page, '10-cuenta-perfil');

  // cambiar contraseña (busca la sección)
  const menuItems = await page.$$eval('.account-menu button', els => els.map(e=>e.textContent.trim())).catch(()=>[]);
  console.log('  menú cuenta:', JSON.stringify(menuItems));

  // 6. Métodos de pago
  console.log('\n▶ Métodos de pago');
  await page.goto(`${FE}/cuenta?s=metodos`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu', { timeout: 20000 }).catch(()=>{});
  await sleep(1000);
  await shot(page, '11-metodos');

  // 7. Facturación
  console.log('\n▶ Facturación');
  await page.goto(`${FE}/cuenta?s=facturacion`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu', { timeout: 20000 }).catch(()=>{});
  await page.waitForSelector('[data-testid="orders-list"]', { timeout: 10000 }).catch(()=>{});
  await sleep(1000);
  await shot(page, '12-facturacion');

  // detalle transacción: click primera orden
  const ordersList = await page.$('[data-testid="orders-list"]');
  if (ordersList) {
    // buscar link a transaccion
    const txLink = await page.$('[data-testid="orders-list"] a');
    if (txLink) {
      await txLink.click();
      await page.waitForFunction(() => location.pathname.includes('/cuenta/transaccion/'), { timeout: 10000 }).catch(()=>{});
      await sleep(1200);
      await shot(page, '13-transaccion-detalle');
      // toggle blockchain
      const toggle = await page.$('[data-testid="toggle-chain"]');
      if (toggle) {
        await page.click('[data-testid="toggle-chain"]');
        await page.waitForSelector('[data-testid="ledger-chain"]', { timeout: 8000 }).catch(()=>{});
        await sleep(800);
        await shot(page, '14-transaccion-blockchain');
        const chain = await page.$eval('[data-testid="ledger-chain"]', e=>e.textContent).catch(()=>'(none)');
        console.log('  chain snippet:', (chain||'').slice(0,120));
      } else { console.log('  NO toggle-chain en detalle'); }
    } else { console.log('  NO link a transaccion en orders-list'); }
  }

  // 8. Wallet
  console.log('\n▶ Wallet');
  await page.goto(`${FE}/cuenta?s=wallet`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu', { timeout: 20000 }).catch(()=>{});
  await page.waitForSelector('[data-testid="wallet-balance"]', { timeout: 10000 }).catch(()=>{});
  await sleep(1000);
  await shot(page, '15-wallet');
  const bal = await page.$eval('[data-testid="wallet-balance"]', e=>e.textContent).catch(()=>'(none)');
  console.log('  saldo:', bal);

  // 9. Boletos
  console.log('\n▶ Boletos');
  await page.goto(`${FE}/cuenta?s=activos`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu', { timeout: 20000 }).catch(()=>{});
  await sleep(2500);
  await shot(page, '16-boletos');
  const posterQr = await page.$('.poster-qr img');
  const qrSrc = posterQr ? await page.evaluate(el=>el.getAttribute('src'), posterQr) : null;
  console.log('  QR src:', qrSrc ? qrSrc.slice(0,80) : '(none)');
  const shareBtn = await page.$('[data-testid="ticket-share"], .poster button');
  console.log('  hay boton compartir/poster:', shareBtn!==null);

  // 10. Cambiar contraseña
  console.log('\n▶ Cambiar contraseña');
  await page.goto(`${FE}/cuenta`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.account-menu', { timeout: 20000 }).catch(()=>{});
  await sleep(600);
  // buscar boton de cambiar contraseña
  const pwToggle = await page.$('[data-testid="toggle-password"], [data-testid="change-password"]');
  if (pwToggle) { await pwToggle.click(); await sleep(600); }
  await shot(page, '17-cambiar-password');

  // 11. Sincronización menú lateral vs dropdown header
  console.log('\n▶ Sync menú/dropdown');
  const ddGo = async (testid) => {
    await page.click('[data-testid="user-menu-trigger"]');
    await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 6000 });
    await page.click(`[data-testid="${testid}"]`);
  };
  try {
    await ddGo('dd-wallet');
    await page.waitForSelector('[data-testid="wallet-balance"]', { timeout: 8000 });
    await shot(page, '18-sync-a-wallet');
    // lateral -> perfil
    await page.$$eval('.account-menu button', b => b[0].click());
    await page.waitForSelector('[data-testid="save-profile"]', { timeout: 8000 });
    await shot(page, '19-sync-lateral-perfil');
    // dropdown -> wallet otra vez
    await ddGo('dd-wallet');
    await page.waitForSelector('[data-testid="wallet-balance"]', { timeout: 8000 });
    const stuck = await page.$('[data-testid="save-profile"]') !== null;
    console.log('  desync (atascado en perfil):', stuck);
    await shot(page, '20-sync-vuelta-wallet');
  } catch (e) { console.log('  sync ERR:', e.message); }

  // dropdown header screenshot
  await page.goto(`${FE}/`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="session-greeting"]', { timeout: 15000 }).catch(()=>{});
  await page.click('[data-testid="user-menu-trigger"]').catch(()=>{});
  await sleep(600);
  await shot(page, '21-dropdown-header');

  await browser.close();
  console.log('\n=== CONSOLE ERRORS/WARN ===');
  console.log(consoleLogs.length ? [...new Set(consoleLogs)].join('\n') : '(ninguno)');
  console.log('\n=== PAGE ERRORS ===');
  console.log(pageErrors.length ? [...new Set(pageErrors)].join('\n') : '(ninguno)');
}
main().catch(e => { console.error('ABORT:', e); process.exit(1); });
