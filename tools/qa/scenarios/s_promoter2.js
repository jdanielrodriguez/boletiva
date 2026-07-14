const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/conviertete-en-promotor',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await clickText(p,'button','Quiero ser promotor'); await sleep(1200);
  await clickText(p,'button','Sí, quiero continuar');
  await sleep(3500);
  await p.screenshot({path:'/tmp/shots/62_promoter_m2.png',fullPage:true});
  let m2=await p.evaluate(()=>{const d=document.querySelector('app-confirm-dialog,[role=dialog],.modal');return d?d.innerText.replace(/\n+/g,' | ').slice(0,600):document.body.innerText.replace(/\n+/g,' | ').slice(0,600);});
  console.log('MODAL2',m2);
  const btns=await p.evaluate(()=>[...document.querySelectorAll('[role=dialog] button, .modal button, app-confirm-dialog button')].map(x=>x.textContent.trim()));
  console.log('M2_BTNS',JSON.stringify(btns));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
