const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/cuenta?s=activos',{waitUntil:'networkidle2',timeout:60000});
  await sleep(4000);
  const tbtn=await p.$('[data-testid="ticket-transfer"]');
  console.log('transferBtn?',!!tbtn);
  if(tbtn) await tbtn.click();
  await sleep(1500);
  await p.screenshot({path:'/tmp/shots/50_transfer_m1.png',fullPage:true});
  let m1=await p.evaluate(()=>{const d=document.querySelector('app-ticket-transfer-modal');return d?d.innerText.replace(/\n+/g,' | ').slice(0,500):null;});
  console.log('MODAL1',m1);
  // buttons in modal
  const btns=await p.evaluate(()=>[...document.querySelectorAll('app-ticket-transfer-modal button')].map(b=>b.textContent.trim()));
  console.log('MODAL1_BTNS',JSON.stringify(btns));
  // click confirm/continuar
  const c=await clickText(p,'button','Continuar')||await clickText(p,'button','Transferir')||await clickText(p,'button','Entiendo')||await clickText(p,'button','Generar')||await clickText(p,'button','Sí');
  console.log('confirm1',c);
  await sleep(3500);
  await p.screenshot({path:'/tmp/shots/51_transfer_m2.png',fullPage:true});
  let m2=await p.evaluate(()=>{const d=document.querySelector('app-ticket-transfer-modal');return d?d.innerText.replace(/\n+/g,' | ').slice(0,600):null;});
  console.log('MODAL2',m2);
  const btns2=await p.evaluate(()=>[...document.querySelectorAll('app-ticket-transfer-modal button')].map(b=>b.textContent.trim()));
  console.log('MODAL2_BTNS',JSON.stringify(btns2));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
