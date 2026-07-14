const puppeteer = require('puppeteer-core');

const MAILHOG = 'http://pasaeventos_mailhog:8025';
const BASE = 'http://localhost:4200';

function decodeQP(s){
  return s.replace(/=\r?\n/g,'').replace(/=([0-9A-Fa-f]{2})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
}
async function fetchJson(url){ const r = await fetch(url); return r.json(); }

async function latestCodeFor(email, sinceIso){
  for(let i=0;i<30;i++){
    const msgs = await fetchJson(`${MAILHOG}/api/v2/messages`);
    for(const m of msgs.items){
      const to = (m.Content.Headers.To||[]).join(',');
      const date = new Date(m.Created);
      if(to.includes(email) && (!sinceIso || date > new Date(sinceIso))){
        const body = decodeQP(m.Content.Body||'');
        const codes = body.match(/\b\d{6}\b/g);
        if(codes && codes.length) return codes[0];
      }
    }
    await new Promise(r=>setTimeout(r,1000));
  }
  return null;
}

async function login(page, email, password){
  const since = new Date().toISOString();
  await page.goto(`${BASE}/login`, {waitUntil:'networkidle2'});
  await page.type('input[name=email]', email);
  await page.type('input[name=password]', password);
  await Promise.all([
    page.click('button[type=submit]'),
    new Promise(r=>setTimeout(r,2500)),
  ]);
  // 2FA?
  const codeInput = await page.$('input[name=code]');
  if(codeInput){
    const code = await latestCodeFor(email, since);
    if(!code) throw new Error('no 2fa code');
    await page.type('input[name=code]', code);
    await page.click('button[type=submit]');
    await new Promise(r=>setTimeout(r,3000));
  }
  await new Promise(r=>setTimeout(r,1500));
}

(async ()=>{
  const args = process.argv.slice(2); // list of "url::filename"
  const browser = await puppeteer.launch({
    executablePath:'/usr/bin/chromium-browser',
    headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--host-resolver-rules=MAP localhost:4200 pasaeventos_frontend:4200, MAP localhost:8080 pasaeventos_api:8080'],
  });
  const page = await browser.newPage();
  await page.setViewport({width:1440, height:900});
  page.on('console', m=>{ if(m.type()==='error') console.log('CONSOLE ERR:', m.text().slice(0,200)); });
  try{
    await login(page, 'admin@pasaeventos.com', 'Password123');
    console.log('LOGGED IN, url=', page.url());
    for(const a of args){
      const [url, file] = a.split('::');
      await page.goto(`${BASE}${url}`, {waitUntil:'networkidle2'});
      await new Promise(r=>setTimeout(r,2500));
      await page.screenshot({path:`/shots/${file}.png`, fullPage:true});
      console.log('SHOT', url, '->', file);
    }
  }catch(e){ console.log('ERROR', e.message); }
  await browser.close();
})();
