const {launch,newPage,login}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  const r=await login(p);
  console.log('LOGIN',JSON.stringify(r));
  await p.screenshot({path:'/tmp/shots/01_afterlogin.png'});
  const body=await p.evaluate(()=>document.body.innerText.slice(0,400));
  console.log('BODY:',body.replace(/\n+/g,' | '));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
