/* Istid (TOI) – delad logik för På isen (skriver) och OVR Rapport (läser).
   Logg per lag i paisen_v1.toi[lag] = append-only lista med poster (varje post har eget id, så två plattor kan slås ihop per lag):
     {id, k:'b'|'c'|'s'|'x', per:'P1', e:ms speltid i perioden (L - kvarvarande klocktid), ts:klockslag, on:[nummer på isen], st:[antal räknande utvisningar hemma, borta]}
     b = periodstart (uppställning vid start), c = byte (uppställningen ändrad), s = numerärändring (utvisning börjar/slutar), x = periodslut (stänger alla byten)
   Speltid e räknas bara upp när klockan går, så avbrott och pauser räknas inte. */
(()=>{
const PN=p=>{const m=/^P(\d)$/.exec(p||'');return m?+m[1]:/^OT/.test(p||'')?10+(+String(p).slice(2)||0):99};
const playing=p=>/^(P[1-9]|OT\d*)$/.test(p||'');
const Lms=(S,p)=>(/^OT/.test(p||'')?((S&&S.len)||{}).OT||5:((S&&S.len)||{}).P||20)*60000;
const eAt=(S,at)=>{if(!S||!S.clock||!playing(S.period))return null;const c=S.clock,L=Lms(S,S.period),rem=Math.max(0,c.remain-(c.running?at-c.startedAt:0));return Math.min(L,Math.max(0,L-rem))};
const str=S=>{try{return[0,1].map(t=>MK.activePens(S,t).length)}catch(e){return[0,0]}};
/* compute(poster, lag, ctx) -> {nr:{no, per:{P1:{tot,sh,shl,pp,bp}}}}  (tider i ms).
   ctx (valfritt) = {cur:aktuell period, e:aktuell speltid ms, Lof:period->längd ms}: stänger period som saknar periodslut. */
function compute(en,t,ctx){ctx=ctx||{};const R={},by={};(en||[]).forEach(x=>(by[x.per]=by[x.per]||[]).push(x));
 const gp=(n,p)=>{const o=R[n]||(R[n]={no:String(n),per:{}});return o.per[p]||(o.per[p]={tot:0,sh:0,shl:0,pp:0,bp:0})};
 Object.keys(by).sort((a,b)=>PN(a)-PN(b)).forEach(pk=>{
  const L=by[pk].slice().sort((a,b)=>(a.ts-b.ts)||(a.id<b.id?-1:a.id>b.id?1:0));
  let on=null,st=[0,0],e0=0;const sl={};
  const adv=e=>{if(on&&e>e0){const dt=e-e0,own=st[t]||0,opp=st[1-t]||0;on.forEach(n=>{const o=gp(n,pk);o.tot+=dt;sl[n]=(sl[n]||0)+dt;if(opp>own)o.pp+=dt;else if(own>opp)o.bp+=dt})}e0=e};
  const fin=n=>{const l=sl[n]||0;if(l>=1000){const o=gp(n,pk);o.sh++;o.shl+=l}delete sl[n]};
  L.forEach(x=>{adv(x.e);if(x.k==='x'){if(on)on.forEach(fin);on=null;return}
   const nw=(x.on||[]).map(String);if(on===null)on=[];
   on.filter(n=>!nw.includes(n)).forEach(fin);nw.filter(n=>!on.includes(n)).forEach(n=>{sl[n]=0});on=nw;if(x.st)st=x.st});
  if(on){let e=null;if(ctx.cur===pk&&ctx.e!=null)e=ctx.e;else if(ctx.cur&&PN(pk)<PN(ctx.cur)&&ctx.Lof)e=ctx.Lof(pk);if(e!=null)adv(e);on.forEach(fin)}
 });return R}
window.TOI={PN,playing,Lms,eAt,str,compute};
})();
