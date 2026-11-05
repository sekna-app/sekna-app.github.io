const {chromium}=require('/opt/node-tools/node_modules/playwright');const {page,go}=require('./shots2.js');const O=__dirname+'/shots3/';
const fake=()=>{const split=[['Search Brand',.10,6.2],['Search Non-Brand',.6,2.4],['Performance Max',.21,3.1],['Demand Gen',.06,1.4],['Video (YouTube)',.03,.6]];
 ['usa','ar'].forEach(a=>{const d=a===CURRENT_ACCOUNT?DASH_DATA:(getAccountCache(a)||{}).data;const h=(d&&d.history)||[];const ex={months:{},days:{},channels:split.map(x=>x[0])};
  h.forEach(m=>{const ch={};split.forEach(([n,s,r])=>{const sp=m.cost*s;ch[n]={spend:sp,clicks:sp/7.5,conversions:m.conversions*s*(r/2.6),value:sp*r*(m.value/m.cost)/2.6}});
   ex.months[m.month]={spend:m.cost,clicks:m.cost/7.6,impressions:m.cost*19,conversions:m.conversions,days:0,channels:ch}});MONTH_EXTRA[a]=ex})};
(async()=>{const b=await chromium.launch();
 const p=await page(b,390,844,2);await p.evaluate(fake);
 for(const [n,m] of [['studio','one'],['compare','compare']]){
  await go(p,m=>{switchDashboardTab('months');setMonthMode(m)},m);await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(500);
  const r=await (await p.$('#bottomBar')).boundingBox();
  const st=await p.addStyleTag({content:'html,body{background:transparent!important}body>*:not(#bottomBar){visibility:hidden!important}'});
  await p.screenshot({path:O+n+'-nav.png',omitBackground:true,clip:{x:0,y:r.y-14,width:390,height:844-(r.y-14)}});await st.evaluate(e=>e.remove());
  const h=await p.addStyleTag({content:'#bottomBar{display:none!important}'});await p.waitForTimeout(300);await p.screenshot({path:O+n+'.png',fullPage:true});await h.evaluate(e=>e.remove());
 }
 const d=await page(b,1440,900,1);await d.addStyleTag({content:'html,body{overflow-x:hidden!important}'});await d.evaluate(fake);
 for(const [n,t] of [['desk-daily','overview'],['desk-days','days'],['desk-month','channel'],['desk-studio','months'],['desk-seasons','seasons']]){
  await go(d,t=>{switchDashboardTab(t);if(t==='days')setDayView('plan');if(t==='months')setMonthMode('one')},t);await d.evaluate(()=>window.scrollTo(0,0));await d.waitForTimeout(500);
  const H=await d.evaluate(()=>{const h=document.documentElement.scrollHeight;['dkRail','dkPanel'].forEach(i=>{const e=document.getElementById(i);if(e){e.style.position='absolute';e.style.bottom='auto';e.style.height=h+'px'}});return h});await d.waitForTimeout(200);await d.screenshot({path:O+n+'.png',fullPage:true,clip:{x:0,y:0,width:1440,height:H}});await d.evaluate(()=>['dkRail','dkPanel'].forEach(i=>{const e=document.getElementById(i);if(e){e.style.position='';e.style.bottom='';e.style.height=''}}))}
 await b.close()})();
