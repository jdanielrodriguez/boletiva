const puppeteer = require('puppeteer-core');
const http=require('http');
function launch(){
  return puppeteer.launch({
    executablePath:'/usr/bin/chromium-browser',
    headless:true,
    userDataDir:'/tmp/pptr-profile',
    args:['--no-sandbox','--disable-setuid-sandbox',
      '--host-resolver-rules=MAP localhost:4200 pasaeventos_frontend:4200, MAP localhost:8080 pasaeventos_api:8080']
  });
}
async function newPage(browser){
  const page=await browser.newPage();
  await page.setViewport({width:1366,height:900});
  page.on('pageerror',e=>console.log('PAGEERR:',e.message));
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE.ERR:',m.text().slice(0,200));});
  return page;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function clickText(page, tag, txt){
  const h=await page.evaluateHandle((tag,txt)=>{
    const els=[...document.querySelectorAll(tag)];
    return els.find(e=>e.textContent.trim().toLowerCase().includes(txt.toLowerCase()));
  },tag,txt);
  const el=h.asElement();
  if(el){await el.click();return true;}
  return false;
}
function mailhog(path){return new Promise((res,rej)=>{http.get('http://pasaeventos_mailhog:8025'+path,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d))}).on('error',rej)});}
function qp(s){ // decode quoted-printable
  return s.replace(/=\r?\n/g,'').replace(/=([0-9A-Fa-f]{2})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
}
async function latest2FACode(){
  const raw=await mailhog('/api/v2/messages?limit=10');
  const j=JSON.parse(raw);
  for(const m of j.items){
    const body=qp(m.Content.Body||'');
    const subj=(m.Content.Headers.Subject||[]).join(' ');
    const mm=body.match(/\b(\d{6})\b/);
    if(mm && /(c[oó]digo|verif|2fa|acceso|dispositivo)/i.test(body+subj)) return mm[1];
  }
  // fallback any 6-digit
  for(const m of j.items){const body=qp(m.Content.Body||'');const mm=body.match(/\b(\d{6})\b/);if(mm)return mm[1];}
  return null;
}
async function login(page, email='cliente@pasaeventos.com', pass='Password123'){
  await page.goto('http://localhost:4200/login',{waitUntil:'networkidle2',timeout:60000});
  await sleep(1200);
  const e=await page.$('input[type=email]'); if(e){await e.click({clickCount:3});await e.type(email);}
  const p=await page.$('input[type=password]'); if(p){await p.click({clickCount:3});await p.type(pass);}
  await sleep(300);
  await clickText(page,'button','Entrar');
  await sleep(3500);
  // detect 2FA: look for otp input
  const body=await page.evaluate(()=>document.body.innerText);
  if(/verif|c[oó]digo|2fa|dos pasos|dispositivo/i.test(body) && /input/){
    const otp=await page.$('input[inputmode=numeric], input[type=tel], input[maxlength="6"], input[name*=code], input[formcontrolname*=code], input[type=text]');
    if(otp){
      await sleep(1500);
      const code=await latest2FACode();
      if(code){await otp.type(code); await sleep(300); await (clickText(page,'button','Verificar')||clickText(page,'button','Confirmar')||clickText(page,'button','Continuar')); await sleep(3500);}
      return {url:page.url(),twofa:true,code};
    }
  }
  return {url:page.url(),twofa:false};
}
module.exports={launch,newPage,login,sleep,clickText,mailhog,latest2FACode,qp};
