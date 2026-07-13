import puppeteer from 'puppeteer-core';
const FE='http://pasaeventos_frontend:4200', MAIL='http://pasaeventos_mailhog:8025';
const BUYER={email:'cliente@pasaeventos.com',password:'Password123'}, OUT='/tmp/qa-shots';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function clearMail(){await fetch(`${MAIL}/api/v1/messages`,{method:'DELETE'}).catch(()=>{});}
async function otp(){for(let i=0;i<30;i++){const r=await fetch(`${MAIL}/api/v2/messages`).catch(()=>null);if(r&&r.ok){const d=await r.json();for(const m of(d.items||[])){const b=(m.Content&&m.Content.Body)||'';const x=b.replace(/=\r?\n/g,'').replace(/=3D/g,'=');const mm=x.match(/\b(\d{6})\b/);if(mm)return mm[1];}}await sleep(500);}throw new Error('no OTP');}
async function shot(p,n){await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true}).catch(()=>{});console.log('  📸',n);}
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium-browser',headless:'new',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const page=await browser.newPage(); await page.setViewport({width:1366,height:900});
const failed=[]; page.on('requestfailed',r=>failed.push(r.url()+' '+ (r.failure()?.errorText||'')));
page.on('response',r=>{if(r.status()>=400)failed.push('HTTP '+r.status()+' '+r.url());});
await clearMail(); await page.goto(`${FE}/login`,{waitUntil:'networkidle0'});
await page.waitForSelector('#email',{timeout:15000}); await page.type('#email',BUYER.email); await page.type('#password',BUYER.password);
await page.click('button[type="submit"]'); await page.waitForSelector('#code, [data-testid="session-greeting"]',{timeout:20000});
if(await page.$('#code')){await page.type('#code',await otp());await page.click('button[type="submit"]');}
await page.waitForSelector('[data-testid="session-greeting"]',{timeout:20000}); console.log('login OK');
failed.length=0; // reset tras login

// ver-detalle -> pagina detalle transaccion
await page.goto(`${FE}/cuenta?s=facturacion`,{waitUntil:'networkidle0'});
await page.waitForSelector('[data-testid="ver-detalle"]',{timeout:12000});
await page.click('[data-testid="ver-detalle"]');
await page.waitForFunction(()=>location.pathname.includes('/cuenta/transaccion/'),{timeout:10000}).catch(()=>{});
await sleep(1200); await shot(page,'G01-transaccion-detalle');
console.log('URL detalle:',page.url());
const tog=await page.$('[data-testid="toggle-chain"]');
if(tog){await tog.click();await page.waitForSelector('[data-testid="ledger-chain"]',{timeout:8000}).catch(()=>{});await sleep(800);await shot(page,'G02-blockchain');
  const c=await page.$eval('[data-testid="ledger-chain"]',e=>e.textContent).catch(()=>'');console.log('chain:',(c||'').replace(/\s+/g,' ').slice(0,220));}
else console.log('no toggle-chain en detalle');

// boletos poster - viewport recortado a la primera tarjeta
await page.goto(`${FE}/cuenta?s=activos`,{waitUntil:'networkidle0'});
await page.waitForSelector('.account-menu',{timeout:20000}); await sleep(2500);
await shot(page,'G03-boletos-full');
const posterInfo=await page.evaluate(()=>{
  const p=document.querySelector('.poster')||document.querySelector('[class*="poster"]');
  const btns=[...document.querySelectorAll('.account-content button, .account-content a')].map(b=>({t:b.textContent.trim().slice(0,20),testid:b.getAttribute('data-testid')})).slice(0,12);
  const qr=document.querySelector('.poster-qr img');
  return {poster:!!p,btns,qr:qr?qr.getAttribute('src').slice(0,60):null};
});
console.log('BOLETOS:',JSON.stringify(posterInfo));
// captura recortada del poster
const poster=await page.$('.poster, [class*="poster"]');
if(poster){await poster.screenshot({path:`${OUT}/G04-boleto-poster.png`}).catch(()=>{});console.log('  📸 G04-boleto-poster');}

console.log('=== REQUESTS FALLIDOS (post-login) ==='); console.log(failed.length?[...new Set(failed)].join('\n'):'(ninguno)');
await browser.close();
