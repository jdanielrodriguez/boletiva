const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  const r=await login(p);
  console.log('LOGIN',JSON.stringify(r));
  // go to event detail
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2500);
  await p.screenshot({path:'/tmp/shots/10_detalle.png',fullPage:true});
  let body=await p.evaluate(()=>document.body.innerText.slice(0,600));
  console.log('DETALLE:',body.replace(/\n+/g,' | '));
  // click comprar / reservar button
  const clicked = await clickText(p,'a','Comprar')|| await clickText(p,'button','Comprar')|| await clickText(p,'a','Reservar')|| await clickText(p,'button','Reservar')|| await clickText(p,'a','boleto');
  console.log('clickedComprar',clicked);
  await sleep(3500);
  console.log('URL now',p.url());
  await p.screenshot({path:'/tmp/shots/11_comprar.png',fullPage:true});
  body=await p.evaluate(()=>document.body.innerText.slice(0,800));
  console.log('COMPRAR:',body.replace(/\n+/g,' | '));
  await b.close();
})().catch(e=>{console.error('ERR',e.message,e.stack);process.exit(1)});
