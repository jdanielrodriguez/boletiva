const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await clickText(p,'button','General'); await sleep(600);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click();
  await sleep(5000);
  const pay=await p.$('[data-testid="pay-btn"]'); 
  console.log('payBtn?',!!pay);
  if(pay) await pay.click();
  await sleep(6000);
  console.log('URL',p.url());
  await p.screenshot({path:'/tmp/shots/20_checkout.png',fullPage:true});
  const info=await p.evaluate(()=>{
    const q=s=>document.querySelector(s);
    return {
      methodsLoading:!!q('[data-testid="methods-loading"]'),
      methodsError:!!q('[data-testid="methods-error"]'),
      walletOpt:!!q('[data-testid="pay-wallet"]'),
      walletBalance:q('[data-testid="wallet-balance"]')?.textContent?.trim(),
      savedCards:document.querySelectorAll('[data-testid="pay-saved-card"]').length,
      newCardOpt:!!q('[data-testid="pay-new-card"]'),
      newCardForm:!!q('[data-testid="new-card-form"]'),
      noMethodsHint:q('[data-testid="no-methods-hint"]')?.textContent?.trim(),
      cvvBlock:!!q('[data-testid="cvv-block"]'),
      breakdown:q('[data-testid="breakdown"]')?.innerText?.replace(/\n+/g,' | '),
      serviceFee:q('[data-testid="service-fee"]')?.textContent,
      total:q('[data-testid="total"]')?.textContent,
      gateways:[...document.querySelectorAll('.gateway-option .gateway-name')].map(n=>n.textContent.trim()),
      err:q('[data-testid="checkout-error"]')?.textContent
    };
  });
  console.log('CHECKOUT',JSON.stringify(info,null,1));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
