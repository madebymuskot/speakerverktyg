/* Zon-modul – ren logik (ingen DOM). Delas av zon.html, ovr.html (läsning) och tester (node).
   Nyckel: zon_v1 (synkas via LAN-hubben). Läser matchklocka_state_v1 (S) och skott_v1 (X, innehav + tekningar). Skriver ALDRIG i skott_v1.
   Zoner är lagrelativa och byter inte vid sidbyte: hd = hemmalagets försvarszon, nz = neutral zon, bd = bortalagets försvarszon. u = ej markerad.
   Tid räknas i SPELTID (periodlängd − kvarvarande), bara när klockan går. Innehav per zon: [hemma, borta, inget/okänt innehav].
   Tekningspunkter (9): c = mittpunkt; h1/h2 = hemmazonens punkter, b1/b2 = bortazonens; nh1/nh2 = neutrala punkter vid hemmalagets blålinje, nb1/nb2 vid bortalagets.
   Suffix 1 = spelarbåssidan, 2 = bortre sidan (fysisk långsida som inte byts vid periodbyte).
   Vinnaren sätts bara i Skott & innehav. Zonmodulen kopplar en vald punkt till tekningen som hör till samma klockstart (nyckel period:startedAt). */
(function(G){
const PER=/^(P[1-3]|OT)$/,ZN=['hd','nz','bd','u'],DOTS=['h1','h2','nh1','nh2','c','nb1','nb2','b1','b2'];
const dotZone=d=>d==='c'?'nz':d[0]==='h'?'hd':d[0]==='b'?'bd':'nz';
const emptyPer=()=>{const o={};ZN.forEach(z=>o[z]=[0,0,0]);return o};
const init=o=>{const d={v:1,z:null,zp:null,acc:{},last:null,fo:[],pend:null,foSeen:{},seg:null,rid:null,lastK:null,owner:null,hb:0};if(!o||typeof o!=='object')return d;for(const k in d)if(!(k in o))o[k]=d[k];return o};
const cp=x=>JSON.parse(JSON.stringify(x));
const live=(S,now)=>!!(S&&S.clock&&now-(S.v||0)<6*3600e3);
const plen=(S,p)=>((p==='OT'?(S.len&&S.len.OT!=null?S.len.OT:5):(S.len&&S.len.P||20))*60000);
const remain=(S,now)=>Math.max(0,S.clock.remain-(S.clock.running?now-S.clock.startedAt:0));
const running=(S,now)=>live(S,now)&&!!S.clock.running&&PER.test(S.period)&&!(S.pre&&S.pre.endsAt>now);
const foCnt=(X,p)=>{const d=X&&X.d&&X.d[p];return d&&d.fo?[d.fo[0]|0,d.fo[1]|0]:[0,0]};
/* Ett tick: banka speltid, hantera period/recall/tekningskoppling. Muterar och returnerar Z. */
function step(Z,S,X,now){Z=init(Z);
 if(!live(S,now))return Z;
 const rid=(S.recallEv&&S.recallEv.id)||'';
 if(Z.rid==null)Z.rid=rid;
 else if(rid&&rid!==Z.rid){Z.rid=rid;
  /* Recall: tillbaka till läget vid senaste start (som skott_v1 gör med tekning+innehav). Skott rörs inte här. */
  const rp=Z.seg&&Z.seg.pend&&Z.seg.pend.per===S.period?Z.seg.pend:null;
  if(Z.seg){Z.acc=Z.seg.acc;Z.fo=Z.seg.fo;Z.z=Z.seg.z;Z.zp=Z.seg.zp}
  Z.seg=null;Z.pend=rp;Z.last=null;Z.lastK=null;Z.foSeen={};if(PER.test(S.period))Z.foSeen[S.period]=foCnt(X,S.period);return Z}
 const p=S.period;
 if(!PER.test(p)){Z.last=null;if(Z.zp&&Z.zp!==p){Z.z=null;Z.zp=null}Z.pend=null;return Z}
 if(Z.zp&&Z.zp!==p){Z.z=null;Z.zp=null;Z.pend=null}/* nytt period => zon okänd tills rapportören markerar */
 Z.acc[p]=Z.acc[p]||emptyPer();
 const run=running(S,now),k=run?p+':'+S.clock.startedAt:null,g=plen(S,p)-remain(S,now);
 if(run&&(!Z.last||Z.last.k!==k)){/* ny klockstart = ny tekning */
  Z.seg={acc:cp(Z.acc),fo:cp(Z.fo),z:Z.z,zp:Z.zp,pend:Z.pend&&Z.pend.k==null?cp(Z.pend):null};Z.lastK=k;
  if(Z.pend&&Z.pend.k==null&&Z.pend.per===p){Z.pend.k=k;Z.z=dotZone(Z.pend.dot);Z.zp=p}/* vald punkt => tekningens zon blir aktiv vid starten */else if(Z.pend&&Z.pend.k!==k)Z.pend=null}
 const pi=X&&X.cur!=null&&(X.per==null||X.per===p)?X.cur:2;
 const bankTo=(g1)=>{const d=g1-Z.last.g;if(d>0&&d<=5000)Z.acc[p][Z.z||'u'][pi]+=d};
 if(run&&(!Z.last||Z.last.k!==k))Z.last={per:p,g:plen(S,p)-S.clock.remain,k};/* räkna från själva starten */
 if(run&&Z.last.k===k&&Z.last.per===p)bankTo(g);
 else if(!run&&Z.last&&Z.last.per===p&&S.clock&&!S.clock.running)bankTo(plen(S,p)-S.clock.remain);/* fram till stoppet */
 Z.last=run?{per:p,g,k}:null;
 /* Tekningar: läs Skott & innehav. +1 => vinnare för aktuell/sista start; −1 (ångra) => ta bort senaste i perioden. */
 const c=foCnt(X,p),pr=Z.foSeen[p];
 if(pr){const dh=c[0]-pr[0],db=c[1]-pr[1];
  if(dh<0||db<0){for(let t=0;t<2;t++)for(let n=0;n<-Math.min(0,t?db:dh);n++){for(let i=Z.fo.length-1;i>=0;i--)if(Z.fo[i].per===p&&Z.fo[i].w===t){Z.fo.splice(i,1);break}}}
  const inc=Math.max(0,dh)+Math.max(0,db),fk=k||Z.lastK;
  if(inc===1&&fk&&!Z.fo.some(e=>e.k===fk)){const w=dh>0?0:1;let dot=null;
   if(Z.pend&&Z.pend.k===fk){dot=Z.pend.dot;Z.pend=null}
   Z.fo.push({k:fk,per:p,w,dot,g})}
  else if(inc>0)for(let t=0;t<2;t++)for(let n=0;n<Math.max(0,t?db:dh);n++)Z.fo.push({k:null,per:p,w:t,dot:null,g,amb:1});/* oklart vilken start: utan punkt */
 }
 Z.foSeen[p]=c;
 return Z}
/* Zonklick. Samma zon igen = ingen ändring. Kör step() före så att tiden fram till nu hamnar i gamla zonen. */
function setZone(Z,zone,S){if(['hd','nz','bd',null].indexOf(zone)<0)return false;if(Z.z===zone)return false;Z.z=zone;Z.zp=zone?S&&S.period:null;return true}
/* Punktklick. Endast när klockan står (avblåsning): punkten väntar på nästa start och kopplas till den startens vinnare
   från Skott & innehav. Klocka går => låst (ingen ändring). Nytt klick under samma avblåsning = rättelse. */
function setDot(Z,dot,S,now){if(DOTS.indexOf(dot)<0||!live(S,now)||!PER.test(S.period))return'ignored';const p=S.period;
 /* Punkt får bara väljas vid avblåsning: klockan måste uttryckligen stå (clock.running===false). Går den (även under nedräkning) => låst. */
 if(dotLocked(S,now))return'locked';
 /* klockan står: alltid nästa start (koppla aldrig bakåt till en tidigare tekning – för tvetydigt) */
 Z.pend={dot,per:p,k:null};return'pending-next'}
const dotLocked=(S,now)=>!live(S,now)||!S.clock||S.clock.running!==false;
function clearDot(Z){Z.pend=null}
/* Rapport: tid per zon och innehav per zon, totalt och per period (ms). */
function report(Z,X,pers){Z=init(Z);pers=pers||['P1','P2','P3','OT'];const r={per:{},tot:emptyPer()};
 pers.forEach(p=>{const a=Z.acc[p]||emptyPer();r.per[p]=cp(a);ZN.forEach(z=>a[z].forEach((v,i)=>r.tot[z][i]+=v))});
 /* tekningar: per punkt och lag; ospecificerad = Skott & innehavs antal minus de med punkt (aldrig negativt) */
 const f={per:{},tot:{}};const add=(o,d,w)=>{o[d]=o[d]||[0,0];o[d][w]++};
 pers.forEach(p=>{const o=f.per[p]={};Z.fo.filter(e=>e.per===p&&e.dot).forEach(e=>{add(o,e.dot,e.w);add(f.tot,e.dot,e.w)});
  const c=foCnt(X,p),loc=[0,1].map(t=>Z.fo.filter(e=>e.per===p&&e.dot&&e.w===t).length);
  const u=[0,1].map(t=>Math.max(0,c[t]-loc[t]));if(u[0]||u[1]){o.ospec=u;f.tot.ospec=f.tot.ospec||[0,0];f.tot.ospec[0]+=u[0];f.tot.ospec[1]+=u[1]}});
 r.fo=f;return r}
const API={dotLocked,ZN,DOTS,dotZone,init,step,setZone,setDot,clearDot,report,running,live,plen,remain,emptyPer};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else G.ZONCORE=API;
})(typeof window!=='undefined'?window:globalThis);
