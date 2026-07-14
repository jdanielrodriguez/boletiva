const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/cuenta',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2000);
  await clickText(p,'button','Métodos de pago'); await sleep(1200);
  await clickText(p,'button','Agregar'); await sleep(1000);
  const set=async(sel,val)=>{const el=await p.$(sel);if(el){await el.click({clickCount:3});await el.type(val);}};
  await set('#card-number','4242424242424242');
  await set('#card-exp-m','12');
  await set('#card-exp-y','30');
  await set('#card-cvc','123');
  // maybe name field
  const nameEl=await p.$('input[name*=name],#card-name'); if(nameEl){await nameEl.type('Cliente Demo');}
  await sleep(300);
  await p.screenshot({path:'/tmp/shots/33_filled.png',fullPage:true});
  // submit - find button inside form
  const clicked=await clickText(p,'button','Guardar tarjeta')||await clickText(p,'button','Guardar')||await clickText(p,'button','Agregar tarjeta');
  console.log('saveClicked',clicked);
  await sleep(3000);
  const body=await p.evaluate(()=>document.body.innerText.slice(0,500).replace(/\n+/g,' | '));
  console.log('AFTER',body);
  await p.screenshot({path:'/tmp/shots/34_saved.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
