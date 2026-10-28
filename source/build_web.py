"""Builds the HEMERA web page (sekna-app.github.io) from the same dashboard file Apps Script serves."""
import sys, re
src, out = sys.argv[1], sys.argv[2]
API = 'https://script.google.com/macros/s/AKfycbzjgZ1nXxLTcFdeFCIEznOj2H0XCo9YGUeu1YF2pJdsQiOo_aM-Mn6HxKKNk8peEuM1Ig/exec'
# The HEMERA server on Firebase answers the dashboard data; Apps Script stays as the backup.
# While FB_PRIMARY is off, only an admin who turns it on for their own device uses Firebase.
FB = 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/api'
FB_PRIMARY = 'true'
# Accounts confirmed to give the same numbers on Firebase. The others stay on Apps Script.
FB_ACCOUNTS = '{usa:1,ar:1}'
h = open(src).read()

head = '''<meta name="theme-color" content="#203C8E">
  <meta name="description" content="HEMERA — media planning, campaign monitoring and reporting in one place.">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" type="image/png" href="icons/favicon-64.png">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="HEMERA">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <script src="firebase-config.js"></script>
  <script>
  (function(){
   var API=%s, FB=%s, FB_PRIMARY=%s, FB_ACCOUNTS=%s;
   // Firebase first for these, Apps Script for everything else. w: how long to wait,
   // a/t: where the account and the token are in the arguments, data: counts as the data server
   // (its failures move this device to the backup and are logged).
   var FB_FNS={
    // Refresh reads the sheet itself (outside the reading window it can take a while).
    getDashboardData:{w:50000,a:0,t:2,data:1},
    getMonthCompareData:{w:45000,a:0,t:1,data:1},
    adminArchiveStatus:{w:60000,a:1,t:0},
    getForecast:{w:45000,a:0,t:2},getMonthVsLy:{w:45000,a:0,t:2},getSearchTerms:{w:45000,a:0,t:2},forecastSet:{w:45000,a:0,t:2},getAssumptions:{w:45000,a:0,t:2},assumeSet:{w:45000,a:0,t:2},
    // Longer than the server's own limit (120 s), so Apps Script never runs a move at the same time.
    adminArchiveMove:{w:130000,a:1,t:0},
    adminArchiveProgress:{w:15000,a:1,t:0},
    adminReadWindow:{w:20000,t:0},adminReadWindowSet:{w:20000,t:0},
    // Team Tasks: the server answers (it passes calls to Apps Script until the admin moves them).
    // tk: once this device has seen them on the server, never fall back to the old sheet.
    tasksLoad:{w:25000,t:0,tk:1},taskSave:{w:45000,t:0,tk:1},taskPhoto:{w:25000,t:0,tk:1},seasonsInfo:{w:20000,t:0,tk:1},seasonGoalSet:{w:20000,t:0,tk:1},taskDelete:{w:25000,t:0,tk:1},taskDone:{w:25000,t:0,tk:1},
    tasksCopyMonth:{w:30000,t:0,tk:1},tasksSendWeek:{w:90000,t:0,tk:1},leaveFreezeSet:{w:25000,t:0,tk:1},
    adminSetMember:{w:25000,t:0,tk:1},teamStatus:{w:15000,t:0,tk:1},adminTasksMove:{w:120000,t:0,tk:2},adminTasksMoveStatus:{w:15000,t:0,tk:2},
    // Sign-in, devices and app state: same rule, with their own "moved" mark.
    accessRequestCode:{w:30000,tk:1,k:'sekna_access_fb'},accessVerifyCode:{w:30000,tk:1,k:'sekna_access_fb'},accessStatus:{w:20000,tk:1,k:'sekna_access_fb'},
    accessSignOut:{w:20000,tk:1,k:'sekna_access_fb'},adminOverview:{w:30000,tk:1,k:'sekna_access_fb'},adminSetStatus:{w:30000,tk:1,k:'sekna_access_fb'},
    adminInvite:{w:30000,tk:1,k:'sekna_access_fb'},adminDelete:{w:30000,tk:1,k:'sekna_access_fb'},adminGetAppState:{w:20000,tk:1,k:'sekna_access_fb'},
    adminSetMaintenance:{w:30000,tk:1,k:'sekna_access_fb'},adminPublishAnnouncement:{w:45000,tk:1,k:'sekna_access_fb'},adminClearAnnouncement:{w:30000,tk:1,k:'sekna_access_fb'},
    adminClearRecent:{w:20000,tk:1,k:'sekna_access_fb'},adminPerms:{w:20000,tk:1,k:'sekna_access_fb'},adminPermsSet:{w:20000,tk:1,k:'sekna_access_fb'},adminAccessMove:{w:120000,tk:2},adminAccessMoveStatus:{w:15000,tk:2},
    // Usage, shares, ideas, plan history, the monthly report and web notifications.
    logShare:{w:20000,tk:1,k:'sekna_rest_fb'},adminShareStats:{w:30000,tk:1,k:'sekna_rest_fb'},adminResetShares:{w:30000,tk:1,k:'sekna_rest_fb'},
    logUsage:{w:20000,tk:1,k:'sekna_rest_fb'},adminActivity:{w:30000,tk:1,k:'sekna_rest_fb'},adminResetActivity:{w:60000,tk:1,k:'sekna_rest_fb'},
    submitIdea:{w:30000,tk:1,k:'sekna_rest_fb'},myNotifications:{w:20000,tk:1,k:'sekna_rest_fb'},adminCelebrate:{w:30000,tk:1,k:'sekna_rest_fb'},myCelebration:{w:15000,tk:1,k:'sekna_rest_fb'},celebrationLatest:{w:15000,tk:1,k:'sekna_rest_fb'},celebrationSeen:{w:15000,tk:1,k:'sekna_rest_fb'},celebrationReact:{w:15000,tk:1,k:'sekna_rest_fb'},dayReactions:{w:15000,tk:1,k:'sekna_rest_fb'},dayReact:{w:15000,tk:1,k:'sekna_rest_fb'},fxRates:{w:20000,tk:1,k:'sekna_rest_fb'},adminFxTime:{w:20000,tk:1,k:'sekna_rest_fb'},adminFxTimeSet:{w:20000,tk:1,k:'sekna_rest_fb'},myIdeas:{w:20000,tk:1,k:'sekna_rest_fb'},adminIdeas:{w:20000,tk:1,k:'sekna_rest_fb'},adminIdeaUpdate:{w:30000,tk:1,k:'sekna_rest_fb'},
    adminSavePlanHistory:{w:60000,tk:1,k:'sekna_rest_fb'},getPlanHistory:{w:20000,tk:1,k:'sekna_rest_fb'},webPushSubscribe:{w:30000,tk:1,k:'sekna_rest_fb'},
    adminReportRecipients:{w:30000,tk:1,k:'sekna_rest_fb'},adminSendMonthlyReport:{w:300000,tk:1,k:'sekna_rest_fb'},adminRestMove:{w:120000,tk:2},adminRestMoveStatus:{w:20000,tk:2}
   };
   var SRV=window.SEKNA_SERVER={primary:FB_PRIMARY,mode:'appsscript',since:0,reason:'',hold:0,ms:0};
   function load(k){try{return localStorage.getItem(k)}catch(e){return null}}
   function save(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch(e){}}
   // The "This device" test switch (Admin → Server) lasts one hour, then the device is back on Automatic.
   // A switch saved without a time (older versions) is cleared at once.
   function dev(){
    var v=load('sekna_fb_device'), at=+load('sekna_fb_device_at')||0;
    if(v&&(!at||Date.now()-at>60*60000)){save('sekna_fb_device',null);save('sekna_fb_device_at',null);return null}
    return v;
   }
   function fbWanted(account){
    var t=dev();
    if(t==='firebase')return true;
    if(t==='appsscript')return false;
    return FB_PRIMARY&&(account===undefined||!!FB_ACCOUNTS[String(account||'usa').toLowerCase()]);
   }
   function asCall(name,args){
    return fetch(API,{method:'POST',body:JSON.stringify({action:'call',fn:name,args:args}),redirect:'follow'})
     .then(function(r){if(!r.ok)throw new Error('The HEMERA server did not answer ('+r.status+'). Please try again.');return r.json()})
     .then(function(j){if(!j||!j.ok)throw new Error((j&&j.error)||'The HEMERA server did not answer. Please try again.');return j.result});
   }
   function fbPost(path,body,wait){
    var ctl=window.AbortController?new AbortController():null, t0=Date.now();
    var timer=setTimeout(function(){if(ctl)ctl.abort()},wait||20000);
    return fetch(FB+path,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(body),signal:ctl?ctl.signal:undefined})
     .then(function(r){if(!r.ok){var x=new Error('Firebase answered '+r.status);x.net=true;throw x}return r.json()},
           function(e){var x=new Error(e&&e.name==='AbortError'?'Firebase took too long to answer':'Firebase could not be reached');x.net=true;throw x})
     .then(function(j){
       clearTimeout(timer);
       if(j&&j.ok){SRV.ms=Date.now()-t0;
        if(j.moved){if(j.moved.tasks)save('sekna_tasks_fb','1');if(j.moved.access)save('sekna_access_fb','1');if(j.moved.rest)save('sekna_rest_fb','1')}
        return j.result}
       var e=new Error((j&&j.error)||'Firebase did not answer');e.access=!!(j&&j.access);throw e;
     },function(e){clearTimeout(timer);throw e});
   }
   function report(kind,reason,token){
    if(!token)return;
    var key='sekna_srv_report_'+kind, last=+load(key)||0;
    if(Date.now()-last<30*60000)return;
    save(key,String(Date.now()));
    var device=navigator.userAgent.slice(0,120);
    // The log lives on the server; when the server cannot take it, Apps Script keeps it in the sheet.
    fbPost('/event',{token:token,kind:kind,reason:reason,device:device},15000)
     .catch(function(){return asCall('reportServerEvent',[token,kind,reason,device])}).catch(function(){});
   }
   function setMode(mode,reason,token){
    var was=SRV.mode;
    if(mode!==was){SRV.mode=mode;SRV.since=Date.now();SRV.reason=reason||''}
    if(mode==='backup'&&was!=='backup')report('backup',reason,token);
    if(mode==='firebase'&&load('sekna_srv_on_backup')==='1')report('firebase','',token);
    save('sekna_srv_on_backup',mode==='backup'?'1':null);
    try{window.dispatchEvent(new Event('sekna-server'))}catch(e){}
   }
   // v170: the backup is kept only while the server really is down. One quick check before moving,
   // a short hold (1 minute, not 5), and a check every 30 seconds that brings the device straight back.
   function alive(){
    var ctl=window.AbortController?new AbortController():null,t=setTimeout(function(){if(ctl)ctl.abort()},5000);
    return fetch(FB+'/ping',{cache:'no-store',signal:ctl?ctl.signal:undefined}).then(function(r){clearTimeout(t);return r.ok},function(){clearTimeout(t);return false});
   }
   var backTimer=null;
   function goBackup(reason,token){
    SRV.hold=Date.now()+60000;setMode('backup',reason,token);
    if(backTimer)return;
    backTimer=setInterval(function(){
     if(SRV.mode!=='backup'){clearInterval(backTimer);backTimer=null;return}
     alive().then(function(up){if(up){SRV.hold=0;clearInterval(backTimer);backTimer=null;setMode('firebase','',token)}});
    },30000);
   }
   function call(name,args){
    var f=FB_FNS[name];
    // Team Tasks: the server first; the old sheet only if the server cannot be reached before the move.
    // Once a part has moved to the server, the test switch never sends it back to the old sheet.
    var mk=f&&(f.k||'sekna_tasks_fb');
    if(f&&f.tk&&(dev()!=='appsscript'||load(mk)==='1')){
     return fbPost('/call',{fn:name,args:args},f.w).then(function(r){
      if(r&&r.store==='firebase')save('sekna_tasks_fb','1');
      if(r&&r.dashboard&&r.dashboard.version==='server')save('sekna_access_fb','1');
      return r},function(e){
      if(f.tk===2||!e.net||load(mk)==='1')throw e;
      return asCall(name,args);
     });
    }
    if(f&&fbWanted(args[f.a])&&(!f.data||Date.now()>SRV.hold)){
     var token=args[f.t];
     return fbPost('/call',{fn:name,args:args},f.w).then(function(r){if(f.data)setMode('firebase','',token);return r},function(e){
      // A move the server refused on purpose is shown as it is, never repeated on Apps Script.
      if(name==='adminArchiveMove'&&/Another move is running|did not save every row/.test(e.message))throw e;
      // An access answer is not a server failure: Apps Script decides it.
      if(!f.data||e.access)return asCall(name,args);
      // A blip is not an outage: check the server once; if it answers, ask it again instead of moving to the backup.
      return alive().then(function(up){
       if(up)return fbPost('/call',{fn:name,args:args},f.w).then(function(r){setMode('firebase','',token);return r},function(e2){
         if(e2.access)throw e2;goBackup(e2.message,token);return asCall(name,args)});
       goBackup(e.message,token);return asCall(name,args);
      });
     });
    }
    // An account that stays on Apps Script (AR, also loaded in the background) does not change this device's status.
    if(f&&f.data&&dev()==='appsscript'&&SRV.mode!=='appsscript'){SRV.mode='appsscript';SRV.since=Date.now()}
    return asCall(name,args);
   }
   window.SEKNA_FB={
    post:fbPost,
    wanted:fbWanted,
    device:function(v){if(v!==undefined){save('sekna_fb_device',v&&v!=='auto'?v:null);save('sekna_fb_device_at',v&&v!=='auto'?String(Date.now()):null);SRV.hold=0}return dev()||'auto'},
    retry:function(){SRV.hold=0}
   };
   function runner(ok,fail){
    return new Proxy({},{get:function(_,key){
     if(key==='withSuccessHandler')return function(f){return runner(f,fail)};
     if(key==='withFailureHandler')return function(f){return runner(ok,f)};
     return function(){var a=Array.prototype.slice.call(arguments);call(key,a).then(function(r){ok&&ok(r)},function(e){fail&&fail(e)})};
    }});
   }
   // Inside the HEMERA Android app the native bridge handles notifications, so web push stays off.
   window.SEKNA_WEB=!window.AndroidShare;
   window.google={script:{run:runner()}};
  })();
  </script>
''' % ('"' + API.replace('/', '\\/') + '"', '"' + FB.replace('/', '\\/') + '"', FB_PRIMARY, FB_ACCOUNTS)

i = h.index('<title>HEMERA</title>')
h = h[:i] + '<title>HEMERA</title>\n  ' + head + h[i + len('<title>HEMERA</title>'):]

sw = '''<script>
if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}
</script>
</body>'''
assert h.count('</body>') == 1
h = h.replace('</body>', sw)
open(out, 'w').write(h)
print('web build', len(h))
