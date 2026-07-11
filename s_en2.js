const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000}); await sleep(1200);
  await p.evaluate(()=>{const en=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||'').includes('English'));en&&en.click();});
  await sleep(2000);
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000}); await sleep(2500);
  const title=await p.evaluate(()=>document.querySelector('h1')?.textContent);
  console.log('PURCHASE_TITLE_EN',title);
  await clickText(p,'button','General'); await sleep(600);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  const reserveText=await p.evaluate(()=>document.querySelector('[data-testid="reserve-btn"]')?.textContent?.trim());
  console.log('reserveBtnEN',reserveText);
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click(); await sleep(5000);
  const reservedEN=await p.evaluate(()=>document.querySelector('[data-testid="reserved"]')?.innerText?.replace(/\n+/g,' | ').slice(0,400));
  console.log('RESERVED_EN',reservedEN);
  await p.screenshot({path:'/tmp/shots/70_en_reserved.png',fullPage:true});
  const pay=await p.$('[data-testid="pay-btn"]'); if(pay) await pay.click(); await sleep(6000);
  const coEN=await p.evaluate(()=>document.querySelector('.checkout')?.innerText?.replace(/\n+/g,' | ').slice(0,550));
  console.log('CHECKOUT_EN',coEN);
  await p.screenshot({path:'/tmp/shots/71_en_checkout.png',fullPage:true});
  // transfer modal EN + conviertete EN
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
