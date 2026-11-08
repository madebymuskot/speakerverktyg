/* LAN-synk (lansync.js) – speglar utvalda localStorage-nycklar mellan enheter via synk-hubben (bridge/bridge.js, ws://<hubb>/lan).
   AV som standard och ofarlig: utan hubb (t.ex. publika https-sajten, file://) gör skriptet ingenting – sidorna fungerar exakt som förut.
   PÅ automatiskt när sidan öppnats från hubben (http://<ip>:8787/…). Manuellt: ?lan=<host:port> (sparas) · ?lan=off (stänger av) · ?lan=auto (återställer).
   Sidorna ändras knappt: inkommande ändringar skrivs till localStorage och skickas som samma storage-/BroadcastChannel-händelser som sidorna redan lyssnar på.
   Konflikter: senaste skrivning vinner (tidsstämplar i hubbens tid). Klockans state (matchklocka_state_v1) får bara skrivas av Klocka (role=klocka).
   Klockskev: hubben ger serverns tid; Date.now()/new Date() utan argument korrigeras med mätt offset så att alla enheter räknar samma speltid.
   <script src="lansync.js" data-role="klocka|klient" data-indicator="1"> – indikator (liten ruta nere till vänster) bara på operatörssidor. ?landebug=1 visar den överallt.
   En-instans-spärr: hubben tillåter bara EN öppen Klocka, Speaker, Skott/innehav och På isen per lag (OVR och visningsskärmar obegränsat). Nekad sida får {t:'busy'} och visar en heltäckande ruta ('Försök igen' + automatiska försök var 3:e s); hubben ignorerar all skrivning från den. Samma flik som laddas om känns igen på cid (sessionStorage) och tar tillbaka sin plats direkt. Utan hubb (file://, ingen LAN) görs inget av detta.
   Puls (heartbeat): hubben skickar {t:'hb'} varje sekund med Klockas fulla läge. Klient som inte hört något på HB_TIMEOUT ms visar markeringen 'frånkopplad' (bara sidor med data-marker="1": omklädningsrum, domarskärm, jumbotron; aldrig NDI/TV/?ndi/?bg). Klockan fortsätter räkna lokalt (fryser inte); markeringen försvinner och läget synkas om när pulsen kommer tillbaka. */
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
const SYNC=k=>typeof k==='string'&&(k===KLOCKA_KEY||k==='paisen_v1'||k==='paisen_override'||k==='skott_v1'||k==='zon_v1'||/^speakerapp_(protokoll|override|lineup)_/.test(k)||k==='matchklocka_reset_v1'||/^matchklocka_nrfix_v1_/.test(k)||/^publik_/.test(k));
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
let lastHeard=origNow(),hbSeen=false;const HB_TIMEOUT=4500;
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
  w.onopen=()=>{if(ws!==w)return;wsOpen=true;tries=0;downSince=0;lastPong=origNow();sendHello();ping();draw()};
  w.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}lastHeard=origNow();
    if(m.t==='snapshot'){hubVer=m.version||hubVer;if(m.time!=null)setOff(m.time-origNow(),400);for(const k in m.items)apply(k,m.items[k].v,m.items[k].ts);status='ok';draw()}
    else if(m.t==='set'){apply(m.k,m.v,m.ts)}
    else if(m.t==='pong'){lastPong=origNow();const t=origNow();setOff(m.s-(m.c+t)/2,t-m.c)}
    else if(m.t==='hb'){hbSeen=true;if(m.k&&(ROLE!=='klocka'||busy)&&typeof m.k.v==='string'&&gi(KLOCKA_KEY)!==m.k.v){send({t:'resync'});/* admin-logg: meddelar hubben att detta läge avvek från Klocka */apply(KLOCKA_KEY,m.k.v,m.k.ts)}}
    else if(m.t==='peers'){peers=m.n;draw()}
    else if(m.t==='busy'){showBusy(m)}
    else if(m.t==='ok'){hideBusy(m.reload)}
    else if(m.t==='ledig'){if(busy)busyRetry()}};
  w.onclose=()=>{if(ws!==w)return;wsOpen=false;ws=null;status='retry';if(!downSince)downSince=origNow();draw();later()};w.onerror=()=>{}}
const ID=Math.random().toString(36).slice(2,8);
/* cid: flikens id (sessionStorage) – överlever omladdning så att hubben ger tillbaka platsen direkt */
let CID='';try{CID=sessionStorage.getItem('lansync_cid')||''}catch(e){}
if(!CID){CID=Math.random().toString(36).slice(2,12);try{sessionStorage.setItem('lansync_cid',CID)}catch(e){}}
function newCid(){CID=Math.random().toString(36).slice(2,12);try{sessionStorage.setItem('lansync_cid',CID)}catch(e){}}
function sendHello(){const items={};
  for(let i=0;i<ls.length;i++){const k=ls.key(i);if(!SYNC(k)||(k===KLOCKA_KEY&&ROLE!=='klocka'))continue;items[k]={v:gi(k),ts:meta[k]||0}}
  for(const k in q){if(q[k].v==null)items[k]={v:null,ts:q[k].ts};delete q[k]}
  return send({t:'hello',role:ROLE,page:PAGE,lag:Q.get('lag')||'',id:ID,cid:CID,items})}
/* ---------- en-instans-spärr: heltäckande ruta ---------- */
let busy=null,busyT=null,busyEl=null;
const TFMT=ms=>{try{return new Date(ms).toLocaleTimeString('sv-SE',{timeZone:'Europe/Stockholm',hour:'2-digit',minute:'2-digit'})}catch(e){return ''}};
function busyRetry(){clearTimeout(busyT);busyT=null;if(busy&&wsOpen)sendHello()}
function showBusy(m){busy=m;if(m.orsak==='overtagen')newCid(); /* samma flik-id används av den som tog över – byt, annars kapar vi tillbaka platsen */
  clearTimeout(busyT);busyT=m.manuell?null:setTimeout(busyRetry,3000);drawBusy()}
function hideBusy(reload){clearTimeout(busyT);busyT=null;const was=busy;busy=null;if(busyEl)busyEl.style.display='none';if(was&&reload){try{location.reload()}catch(e){}}}
function drawBusy(){if(!busy)return;if(!document.body){addEventListener('DOMContentLoaded',drawBusy,{once:true});return}
  if(!busyEl){const st=document.createElement('style');st.textContent='#lanbusy{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483600;background:#0b0b0b;color:#fff;display:flex;align-items:center;justify-content:center;padding:4vmin;font-family:-apple-system,Segoe UI,Roboto,system-ui,Arial,sans-serif;text-align:left;overflow:auto}#lanbusy .bx{max-width:760px;width:100%;background:#151515;border-left:10px solid #AF2E32;border-radius:14px;padding:5vmin}#lanbusy h1{margin:0 0 .5em;font-size:clamp(24px,4.4vmin,44px);line-height:1.15}#lanbusy .dv{font-size:clamp(17px,2.6vmin,26px);color:#ddd;margin:.2em 0}#lanbusy .dv b{color:#fff}#lanbusy .no{font-size:clamp(18px,2.8vmin,28px);font-weight:800;margin:.9em 0 .3em;color:#fff}#lanbusy .hint{font-size:clamp(13px,1.9vmin,18px);color:#9a9a9a;margin:.2em 0 1em}#lanbusy button{background:#222;color:#fff;border:1px solid #555;border-radius:8px;padding:.55em 1.1em;font:600 clamp(14px,2vmin,20px) inherit;font-family:inherit;cursor:pointer}#lanbusy button:hover{background:#AF2E32;border-color:#AF2E32}';document.head.appendChild(st);
    busyEl=document.createElement('div');busyEl.id='lanbusy';busyEl.setAttribute('role','alertdialog');busyEl.setAttribute('aria-modal','true');document.body.appendChild(busyEl);
    busyEl.addEventListener('click',e=>{if(e.target&&e.target.id==='lanbusy-retry'){e.target.disabled=true;setTimeout(()=>{e.target.disabled=false},1500);if(wsOpen)sendHello();else connect()}});
    for(const ev of['keydown','keyup','keypress'])addEventListener(ev,e=>{if(busy&&!(busyEl&&busyEl.contains(e.target))){e.stopImmediatePropagation();e.preventDefault()}},true)}
  const m=busy,esc=x=>String(x==null?'':x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  let det;if(m.orsak==='slappt')det='Platsen släpptes av en administratör.';
  else if(m.ip)det='Öppen på: <b>'+esc(m.enhet||'annan enhet')+'</b> ('+esc(m.ip)+')'+(m.sedan?' sedan '+esc(TFMT(m.sedan)):'');
  else det='Platsen hålls av en annan enhet.';
  busyEl.innerHTML='<div class="bx"><h1>'+esc(m.namn||'Sidan')+' är redan öppen på en annan enhet</h1><div class="dv">'+det+'</div><div class="no">Den här sidan kan inte öppnas.</div><div class="hint">'+(m.manuell?'Tryck på Försök igen när du vill ta över platsen.':'Väntar på att den blir ledig – försöker automatiskt var 3:e sekund.')+'</div><button id="lanbusy-retry" type="button">Försök igen</button></div>';
  busyEl.style.display='flex'}
function later(){clearTimeout(rt);tries++;rt=setTimeout(connect,Math.min(3000,400*tries))}
function ping(){clearTimeout(pingT);if(wsOpen){send({t:'ping',c:origNow(),off:offSet?off:null});if(origNow()-lastPong>12000){try{ws.close()}catch(e){}}}pingT=setTimeout(ping,tries?2000:4000)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!wsOpen)connect()});
/* ---------- indikator (bara operatörssidor) ---------- */
let el=null;
function draw(){if(!(DS.indicator==='1'||Q.get('landebug')==='1'))return;if(!document.body){return}
  if(!el){const st=document.createElement('style');st.textContent='#lanind{position:fixed;left:6px;bottom:6px;z-index:2147483200;font:700 12px/1 system-ui,Arial,sans-serif;padding:5px 9px;border-radius:12px;pointer-events:none;letter-spacing:.3px;border:1px solid #0006;white-space:nowrap}#lanind.ok{background:#1f6f3a;color:#fff}#lanind.wait{background:#FFB000;color:#000}#lanind.off{background:#AF2E32;color:#fff;font-size:14px;padding:8px 12px;animation:lanbl 1s steps(1,end) infinite}@keyframes lanbl{50%{opacity:.35}}@media print{#lanind{display:none}}';document.head.appendChild(st);
    el=document.createElement('div');el.id='lanind';el.setAttribute('role','status');document.body.appendChild(el)}
  const down=downSince?origNow()-downSince:0;let c,t;
  if(wsOpen&&status==='ok'&&!silent()){c='ok';t='LAN ansluten'+(peers>1?' · '+peers+' enheter':'')}
  else if(wsOpen&&status==='ok'){c='wait';t='LAN – ingen kontakt med hubben…'}
  else if(downSince&&down>8000){c='off';t='LAN OFFLINE – ändringar delas inte'}
  else{c='wait';t=downSince?'LAN återansluter…':'LAN ansluter…'}
  if(el.className!==c)el.className=c;if(el.textContent!==t)el.textContent=t}
/* ---------- 'frånkopplad'-markering (puls saknas) – bara sidor med data-marker="1" ---------- */
const silent=()=>(hbSeen||!wsOpen)&&origNow()-lastHeard>HB_TIMEOUT;
let mk=null,mkOn=false;
const wantMark=DS.marker==='1'&&!Q.has('ndi')&&!Q.has('bg');
function drawMark(){if(!wantMark||!document.body)return;const on=silent();if(on===mkOn&&(mk||!on))return;mkOn=on;
  if(!mk){const st=document.createElement('style');st.textContent='#lanmk{position:fixed;right:max(8px,.8vw);bottom:max(8px,.8vw);z-index:2147483300;font:700 clamp(12px,1.2vw,20px)/1 system-ui,Arial,sans-serif;padding:.45em .8em;border-radius:1em;background:rgba(175,46,50,.88);color:#fff;pointer-events:none;white-space:nowrap;border:1px solid #0006}#lanmk::before{content:"●";margin-right:.45em;animation:lanmkb 1.2s steps(1,end) infinite}@keyframes lanmkb{50%{opacity:.25}}@media print{#lanmk{display:none}}';document.head.appendChild(st);
    mk=document.createElement('div');mk.id='lanmk';mk.setAttribute('role','status');mk.textContent='frånkopplad';document.body.appendChild(mk)}
  mk.style.display=on?'':'none'}
setInterval(()=>{draw();if(busy&&!wsOpen&&downSince&&origNow()-downSince>8000)hideBusy(false)},1000);setInterval(drawMark,500);addEventListener('DOMContentLoaded',drawMark);addEventListener('DOMContentLoaded',draw);
window.LANSYNC={role:ROLE,page:PAGE,id:ID,host,get connected(){return wsOpen&&status==='ok'},get offset(){return off},get peers(){return peers},get silent(){return silent()},get hbSeen(){return hbSeen},get busy(){return busy},get sinceHeard(){return origNow()-lastHeard},get hubVersion(){return hubVer},SYNC,meta:()=>meta};
connect();
})();
