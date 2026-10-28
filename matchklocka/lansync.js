/* LAN-synk (lansync.js) – speglar utvalda localStorage-nycklar mellan enheter via synk-hubben (bridge/bridge.js, ws://<hubb>/lan).
   AV som standard och ofarlig: utan hubb (t.ex. publika https-sajten, file://) gör skriptet ingenting – sidorna fungerar exakt som förut.
   PÅ automatiskt när sidan öppnats från hubben (http://<ip>:8787/…). Manuellt: ?lan=<host:port> (sparas) · ?lan=off (stänger av) · ?lan=auto (återställer).
   Sidorna ändras knappt: inkommande ändringar skrivs till localStorage och skickas som samma storage-/BroadcastChannel-händelser som sidorna redan lyssnar på.
   Konflikter: senaste skrivning vinner (tidsstämplar i hubbens tid). Klockans state (matchklocka_state_v1) får bara skrivas av Klocka (role=klocka).
   Klockskev: hubben ger serverns tid; Date.now()/new Date() utan argument korrigeras med mätt offset så att alla enheter räknar samma speltid.
   <script src="lansync.js" data-role="klocka|klient" data-indicator="1"> – indikator (liten ruta nere till vänster) bara på operatörssidor. ?landebug=1 visar den överallt. */
(()=>{
if(window.LANSYNC)return;
const SC=document.currentScript,DS=(SC&&SC.dataset)||{},ROLE=DS.role||'klient',PAGE=(location.pathname.split('/').pop()||'index').replace(/\.html$/,'');
const Q=new URLSearchParams(location.search);
let CFG=null;try{if(Q.has('lan')){const v=Q.get('lan').trim();if(v==='auto'||v==='')localStorage.removeItem('lansync_cfg');else localStorage.setItem('lansync_cfg',v);}CFG=localStorage.getItem('lansync_cfg')}catch(e){return}
if(CFG==='off')return;
if(location.protocol==='file:')return;
const origNow=Date.now.bind(Date);
let host=null,same=false;
if(CFG&&CFG!=='on'){host=CFG.replace(/^(https?|wss?):\/\//,'').replace(/\/.*$/,'');same=host===location.host}
else if(location.protocol==='http:'){host=location.host;same=true}
if(!host)return;
if(location.protocol==='https:'&&!/^(localhost|127\.0\.0\.1)(:|$)/.test(host))return; // webbläsaren blockerar ws:// till annan dator från https
const HTTP='http://'+host,WSU='ws://'+host+'/lan';
const KLOCKA_KEY='matchklocka_state_v1';
/* Vilka nycklar som delas (samma lista i hubben). Medvetet INTE: matchklocka_tv_v1 (TV-utgångens inställningar hör till den Klocka som kör bridgen), fullt_seen/tleft_seen (påminnelseflaggor per enhet). */
const SYNC=k=>typeof k==='string'&&(k===KLOCKA_KEY||k==='paisen_v1'||k==='paisen_override'||k==='skott_v1'||/^speakerapp_(protokoll|override|lineup)_/.test(k)||k==='matchklocka_reset_v1'||/^matchklocka_nrfix_v1_/.test(k)||/^publik_/.test(k));
const ls=localStorage,origSet=Storage.prototype.setItem,origRem=Storage.prototype.removeItem,origGet=Storage.prototype.getItem;
const gi=k=>{try{return origGet.call(ls,k)}catch(e){return null}};
/* ---------- tid: hubbens klocka ---------- */
let off=0,offSet=false,samples=[];
try{const o=sessionStorage.getItem('lansync_off');if(o!=null){off=+o||0;offSet=true}}catch(e){}
const now=()=>origNow()+off;
const setOff=(o,rtt)=>{samples.push({o,rtt});if(samples.length>6)samples.shift();const best=samples.reduce((a,b)=>b.rtt<a.rtt?b:a);
  if(!offSet||Math.abs(best.o-off)>25){off=Math.round(best.o);offSet=true;try{sessionStorage.setItem('lansync_off',String(off))}catch(e){}}};
/* ---------- meta (tidsstämpel per nyckel) ---------- */
let meta={};try{meta=JSON.parse(gi('lansync_meta'))||{}}catch(e){}
const saveMeta=()=>{try{origSet.call(ls,'lansync_meta',JSON.stringify(meta))}catch(e){}};
let applying=false,ws=null,wsOpen=false,status='conn',peers=0,tries=0,downSince=0,hubVer='',lastPong=0,rt=null,pingT=null;
const q=Object.create(null);let qt=0;
const send=o=>{if(!wsOpen)return false;try{ws.send(JSON.stringify(o));return true}catch(e){return false}};
function local(k,v){if(k===KLOCKA_KEY&&ROLE!=='klocka')return;const ts=now();meta[k]=ts;saveMeta();q[k]={v,ts};if(!qt)qt=setTimeout(flush,0)}
function flush(){qt=0;if(!wsOpen)return;for(const k in q){send({t:'set',k,v:q[k].v,ts:q[k].ts});delete q[k]}}
/* ---------- apply inkommande ---------- */
let bc=null;try{bc=new BroadcastChannel('matchklocka')}catch(e){}
function apply(k,v,ts){if(!SYNC(k))return;const cur=gi(k);meta[k]=ts;if(cur===v||(v==null&&cur==null)){saveMeta();return}
  applying=true;try{if(v==null)origRem.call(ls,k);else origSet.call(ls,k,v)}catch(e){}applying=false;saveMeta();
  try{dispatchEvent(new StorageEvent('storage',{key:k,oldValue:cur,newValue:v,storageArea:ls,url:location.href}))}catch(e){}
  if(k===KLOCKA_KEY&&bc&&v){try{bc.postMessage(JSON.parse(v))}catch(e){}}}
/* ---------- snapshot vid sidladdning (synkront, så att sidans egna skript ser rätt läge från start) ---------- */
let pre=false;
if(same){try{const x=new XMLHttpRequest(),t0=origNow();x.open('GET','/lan/snapshot?t='+t0,false);x.send();const t1=origNow();
  if(x.status===200){const j=JSON.parse(x.responseText);if(j&&j.hub){pre=true;hubVer=j.version||'';setOff(j.time-(t0+t1)/2,t1-t0);for(const k in j.items||{})apply(k,j.items[k].v,j.items[k].ts)}}}catch(e){}
  if(!pre&&!CFG)return} // sidan serveras inte av en hubb -> gör ingenting (ingen indikator, inga hooks)
/* Först nu (hubb bekräftad eller uttryckligen vald) ändras något i sidan: Date-korrigering och localStorage-hooks */
const D0=Date;
window.Date=new Proxy(D0,{construct(t,a,n){return a.length?Reflect.construct(t,a,n):new t(origNow()+off)},get(t,k,r){return k==='now'?()=>origNow()+off:Reflect.get(t,k,t)}});
Storage.prototype.setItem=function(k,v){origSet.call(this,k,v);if(this===ls&&!applying&&SYNC(k))local(k,String(v))};
Storage.prototype.removeItem=function(k){origRem.call(this,k);if(this===ls&&!applying&&SYNC(k))local(k,null)};
/* ---------- WebSocket ---------- */
function connect(){clearTimeout(rt);if(ws){try{ws.onopen=ws.onclose=ws.onerror=ws.onmessage=null;ws.close()}catch(e){}ws=null}wsOpen=false;
  let w;try{w=new WebSocket(WSU)}catch(e){later();return}ws=w;
  w.onopen=()=>{if(ws!==w)return;wsOpen=true;tries=0;downSince=0;lastPong=origNow();const items={};
    for(let i=0;i<ls.length;i++){const k=ls.key(i);if(!SYNC(k)||(k===KLOCKA_KEY&&ROLE!=='klocka'))continue;items[k]={v:gi(k),ts:meta[k]||0}}
    for(const k in q){if(q[k].v==null)items[k]={v:null,ts:q[k].ts};delete q[k]}send({t:'hello',role:ROLE,page:PAGE,id:ID,items});ping();draw()};
  w.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m.t==='snapshot'){hubVer=m.version||hubVer;if(m.time!=null)setOff(m.time-origNow(),400);for(const k in m.items)apply(k,m.items[k].v,m.items[k].ts);status='ok';draw()}
    else if(m.t==='set'){apply(m.k,m.v,m.ts)}
    else if(m.t==='pong'){lastPong=origNow();const t=origNow();setOff(m.s-(m.c+t)/2,t-m.c)}
    else if(m.t==='peers'){peers=m.n;draw()}};
  w.onclose=()=>{if(ws!==w)return;wsOpen=false;ws=null;status='retry';if(!downSince)downSince=origNow();draw();later()};w.onerror=()=>{}}
const ID=Math.random().toString(36).slice(2,8);
function later(){clearTimeout(rt);tries++;rt=setTimeout(connect,Math.min(3000,400*tries))}
function ping(){clearTimeout(pingT);if(wsOpen){send({t:'ping',c:origNow()});if(origNow()-lastPong>12000){try{ws.close()}catch(e){}}}pingT=setTimeout(ping,tries?2000:4000)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!wsOpen)connect()});
/* ---------- indikator (bara operatörssidor) ---------- */
let el=null;
function draw(){if(!(DS.indicator==='1'||Q.get('landebug')==='1'))return;if(!document.body){return}
  if(!el){const st=document.createElement('style');st.textContent='#lanind{position:fixed;left:6px;bottom:6px;z-index:2147483200;font:700 12px/1 system-ui,Arial,sans-serif;padding:5px 9px;border-radius:12px;pointer-events:none;letter-spacing:.3px;border:1px solid #0006;white-space:nowrap}#lanind.ok{background:#1f6f3a;color:#fff}#lanind.wait{background:#FFB000;color:#000}#lanind.off{background:#AF2E32;color:#fff;font-size:14px;padding:8px 12px;animation:lanbl 1s steps(1,end) infinite}@keyframes lanbl{50%{opacity:.35}}@media print{#lanind{display:none}}';document.head.appendChild(st);
    el=document.createElement('div');el.id='lanind';el.setAttribute('role','status');document.body.appendChild(el)}
  const down=downSince?origNow()-downSince:0;let c,t;
  if(wsOpen&&status==='ok'){c='ok';t='LAN ansluten'+(peers>1?' · '+peers+' enheter':'')}
  else if(downSince&&down>8000){c='off';t='LAN OFFLINE – ändringar delas inte'}
  else{c='wait';t=downSince?'LAN återansluter…':'LAN ansluter…'}
  if(el.className!==c)el.className=c;if(el.textContent!==t)el.textContent=t}
setInterval(draw,1000);addEventListener('DOMContentLoaded',draw);
window.LANSYNC={role:ROLE,page:PAGE,id:ID,host,get connected(){return wsOpen&&status==='ok'},get offset(){return off},get peers(){return peers},get hubVersion(){return hubVer},SYNC,meta:()=>meta};
connect();
})();
