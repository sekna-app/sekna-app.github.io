const { chromium } = require('/opt/node-tools/node_modules/playwright');const fs=require('fs');const S=__dirname,O=S+'/shots2/';
const DT=process.env.DT||'';
async function page(b,w,h,d){const c=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:d});const p=await c.newPage();
 if(DT)await p.addInitScript(t=>{const T=Date.parse(t+'T10:00:00Z'),O=Date,d=O.now()-T;class D extends O{constructor(...a){a.length?super(...a):super(O.now()-d)}static now(){return O.now()-d}};window.Date=D},DT);
 await p.goto('file:///home/user/sekna-app.github.io/source/Index.html');await p.waitForTimeout(3500);
 await eval('(async()=>{'+fs.readFileSync(S+'/setup.txt','utf8')+'})()');await p.evaluate(()=>{try{MONTH_EXTRA[CURRENT_ACCOUNT]=MONTH_EXTRA[CURRENT_ACCOUNT]||{months:{}}}catch(e){};['skSplash','ssRem','tour'].forEach(i=>document.getElementById(i)?.remove())});
 await p.addStyleTag({content:'.reveal-card,.motion-pop{opacity:1!important;transform:none!important}'});return p}
async function warm(p){for(let y=0;y<6000;y+=450){await p.evaluate(y=>window.scrollTo(0,y),y);await p.waitForTimeout(150)}await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(1800)}
async function go(p,fn,a){await p.evaluate(fn,a);await p.waitForTimeout(700);await warm(p);await p.evaluate(()=>document.getElementById('ssRem')?.remove())}
module.exports={page,warm,go,O};
if(require.main===module)(async()=>{const b=await chromium.launch();const mode=process.argv[2];
 if(mode==='phone'){const p=await page(b,390,844,2);
  await go(p,()=>{document.body.classList.add('dark-mode');switchDashboardTab('overview')});await p.screenshot({path:O+'home-dark.png'});await p.evaluate(()=>document.body.classList.remove('dark-mode'));await go(p,()=>switchDashboardTab('overview'));await p.screenshot({path:O+'home.png'});
  await p.evaluate(()=>{const t=[...document.querySelectorAll('.section-title')].find(x=>/Campaign Type/.test(x.textContent));if(t)t.closest('section').scrollIntoView({block:'start'});window.scrollBy(0,-80)});await p.waitForTimeout(1500);await p.screenshot({path:O+'types.png'});
  await p.evaluate(()=>{const t=[...document.querySelectorAll('.section-title')].find(x=>/Same Day Last Year/.test(x.textContent));if(t)t.closest('section').scrollIntoView({block:'start'});window.scrollBy(0,-80)});await p.waitForTimeout(1500);await p.screenshot({path:O+'yoy.png'});
  await go(p,()=>{switchDashboardTab('days');setDayView('results')});await p.screenshot({path:O+'results.png'});
  await go(p,()=>{switchDashboardTab('months');setMonthMode('one')});await p.screenshot({path:O+'studio.png',fullPage:true});
  await go(p,()=>{setMonthMode('compare')});await p.screenshot({path:O+'compare.png',fullPage:true});
  await go(p,()=>{switchDashboardTab('seasons')});await p.screenshot({path:O+'seasons.png'});
  for(const k of ['ramadan','last10','eidfitr','dhulhijjah','arafah','eidadha','ashura','thanksgiving','givingtuesday','yearend']){await p.evaluate(k=>{const t=ssToday(),L=ssList().filter(s=>s.to>=t&&ssDays(t,s.from)<=365);SS.f='all';SS.hf='all';SS.hi=Math.max(0,L.findIndex(s=>s.key===k));renderSeasons();window.scrollTo(0,0)},k);await p.waitForTimeout(1500);await p.screenshot({path:O+'ss-'+k+'.png'})}
  await go(p,()=>{switchDashboardTab('overview')});
  await p.evaluate(()=>{localStorage.clear();const real=ssGreetNow;window.ssGreetNow=()=>ssList().find(x=>x.key==='eidadha');ssGreet();window.ssGreetNow=real});await p.waitForTimeout(1500);await p.screenshot({path:O+'greet.png'});await p.evaluate(()=>ssGreetSet(true));await p.waitForTimeout(400);await p.screenshot({path:O+'greet-ar.png'});
  await b.close();return}
 if(mode==='desk'){const p=await page(b,1440,900,1);
  for(const [n,t] of [['desk-daily','overview'],['desk-days','days'],['desk-month','channel'],['desk-studio','months'],['desk-seasons','seasons']]){await go(p,t=>{switchDashboardTab(t);if(t==='days')setDayView('plan');if(t==='months')setMonthMode('one')},t);await p.screenshot({path:O+n+'.png',fullPage:true})}
  await b.close()}
})();
