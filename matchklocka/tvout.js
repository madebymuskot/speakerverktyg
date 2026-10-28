/* TV-utgång: skickar händelser från Klocka till TV-bridge (bridge/bridge.js) över WebSocket.
   Konfig sparas i localStorage 'matchklocka_tv_v1' (skild från matchstate) och skickas till bridgen vid anslutning och varje ändring.
   Blockerar aldrig Klocka: allt är asynkront, saknas bridgen återansluts det tyst. */
(()=>{
const KEY='matchklocka_tv_v1',$=i=>document.getElementById(i);
const EVENTS=[['clockStart','Klocka start'],['clockStop','Klocka stopp'],['periodStart','Periodstart'],['periodEnd','Periodslut / tuta'],['goalHome','Mål hemma'],['goalAway','Mål borta'],['goalRemoved','Mål borttaget'],['penaltyAdded','Utvisning ny'],['penaltyExpired','Utvisning slut'],['timeout','Timeout'],['powerbreak','Powerbreak'],['gameReset','Nollställ match']];
const TYPES=[['rosstalk','RossTalk (TCP)'],['tcp','TCP (text)'],['udp','UDP (text)'],['osc','OSC (UDP)'],['http','HTTP']];
const DEFPORT={rosstalk:7788,tcp:5250,udp:7000,osc:9000};
const PORT=8787;
const E=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
/* ---------- mallar ---------- */
const byEv=(out,m)=>{const e={};EVENTS.forEach(([k],i)=>{const r=m(k,i);if(r)e[k]=(Array.isArray(r)?r:[r]).map(x=>Object.assign({out},x))});return e};
const q='\\"';
const PRESETS={
 rosstalk:{n:'RossTalk GPI',f:()=>({outputs:[{id:'o1',name:'Ross (RossTalk)',type:'rosstalk',host:'192.168.0.10',port:7788,eol:'crlf'}],events:byEv('o1',(k,i)=>({msg:'GPI '+(i+1)})),feed:{on:false,type:'udp',host:'127.0.0.1',port:7790,hz:10}})},
 caspar:{n:'CasparCG (AMCP)',f:()=>({outputs:[{id:'o1',name:'CasparCG',type:'tcp',host:'127.0.0.1',port:5250,eol:'crlf'}],events:byEv('o1',k=>{
   const inv=`CG 1-10 INVOKE 1 "${k}"`,upd=j=>`CG 1-10 UPDATE 1 "${j}"`,S=`{${q}home${q}:{home},${q}away${q}:{away},${q}clock${q}:${q}{clock}${q},${q}period${q}:${q}{period}${q}}`;
   return k==='gameReset'?[{msg:upd(S)},{msg:inv}]:/^goal/.test(k)||/^period/.test(k)?[{msg:upd(S)},{msg:inv}]:k==='penaltyAdded'?[{msg:upd(`{${q}penTeam${q}:${q}{teamshort}${q},${q}penNr${q}:${q}{nr}${q},${q}penType${q}:${q}{pen}${q}}`)},{msg:inv}]:{msg:inv}}),feed:{on:false,type:'udp',host:'127.0.0.1',port:7790,hz:10}})},
 companion:{n:'Companion (HTTP)',f:()=>({outputs:[{id:'o1',name:'Companion',type:'http',url:'http://127.0.0.1:8000',method:'GET'}],events:byEv('o1',(k,i)=>({msg:'/api/location/1/0/'+i+'/press'})),feed:{on:false,type:'udp',host:'127.0.0.1',port:7790,hz:10}})},
 singular:{n:'Singular (HTTP)',f:()=>({outputs:[{id:'o1',name:'Singular',type:'http',url:'https://app.singular.live/apiv2/controlapps/DIN_APP_TOKEN/control',method:'PATCH'}],events:byEv('o1',k=>{
   const B=(sc,pl,st)=>({msg:'',body:`[{${'"'}subCompositionName${'"'}:${'"'}${sc}${'"'},${'"'}payload${'"'}:{${pl}}${st?`,${'"'}state${'"'}:${'"'}${st}${'"'}`:''}}]`});
   const SB='"Home":"{home}","Away":"{away}","Clock":"{clock|json}","Period":"{period|json}"';
   if(/^(goal|clock|period)/.test(k)||k==='gameReset')return B('Scoreboard',SB+(k==='clockStart'?',"Running":"true"':k==='clockStop'?',"Running":"false"':''));
   if(k==='penaltyAdded')return B('Penalty','"Team":"{teamshort|json}","Nr":"{nr}","Type":"{pen}"','In');
   if(k==='penaltyExpired')return B('Penalty','"Team":"{teamshort|json}","Nr":"{nr}"','Out');
   return B(k==='timeout'?'Timeout':'Powerbreak','"Team":"{team|json}"','In')}),feed:{on:false,type:'udp',host:'127.0.0.1',port:7790,hz:10}})},
 osc:{n:'OSC (generisk)',f:()=>({outputs:[{id:'o1',name:'OSC',type:'osc',host:'127.0.0.1',port:9000}],events:byEv('o1',k=>({msg:'/klocka/'+k,args:/^goal/.test(k)?'{home} {away} {teamshort}':/^pen/.test(k)?'{teamshort} {nr} {pen}':'{clock} {period}'})),feed:{on:false,type:'udp',host:'127.0.0.1',port:7790,hz:10}})}};
/* ---------- tillstånd ---------- */
const empty=()=>({on:false,url:'',cfg:{outputs:[],events:{},feed:{on:false,type:'udp',host:'127.0.0.1',port:7790,hz:10}}});
let T;try{T=JSON.parse(localStorage.getItem(KEY))}catch(e){}T=Object.assign(empty(),T||{});T.cfg=Object.assign(empty().cfg,T.cfg||{});let lastCfgJ=JSON.stringify(T.cfg);
const here=location.hostname;const isLocalPage=/^https?:$/.test(location.protocol)&&here&&!/github\.io$/.test(here)&&here!=='localhost'&&here!=='127.0.0.1';
const defUrl=()=>'ws://'+(isLocalPage&&location.protocol==='http:'?here:'localhost')+':'+PORT;
const url=()=>(T.url||'').trim()||defUrl();
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(T))}catch(e){}pushSoon()};
/* ---------- WebSocket ---------- */
let ws=null,status='off',detail='',tries=0,rt=null,logLines=[],lastMsg='';
const blockedWhy=u=>{if(location.protocol!=='https:')return '';let h='';try{h=new URL(u.replace(/^ws/,'http')).hostname}catch(e){return 'Ogiltig adress'}
  if(/^ws:/i.test(u)&&!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h))return 'Webbläsaren blockerar ws:// till annan dator från den här https-sidan. Kör bridgen på samma dator som Klocka (ws://localhost) eller öppna Klocka från bridgens egen adress (http://'+h+':'+PORT+'/matchklocka/kontroll.html).';return ''};
function setStatus(s,d){status=s;detail=d||'';drawStatus()}
function connect(){clearTimeout(rt);if(ws){try{ws.onclose=ws.onerror=ws.onmessage=ws.onopen=null;ws.close()}catch(e){}ws=null}
  if(!T.on){setStatus('off');return}const u=url(),b=blockedWhy(u);if(b){setStatus('blocked',b);return}
  setStatus('conn');let w;try{w=new WebSocket(u)}catch(e){setStatus('retry',String(e.message||e));later();return}ws=w;
  w.onopen=()=>{if(ws!==w)return;tries=0;setStatus('ok');sendCfg();lastSt='';pushState(true)};
  w.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch(_){return}
    if(m.type==='hello'){bridgeVer=m.version;(m.log||[]).forEach(addLog);setStatus('ok')}else if(m.type==='log')addLog(m.line);
    else if(m.type==='sent'){lastMsg=(m.test?'Test ':'')+m.name+': '+(m.routes?m.routes+' utskick skickade (se logg nedan)':'inga mål konfigurerade för den här händelsen');drawMsg()}};
  w.onclose=()=>{if(ws!==w)return;ws=null;if(T.on){setStatus('retry');later()}};w.onerror=()=>{}}
let bridgeVer='';
function later(){clearTimeout(rt);tries++;rt=setTimeout(connect,Math.min(10000,800*Math.min(tries,12)))}
const open=()=>ws&&ws.readyState===1;
function tx(o){if(!open())return false;try{ws.send(JSON.stringify(o));return true}catch(e){return false}}
let pt=null;function pushSoon(){clearTimeout(pt);pt=setTimeout(()=>{if(JSON.stringify(T.cfg)!==lastCfgJ)sendCfg(true)},400)}
function sendCfg(force){if(!force&&!T.cfg.outputs.length)return;lastCfgJ=JSON.stringify(T.cfg);tx({type:'config',config:T.cfg})}
/* ---------- state + händelser ---------- */
const play=p=>/^(P\d|OT\d*)$/.test(p);
function mkVars(s,name,x){x=x||{};const t=x.t!=null?x.t:null,h=s.goals[0],a=s.goals[1],d=new Date(),p2=n=>String(n).padStart(2,'0');
  const v={event:name,clock:MK.fmtShown(s),clockms:Math.round(MK.remain(s)),period:MK.pshort(s.period),periodname:MK.pname(s.period),home:h,away:a,score:h+'-'+a,homename:s.home,awayname:s.away,homeshort:MK.short(s,0),awayshort:MK.short(s,1),
    team:t==null?'':(t?s.away:s.home),teamshort:t==null?'':MK.short(s,t),side:t==null?'':(t?'away':'home'),teamgoals:t==null?'':s.goals[t],gid:s.gid||'',time:p2(d.getHours())+':'+p2(d.getMinutes())+':'+p2(d.getSeconds()),
    homepens:s.pens[0].filter(p=>MK.penLeft(s,p,0)>0).length,awaypens:s.pens[1].filter(p=>MK.penLeft(s,p,1)>0).length};
  try{const st=MK.strength(s);v.strength=st?st.txt:''}catch(e){v.strength=''}
  if(x.nr!=null){v.nr=x.nr;v.pen=x.pen||'';v.min=x.min==null?'':x.min;v.player=x.t!=null?MK.pname2(s,x.t,x.nr):''}else{v.nr=v.pen=v.min=v.player=''}
  return v}
function emit(name,x,test){const s=MK.state;if(!s)return false;const ok=tx({type:'event',name,vars:mkVars(s,name,x),test:!!test});
  if(!test){lastEv=EVENTS.find(e=>e[0]===name)[1]+' '+new Date().toLocaleTimeString('sv-SE')+(ok?'':' – ej skickad (ingen bridge)');drawMsg()}return ok}
let lastEv='';
const snap=s=>{const act={};[0,1].forEach(t=>s.pens[t].forEach(p=>{if(p.kind!=='gm'&&MK.penLeft(s,p,t)>0)act[t+':'+p.id]={t,nr:p.nr,pen:p.lbl,min:p.min}}));
  return{run:!!s.clock.running,per:s.period,rem:MK.remain(s),goals:s.goals.slice(),tmo:s.timeout?s.timeout.endsAt:0,pb:s.pb?s.pb.start:0,evs:new Set((s.ev||[]).filter(e=>e.typ==='Utvisning').map(e=>e.id)),act,mid:s.mid||'',dels:(s.dels||[]).slice()}};
let prev=null,inReset=false,started={};
function diff(){const s=MK.state;if(!s)return;const c=snap(s),p=prev;prev=c;if(!p||inReset||!T.on)return;
  if(c.mid!==p.mid)started={};const out=[];
  if(play(c.per)&&c.per===p.per){if(!p.run&&c.run){const k=c.mid+'|'+c.per;if(!started[k]&&p.rem>=MK.periodLen(c.per)-1500){started[k]=1;out.push(['periodStart'])}out.push(['clockStart'])}
    else if(p.run&&!c.run){out.push(['clockStop']);if(c.rem<=100)out.push(['periodEnd'])}}
  else if(play(p.per)&&p.run&&!c.run&&c.per!==p.per){out.push(['clockStop']);if(p.rem<=300)out.push(['periodEnd'])}
  [0,1].forEach(t=>{if(c.goals[t]>p.goals[t])out.push([t?'goalAway':'goalHome',{t}]);else if(c.goals[t]<p.goals[t])out.push(['goalRemoved',{t}])});
  if(c.tmo&&c.tmo!==p.tmo&&s.timeout)out.push(['timeout',{t:s.timeout.team}]);
  if(c.pb&&c.pb!==p.pb)out.push(['powerbreak']);
  (s.ev||[]).forEach(e=>{if(e.typ==='Utvisning'&&!e.del&&!p.evs.has(e.id))out.push(['penaltyAdded',{t:e.t,nr:e.nr,pen:e.lbl,min:e.min}])});
  Object.keys(p.act).forEach(k=>{if(!c.act[k]&&!(s.dels||[]).includes(k)&&!p.dels.includes(k)){const a=p.act[k];out.push(['penaltyExpired',a])}});
  out.forEach(([n,x])=>emit(n,x))}
let lastSt='';function pushState(force){if(!open()||!T.cfg.feed||!T.cfg.feed.on)return;const s=MK.state;if(!s)return;
  const pl=t=>({name:t?s.away:s.home,short:MK.short(s,t),goals:s.goals[t],shots:s.shots[t],pens:s.pens[t].filter(p=>MK.penLeft(s,p,t)>0).map(p=>({nr:p.nr,kind:p.kind,leftMs:p.kind==='gm'?1:MK.penLeft(s,p,t),active:MK.penRunning(s,t,p)||p.kind==='gm'}))});
  let st=null;try{st=MK.strength(s)}catch(e){}
  const o={ts:Date.now(),running:!!s.clock.running,remainMs:MK.remain(s),lenMs:MK.periodLen(s.period),dir:MK.dir(s),period:MK.pshort(s.period),periodName:MK.pname(s.period),penClock:s.period!=='PAUS'&&s.period!=='SLUT',home:pl(0),away:pl(1),strength:st?st.txt:'',
    timeout:s.timeout&&MK.cd(s.timeout)>0?{team:s.timeout.team?s.away:s.home,leftMs:MK.cd(s.timeout)}:null,pb:s.pb&&MK.cd(s.pb)>0?{leftMs:MK.cd(s.pb)}:null,gid:s.gid||'',mid:s.mid||''};
  tx({type:'state',state:o})}
/* ---------- gränssnitt ---------- */
const css=`#tvbox .tvtop{display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;margin:6px 0 4px}#tvbox label.tvon{font-size:22px;font-weight:800;display:flex;gap:10px;align-items:center;cursor:pointer}#tvbox label.tvon input{width:28px;height:28px}
#tvbox .tvstat{font-size:22px;font-weight:900;padding:6px 14px;border-radius:8px;background:#222;border:2px solid #555}#tvbox .tvstat.ok{color:#5f5;border-color:#2e8b2e}#tvbox .tvstat.conn,#tvbox .tvstat.retry,#tvbox .tvstat.blocked{color:#FFB000;border-color:#8a6500}#tvbox .tvstat.off{color:#aaa}
#tvbox input,#tvbox select,#tvbox textarea{font-size:16px;padding:5px 6px;border-radius:6px;border:2px solid #555;background:#111;color:#fff;font-family:inherit}#tvbox input[type=checkbox]{width:auto}#tvbox input.u{width:min(340px,70vw)}
#tvbox button{font-size:15px;padding:5px 12px}#tvbox button.tst{border-color:#FFB000;color:#FFB000}#tvbox .hint{color:#bbb;font-size:15px;margin:4px 0}#tvbox .tvmsg{min-height:22px;font-size:16px;color:#FFB000;margin:4px 0}
#tvbox details{border-top:1px solid #333;margin-top:10px;padding-top:8px}#tvbox summary{cursor:pointer;font-weight:800;font-size:18px}
#tvbox .evg{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:8px;margin-top:8px}#tvbox .evc{background:#1d1d1d;border-radius:8px;padding:8px}#tvbox .evh{display:flex;align-items:center;gap:8px;font-weight:800;font-size:17px;margin-bottom:4px}#tvbox .evh span{flex:1}
#tvbox .rr,#tvbox .or{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0}#tvbox .rr select{max-width:150px}#tvbox .rr input.m{flex:1 1 150px;min-width:110px}#tvbox .rr input.ax{flex:1 1 120px;min-width:90px}
#tvbox .or{background:#1d1d1d;border-radius:8px;padding:6px}#tvbox .or input.nm{width:150px}#tvbox .or input.ho{width:200px}#tvbox .or input.po{width:80px}
#tvbox .x{padding:3px 9px}#tvbox pre{background:#0b0b0b;border:1px solid #333;border-radius:8px;padding:8px;margin:6px 0;font-size:13px;max-height:180px;overflow:auto;white-space:pre-wrap;color:#cfc}#tvbox textarea{width:100%;height:120px;font-family:monospace;font-size:13px}`;
let openSec={};
function drawStatus(){const e=$('tvStat');if(!e)return;const M={off:['off','○ AV'],conn:['conn','● Ansluter…'],retry:['retry','● Ingen bridge hittad – försöker igen'],ok:['ok','● ANSLUTEN'+(bridgeVer?' (bridge '+bridgeVer+')':'')],blocked:['blocked','● Kan inte ansluta (se nedan)']}[status];
  e.className='tvstat '+M[0];e.textContent=M[1];const d=$('tvDet');if(d)d.textContent=detail||(status==='retry'?'Starta bridgen på den här datorn (start.bat / start.sh). Klocka fungerar som vanligt under tiden.':'')}
function drawMsg(){const e=$('tvMsg');if(e)e.textContent=lastMsg||lastEv?[lastMsg,lastEv?'Senast: '+lastEv:''].filter(Boolean).join('  ·  '):''}
function addLog(l){logLines.push(l);if(logLines.length>12)logLines.shift();const e=$('tvLog');if(e){e.textContent=logLines.join('\n');e.scrollTop=1e6}}
const typeOf=id=>{const o=T.cfg.outputs.find(x=>x.id===id);return o?o.type:''};
function routeRow(ev,i,r){const ty=typeOf(r.out),opts=T.cfg.outputs.map(o=>`<option value="${E(o.id)}"${o.id===r.out?' selected':''} data-o="${E(o.id)}">${E(o.name||o.id)}</option>`).join('');
  const ph=ty==='osc'?'/adress':ty==='http'?'/sökväg eller full URL (tomt = bas-URL)':'t.ex. GPI 1';
  return `<div class="rr"><select data-p="events.${ev}.${i}.out" data-re="1">${opts}</select><input class="m" data-p="events.${ev}.${i}.msg" value="${E(r.msg)}" placeholder="${ph}" title="Variabler: {clock} {period} {home} {away} {team} …">`+
   (ty==='osc'?`<input class="ax" data-p="events.${ev}.${i}.args" value="${E(r.args)}" placeholder="argument, t.ex. {home} {away}">`:ty==='http'?`<input class="ax" data-p="events.${ev}.${i}.body" value="${E(r.body)}" placeholder="Body (valfri)">`:'')+
   `<button class="x" data-a="delr" data-ev="${ev}" data-i="${i}" title="Ta bort">✕</button></div>`}
function outRow(i,o){const ty=o.type,ht=ty==='http';
  return `<div class="or"><input class="nm" data-p="outputs.${i}.name" value="${E(o.name)}" placeholder="Namn"><select data-p="outputs.${i}.type" data-re="1">${TYPES.map(([k,n])=>`<option value="${k}"${k===ty?' selected':''}>${n}</option>`).join('')}</select>`+
   (ht?`<input class="ho" style="width:min(380px,90vw)" data-p="outputs.${i}.url" value="${E(o.url)}" placeholder="Bas-URL, t.ex. http://192.168.0.5:8000"><select data-p="outputs.${i}.method">${['GET','POST','PUT','PATCH'].map(m=>`<option${m===(o.method||'GET')?' selected':''}>${m}</option>`).join('')}</select><input class="ho" data-p="outputs.${i}.headers" value="${E(o.headers)}" placeholder="Headers (valfritt) Namn: värde; …">`:
    `<input class="ho" data-p="outputs.${i}.host" value="${E(o.host)}" placeholder="IP / värdnamn"><input class="po" type="number" data-p="outputs.${i}.port" value="${E(o.port)}" placeholder="Port">`+(ty==='osc'?'':`<select data-p="outputs.${i}.eol" title="Radslut som läggs till efter strängen">${[['crlf','Radslut CR+LF'],['lf','Radslut LF'],['cr','Radslut CR'],['none','Inget radslut']].map(([k,n])=>`<option value="${k}"${k===(o.eol||(ty==='udp'?'none':'crlf'))?' selected':''}>${n}</option>`).join('')}</select>`))+
   `<button class="x" data-a="delo" data-i="${i}" title="Ta bort utgång">✕</button></div>`}
let keepOpen=false;
function snapOpen(){const b=$('tvbox');if(b)b.querySelectorAll('details[data-s]').forEach(d=>openSec[d.dataset.s]=d.open)}
function draw(){const b=$('tvbox');if(!b)return;if(!keepOpen)snapOpen();keepOpen=false;const c=T.cfg,f=c.feed||{};
  b.innerHTML=`<h2>TV-utgång <small style="color:#bbb;font-weight:400;font-size:14px">nätverkstriggers (GPI över nätverk) till sändarens grafiksystem</small></h2>
<div class="tvtop"><label class="tvon"><input type="checkbox" id="tvOn" ${T.on?'checked':''}> TV-utgång på</label><span id="tvStat" class="tvstat off">○ AV</span>
<label>Bridge-adress <input class="u" id="tvUrl" value="${E(T.url)}" placeholder="${E(defUrl())}"></label></div>
<div class="hint" id="tvDet"></div><div class="tvmsg" id="tvMsg"></div>
<details data-s="ev" ${openSec.ev!==false?'open':''}><summary>Händelser – vad skickas och vart (Testa skickar direkt)</summary>
${c.outputs.length?'':'<div class="hint">Börja med att välja en mall under “Mallar och JSON” nedan, eller lägg till en utgång.</div>'}
<div class="evg">${EVENTS.map(([k,n])=>{const R=c.events[k]||[];return `<div class="evc"><div class="evh"><span>${n}</span><button class="tst" data-a="test" data-ev="${k}">Testa</button></div>${R.map((r,i)=>routeRow(k,i,r)).join('')}<button class="x" data-a="addr" data-ev="${k}" ${c.outputs.length?'':'disabled'}>+ Koppling</button></div>`}).join('')}</div>
<div class="hint">Variabler i strängar: <code>{clock}</code> klocka · <code>{period}</code> P1/P2/P3/OT · <code>{periodname}</code> · <code>{home}</code> <code>{away}</code> mål hemma/borta · <code>{score}</code> 2-1 · <code>{homename}</code> <code>{awayname}</code> · <code>{homeshort}</code> <code>{awayshort}</code> · <code>{team}</code> <code>{teamshort}</code> <code>{side}</code> laget i händelsen · <code>{nr}</code> <code>{pen}</code> <code>{min}</code> <code>{player}</code> vid utvisning · <code>{clockms}</code> <code>{strength}</code> <code>{time}</code> · filter: <code>{team|json}</code> <code>{team|url}</code> <code>{team|upper}</code>. Radslut i text: <code>\\r\\n</code>.</div></details>
<details data-s="out" ${openSec.out?'open':''}><summary>Utgångar (mottagare)</summary>${c.outputs.map((o,i)=>outRow(i,o)).join('')}<button data-a="addo">+ Lägg till utgång</button></details>
<details data-s="feed" ${openSec.feed?'open':''}><summary>Datafeed (löpande status som JSON)</summary><div class="or"><label><input type="checkbox" data-p="feed.on" ${f.on?'checked':''}> På</label><select data-p="feed.type"><option value="udp"${f.type!=='tcp'?' selected':''}>UDP</option><option value="tcp"${f.type==='tcp'?' selected':''}>TCP</option></select><input class="ho" data-p="feed.host" value="${E(f.host)}" placeholder="IP / värdnamn"><input class="po" type="number" data-p="feed.port" value="${E(f.port)}" placeholder="Port"><label>Hastighet <input class="po" type="number" min="1" max="30" data-p="feed.hz" value="${E(f.hz)}"> Hz</label></div>
<div class="hint">Klocka, period, ställning, utvisningar och löpflagga skickas som en JSON-rad per paket (klockan räknas av bridgen mellan uppdateringarna). Även tillgängligt som GET /state på bridgen.</div></details>
<details data-s="tpl" ${openSec.tpl?'open':''}><summary>Mallar och JSON</summary><div class="or"><select id="tvPre"><option value="">– välj mall –</option>${Object.entries(PRESETS).map(([k,v])=>`<option value="${k}">${v.n}</option>`).join('')}</select><button data-a="preset">Fyll i från mall</button><button data-a="export">Exportera JSON</button><button data-a="import">Importera JSON</button><input type="file" id="tvFile" accept=".json,application/json" hidden></div>
<textarea id="tvJson" placeholder="JSON visas här vid export. Klistra in JSON här och tryck Importera." spellcheck="false"></textarea>
<div class="hint">Mallarna fyller i exempelvärden (IP, token, ID) som du justerar själv. Konfigen sparas i Klocka och skickas till bridgen vid anslutning och vid varje ändring; bridgen sparar senast mottagna som reserv.</div></details>
<details data-s="log" ${openSec.log?'open':''}><summary>Senaste utskick (från bridgen)</summary><pre id="tvLog">${E(logLines.join('\n'))}</pre></details>
<div class="hint" style="margin-top:10px">Bridgen körs på Klocka-datorn (eller en Raspberry Pi): <a href="../tv-bridge.zip" style="color:#FFB000">Hämta TV-bridge (zip)</a> – README ligger i zip-filen. Webbläsaren tillåter ws://localhost från den här sidan men inte ws:// till andra IP-adresser; kör därför bridgen på samma dator, eller öppna Klocka via bridgens egen http-adress.</div>`;
  drawStatus();drawMsg()}
const setP=(p,v)=>{const a=p.split('.');let o=T.cfg;if(a[0]==='events'&&!o.events[a[1]])o.events[a[1]]=[];if(a[0]==='feed'&&!o.feed)o.feed={};for(let i=0;i<a.length-1;i++)o=o[a[i]];
  let k=a[a.length-1];if(/^(port|hz)$/.test(k)&&v!==''&&!isNaN(+v))v=+v;o[k]=v;};
function hook(){const b=$('tvbox');
  b.addEventListener('input',e=>{const t=e.target;if(t.id==='tvUrl'){T.url=t.value.trim();save();clearTimeout(window._tvu);window._tvu=setTimeout(connect,700);return}
    const p=t.dataset&&t.dataset.p;if(!p||t.dataset.re||t.type==='checkbox')return;setP(p,t.value);if(/^outputs\.\d+\.name$/.test(p)){const id=T.cfg.outputs[+p.split('.')[1]].id;b.querySelectorAll('option[data-o="'+id+'"]').forEach(o=>o.textContent=t.value||id)}save()});
  b.addEventListener('change',e=>{const t=e.target;if(t.id==='tvOn'){T.on=t.checked;save();tries=0;connect();return}if(t.id==='tvFile'){const f=t.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{$('tvJson').value=r.result;doImport()};r.readAsText(f);t.value='';return}
    const p=t.dataset&&t.dataset.p;if(!p)return;setP(p,t.type==='checkbox'?t.checked:t.value);
    const m=p.match(/^outputs\.(\d+)\.type$/);if(m){const o=T.cfg.outputs[+m[1]];if(!o.port||Object.values(DEFPORT).includes(+o.port))o.port=DEFPORT[o.type]||'';if(o.type==='http'&&!o.method)o.method='GET'}
    save();if(t.dataset.re)draw()});
  b.addEventListener('click',e=>{const t=e.target.closest('button[data-a]');if(!t)return;snapOpen();const a=t.dataset.a,ev=t.dataset.ev,i=+t.dataset.i,c=T.cfg;
    if(a==='test'){if(!T.on)lastMsg='Slå på TV-utgång först.';else if(!open())lastMsg='Ingen bridge ansluten – inget skickat.';else{const s=MK.state;lastMsg='';emit(ev,{t:ev==='goalAway'?1:0,nr:'17',pen:'2',min:2},true)}drawMsg();return}
    if(a==='addr'){(c.events[ev]=c.events[ev]||[]).push({out:c.outputs[0]?c.outputs[0].id:'',msg:''})}
    else if(a==='delr'){c.events[ev].splice(i,1)}
    else if(a==='addo'){let n=1;while(c.outputs.some(o=>o.id==='o'+n))n++;c.outputs.push({id:'o'+n,name:'Utgång '+n,type:'rosstalk',host:'',port:7788,eol:'crlf'});openSec.out=true}
    else if(a==='delo'){const id=c.outputs[i].id,used=Object.values(c.events).some(r=>r.some(x=>x.out===id));if(used&&!confirm('Utgången används av händelser. Ta bort den och dess kopplingar?'))return;c.outputs.splice(i,1);Object.keys(c.events).forEach(k=>c.events[k]=c.events[k].filter(x=>x.out!==id))}
    else if(a==='preset'){const k=$('tvPre').value;if(!k)return;if(c.outputs.length&&!confirm('Mallen ersätter nuvarande utgångar och kopplingar. Fortsätta?'))return;T.cfg=PRESETS[k].f();openSec.out=true}
    else if(a==='export'){const j=JSON.stringify(T.cfg,null,1);$('tvJson').value=j;openSec.tpl=true;const l=document.createElement('a');l.href=URL.createObjectURL(new Blob([j],{type:'application/json'}));l.download='tv-utgang.json';l.click();return}
    else if(a==='import'){if($('tvJson').value.trim())doImport();else $('tvFile').click();return}
    save();keepOpen=true;draw()});}
function doImport(){let j;try{j=JSON.parse($('tvJson').value)}catch(e){lastMsg='Ogiltig JSON: '+e.message;drawMsg();return}if(j&&j.cfg)j=j.cfg;
  if(!j||!Array.isArray(j.outputs)){lastMsg='JSON saknar "outputs".';drawMsg();return}T.cfg=Object.assign(empty().cfg,{outputs:j.outputs.filter(o=>o&&o.id),events:j.events||{},feed:j.feed||empty().cfg.feed});save();openSec.tpl=true;draw();lastMsg='Importerad: '+T.cfg.outputs.length+' utgångar.';drawMsg()}
/* ---------- start ---------- */
function init(){if(!$('tvbox')||typeof MK==='undefined'||!MK.state)return;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  const r=MK.reset;MK.reset=function(){inReset=true;try{return r.apply(this,arguments)}finally{prev=snap(MK.state);inReset=false;emit('gameReset')}};
  prev=snap(MK.state);MK.on(()=>{try{diff()}catch(e){}});setInterval(()=>{try{diff()}catch(e){}},250);
  let lt=0;MK.on(()=>{const n=Date.now();if(n-lt>150){lt=n;try{pushState()}catch(e){}}});setInterval(()=>pushState(),1000);
  draw();hook();connect();window.TVOUT={emit,cfg:()=>T,status:()=>status}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
