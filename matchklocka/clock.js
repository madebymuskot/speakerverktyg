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
  len:{P:20,PAUS:15,OT:5},clock:{running:false,remain:20*60000,startedAt:0},pens:[[],[]],timeout:null,pid:1});
MK.init=function(transports){MK.transports=transports||[MK.LocalTransport];let s=null;
  for(const t of MK.transports){t.init(r=>{if(!MK.state||r.v>=MK.state.v){MK.state=r;MK.emit()}});s=s||t.load()}
  MK.state=Object.assign(MK.defaults(),s||{});return MK.state};
MK.on=f=>MK.listeners.push(f);MK.emit=()=>MK.listeners.forEach(f=>f(MK.state));
MK.save=function(){MK.state.v=Date.now();MK.transports.forEach(t=>t.publish(MK.state));MK.emit()};
// Tidsberäkning (Date.now-baserad, ingen intervalldrift)
MK.elapsed=s=>s.clock.running?Date.now()-s.clock.startedAt:0;
MK.remain=s=>Math.max(0,s.clock.remain-MK.elapsed(s));
MK.activePens=(s,t)=>s.pens[t].filter(p=>p.min!==10).slice(0,2); // max 2 samtidigt räknas ner
MK.penLeft=(s,p,t)=>{const act=MK.activePens(s,t).includes(p)||p.min===10;return Math.max(0,p.left-(act?MK.elapsed(s):0))};
MK.fmt=ms=>{if(ms<60000&&ms>0){const t=Math.floor(ms/100);return Math.floor(t/10)+','+(t%10)}
  const sec=Math.ceil(ms/1000);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
MK.fmtP=ms=>{const sec=Math.ceil(ms/1000);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
MK.pname=p=>({P1:'1:a perioden',P2:'2:a perioden',P3:'3:e perioden',OT:'Förlängning',PAUS:'Paus'})[p]||p;
MK.pshort=p=>({P1:'P1',P2:'P2',P3:'P3',OT:'OT',PAUS:'PAUS'})[p]||p;
// Mutationer (används av kontroll)
MK.commit=function(){const s=MK.state,e=MK.elapsed(s);if(!s.clock.running)return;
  for(const t of[0,1]){const act=MK.activePens(s,t);s.pens[t].forEach(p=>{if(act.includes(p)||p.min===10)p.left-=e});
    s.pens[t]=s.pens[t].filter(p=>p.left>0)}
  s.clock.remain=Math.max(0,s.clock.remain-e);s.clock.startedAt=Date.now();};
MK.start=()=>{const s=MK.state;if(s.clock.running||s.clock.remain<=0)return;s.clock.running=true;s.clock.startedAt=Date.now();MK.save()};
MK.stop=()=>{const s=MK.state;if(!s.clock.running)return;MK.commit();s.clock.running=false;MK.save()};
MK.toggle=()=>MK.state.clock.running?MK.stop():MK.start();
MK.adjust=ms=>{MK.commit();const s=MK.state,max=MK.periodLen(s.period);s.clock.remain=Math.min(max,Math.max(0,s.clock.remain+ms));MK.save()};
MK.setTime=ms=>{MK.commit();MK.state.clock.remain=Math.max(0,ms);MK.save()};
MK.periodLen=p=>{const l=MK.state.len;return(p==='PAUS'?l.PAUS:p==='OT'?l.OT:l.P)*60000};
MK.setPeriod=p=>{MK.commit();const s=MK.state;s.clock.running=false;s.period=p;s.clock.remain=MK.periodLen(p);MK.save()};
MK.goal=(t,d)=>{MK.commit();const s=MK.state;s.goals[t]=Math.max(0,s.goals[t]+d);
  if(d>0){const o=1-t,ao=MK.activePens(s,o),at=MK.activePens(s,t); // motståndarens 2-minuters tas bort vid mål i numerärt överläge
    if(ao.length>at.length){const two=ao.filter(p=>p.min===2).sort((a,b)=>a.left-b.left)[0];if(two)s.pens[o]=s.pens[o].filter(p=>p!==two)}}
  MK.save()};
MK.shot=(t,d)=>{MK.state.shots[t]=Math.max(0,MK.state.shots[t]+d);MK.save()};
MK.addPen=(t,nr,min)=>{MK.commit();const s=MK.state;s.pens[t].push({id:s.pid++,nr,min,left:min*60000});MK.save()};
MK.delPen=(t,id)=>{MK.commit();MK.state.pens[t]=MK.state.pens[t].filter(p=>p.id!==id);MK.save()};
MK.setTimeout_=t=>{MK.stop();MK.state.timeout=t==null?null:{team:t,endsAt:Date.now()+30000};MK.save()};
MK.reset=()=>{const s=MK.defaults();s.home=MK.state.home;s.away=MK.state.away;s.len=MK.state.len;s.gid=MK.state.gid;s.rosters=MK.state.rosters;s.dir=MK.state.dir;s.clock.remain=s.len.P*60000;MK.state=s;MK.save()};
// Gemensam vy-hjälp för outputs
MK.view=function(render){MK.init();MK.on(render);const loop=()=>{render(MK.state);requestAnimationFrame(loop)};loop()};
MK.pensHTML=(s,t,cls)=>s.pens[t].filter(p=>MK.penLeft(s,p,t)>0).map(p=>{const a=MK.activePens(s,t).includes(p)||p.min===10;
  return `<div class="${cls}${a?'':' q'}">#${p.nr} <b>${MK.fmtP(MK.penLeft(s,p,t))}</b></div>`}).join('');
// Tillägg: räkna upp/ner, redigera utvisning, powerbreak
MK.dir=s=>s.dir||'down';
MK.shown=s=>MK.dir(s)==='up'&&s.period!=='PAUS'?MK.periodLen(s.period)-MK.remain(s):MK.remain(s);
MK.fmtShown=s=>MK.dir(s)==='up'&&s.period!=='PAUS'?MK.fmtUp(MK.shown(s)):MK.fmt(MK.shown(s));
MK.fmtUp=ms=>{const sec=Math.floor(ms/1000);return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0')};
MK.setDir=d=>{MK.state.dir=d;MK.save()};
MK.setShown=ms=>{const s=MK.state;MK.setTime(MK.dir(s)==='up'&&s.period!=='PAUS'?MK.periodLen(s.period)-ms:ms)};
MK.editPen=(t,id,ms)=>{MK.commit();const p=MK.state.pens[t].find(p=>p.id===id);if(p)p.left=Math.max(0,ms);MK.state.pens[t]=MK.state.pens[t].filter(p=>p.left>0);MK.save()};
MK.powerbreak=on=>{if(on){MK.stop();MK.state.pb={endsAt:Date.now()+(MK.state.len.PB||90)*1000}}else MK.state.pb=null;MK.save()};
MK.cd=x=>x?Math.max(0,x.endsAt-Date.now()):0;
MK.overlay=s=>{const t=MK.cd(s.timeout),p=MK.cd(s.pb);
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
  if(teams.length<2)throw Error('Ingen laguppställning hittades');teams.forEach(t=>t.players.sort((a,b)=>a.no-b.no));return teams};
MK.loadGame=async gid=>{const t=await MK.fetchLineup(gid),s=MK.state;s.gid=gid;s.home=t[0].name;s.away=t[1].name;s.rosters=[t[0].players,t[1].players];MK.save();return t};
MK.pname2=(s,t,nr)=>{const p=((s.rosters||[])[t]||[]).find(p=>p.no==nr);return p?p.name:''};
