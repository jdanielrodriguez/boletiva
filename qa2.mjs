import puppeteer from 'puppeteer-core';

const FE = 'http://pasaeventos_frontend:4200';
const MAIL = 'http://pasaeventos_mailhog:8025';
const PROMO = { email: 'promotor@pasaeventos.com', password: 'Password123' };
const OUT = '/app/qa-out';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleLogs = [];
const pageErrors = [];
const failedReqs = [];

async function clearMail() { await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {}); }
async function otpFromMail() {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      for (const m of data.items || []) {
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

async function main() {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser', headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`HTTP ${r.status()} ${r.url()}`); });
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log('shot', name); };

  // login
  await clearMail();
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email', { timeout: 15000 });
  await page.type('#email', PROMO.email);
  await page.type('#password', PROMO.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#code, [data-testid="session-greeting"]', { timeout: 15000 });
  if (await page.$('#code')) { await page.type('#code', await otpFromMail()); await page.click('button[type="submit"]'); }
  await page.waitForSelector('[data-testid="session-greeting"]', { timeout: 15000 });
  console.log('login OK');

  // ===== /promotor =====
  console.log('\n===== /promotor =====');
  await page.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  await shot('10-promotor');
  console.log('URL:', page.url());
  // tabs
  const tabs = await page.$$eval('[data-testid^="tab-"]', (els) => els.map((e) => ({ id: e.getAttribute('data-testid'), t: e.textContent?.trim() }))).catch(() => []);
  console.log('TABS:', JSON.stringify(tabs));
  // dump main panel html (trimmed)
  const panelHtml = await page.$eval('main, .promoter, .panel, .container', (e) => e.outerHTML).catch(() => 'NO PANEL');
  console.log('PANEL HTML (5000):\n', panelHtml.slice(0, 5000));

  // events list structure
  const eventsList = await page.$('[data-testid="events-list"]');
  console.log('events-list present:', !!eventsList);
  if (eventsList) {
    const listHtml = await page.$eval('[data-testid="events-list"]', (e) => e.outerHTML);
    console.log('EVENTS-LIST HTML (4000):\n', listHtml.slice(0, 4000));
    // count event rows/cards and buttons per event
    const evBtns = await page.$$eval('[data-testid="events-list"] button, [data-testid="events-list"] a', (els) => els.map((e) => e.textContent?.trim() || e.getAttribute('data-testid')).filter(Boolean));
    console.log('EVENT ACTIONS:', JSON.stringify(evBtns.slice(0, 40)));
  }

  // Check each tab
  for (const tab of tabs) {
    try {
      await page.click(`[data-testid="${tab.id}"]`);
      await sleep(1000);
      await shot(`11-tab-${tab.id}`);
      console.log(`\n-- TAB ${tab.id} content --`);
      const c = await page.$eval('main, .promoter, .panel', (e) => e.innerText).catch(() => '');
      console.log(c.slice(0, 1500));
    } catch (e) { console.log('tab err', tab.id, e.message); }
  }

  // Try create event form
  console.log('\n-- CREAR EVENTO --');
  await page.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
  await sleep(1000);
  const createBtn = await page.$('[data-testid="ev-create"], [data-testid="create-event"], [data-testid="new-event"]');
  const createBtns = await page.$$eval('button, a', (els) => els.map((e) => ({ t: e.textContent?.trim(), d: e.getAttribute('data-testid') })).filter((x) => x.t && /crear|nuevo|new/i.test(x.t)));
  console.log('CREATE-like buttons:', JSON.stringify(createBtns));

  // ===== /configuracion =====
  console.log('\n===== /configuracion =====');
  await page.goto(`${FE}/configuracion`, { waitUntil: 'networkidle0' });
  await sleep(1500);
  await shot('20-configuracion');
  console.log('URL:', page.url());
  const cfgHtml = await page.$eval('main, .config, .panel, .container', (e) => e.outerHTML).catch(() => 'NO CFG');
  console.log('CONFIG HTML (4000):\n', cfgHtml.slice(0, 4000));
  const cfgTabs = await page.$$eval('[data-testid^="tab-"], .tabs a, .tabs button, nav a', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
  console.log('CFG NAV:', JSON.stringify(cfgTabs));

  await browser.close();
  dump();
}
function dump() {
  console.log('\n=== PAGE ERRORS ==='); console.log(pageErrors.join('\n') || '(none)');
  console.log('\n=== FAILED/4xx REQUESTS ==='); console.log([...new Set(failedReqs)].join('\n') || '(none)');
  console.log('\n=== CONSOLE errors/warns ==='); console.log(consoleLogs.filter(l => /error|warn/i.test(l)).join('\n') || '(none)');
}
main().catch((e) => { console.error('ABORT', e); dump(); process.exit(1); });
