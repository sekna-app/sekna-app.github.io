const { chromium } = require('/opt/node-tools/node_modules/playwright');const {page,go,O}=require('./shots2.js');
(async()=>{const b=await chromium.launch();const p=await page(b,390,844,2);
 const hide=()=>p.addStyleTag({content:'#bottomBar{display:none!important}'}).then(h=>h);
 for(const [n,m] of [['studio','one'],['compare','compare']]){
  await go(p,m=>{switchDashboardTab('months');setMonthMode(m)},m);
  // the bar alone, on a clear background
  await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(400);
  const bb=await p.$('#bottomBar');const r=await bb.boundingBox();
  const st=await p.addStyleTag({content:'html,body{background:transparent!important}body>*:not(#bottomBar){visibility:hidden!important}'});
  await p.screenshot({path:O+n+'-nav.png',omitBackground:true,clip:{x:0,y:r.y-14,width:390,height:844-(r.y-14)}});
  await st.evaluate(e=>e.remove());
  const h=await p.addStyleTag({content:'#bottomBar{display:none!important}'});await p.waitForTimeout(300);
  await p.screenshot({path:O+n+'.png',fullPage:true});await h.evaluate(e=>e.remove());
 }
 await b.close()})();
