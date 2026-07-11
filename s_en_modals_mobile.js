const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  // EN via flag on home, then SPA to account
  await p.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000}); await sleep(1200);
  await p.evaluate(()=>{const en=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||'').includes('English'));en&&en.click();});
  await sleep(1500);
  // SPA to account via account menu / link
  await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>(x.getAttribute('href')||'')==='/cuenta'||/My account|Account/i.test(x.textContent));a&&a.click();});
  await sleep(1500);
  // ensure on account; click active tickets tab (EN "Active tickets")
  await p.evaluate(()=>{const el=[...document.querySelectorAll('button,a')].find(x=>/Active tickets|Boletos activos/i.test(x.textContent));el&&el.click();});
  await sleep(3500);
  console.log('ACCOUNT_HEADING',await p.evaluate(()=>document.querySelector('h1,h2')?.textContent));
  // open transfer modal
  const tb=await p.$('[data-testid="ticket-transfer"]'); if(tb) await tb.click(); await sleep(1500);
  const m1=await p.evaluate(()=>document.querySelector('app-ticket-transfer-modal')?.innerText?.replace(/\n+/g,' | ').slice(0,450));
  console.log('TRANSFER_MODAL_EN',m1);
  await b.close();

  // conviertete EN
  const b2=await launch(); const p2=await newPage(b2);
  await login(p2);
  await p2.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000}); await sleep(1000);
  await p2.evaluate(()=>{const en=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||'').includes('English'));en&&en.click();});
  await sleep(1200);
  await p2.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>(x.getAttribute('href')||'').includes('conviertete')||/Become a promoter/i.test(x.textContent));a&&a.click();});
  await sleep(2000);
  console.log('BECOME_H1',await p2.evaluate(()=>document.querySelector('h1')?.textContent));
  await p2.evaluate(()=>{const btns=[...document.querySelectorAll('button')].find(x=>/promoter|Become/i.test(x.textContent));btns&&btns.click();});
  await sleep(1500);
  const pm=await p2.evaluate(()=>document.querySelector('[role=dialog],.modal,app-confirm-dialog')?.innerText?.replace(/\n+/g,' | ').slice(0,450));
  console.log('PROMOTER_MODAL_EN',pm);
  await b2.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
