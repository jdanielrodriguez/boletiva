import puppeteer from 'puppeteer-core';

const FE = 'http://pasaeventos_frontend:4200';
const MAIL = 'http://pasaeventos_mailhog:8025';
const PROMO = { email: 'promotor@pasaeventos.com', password: 'Password123' };
const OUT = '/app/qa-out';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const consoleLogs = [];
const pageErrors = [];
const failedReqs = [];

async function clearMail() {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
}
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
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (r) => failedReqs.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`HTTP ${r.status()} ${r.url()}`); });

  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log('shot', name); };

  // Login
  console.log('== LOGIN ==');
  await clearMail();
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email', { timeout: 15000 });
  await page.type('#email', PROMO.email);
  await page.type('#password', PROMO.password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#code, [data-testid="session-greeting"]', { timeout: 15000 });
  if (await page.$('#code')) {
    const otp = await otpFromMail();
    await page.type('#code', otp);
    await page.click('button[type="submit"]');
  }
  await page.waitForSelector('[data-testid="session-greeting"]', { timeout: 15000 });
  console.log('login OK');
  await shot('01-home-logged');

  // Header dropdown
  console.log('== HEADER DROPDOWN ==');
  // try clicking the session greeting / user menu
  const greetingText = await page.$eval('[data-testid="session-greeting"]', (e) => e.textContent?.trim()).catch(() => '');
  console.log('greeting:', greetingText);
  // Look for a dropdown toggle in header
  const headerHtml = await page.$eval('header, .header, nav', (e) => e.outerHTML).catch(() => 'NO HEADER');
  console.log('HEADER HTML:\n', headerHtml.slice(0, 3000));
  // Try to open dropdown by clicking greeting
  try {
    await page.click('[data-testid="session-greeting"]');
    await sleep(600);
    await shot('02-header-dropdown');
  } catch (e) { console.log('no dropdown on greeting click', e.message); }
  // Dump any dropdown menu links
  const menuLinks = await page.$$eval('a, button', (els) =>
    els.map((e) => ({ t: e.textContent?.trim(), href: e.getAttribute('href') })).filter((x) => x.t)
  );
  console.log('MENU/LINKS after dropdown:', JSON.stringify(menuLinks.filter(l => l.t && l.t.length < 40), null, 1).slice(0, 2000));

  await browser.close();
  dump();
}

function dump() {
  console.log('\n=== CONSOLE LOGS ===');
  console.log(consoleLogs.join('\n') || '(none)');
  console.log('\n=== PAGE ERRORS ===');
  console.log(pageErrors.join('\n') || '(none)');
  console.log('\n=== FAILED/4xx REQUESTS ===');
  console.log([...new Set(failedReqs)].join('\n') || '(none)');
}

main().catch((e) => { console.error('ABORT', e); dump(); process.exit(1); });
