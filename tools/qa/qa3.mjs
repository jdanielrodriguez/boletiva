import puppeteer from 'puppeteer-core';
const FE = 'http://pasaeventos_frontend:4200';
const MAIL = 'http://pasaeventos_mailhog:8025';
const OUT = '/app/qa-out';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clearMail() { await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {}); }
async function otpFromMail() {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
    if (res && res.ok) { const d = await res.json();
      for (const m of d.items || []) { const b = (m.Content && m.Content.Body) || ''; const dd = b.replace(/=\r?\n/g,'').replace(/=3D/g,'='); const mm = dd.match(/\b(\d{6})\b/); if (mm) return mm[1]; } }
    await sleep(500);
  } throw new Error('no OTP');
}
const errs = [];
async function main() {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium-browser', headless: 'new', args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });
  page.on('pageerror', (e) => errs.push('PAGEERR '+e.message));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  await clearMail();
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#email'); await page.type('#email','promotor@pasaeventos.com'); await page.type('#password','Password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#code, [data-testid="session-greeting"]', { timeout: 15000 });
  if (await page.$('#code')) { await page.type('#code', await otpFromMail()); await page.click('button[type="submit"]'); }
  await page.waitForSelector('[data-testid="session-greeting"]', { timeout: 15000 });
  console.log('login OK');

  await page.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' });
  await sleep(1200);
  // viewport-only shot of top
  await page.screenshot({ path: `${OUT}/30-promotor-top.png` });
  console.log('shot top');

  // Localidades
  console.log('== LOCALIDADES ==');
  const locBtn = await page.$('[data-testid="ev-localities"]');
  if (locBtn) {
    await locBtn.click();
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/31-localidades.png` });
    const locHtml = await page.evaluate(() => {
      const el = document.querySelector('.pe-localities, [data-testid="localities"], .localities, .panel-localities');
      return el ? el.outerHTML : (document.querySelector('.panel-event')?.outerHTML || 'no loc panel');
    });
    console.log('LOC HTML (3500):\n', locHtml.slice(0, 3500));
  } else console.log('no localities btn');

  // Banner
  console.log('== BANNER ==');
  await page.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' }); await sleep(1000);
  const bBtn = await page.$('[data-testid="ev-banner"]');
  if (bBtn) {
    await bBtn.click();
    await page.waitForSelector('.pe-banner', { timeout: 15000 }).catch(()=>console.log('no .pe-banner appeared'));
    await sleep(1500);
    await page.screenshot({ path: `${OUT}/32-banner.png` });
    const src = await page.$eval('.pe-banner', (i) => i.getAttribute('src')).catch(()=>null);
    console.log('banner src:', src ? src.slice(0,120) : 'none');
  }

  // Create event
  console.log('== CREAR EVENTO ==');
  await page.goto(`${FE}/promotor`, { waitUntil: 'networkidle0' }); await sleep(800);
  await page.type('[data-testid="ev-name"]', 'QA Prueba Promotor');
  await page.type('[data-testid="ev-start"]', '2027-12-01T20:00');
  await page.type('[data-testid="ev-end"]', '2027-12-01T23:00');
  await page.screenshot({ path: `${OUT}/33-create-filled.png` });
  await page.click('[data-testid="ev-create"]');
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/34-after-create.png` });
  console.log('created, errs after create:', errs.slice(-3));

  await browser.close();
  console.log('\n=== ERRORS ==='); console.log([...new Set(errs)].join('\n')||'(none)');
}
main().catch((e)=>{console.error('ABORT',e); console.log(errs.join('\n')); process.exit(1);});
