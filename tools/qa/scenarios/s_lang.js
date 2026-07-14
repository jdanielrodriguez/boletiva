const {launch,newPage,login,sleep}=require('/app/tools/qa/scenarios/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await login(p);
  await p.goto('http://localhost:4200/',{waitUntil:'networkidle2',timeout:60000});
  await sleep(1500);
  const before=await p.evaluate(()=>document.querySelector('nav,header')?.innerText?.replace(/\n+/g,' '));
  console.log('BEFORE',before);
  // find EN button and its tag
  const eninfo=await p.evaluate(()=>{
    const els=[...document.querySelectorAll('button,a')];
    const en=els.find(e=>(e.getAttribute('aria-label')||'').includes('English'));
    return en?{tag:en.tagName,txt:en.textContent.trim(),al:en.getAttribute('aria-label'),disabled:en.disabled}:'NOT_FOUND';
  });
  console.log('EN_BTN',JSON.stringify(eninfo));
  // click via DOM
  await p.evaluate(()=>{const en=[...document.querySelectorAll('button,a')].find(e=>(e.getAttribute('aria-label')||'').includes('English'));en&&en.click();});
  await sleep(2500);
  const after=await p.evaluate(()=>document.querySelector('nav,header')?.innerText?.replace(/\n+/g,' '));
  console.log('AFTER',after);
  const ls=await p.evaluate(()=>({lang:localStorage.getItem('lang')||localStorage.getItem('language')||localStorage.getItem('pe_lang'), keys:Object.keys(localStorage)}));
  console.log('LS',JSON.stringify(ls));
  const heading=await p.evaluate(()=>document.querySelector('h1,h2')?.textContent?.trim());
  console.log('HEADING',heading);
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
