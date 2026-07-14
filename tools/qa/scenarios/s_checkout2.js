const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await clickText(p,'button','General'); await sleep(600);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click(); await sleep(5000);
  const pay=await p.$('[data-testid="pay-btn"]'); if(pay) await pay.click(); await sleep(6000);
  console.log('URL',p.url());
  const info=await p.evaluate(()=>{
    const q=s=>document.querySelector(s);
    return {
      savedCards:document.querySelectorAll('[data-testid="pay-saved-card"]').length,
      savedCardText:q('[data-testid="pay-saved-card"]')?.innerText?.replace(/\n+/g,' '),
      savedCardChecked:q('[data-testid="pay-saved-card"]')?.getAttribute('aria-checked'),
      newCardOpt:!!q('[data-testid="pay-new-card"]'),
      walletOpt:!!q('[data-testid="pay-wallet"]'),
      cvvBlockInitially:!!q('[data-testid="cvv-block"]')
    };
  });
  console.log('CHECKOUT2',JSON.stringify(info));
  // click saved card to reveal CVV
  const sc=await p.$('[data-testid="pay-saved-card"]'); if(sc) await sc.click(); await sleep(800);
  const cvv=await p.evaluate(()=>({cvvBlock:!!document.querySelector('[data-testid="cvv-block"]'),cvvInput:!!document.querySelector('[data-testid="saved-cvv"]'),label:document.querySelector('[data-testid="cvv-block"] label')?.textContent}));
  console.log('CVV',JSON.stringify(cvv));
  await p.screenshot({path:'/tmp/shots/21_checkout_saved.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
