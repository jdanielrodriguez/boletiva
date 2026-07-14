const {launch,newPage,login,sleep,clickText}=require('/app/tools/qa/scenarios/lib.js');
const fs=require('fs');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  let token=null; const medias=[]; let ticketsJson=null;
  await p.setRequestInterception(true);
  p.on('request',r=>{const h=r.headers();if(h.authorization&&h.authorization.startsWith('Bearer'))token=h.authorization;r.continue();});
  p.on('response',async res=>{const u=res.url();
    try{
      if(/\/api\/v1\/tickets\?/.test(u)&&res.status()===200){ticketsJson=await res.json();}
      if(/\/tickets\/[^/]+\/media/.test(u)&&res.status()===200){medias.push(await res.json());}
    }catch(e){}
  });
  await login(p);
  await p.goto('http://localhost:4200/cuenta?s=activos',{waitUntil:'networkidle2',timeout:60000});
  await sleep(4000);
  console.log('TOKEN?',!!token);
  const ids=(ticketsJson?.items||ticketsJson||[]).map(t=>({id:t.id,serial:t.serial,status:t.status,mediaReady:t.mediaReady}));
  console.log('TICKETS',JSON.stringify(ids.slice(0,6)));
  console.log('MEDIAS',JSON.stringify(medias.slice(0,3)));
  fs.writeFileSync('/tmp/token.txt',token||'');
  fs.writeFileSync('/tmp/medias.json',JSON.stringify(medias));
  fs.writeFileSync('/tmp/tickets.json',JSON.stringify(ids));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
