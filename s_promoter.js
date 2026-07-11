const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  // click footer link
  await p.goto('http://localhost:4200/conviertete-en-promotor',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await p.screenshot({path:'/tmp/shots/60_promoter_landing.png',fullPage:true});
  let body=await p.evaluate(()=>document.body.innerText.replace(/\n+/g,' | ').slice(0,600));
  console.log('LANDING',body);
  // click the CTA to open modal
  const c=await clickText(p,'button','promotor')||await clickText(p,'button','Solicitar')||await clickText(p,'button','Quiero')||await clickText(p,'button','Comenzar')||await clickText(p,'button','Empezar');
  console.log('ctaClicked',c);
  await sleep(1500);
  await p.screenshot({path:'/tmp/shots/61_promoter_m1.png',fullPage:true});
  let m1=await p.evaluate(()=>{const d=document.querySelector('app-confirm-dialog,[role=dialog],.modal');return d?d.innerText.replace(/\n+/g,' | ').slice(0,600):'NO_MODAL';});
  console.log('MODAL1',m1);
  const btns=await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] button, .modal button, app-confirm-dialog button')].map(x=>x.textContent.trim()));
  console.log('M1_BTNS',JSON.stringify(btns));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
