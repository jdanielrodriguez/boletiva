const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  // click Mesas VIP locality tab
  await clickText(p,'button','Mesas VIP');
  await sleep(3000);
  await p.screenshot({path:'/tmp/shots/12_seated.png',fullPage:true});
  let body=await p.evaluate(()=>document.body.innerText.slice(0,900));
  console.log('SEATED:',body.replace(/\n+/g,' | '));
  // dump aria-labels / titles of buttons on page
  const btns=await p.evaluate(()=>[...document.querySelectorAll('button,[role=button],a')].map(b=>({t:(b.textContent||'').trim().slice(0,20),al:b.getAttribute('aria-label'),ti:b.getAttribute('title')})).filter(x=>x.al||x.ti||!x.t));
  console.log('BTNS',JSON.stringify(btns).slice(0,1200));
  const pager=await p.evaluate(()=>!!document.querySelector('app-pager, .pager, [class*=pager]'));
  console.log('hasPager',pager);
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
