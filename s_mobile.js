const {launch,newPage,login,sleep,clickText}=require('/app/lib.js');
(async()=>{
  const b=await launch(); const p=await newPage(b);
  await p.setViewport({width:390,height:844});
  await login(p);
  // purchase page mobile (seated)
  await p.goto('http://localhost:4200/eventos/evento-demo-pasaeventos/comprar',{waitUntil:'networkidle2',timeout:60000}); await sleep(2500);
  const ov1=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth}));
  console.log('PURCHASE_MOBILE overflow',ov1.sw>ov1.iw, JSON.stringify(ov1));
  await p.screenshot({path:'/tmp/shots/80_m_purchase.png',fullPage:true});
  // reserve GA then checkout
  await clickText(p,'button','General'); await sleep(400);
  for(let i=0;i<3;i++){const plus=await p.$('[data-testid="qty-plus"]');if(plus)await plus.click();await sleep(120);}
  const rb=await p.$('[data-testid="reserve-btn"]'); if(rb) await rb.click(); await sleep(5000);
  const ov2=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth}));
  console.log('RESERVED_MOBILE overflow',ov2.sw>ov2.iw, JSON.stringify(ov2));
  await p.screenshot({path:'/tmp/shots/81_m_reserved.png',fullPage:true});
  const pay=await p.$('[data-testid="pay-btn"]'); if(pay) await pay.click(); await sleep(6000);
  const ov3=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:window.innerWidth}));
  console.log('CHECKOUT_MOBILE overflow',ov3.sw>ov3.iw, JSON.stringify(ov3));
  await p.screenshot({path:'/tmp/shots/82_m_checkout.png',fullPage:true});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
