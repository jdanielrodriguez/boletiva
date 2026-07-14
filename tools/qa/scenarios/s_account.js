const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/cuenta',{waitUntil:'networkidle2',timeout:60000});
  await sleep(3000);
  await p.screenshot({path:'/tmp/shots/30_cuenta.png',fullPage:true});
  const tabs=await p.evaluate(()=>[...document.querySelectorAll('button,a,[role=tab]')].map(e=>e.textContent.trim()).filter(t=>t&&t.length<30));
  console.log('TABS',JSON.stringify([...new Set(tabs)]));
  const body=await p.evaluate(()=>document.body.innerText.slice(0,600).replace(/\n+/g,' | '));
  console.log('BODY',body);
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
