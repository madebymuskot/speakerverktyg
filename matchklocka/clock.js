// Matchklocka – delad logik + sync-lager
// SYNC-LAGER: byt/utöka transports för nätverkssynk (WebSocket/Firebase) senare.
const MK={KEY:'matchklocka_state_v1',transports:[],listeners:[]};
MK.LocalTransport={ // BroadcastChannel + localStorage (samma dator)
  init(onRemote){this.bc='BroadcastChannel'in window?new BroadcastChannel('matchklocka'):null;
    if(this.bc)this.bc.onmessage=e=>onRemote(e.data);
    addEventListener('storage',e=>{if(e.key===MK.KEY&&e.newValue)onRemote(JSON.parse(e.newValue))});},
  load(){try{return JSON.parse(localStorage.getItem(MK.KEY))}catch(e){return null}},
  publish(s){localStorage.setItem(MK.KEY,JSON.stringify(s));if(this.bc)this.bc.postMessage(s)}
};
// Exempel på framtida transport: {init(onRemote){...ws.onmessage...}, load(){return null}, publish(s){ws.send(JSON.stringify(s))}}
MK.defaults=()=>({v:0,home:'Piteå HC',away:'Motståndare',goals:[0,0],shots:[0,0],period:'P1',
  len:{P:20,PAUS:18,PRE:60,WU:40,WUL:20,OT:5,PB:70,PBS:60},clock:{running:false,remain:20*60000,startedAt:0},pens:[[],[]],timeout:null,pid:1});
MK.init=function(transports){MK.transports=transports||[MK.LocalTransport];let s=null;
  for(const t of MK.transports){t.init(r=>{if(!MK.state||r.v>=MK.state.v){MK.state=r;MK.emit()}});s=s||t.load()}
  MK.state=Object.assign(MK.defaults(),s||{});if(!MK.state.len.v18){if(MK.state.len.PAUS===15)MK.state.len.PAUS=18;MK.state.len.v18=1}MK.state.pens.forEach(a=>a.forEach(p=>{p.kind=p.kind||(p.min===10?'mis':p.min===5?'maj':'min')}));return MK.state};
MK.on=f=>MK.listeners.push(f);MK.emit=()=>MK.listeners.forEach(f=>f(MK.state));
MK.save=function(){MK.state.v=Date.now();MK.transports.forEach(t=>t.publish(MK.state));MK.emit()};
// Tidsberäkning (Date.now-baserad, ingen intervalldrift)
MK.elapsed=s=>s.clock.running?Date.now()-s.clock.startedAt:0;
MK.remain=s=>Math.max(0,s.clock.remain-MK.elapsed(s));
// ===== Utvisningsmotor enligt IIHF Official Rule Book 2026/27 (som Svenska Ishockeyförbundet tillämpar) =====
// Utvisning: {id,nr,min,kind:'min'|'maj'|'mis'|'gm',left(ms),coin(bool),after(id|null),lbl}
//  kind 'min' = mindre straff 2 min (R16) / del av dubbel 2+2 (R18), 'maj' = 5 min (R20),
//  'mis' = 10 min personligt (R22), 'gm' = matchstraff/game misconduct (R23, ingen tid – resten av matchen).
// Räknande (påverkar numerär): min/maj som inte är coin. Högst 2 räknande avtjänas samtidigt, övriga köas
//  och börjar när plats blir ledig (R26.1 Delayed Penalty); laget har alltid minst 3 utespelare (R26.1).
// Samtidiga lika straff (coin, R19.1/19.2): ersättare direkt -> ingen numerärändring, räknas inte i R26-regeln; tiden räknas.
// 10 min (R22.1/22.3): ersättare direkt, ingen numerärändring, egen tid. 'after' = startar när föregående del är avtjänad
//  (andra delen av 2+2 R18.1; 10:an i 2+10 R22.3; GM i 5+20 R20.4/R23).
MK.counts=p=>(p.kind==='min'||p.kind==='maj')&&!p.coin;
MK.penSim=(s,t,e)=>{const L=new Map(s.pens[t].map(p=>[p.id,p.left])),gone=new Set(s.pens[t].filter(p=>p.done).map(p=>p.id));let run=[],slot=[];
  for(let g=0;g<50;g++){const elig=s.pens[t].filter(p=>!p.done&&!gone.has(p.id)&&(!p.after||gone.has(p.after)||!s.pens[t].some(q=>q.id===p.after)));
    slot=elig.filter(MK.counts).slice(0,2);run=slot.concat(elig.filter(p=>!MK.counts(p)&&p.kind!=='gm'));
    if(e<=0||!run.length)break;const dt=Math.min(e,...run.map(p=>L.get(p.id)));
    run.forEach(p=>{L.set(p.id,L.get(p.id)-dt);if(L.get(p.id)<=0)gone.add(p.id)});e-=dt}
  return{L,gone,run,slot}};
MK.penNow=(s,t)=>MK.penSim(s,t,MK.penEl(s));
MK.activePens=(s,t)=>MK.penNow(s,t).slot; // räknande som avtjänas nu (max 2, R26.1)
MK.penRunning=(s,t,p)=>MK.penNow(s,t).run.includes(p);
MK.penEl=s=>s.period==='PAUS'||s.period==='SLUT'?0:MK.elapsed(s); // utvisningar står still i pausen, fortsätter i nästa period
MK.penLeft=(s,p,t)=>p.kind==='gm'?1:Math.max(0,MK.penNow(s,t).L.get(p.id)??0);
MK.penTxt=(s,p,t)=>p.kind==='gm'?'GM':MK.fmtP(MK.penLeft(s,p,t));
MK.fmt=ms=>{if(ms<60000&&ms>0){const t=Math.floor(ms/100);return Math.floor(t/10)+','+(t%10)}
  const sec=Math.ceil(ms/1000);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
MK.fmtP=ms=>{const sec=Math.ceil(ms/1000);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
MK.pname=p=>({P1:'1:a perioden',P2:'2:a perioden',P3:'3:e perioden',OT:'Förlängning',PAUS:'Paus',SLUT:'Slut'})[p]||p;
MK.pshort=p=>({P1:'P1',P2:'P2',P3:'P3',OT:'OT',PAUS:'PAUS',SLUT:'SLUT'})[p]||p;
// Mutationer (används av kontroll)
MK.commit=function(){const s=MK.state,e0=MK.elapsed(s),e=MK.penEl(s);if(!s.clock.running)return;
  for(const t of[0,1]){const r=MK.penSim(s,t,e);s.pens[t].forEach(p=>p.left=r.L.get(p.id));s.pens[t].forEach(p=>{if(p.coin&&r.gone.has(p.id)){p.left=0;p.done=true}});s.pens[t]=s.pens[t].filter(p=>p.done||!r.gone.has(p.id))}
  s.clock.remain=Math.max(0,s.clock.remain-e0);s.clock.startedAt=Date.now();};
MK.start=()=>{const s=MK.state;if(s.clock.running||s.clock.remain<=0)return;s.clock.running=true;s.clock.startedAt=Date.now();MK.save()};
MK.stop=()=>{const s=MK.state;if(!s.clock.running)return;MK.commit();s.clock.running=false;s.lastStop={period:s.period,remain:s.clock.remain,len:MK.periodLen(s.period),at:Date.now()};MK.save()};
MK.toggle=()=>MK.state.clock.running?MK.stop():MK.start();
MK.adjust=ms=>{MK.commit();const s=MK.state,max=MK.periodLen(s.period);s.clock.remain=Math.min(max,Math.max(0,s.clock.remain+ms));MK.save()};
MK.setTime=ms=>{MK.commit();const s=MK.state,old=s.clock.remain;s.clock.remain=Math.max(0,ms);
  if(/^(P\d|OT)$/.test(s.period)&&!MK.current(s))MK.shiftPens(old-s.clock.remain);MK.save()};
// Utvisningar lagras som återstående SPELTID (left, ms) och räknas ned med spelklockans förlupna tid (MK.commit/penSim),
// aldrig väggklocka. Vid redigerad matchtid flyttas de med samma delta d (förlupen speltid, + = framåt):
//  framåt: samma simulering som när klockan går (kö, 2+2-delar, slot som frigörs, kvittade -> 'done').
//  bakåt: pågående (avtjänas nu, inkl. kvittade och 'done' kvittade) får +|d|, max full längd. Är |d| större än vad en
//  pågående del hunnit avtjäna återställs inte redan avslutade/borttagna delar (de finns inte kvar) – kladdas till full längd.
MK.fullLen=p=>p.min*60000;
MK.shiftPens=d=>{const s=MK.state;if(!d)return;for(const t of[0,1]){
  if(d>0){const r=MK.penSim(s,t,d);s.pens[t].forEach(p=>{if(p.done)return;p.left=r.L.get(p.id);if(r.gone.has(p.id)&&p.coin){p.left=0;p.done=true}});
    s.pens[t]=s.pens[t].filter(p=>p.done||p.kind==='gm'||!r.gone.has(p.id))}
  else{const run=MK.penSim(s,t,0).run;s.pens[t].forEach(p=>{if(run.includes(p)||(p.done&&p.coin)){p.left=Math.min(MK.fullLen(p),Math.max(0,p.left-d));if(p.done&&p.left>0)p.done=false}})}}};
MK.periodLen=p=>{const s=MK.state,l=s.len;return(p==='PAUS'?l.PAUS:p==='OT'?l.OT:l.P)*60000};
// Förinställningar (min). Källor: SIF TB 2026/27 §1:6 (3x20, periodpaus 18 förbundsserie / 15 distrikt-region), §5:7 D (OT max 5 min, 3+1),
// SIF SB 2026/27 (U18/U19/U20 SM-slutspel: OT max 10 min, paus före OT max 3), IIHF R77.2 (paus 15), R84.1 (OT 5, paus 3).
// Paus före OT: domarstyrd (Daniels beslut) – öppen paus som räknar upp, avslutas med Avbryt.
MK.PRESETS={'Förbundsserie, t.ex. Hockeyettan / U18 Nationell grundserie (TB)':{P:20,PAUS:18,OT:5},
  'U18/U19/U20 SM-slutspel (SB)':{P:20,PAUS:18,OT:10},'Distrikt/region (TB, om ej annat i SB)':{P:20,PAUS:15,OT:5},'IIHF (regelboken)':{P:20,PAUS:15,OT:5}};
MK.preset=k=>{const l=MK.state.len,v=MK.PRESETS[k];if(!v)return;Object.assign(l,v);MK.save()};
MK.setPeriod=p=>{MK.commit();const s=MK.state;s.openSince=null;s.clock.running=false;s.period=p;s.next=null;s.clock.remain=p==='SLUT'?0:MK.periodLen(p);MK.save()};
// Mål (R16.2/R17.2): om det insläppande laget är i numerärt underläge (R16.2 "short-handed") avslutas det räknande
// mindre straffet med minst tid kvar. 5 min (R20.2), 10 min (R22) och samtidiga (R19) avslutas aldrig av mål.
// Dubbel 2+2: bara pågående del avslutas (andra delen startar då direkt). 2+10: 10:an startar direkt (R22.3).
MK.goal=(t,d)=>{MK.commit();const s=MK.state;s.goals[t]=Math.max(0,s.goals[t]+d);
  if(d>0){const o=1-t,st=MK.strength(s);
    if(st&&st.pp===t){const two=MK.activePens(s,o).filter(p=>p.kind==='min').sort((a,b)=>a.left-b.left)[0];if(two)s.pens[o]=s.pens[o].filter(p=>p!==two)}}
  MK.save()};
MK.shot=(t,d)=>{MK.state.shots[t]=Math.max(0,MK.state.shots[t]+d);MK.save()};
MK.PENTYPES={'2':[[2,'min']],'2+2':[[2,'min'],[2,'min']],'5':[[5,'maj']],'10':[[10,'mis']],'2+10':[[2,'min'],[10,'mis']],'5+20':[[5,'maj'],[20,'gm']]};
MK.addPen=(t,nr,type,coin)=>{MK.commit();const s=MK.state;let prev=null;type=String(type);
  for(const[m,kind]of MK.PENTYPES[type]||[[+type,'min']]){const p={id:s.pid++,nr,min:m,kind,left:m*60000,coin:!!coin&&kind!=='mis'&&kind!=='gm',after:prev,lbl:type};
    if(prev){const i=s.pens[t].findIndex(q=>q.id===prev);s.pens[t].splice(i+1,0,p)}else s.pens[t].push(p);prev=p.id}MK.save()};
MK.delPen=(t,id)=>{MK.commit();MK.state.pens[t]=MK.state.pens[t].filter(p=>p.id!==id);MK.save()};
MK.setTimeout_=t=>{MK.stop();MK.state.timeout=t==null?null:{team:t,endsAt:Date.now()+30000};MK.save()};
MK.reset=()=>{const s=MK.defaults();s.home=MK.state.home;s.away=MK.state.away;s.len=MK.state.len;s.gid=MK.state.gid;s.rosters=MK.state.rosters;s.dir=MK.state.dir;s.swName=MK.state.swName;s.short=MK.state.short;s.startTime=MK.state.startTime;s.startDate=MK.state.startDate;s.swStart=MK.state.swStart;s.clock.remain=s.len.P*60000;MK.state=s;MK.save()};
// Gemensam vy-hjälp för outputs
MK.view=function(render){MK.init();MK.on(render);const loop=()=>{render(MK.state);requestAnimationFrame(loop)};loop()};
MK.pensHTML=(s,t,cls)=>s.pens[t].filter(p=>!p.coin&&MK.penLeft(s,p,t)>0).map(p=>{const a=MK.penRunning(s,t,p)||p.kind==='gm';
  return `<div class="${cls}${a?'':' q'}">#${p.nr} <b>${MK.penTxt(s,p,t)}</b></div>`}).join('');
// Tillägg: räkna upp/ner, redigera utvisning, powerbreak
MK.dir=s=>s.dir||'down';
MK.shown=s=>MK.dir(s)==='up'&&s.period!=='PAUS'?MK.periodLen(s.period)-MK.remain(s):MK.remain(s);
MK.fmtShown=s=>MK.dir(s)==='up'&&s.period!=='PAUS'?MK.fmtUp(MK.shown(s)):MK.fmt(MK.shown(s));
MK.fmtUp=ms=>{const sec=Math.floor(ms/1000);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
MK.setDir=d=>{MK.state.dir=d;MK.save()};
MK.setShown=ms=>{const s=MK.state;MK.setTime(MK.dir(s)==='up'&&s.period!=='PAUS'?MK.periodLen(s.period)-ms:ms)};
MK.editPen=(t,id,ms)=>{MK.commit();const p=MK.state.pens[t].find(p=>p.id===id);if(p){p.left=Math.max(0,ms);if(p.coin)p.done=p.left<=0}MK.state.pens[t]=MK.state.pens[t].filter(p=>p.left>0||p.kind==='gm'||p.done);MK.save()};
MK.powerbreak=on=>{if(on){MK.stop();const n=Date.now(),l=MK.state.len;MK.state.pb={start:n,endsAt:n+(l.PB||70)*1000,sigAt:n+(l.PBS??60)*1000,sig:false}}else MK.state.pb=null;MK.save()};
MK.cd=x=>x?Math.max(0,x.endsAt-Date.now()):0;
MK.overlay=s=>{const t=MK.cd(s.timeout),p=MK.cd(s.pb),f=MK.cd(s.pre);if(f>0){const w=MK.warm(s);return{k:'MATCHSTART OM',v:MK.fmtP(f),pre:1,w:w.txt,wph:w.ph}}
  if(t>0)return{k:'TIMEOUT '+(s.timeout.team?s.away:s.home).toUpperCase(),v:MK.fmtP(t)};if(p>0)return{k:'POWERBREAK',v:MK.fmtP(p)};return null};
// Swehockey (CORS *): lagnamn + laglistor från /Game/LineUps/<gid>
MK.fetchLineup=async gid=>{const r=await fetch('https://stats.swehockey.se/Game/LineUps/'+gid,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);
  const d=new DOMParser().parseFromString(await r.text(),'text/html'),ws=x=>x.replace(/\s+/g,' ').trim(),teams=[];let team=null,role=null;
  for(const tr of d.querySelectorAll('tr')){if(tr.querySelector('table'))continue;const t=ws(tr.textContent),m=t.match(/^(.+?) \((\w+)\)/);
    if(m&&tr.querySelectorAll('td,th').length<=2&&!/Referee/.test(t)){team={name:m[1],players:[]};teams.push(team);role=null;continue}
    if(!team)continue;const st=tr.querySelector('strong');if(st&&ws(st.textContent))role=ws(st.textContent);
    const isD=[...tr.querySelectorAll('td')].some(td=>!td.hasAttribute('colspan')&&!td.querySelector('strong'));
    for(const dv of tr.querySelectorAll('div.lineUpPlayer')){const mm=ws(dv.textContent).match(/^(\d+)\.\s*(.+?),\s*(.+)$/);if(!mm)continue;
      if(team.players.some(p=>p.no===mm[1]))continue;team.players.push({no:mm[1],name:mm[3]+' '+mm[2],pos:role==='Goalies'?'M':/\d/.test(role||'')?(isD?'B':'F'):'–'})}}
  const tm=d.body.textContent.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);teams.start=tm?{date:tm[1],time:tm[2].padStart(5,'0')}:null;
  if(teams.length<2)throw Error('Ingen laguppställning hittades');teams.forEach(t=>t.players.sort((a,b)=>a.no-b.no));return teams};
MK.loadGame=async gid=>{const t=await MK.fetchLineup(gid),s=MK.state;const same=s.gid===gid,sw=s.swName||[];if(!same||s.home===sw[0]||!sw[0])s.home=t[0].name;if(!same||s.away===sw[1]||!sw[1])s.away=t[1].name;if(!same)s.short=['',''];s.gid=gid;s.swName=[t[0].name,t[1].name];s.rosters=[t[0].players,t[1].players];if(t.start&&(!same||!s.startTime||s.startTime===s.swStart)){s.startTime=t.start.time;s.startDate=t.start.date}if(t.start)s.swStart=t.start.time;MK.save();return t};
MK.pname2=(s,t,nr)=>{const p=((s.rosters||[])[t]||[]).find(p=>p.no==nr);return p?p.name:''};
// Automatiskt matchflöde: period slut -> paus (räknar ner) -> nästa period laddad, stoppad
MK.nextOf=s=>({P1:'P2',P2:'P3',P3:s.goals[0]===s.goals[1]?'OT':'SLUT',OT:'SLUT'})[s.period]||null;
// "Nästa steg i tidslinjen" – används både av automatik (nedräkning når 0) och Avbryt-knappen
// Uppvärmning (TB §1:6): startar len.WU min före matchstart, pågår len.WUL min. ph 0=före,1=pågår,2=efter
MK.warm=s=>{const f=MK.cd(s.pre),wu=(s.len.WU??40)*60000,we=wu-(s.len.WUL??20)*60000;return f>wu?{ph:0,txt:'UPPVÄRMNING OM '+MK.fmtP(f-wu)}:f>we?{ph:1,txt:'UPPVÄRMNING PÅGÅR'}:{ph:2,txt:''}};
MK.current=s=>MK.cd(s.pre)>0?'forematch':MK.cd(s.timeout)>0?'timeout':MK.cd(s.pb)>0?'powerbreak':s.period==='PAUS'?'paus':null;
MK.advance=function(){const s=MK.state,c=MK.current(s);
  if(c==='forematch'){s.pre=null;MK.setPeriod('P1')}else if(c==='timeout'){s.timeout=null;MK.save()}else if(c==='powerbreak'){s.pb=null;MK.save()}
  else if(c==='paus'){MK.setPeriod(s.next||'P2')}};
MK.autoTick=function(){const s=MK.state;if(s.pre&&MK.cd(s.pre)<=0){s.pre=null;MK.setPeriod('P1');return}
  if((s.timeout&&MK.cd(s.timeout)<=0)){s.timeout=null;MK.save()}if(s.pb&&MK.cd(s.pb)<=0){s.pb=null;MK.save()}
  if(!s.clock.running||MK.remain(s)>0)return;
  if(s.period==='PAUS'){MK.advance();return}
  MK.stop();const n=MK.nextOf(s);if(!n)return;
  if(n==='SLUT'){s.period='SLUT';s.next=null;s.clock.remain=0;MK.save();return}
  if(n==='OT'){s.period='PAUS';s.next='OT';s.clock.remain=0;s.clock.running=false;s.openSince=Date.now();MK.save();return}
  s.period='PAUS';s.next=n;s.openSince=null;s.clock.remain=MK.periodLen('PAUS');s.clock.running=true;s.clock.startedAt=Date.now();MK.save()};
MK.nextLabel=s=>s.period==='PAUS'&&s.next?'Nästa: '+s.next:'';
MK.ab=n=>n.replace(/\s*HC$/,'').slice(0,3).toUpperCase();MK.short=(s,t)=>((s.short||[])[t]||MK.ab(t?s.away:s.home)).toUpperCase();
// Numerär: vem har powerplay (10-min räknas inte)
// Numerär: utespelare = max(3, 5 − aktiva räknande utvisningar). Används av tv, jumbotron och kontroll (mål-regeln).
MK.strength=s=>{const a=[0,1].map(t=>MK.activePens(s,t).filter(p=>MK.penLeft(s,p,t)>0));const n=a.map(x=>x.length);
  if(!n[0]&&!n[1])return null;const k=n.map(x=>Math.max(3,5-x));
  if(k[0]===k[1])return{pp:null,k,txt:k[0]<5?k[0]+' mot '+k[1]:''};
  const pp=k[0]>k[1]?0:1,left=Math.min(...a[1-pp].map(p=>MK.penLeft(s,p,1-pp)));return{pp,k,txt:k[pp]+' mot '+k[1-pp],left}};

// Öppen paus före OT (domarstyrd): räknar upp tills Avbryt
MK.openPause=s=>s.period==='PAUS'&&s.next==='OT'&&!!s.openSince;
{const f=MK.fmtShown;MK.fmtShown=s=>MK.openPause(s)?MK.fmtUp(Date.now()-s.openSince):f(s)}
MK.pauseText=s=>MK.openPause(s)?'Paus – väntar på domare':'';

// Förmatch: nedräkning till matchstart (första steget i tidslinjen, före P1). Inga andra moment under nedräkningen.
// (b) mot klockslag s.startTime (dagens datum) om det finns och ligger i framtiden, annars (a) vald längd len.PRE min.
MK.startAtMs=s=>{if(!/^\d{1,2}:\d{2}$/.test(s.startTime||''))return null;const[h,m]=s.startTime.split(':').map(Number),d=new Date();d.setHours(h,m,0,0);return d.getTime()};
MK.preMode=s=>{const a=MK.startAtMs(s);return a&&a>Date.now()?'tid':'langd'};
MK.preStart=mode=>{const s=MK.state;MK.stop();mode=mode||MK.preMode(s);const a=MK.startAtMs(s);
  s.pre=mode==='tid'&&a>Date.now()?{endsAt:a,mode:'tid'}:{endsAt:Date.now()+(s.len.PRE||60)*60000,mode:'langd'};MK.save()};
MK.setStartTime=v=>{v=(v||'').trim().replace('.',':');MK.state.startTime=/^\d{1,2}:\d{2}$/.test(v)?v.padStart(5,'0'):'';MK.save()};

// Kvittade (coin) utvisningar visas aldrig på outputs. När tiden är slut ligger de kvar som done tills
// första avblåsning (klockan stoppad) -> varning på kontroll "Släpp ut", tas bort när operatören trycker OK.
MK.releases=s=>s.clock.running?[]:[0,1].flatMap(t=>s.pens[t].filter(p=>p.done&&p.coin&&!s.pens[t].some(q=>q.after===p.id)).map(p=>({t,p})));
MK.release=(t,id)=>MK.delPen(t,id);
MK.setCoin=(t,id,on)=>{MK.commit();const s=MK.state,p=s.pens[t].find(p=>p.id===id);if(!p)return;
 p.coin=!!on&&p.kind!=='mis'&&p.kind!=='gm';if(!p.coin&&p.done){p.done=false}s.pens[t]=s.pens[t].filter(q=>q.left>0||q.kind==='gm'||q.done);MK.save()};
