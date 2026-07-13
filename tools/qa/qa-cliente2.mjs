import puppeteer from 'puppeteer-core';
const FE = 'http://pasaeventos_frontend:4200';
const MAIL = 'http://pasaeventos_mailhog:8025';
const BUYER = { email: 'cliente@pasaeventos.com', password: 'Password123' };
const OUT = '/tmp/qa-shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clearMail() { await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' }).catch(() => {}); }
async function otpFromMail() {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAIL}/api/v2/messages`).catch(() => null);
    if (res && res.ok) { const data = await res.json();
      for (const m of (data.items || [])) { const body=(m.Content&&m.Content.Body)||''; const d=body.replace(/=\r?\n/g,'').replace(/=3D/g,'='); const mm=d.match(/\b(\d{6})\b/); if(mm)return mm[1]; } }
    await sleep(500);
  } throw new Error('no OTP');
}
async function shot(page,name){await page.screenshot({path:`${OUT}/${name}.png`}).catch(()=>{});console.log('  📸',name);}

const browser = await puppeteer.launch({executablePath:'/usr/bin/chromium-browser',headless:'new',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const page = await browser.newPage();
await page.setViewport({width:1366,height:900});
const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); page.on('pageerror',e=>errs.push('PAGEERR '+e));

// login
await clearMail();
await page.goto(`${FE}/login`,{waitUntil:'networkidle0'});
await page.waitForSelector('#email',{timeout:15000});
await page.type('#email',BUYER.email); await page.type('#password',BUYER.password);
await page.click('button[type="submit"]');
await page.waitForSelector('#code, [data-testid="session-greeting"]',{timeout:20000});
if(await page.$('#code')){const o=await otpFromMail();await page.type('#code',o);await page.click('button[type="submit"]');}
await page.waitForSelector('[data-testid="session-greeting"]',{timeout:20000});
console.log('login OK');

// FACTURACION top viewport + filtros + link a detalle
await page.goto(`${FE}/cuenta?s=facturacion`,{waitUntil:'networkidle0'});
await page.waitForSelector('.account-menu',{timeout:20000});
await page.waitForSelector('[data-testid="orders-list"]',{timeout:10000}).catch(()=>{});
await sleep(800);
await shot(page,'F01-facturacion-top');
// inspeccionar links dentro de orders-list
const linkInfo = await page.evaluate(()=>{
  const list=document.querySelector('[data-testid="orders-list"]');
  if(!list) return 'NO orders-list';
  const anchors=[...list.querySelectorAll('a')].slice(0,4).map(a=>({t:a.textContent.trim().slice(0,30),href:a.getAttribute('href'),testid:a.getAttribute('data-testid')}));
  const btns=[...list.querySelectorAll('button')].slice(0,4).map(b=>({t:b.textContent.trim().slice(0,30),testid:b.getAttribute('data-testid')}));
  const clickable=[...list.querySelectorAll('[data-testid]')].slice(0,6).map(e=>e.getAttribute('data-testid'));
  return {anchors,btns,clickable};
});
console.log('FACT links:',JSON.stringify(linkInfo));
// filtros visibles
const filterInfo = await page.evaluate(()=>{
  const c=document.querySelector('.account-content')||document.body;
  const inputs=[...c.querySelectorAll('input,select')].map(e=>({tag:e.tagName,type:e.type,ph:e.placeholder||'',testid:e.getAttribute('data-testid')}));
  return inputs.slice(0,8);
});
console.log('FACT filtros:',JSON.stringify(filterInfo));

// navegar a un detalle de transaccion
const detailNav = await page.evaluate(()=>{
  const list=document.querySelector('[data-testid="orders-list"]');
  const a=[...list.querySelectorAll('a')].find(x=>/detalle|transacc/i.test(x.textContent)||/transaccion/.test(x.getAttribute('href')||''));
  if(a){a.click();return a.getAttribute('href');}
  return null;
});
console.log('detailNav clicked href:',detailNav);
if(detailNav){
  await page.waitForFunction(()=>location.pathname.includes('/cuenta/transaccion/'),{timeout:10000}).catch(()=>{});
  await sleep(1200);
  await shot(page,'F02-transaccion-detalle');
  // toggle blockchain
  const tog=await page.$('[data-testid="toggle-chain"]');
  if(tog){await tog.click();await page.waitForSelector('[data-testid="ledger-chain"]',{timeout:8000}).catch(()=>{});await sleep(800);await shot(page,'F03-blockchain');
    const chain=await page.$eval('[data-testid="ledger-chain"]',e=>e.textContent).catch(()=>'');
    console.log('chain:',(chain||'').replace(/\s+/g,' ').slice(0,200));
  } else {console.log('NO toggle-chain; testids en pagina:');
    const ids=await page.evaluate(()=>[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')).slice(0,25)); console.log(JSON.stringify(ids));}
}

// DROPDOWN del header - inspeccionar testids
await page.goto(`${FE}/`,{waitUntil:'networkidle0'});
await page.waitForSelector('[data-testid="session-greeting"]',{timeout:15000}).catch(()=>{});
const trig=await page.$('[data-testid="user-menu-trigger"]');
console.log('trigger?',trig!==null);
if(trig){await trig.click();await sleep(600);await shot(page,'F04-dropdown');
  const dd=await page.evaluate(()=>{
    const items=[...document.querySelectorAll('[data-testid^="dd-"], [data-testid$="-link"], [data-testid*="menu"] a, [data-testid*="dropdown"] a')].map(e=>({testid:e.getAttribute('data-testid'),t:e.textContent.trim().slice(0,25),tag:e.tagName}));
    // fallback: cualquier link visible en dropdown
    const drop=document.querySelector('[data-testid="user-dropdown"]')||document.querySelector('.dropdown, .user-dropdown, .menu-dropdown');
    const links=drop?[...drop.querySelectorAll('a,button')].map(e=>({testid:e.getAttribute('data-testid'),t:e.textContent.trim().slice(0,25)})):[];
    return {items,links};
  });
  console.log('DROPDOWN:',JSON.stringify(dd));
}

// Sync test con testids reales
await page.goto(`${FE}/cuenta?s=wallet`,{waitUntil:'networkidle0'});
await page.waitForSelector('.account-menu',{timeout:20000});
await page.waitForSelector('[data-testid="wallet-balance"]',{timeout:8000}).catch(()=>{});
console.log('en wallet inicial');
// lateral -> perfil (boton 0)
await page.$$eval('.account-menu button',b=>b[0].click());
await page.waitForSelector('[data-testid="save-profile"]',{timeout:8000}).catch(()=>{});
console.log('lateral->perfil OK, save-profile?',(await page.$('[data-testid="save-profile"]'))!==null);
// dropdown -> wallet
const t2=await page.$('[data-testid="user-menu-trigger"]');
if(t2){await t2.click();await sleep(500);
  const w=await page.$('[data-testid="dd-wallet"]');
  console.log('dd-wallet existe?',w!==null);
  if(w){await w.click();await page.waitForSelector('[data-testid="wallet-balance"]',{timeout:8000}).catch(()=>{});
    const stuck=(await page.$('[data-testid="save-profile"]'))!==null;
    console.log('DESYNC (atascado en perfil)?',stuck);
  }
}
console.log('=== ERRORS ==='); console.log(errs.length?[...new Set(errs)].join('\n'):'(ninguno)');
await browser.close();
