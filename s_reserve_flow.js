const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  // ensure General tab
  await clickText(p,'button','General');
  await sleep(800);
  // click + 13 times
  for(let i=0;i<13;i++){
    const plus=await p.$('[data-testid="qty-plus"]');
    if(plus) await plus.click();
    await sleep(120);
  }
  const qty=await p.evaluate(()=>document.querySelector('[data-testid="qty-value"]')?.textContent);
  console.log('qty selected',qty);
  await p.screenshot({path:'/tmp/shots/13_selected.png'});
  // Reservar
  const rb=await p.$('[data-testid="reserve-btn"]');
  if(rb) await rb.click();
  await sleep(6000);
  console.log('URL',p.url());
  const reserved=await p.evaluate(()=>!!document.querySelector('[data-testid="reserved"]'));
  console.log('reservedPhase',reserved);
  await p.screenshot({path:'/tmp/shots/14_reserved.png',fullPage:true});
  const info=await p.evaluate(()=>{
    const pager=document.querySelector('[data-testid="reservation-items-pager"]');
    const cd=document.querySelector('[data-testid="countdown"]');
    const payBtn=document.querySelector('[data-testid="pay-btn"]');
    const rows=document.querySelectorAll('.res-group li').length;
    return {pager:!!pager, pagerAria:pager?.getAttribute('aria-label')||pager?.querySelector('[aria-label]')?.getAttribute('aria-label'),
      cd:cd?.getAttribute('aria-label'), cdText:cd?.textContent?.trim(),
      payAria:payBtn?.getAttribute('aria-label'), payTitle:payBtn?.getAttribute('title'),
      rowsVisible:rows, err:document.querySelector('[data-testid="purchase-error"]')?.textContent};
  });
  console.log('RESERVED_INFO',JSON.stringify(info));
  const body=await p.evaluate(()=>document.body.innerText.slice(0,700));
  console.log('BODY',body.replace(/\n+/g,' | '));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
