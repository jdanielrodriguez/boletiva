const puppeteer = require('puppeteer-core');
const MAILHOG='http://pasaeventos_mailhog:8025', BASE='http://localhost:4200';
const decodeQP=s=>s.replace(/=\r?\n/g,'').replace(/=([0-9A-Fa-f]{2})/g,(m,h)=>String.fromCharCode(parseInt(h,16)));
const fj=async u=>(await fetch(u)).json();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function code(email,since){for(let i=0;i<30;i++){const m=await fj(`${MAILHOG}/api/v2/messages`);for(const x of m.items){const to=(x.Content.Headers.To||[]).join(',');if(to.includes(email)&&new Date(x.Created)>new Date(since)){const b=decodeQP(x.Content.Body||'');const c=b.match(/\b\d{6}\b/g);if(c)return c[0];}}await sleep(1000);}return null;}
async function shot(page,f){await page.screenshot({path:`/shots/${f}.png`,fullPage:true});console.log('SHOT',f);}
async function login(page,email,pw){const s=new Date().toISOString();await page.goto(`${BASE}/login`,{waitUntil:'networkidle2'});await page.type('input[name=email]',email);await page.type('input[name=password]',pw);await page.click('button[type=submit]');await sleep(2500);if(await page.$('input[name=code]')){const c=await code(email,s);await page.type('input[name=code]',c);await page.click('button[type=submit]');await sleep(3000);}await sleep(1500);}

(async()=>{
 const scn=process.argv[2];
 const browser=await puppeteer.launch({executablePath:'/usr/bin/chromium-browser',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--host-resolver-rules=MAP localhost:4200 pasaeventos_frontend:4200, MAP localhost:8080 pasaeventos_api:8080']});
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});
 page.on('console',async m=>{if(m.type()==='error'){try{const parts=[];for(const a of m.args()){let msg=await a.getProperty('message').then(p=>p.jsonValue()).catch(()=>null);if(!msg)msg=await a.jsonValue().catch(()=>null);parts.push(typeof msg==='string'?msg:JSON.stringify(msg));}console.log('CERR:',parts.join(' | ').slice(0,400));}catch(e){console.log('CERR-raw:',m.text().slice(0,200));}}});
 page.on('pageerror',e=>console.log('PAGEERR:',(e&&e.message||String(e)).slice(0,300)));
 try{
  await login(page,'admin@pasaeventos.com','Password123');
  console.log('LOGIN url=',page.url());

  if(scn==='tooltip'){
    await page.goto(`${BASE}/configuracion?tab=sistema`,{waitUntil:'networkidle2'});await sleep(2000);
    const btns=await page.$$('[data-testid=info-tooltip-btn]');
    console.log('tooltip btns=',btns.length);
    if(btns.length){await btns[0].click();await sleep(600);await shot(page,'11-tooltip-open');}
  }

  if(scn==='reset'){
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(1500);
    await page.type('input[placeholder*="ombre"], input[type=search], input[type=text]','buscar-xyz').catch(()=>{});
    // status select
    const sel=await page.$('select');if(sel){const opts=await page.$$eval('select option',os=>os.map(o=>o.value));console.log('status opts=',opts);}
    await sleep(400);await shot(page,'12-reset-filtered');
    await page.click('[data-testid=tab-eventos]');await sleep(1200);
    await page.click('[data-testid=tab-promotores]');await sleep(1200);
    const val=await page.$eval('input[type=text],input[type=search]',e=>e.value).catch(()=>'(n/a)');
    console.log('search after switch=',JSON.stringify(val));
    await shot(page,'13-reset-after');
  }

  if(scn==='impersonate'){
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(1500);
    const imp=await page.$('[data-testid=promoter-impersonate]');
    console.log('impersonate btn?',!!imp);
    if(imp){await imp.click();await sleep(800);await shot(page,'14-impersonate-modal');
      // confirm
      await page.click('[data-testid=confirm-accept]');console.log('confirmed');
      await sleep(4000);await shot(page,'15-impersonate-banner');
      console.log('url after impersonate=',page.url());
      // exit
      const bx=await page.$$('button');for(const b of bx){const t=(await (await b.getProperty('textContent')).jsonValue()||'').trim().toLowerCase();if(/salir|exit|volver a admin/.test(t)){await b.click();console.log('exit via',t);break;}}
      await sleep(3000);await shot(page,'16-impersonate-exit');
      console.log('url after exit=',page.url());
    }
  }

  if(scn==='modals'){
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(1500);
    // desechable pending -> approve/reject buttons
    const ap=await page.$('[data-testid=promoter-approve]');console.log('approve btn?',!!ap);
    if(ap){await ap.click();await sleep(700);await shot(page,'17-approve-modal');
      // cancel
      const bs=await page.$$('button');for(const b of bs){const t=(await (await b.getProperty('textContent')).jsonValue()||'').trim().toLowerCase();if(/cancel/.test(t)){await b.click();break;}}await sleep(600);
    }
    const rj=await page.$('[data-testid=promoter-reject]');console.log('reject btn?',!!rj);
    if(rj){await rj.click();await sleep(700);await shot(page,'18-reject-modal');
      const bs=await page.$$('button');for(const b of bs){const t=(await (await b.getProperty('textContent')).jsonValue()||'').trim().toLowerCase();if(/cancel/.test(t)){await b.click();break;}}await sleep(600);
    }
    const su=await page.$('[data-testid=promoter-suspend]');console.log('suspend btn?',!!su);
    if(su){await su.click();await sleep(700);await shot(page,'19-suspend-modal');}
  }


  if(scn==='reactivate'){
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(1500);
    const ap=await page.$('[data-testid=promoter-approve]');console.log('reactivate(approve) btn?',!!ap);
    if(ap){await ap.click();await sleep(700);await shot(page,'20-reactivate-modal');}
  }


  if(scn==='unlock'){
    const EV='16823c54-9ca1-49d7-8119-5d9c9567e806';
    await page.goto(`${BASE}/promotor/eventos/${EV}/editar?from=admin`,{waitUntil:'networkidle2'});await sleep(2000);
    const ub=await page.$('[data-testid=unlock-btn]');console.log('unlock-btn?',!!ub);
    const since=new Date().toISOString();
    if(ub){await ub.click();await sleep(800);
      await page.click('[data-testid=unlock-request]').catch(e=>console.log('req err',e.message));
      console.log('code requested');await sleep(2500);
      const c=await code('admin@pasaeventos.com',since);console.log('unlock code=',c);
      if(c){await page.type('[data-testid=unlock-code]',c);await sleep(300);
        await page.click('[data-testid=unlock-verify]');await sleep(3000);
        const timer=await page.$('[data-testid=unlock-timer]');console.log('unlock-timer present?',!!timer);
        if(timer){const t=await page.$eval('.lock-countdown',e=>e.textContent.trim()).catch(()=>'(n/a)');console.log('countdown=',t);}
        await shot(page,'23-editor-desbloqueado');
      }
    }
  }


  if(scn==='persist'){
    const NOTE='QA-nota-'+Date.now();
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(3500);
    // Locate the QA Desechable card index by email text
    const idx=await page.$$eval('.promoter-card',cs=>cs.findIndex(c=>c.textContent.includes('qa-desechable@example.com')));
    console.log('QA card idx=',idx);
    async function inCard(sel){const cards=await page.$$('.promoter-card');return cards[idx].$(sel);}
    const noteInp=await inCard('input[type=text]');
    await noteInp.click({clickCount:3});await noteInp.type(NOTE);
    await (await inCard('[data-testid=promoter-note-save]')).click();await sleep(1600);
    const pctInp=await inCard('input[type=number]');
    await pctInp.click({clickCount:3});await pctInp.type('0.35');
    await (await inCard('[data-testid=promoter-pct-save]')).click();await sleep(1800);
    await page.reload({waitUntil:'networkidle2'});await sleep(2500);
    const idx2=await page.$$eval('.promoter-card',cs=>cs.findIndex(c=>c.textContent.includes('qa-desechable@example.com')));
    const res=await page.$$eval('.promoter-card',(cs,i)=>{const c=cs[i];return {note:c.querySelector('input[type=text]').value,pct:c.querySelector('input[type=number]').value,eff:(c.querySelector('[data-testid=promoter-pct-effective]')||{}).textContent,reset:!!c.querySelector('[data-testid=promoter-pct-reset]')};},idx2);
    console.log('AFTER RELOAD',JSON.stringify(res),'expectedNote=',NOTE);
    await shot(page,'24-persist-reload');
    // reset to default
    if(res.reset){const cards=await page.$$('.promoter-card');await (await cards[idx2].$('[data-testid=promoter-pct-reset]')).click();await sleep(1600);await page.reload({waitUntil:'networkidle2'});await sleep(2200);
      const idx3=await page.$$eval('.promoter-card',cs=>cs.findIndex(c=>c.textContent.includes('qa-desechable@example.com')));
      const res2=await page.$$eval('.promoter-card',(cs,i)=>{const c=cs[i];return {eff:(c.querySelector('[data-testid=promoter-pct-effective]')||{}).textContent,reset:!!c.querySelector('[data-testid=promoter-pct-reset]')};},idx3);
      console.log('AFTER RESET',JSON.stringify(res2));
    }
  }
  if(scn==='unlock'){
    const EV='16823c54-9ca1-49d7-8119-5d9c9567e806';
    await page.goto(`${BASE}/promotor/eventos/${EV}/editar?from=admin`,{waitUntil:'networkidle2'});await sleep(2000);
    const ub=await page.$('[data-testid=unlock-btn]');console.log('unlock-btn?',!!ub);
    const since=new Date().toISOString();
    if(ub){await ub.click();await sleep(800);
      await page.click('[data-testid=unlock-request]').catch(e=>console.log('req err',e.message));
      console.log('code requested');await sleep(2500);
      const c=await code('admin@pasaeventos.com',since);console.log('unlock code=',c);
      if(c){await page.type('[data-testid=unlock-code]',c);await sleep(300);
        await page.click('[data-testid=unlock-verify]');await sleep(3000);
        const timer=await page.$('[data-testid=unlock-timer]');console.log('unlock-timer present?',!!timer);
        if(timer){const t=await page.$eval('.lock-countdown',e=>e.textContent.trim()).catch(()=>'(n/a)');console.log('countdown=',t);}
        await shot(page,'23-editor-desbloqueado');
      }
    }
  }


  if(scn==='persist'){
    const ID='9caeb6d9-0117-4047-bf89-d09552f17fa4';
    const NOTE='QA-nota-'+Date.now();
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(3500);
    const names=await page.$$eval('input',es=>es.map(e=>e.name).filter(n=>n));console.log('input names=',names);const cards=await page.$$eval('.promoter-card',es=>es.length).catch(()=>-1);console.log('promoter cards=',cards);await shot(page,'dbg-persist');
    // set note
    await page.click(`input[name='note-${ID}']`);
    await page.type(`input[name='note-${ID}']`,NOTE);
    // find its save button: within same card. Use evaluate to click note-save near this input.
    await page.evaluate((id,note)=>{
      const inp=document.querySelector(`input[name='note-${id}']`);
      const card=inp.closest('.promoter-card');
      card.querySelector('[data-testid=promoter-note-save]').click();
    },ID,NOTE);
    await sleep(1500);
    // set pct
    await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);inp.value='';},ID);
    await page.focus(`input[name='pct-${ID}']`);
    await page.$eval(`input[name='pct-${ID}']`,e=>e.value='');
    await page.type(`input[name='pct-${ID}']`,'0.35');
    await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);const ev=new Event('input',{bubbles:true});inp.dispatchEvent(ev);const card=inp.closest('.promoter-card');card.querySelector('[data-testid=promoter-pct-save]').click();},ID);
    await sleep(1800);
    // reload
    await page.reload({waitUntil:'networkidle2'});await sleep(2000);
    const noteVal=await page.$eval(`input[name='note-${ID}']`,e=>e.value).catch(()=>'(n/a)');
    const pctVal=await page.$eval(`input[name='pct-${ID}']`,e=>e.value).catch(()=>'(n/a)');
    const eff=await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);const card=inp.closest('.promoter-card');const e=card.querySelector('[data-testid=promoter-pct-effective]');return e?e.textContent.trim():'(none)';},ID);
    const hasReset=await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);const card=inp.closest('.promoter-card');return !!card.querySelector('[data-testid=promoter-pct-reset]');},ID);
    console.log('AFTER RELOAD note=',JSON.stringify(noteVal),'pct=',JSON.stringify(pctVal),'eff=',JSON.stringify(eff),'hasReset=',hasReset,'expectedNote=',NOTE);
    await shot(page,'24-persist-reload');
    // reset
    if(hasReset){await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);const card=inp.closest('.promoter-card');card.querySelector('[data-testid=promoter-pct-reset]').click();},ID);await sleep(1500);await page.reload({waitUntil:'networkidle2'});await sleep(1800);
      const eff2=await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);const card=inp.closest('.promoter-card');const e=card.querySelector('[data-testid=promoter-pct-effective]');return e?e.textContent.trim():'(none)';},ID);
      const hasReset2=await page.evaluate((id)=>{const inp=document.querySelector(`input[name='pct-${id}']`);const card=inp.closest('.promoter-card');return !!card.querySelector('[data-testid=promoter-pct-reset]');},ID);
      console.log('AFTER RESET eff=',JSON.stringify(eff2),'hasReset=',hasReset2);
    }
  }


  if(scn==='pctdbg'){
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(3500);
    const idx=await page.$$eval('.promoter-card',cs=>cs.findIndex(c=>c.textContent.includes('qa-desechable@example.com')));
    const cards=await page.$$('.promoter-card');const card=cards[idx];
    const pctInp=await card.$('input[type=number]');
    await pctInp.focus();
    // clear
    await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
    await pctInp.type('0.35',{delay:60});
    const v1=await (await pctInp.getProperty('value')).jsonValue();console.log('pct input value before save=',JSON.stringify(v1));
    const saveBtn=await card.$('[data-testid=promoter-pct-save]');
    await saveBtn.click();await sleep(2000);
    // check toast text
    const toast=await page.$$eval('[class*=toast],[role=alert]',es=>es.map(e=>e.textContent.trim())).catch(()=>[]);
    console.log('toasts=',JSON.stringify(toast));
    await shot(page,'25-pctdbg');
  }


  if(scn==='resetpct'){
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(3500);
    let idx=await page.$$eval('.promoter-card',cs=>cs.findIndex(c=>c.textContent.includes('qa-desechable@example.com')));
    let st=await page.$$eval('.promoter-card',(cs,i)=>{const c=cs[i];return {pct:c.querySelector('input[type=number]').value,eff:(c.querySelector('[data-testid=promoter-pct-effective]')||{}).textContent,reset:!!c.querySelector('[data-testid=promoter-pct-reset]')};},idx);
    console.log('WITH OVERRIDE',JSON.stringify(st));
    await shot(page,'26-override-shown');
    if(st.reset){const cards=await page.$$('.promoter-card');await (await cards[idx].$('[data-testid=promoter-pct-reset]')).click();await sleep(2000);await page.reload({waitUntil:'networkidle2'});await sleep(2500);
      idx=await page.$$eval('.promoter-card',cs=>cs.findIndex(c=>c.textContent.includes('qa-desechable@example.com')));
      let st2=await page.$$eval('.promoter-card',(cs,i)=>{const c=cs[i];return {pct:c.querySelector('input[type=number]').value,eff:(c.querySelector('[data-testid=promoter-pct-effective]')||{}).textContent,reset:!!c.querySelector('[data-testid=promoter-pct-reset]')};},idx);
      console.log('AFTER RESET',JSON.stringify(st2));
    }
  }


  if(scn==='i18nmobile'){
    // EN sistema
    await page.goto(`${BASE}/configuracion?tab=sistema`,{waitUntil:'networkidle2'});await sleep(2000);
    await page.click('[data-testid=lang-en]').catch(e=>console.log('lang-en err',e.message));await sleep(1500);
    await shot(page,'27-en-sistema');
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(2000);
    await shot(page,'28-en-promotores');
    await page.goto(`${BASE}/configuracion/salones`,{waitUntil:'networkidle2'});await sleep(2000);
    await shot(page,'29-en-salones');
    // back to ES
    await page.click('[data-testid=lang-es]').catch(()=>{});await sleep(1200);
    // MOBILE 390
    await page.setViewport({width:390,height:800});
    await page.goto(`${BASE}/configuracion?tab=sistema`,{waitUntil:'networkidle2'});await sleep(2000);
    const ow1=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));console.log('mobile sistema overflow',JSON.stringify(ow1));
    await shot(page,'30-mobile-sistema');
    await page.goto(`${BASE}/configuracion?tab=promotores`,{waitUntil:'networkidle2'});await sleep(1800);
    const ow2=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));console.log('mobile promotores overflow',JSON.stringify(ow2));
    await shot(page,'31-mobile-promotores');
    await page.goto(`${BASE}/configuracion/salones`,{waitUntil:'networkidle2'});await sleep(1800);
    const ow3=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));console.log('mobile salones overflow',JSON.stringify(ow3));
    await shot(page,'32-mobile-salones');
  }


  if(scn==='enprom'){
    await page.goto(`${BASE}/configuracion?tab=sistema`,{waitUntil:'networkidle2'});await sleep(2000);
    await page.click('[data-testid=lang-en]');await sleep(1200);
    await page.click('[data-testid=tab-promotores]');await sleep(2000);
    await shot(page,'33-en-promotores-spa');
    // capture some labels
    const labels=await page.$$eval('.promoter-card label span, .promoter-card [data-testid]',es=>es.slice(0,8).map(e=>e.textContent.trim()));
    console.log('labels=',JSON.stringify(labels));
    await page.click('[data-testid=lang-es]').catch(()=>{});
  }

 }catch(e){console.log('ERR',e.message);}
 await browser.close();
})();
