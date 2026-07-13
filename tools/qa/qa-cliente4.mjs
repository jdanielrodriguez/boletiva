import puppeteer from 'puppeteer-core';
const FE='http://pasaeventos_frontend:4200', MAIL='http://pasaeventos_mailhog:8025';
const BUYER={email:'cliente@pasaeventos.com',password:'Password123'}, OUT='/app/qashots2';
import fs from 'fs'; fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function clearMail(){await fetch(`${MAIL}/api/v1/messages`,{method:'DELETE'}).catch(()=>{});}
async function otp(){for(let i=0;i<30;i++){const r=await fetch(`${MAIL}/api/v2/messages`).catch(()=>null);if(r&&r.ok){const d=await r.json();for(const m of(d.items||[])){const b=(m.Content&&m.Content.Body)||'';const x=b.replace(/=\r?\n/g,'').replace(/=3D/g,'=');const mm=x.match(/\b(\d{6})\b/);if(mm)return mm[1];}}await sleep(500);}throw new Error('no OTP');}
const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium-browser',headless:'new',args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']});
const page=await browser.newPage(); await page.setViewport({width:1366,height:900});
await clearMail(); await page.goto(`${FE}/login`,{waitUntil:'networkidle0'});
await page.waitForSelector('#email',{timeout:15000}); await page.type('#email',BUYER.email); await page.type('#password',BUYER.password);
await page.click('button[type="submit"]'); await page.waitForSelector('#code, [data-testid="session-greeting"]',{timeout:20000});
if(await page.$('#code')){await page.type('#code',await otp());await page.click('button[type="submit"]');}
await page.waitForSelector('[data-testid="session-greeting"]',{timeout:20000}); console.log('login OK');
// transaccion detalle
await page.goto(`${FE}/cuenta?s=facturacion`,{waitUntil:'networkidle0'});
await page.waitForSelector('[data-testid="ver-detalle"]',{timeout:12000});
await page.click('[data-testid="ver-detalle"]');
await page.waitForFunction(()=>location.pathname.includes('/cuenta/transaccion/'),{timeout:10000}).catch(()=>{});
await sleep(1200); await page.screenshot({path:`${OUT}/tx-detalle.png`,fullPage:true});
console.log('tx detalle testids:',JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[data-testid]')].map(e=>e.getAttribute('data-testid')))));
// blockchain desde facturacion
await page.goto(`${FE}/cuenta?s=facturacion`,{waitUntil:'networkidle0'});
await page.waitForSelector('[data-testid="toggle-chain"]',{timeout:12000});
await page.click('[data-testid="toggle-chain"]');
await page.waitForSelector('[data-testid="ledger-chain"]',{timeout:8000}).catch(()=>{});
await sleep(800);
const chainEl=await page.$('[data-testid="ledger-chain"]');
if(chainEl){await chainEl.screenshot({path:`${OUT}/blockchain.png`}).catch(()=>{}); const c=await page.$eval('[data-testid="ledger-chain"]',e=>e.textContent);console.log('CHAIN:',(c||'').replace(/\s+/g,' ').slice(0,300));}
// boleto poster individual
await page.goto(`${FE}/cuenta?s=activos`,{waitUntil:'networkidle0'});
await page.waitForSelector('.account-menu',{timeout:20000}); await sleep(2000);
const poster=await page.$('.poster, [class*="poster"]');
if(poster){await poster.screenshot({path:`${OUT}/poster.png`});console.log('poster shot ok');}
await browser.close();
