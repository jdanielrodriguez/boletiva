const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000}); await sleep(1500);
  // flag EN (client-side)
  await p.evaluate(()=>{const en=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||'').includes('English'));en&&en.click();});
  await sleep(2000);
  console.log('HOME_HEADING',await p.evaluate(()=>document.querySelector('h1,h2')?.textContent));
  // SPA navigate: click event card link
  const nav=await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(x=>/evento-demo|Demo/.test(x.getAttribute('href')||x.textContent));if(a){a.click();return a.getAttribute('href');}return null;});
  console.log('clickedEventLink',nav);
  await sleep(2500);
  console.log('DETAIL_HEADING',await p.evaluate(()=>document.querySelector('h1')?.textContent));
  const detailBody=await p.evaluate(()=>document.body.innerText.replace(/\n+/g,' | ').slice(0,300));
  console.log('DETAIL',detailBody);
  // click Comprar (SPA)
  await p.evaluate(()=>{const a=[...document.querySelectorAll('a,button')].find(x=>/Buy|Comprar|Get tickets|Purchase/i.test(x.textContent));a&&a.click();});
  await sleep(2500);
  console.log('PURCHASE_HEADING',await p.evaluate(()=>document.querySelector('h1')?.textContent));
  const reserveBtn=await p.evaluate(()=>document.querySelector('[data-testid="reserve-btn"]')?.textContent?.trim());
  const cartCount=await p.evaluate(()=>document.querySelector('.cart-count')?.textContent?.trim());
  console.log('reserveBtn',reserveBtn,'| cart',cartCount);
  await p.screenshot({path:'/tmp/shots/72_en_purchase_spa.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
