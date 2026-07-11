const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/cuenta',{waitUntil:'networkidle2',timeout:60000});
  await sleep(2000);
  await clickText(p,'button','Métodos de pago');
  await sleep(1500);
  await p.screenshot({path:'/tmp/shots/31_methods.png',fullPage:true});
  const body=await p.evaluate(()=>document.body.innerText.slice(0,500).replace(/\n+/g,' | '));
  console.log('METHODS',body);
  // find add button
  const clicked=await clickText(p,'button','Agregar')|| await clickText(p,'button','Añadir')|| await clickText(p,'button','tarjeta');
  console.log('addClicked',clicked);
  await sleep(1200);
  // dump inputs
  const inputs=await p.evaluate(()=>[...document.querySelectorAll('input')].map(i=>({ph:i.placeholder,name:i.name,id:i.id,type:i.type})));
  console.log('INPUTS',JSON.stringify(inputs));
  await p.screenshot({path:'/tmp/shots/32_addform.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
