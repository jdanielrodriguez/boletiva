const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await clickText(p,'button','General'); await sleep(600);
  for(let i=0;i<2;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(150);}
  (await p.$('[data-testid="reserve-btn"]'))?.click&&await (await p.$('[data-testid="reserve-btn"]')).click(); await sleep(5000);
  const pb=await p.$('[data-testid="pay-btn"]'); if(pb) await pb.click(); await sleep(6000);
  const orderId=p.url().split('/checkout/')[1];
  console.log('orderId',orderId);
  // select saved card + fill CVV
  const sc=await p.$('[data-testid="pay-saved-card"]'); if(sc) await sc.click(); await sleep(500);
  const cvv=await p.$('[data-testid="saved-cvv"]'); if(cvv) await cvv.type('123'); await sleep(400);
  // click pay confirm
  const pc=await p.$('[data-testid="pay-confirm"]');
  console.log('payConfirmDisabled',await p.evaluate(el=>el?.disabled,pc));
  if(pc) await pc.click();
  // wait for paid state
  let paid=false,url='';
  for(let i=0;i<20;i++){
    await sleep(1500);
    url=p.url();
    const st=await p.evaluate(()=>({paid:!!document.querySelector('[data-testid="status-paid"]'),redirect:document.querySelector('[data-testid="paid-redirect"]')?.textContent,awaiting:!!document.querySelector('[data-testid="awaiting"]')}));
    if(i%2===0)console.log('t'+i,url,JSON.stringify(st));
    if(st.paid){paid=true; await p.screenshot({path:'/tmp/shots/40_paid.png',fullPage:true});}
    if(!url.includes('/checkout/')){console.log('REDIRECTED to',url);break;}
  }
  await sleep(2000);
  console.log('FINAL URL',p.url());
  await p.screenshot({path:'/tmp/shots/41_boletos.png',fullPage:true});
  const body=await p.evaluate(()=>document.body.innerText.slice(0,700).replace(/\n+/g,' | '));
  console.log('BODY',body);
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
