const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/cuenta',{waitUntil:'networkidle2',timeout:60000}); await sleep(2500);
  // find language EN option within profile idioma section and save
  // click the EN language radio/button in the idioma block (aria-label English)
  await p.evaluate(()=>{
    const btns=[...document.querySelectorAll('button')].filter(e=>(e.getAttribute('aria-label')||'').includes('English')||/English|English \(/.test(e.textContent));
    // pick the one inside the profile (not header) - choose last
    (btns[btns.length-1]||btns[0])?.click();
  });
  await sleep(800);
  const saved=await clickText(p,'button','Guardar cambios');
  console.log('savedClicked',saved);
  await sleep(3000);
  // now reload purchase page fresh
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000}); await sleep(2500);
  const title=await p.evaluate(()=>document.querySelector('h1')?.textContent);
  console.log('PURCHASE_TITLE',title);
  await clickText(p,'button','General'); await sleep(500);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  const rt=await p.evaluate(()=>document.querySelector('[data-testid="reserve-btn"]')?.textContent?.trim());
  const cnt=await p.evaluate(()=>document.querySelector('.cart-count')?.textContent?.trim());
  console.log('reserveBtn',rt,'| count',cnt);
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click(); await sleep(5000);
  const reserved=await p.evaluate(()=>document.querySelector('[data-testid="reserved"]')?.innerText?.replace(/\n+/g,' | ').slice(0,350));
  console.log('RESERVED',reserved);
  await p.screenshot({path:'/tmp/shots/70_en_reserved.png',fullPage:true});
  const pay=await p.$('[data-testid="pay-btn"]'); if(pay) await pay.click(); await sleep(6000);
  const co=await p.evaluate(()=>document.querySelector('.checkout')?.innerText?.replace(/\n+/g,' | ').slice(0,550));
  console.log('CHECKOUT',co);
  await p.screenshot({path:'/tmp/shots/71_en_checkout.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
