const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  // switch to EN
  await p.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000});
  await sleep(1500);
  const en=await p.evaluateHandle(()=>[...document.querySelectorAll('button,a')].find(e=>e.getAttribute('aria-label')&&e.getAttribute('aria-label').includes('English')));
  if(en.asElement()) await en.asElement().click();
  await sleep(2000);
  // reservar page in EN
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await clickText(p,'button','General'); await sleep(600);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  const reserveText=await p.evaluate(()=>document.querySelector('[data-testid="reserve-btn"]')?.textContent?.trim());
  console.log('reserveBtnEN',reserveText);
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click(); await sleep(5000);
  await p.screenshot({path:'/tmp/shots/70_en_reserved.png',fullPage:true});
  const reservedEN=await p.evaluate(()=>document.querySelector('[data-testid="reserved"]')?.innerText?.replace(/\n+/g,' | ').slice(0,500));
  console.log('RESERVED_EN',reservedEN);
  const pay=await p.$('[data-testid="pay-btn"]'); if(pay) await pay.click(); await sleep(6000);
  await p.screenshot({path:'/tmp/shots/71_en_checkout.png',fullPage:true});
  const coEN=await p.evaluate(()=>{const s=document.querySelector('.checkout');return s?s.innerText.replace(/\n+/g,' | ').slice(0,600):'?';});
  console.log('CHECKOUT_EN',coEN);
  // detect raw keys (word.word patterns typical of missing i18n)
  const raw=await p.evaluate(()=>{const t=document.querySelector('.checkout')?.innerText||'';return (t.match(/\b[a-z]+\.[a-z]+[A-Za-z.]*\b/g)||[]).filter(x=>!x.includes('.com')).slice(0,10);});
  console.log('RAW_KEYS_CHECKOUT',JSON.stringify(raw));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
