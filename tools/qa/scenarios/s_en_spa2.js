const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000}); await sleep(1200);
  await p.evaluate(()=>{const en=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||'').includes('English'));en&&en.click();});
  await sleep(1800);
  // SPA to detail
  await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>(x.getAttribute('href')||'').includes('/eventos/evento-demo'));a&&a.click();});
  await sleep(2200);
  // click the locality link -> /comprar
  const href=await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>(x.getAttribute('href')||'').includes('/comprar'));if(a){a.click();return a.getAttribute('href');}return 'NONE';});
  console.log('comprarHref',href);
  await sleep(2500);
  console.log('PURCHASE_H1',await p.evaluate(()=>document.querySelector('h1')?.textContent));
  const cnt0=await p.evaluate(()=>document.querySelector('.cart-count')?.textContent?.trim());
  const rt=await p.evaluate(()=>document.querySelector('[data-testid="reserve-btn"]')?.textContent?.trim());
  const perTicket=await p.evaluate(()=>document.querySelector('.loc-active h2')?.textContent?.trim());
  console.log('cart',cnt0,'| reserveBtn',rt,'| locHeader',perTicket);
  // add 2 and reserve
  await clickText(p,'button','General'); await sleep(400);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click(); await sleep(5000);
  const reserved=await p.evaluate(()=>document.querySelector('[data-testid="reserved"]')?.innerText?.replace(/\n+/g,' | ').slice(0,350));
  console.log('RESERVED_EN',reserved);
  await p.screenshot({path:'/tmp/shots/70_en_reserved.png',fullPage:true});
  const pay=await p.$('[data-testid="pay-btn"]'); if(pay) await pay.click(); await sleep(6000);
  const co=await p.evaluate(()=>document.querySelector('.checkout')?.innerText?.replace(/\n+/g,' | ').slice(0,500));
  console.log('CHECKOUT_EN',co);
  await p.screenshot({path:'/tmp/shots/71_en_checkout.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
