/* Nollställ allt (reset.js) – delas av På isen och Skott (Speaker har samma logik inbyggd).
   Klocka skriver signalen localStorage 'matchklocka_reset_v1' = {id,ts,gid} när operatören trycker "Nollställ allt" (delas även via LAN-hubben).
   Varje modul arkiverar först en kopia av sina data (nyckel rs_arkiv_<modul>_v1, de 5 senaste behålls) och rensar sedan. Inställningar rörs aldrig.
   Reagerar direkt (storage-händelse + kontroll var 3:e sekund) och vid sidladdning: data som är äldre än signalen rensas, data som skrivits efter signalen lämnas.
   Använd: <script src="reset.js"></script><script>MKRESET.register({name:'skott',keys:['skott_v1']})</script> i <head> före sidans egna skript. */
(()=>{
if(window.MKRESET)return;
const SIG='matchklocka_reset_v1',WK='rs_wts_v1',ls=localStorage;
let W={};try{W=JSON.parse(ls.getItem(WK))||{}}catch(e){}
const cfgs=[],watch=new Set(),blocked=new Set();
const sset=Storage.prototype.setItem;
Storage.prototype.setItem=function(k,v){if(this===ls&&blocked.has(k))return;sset.call(this,k,v);if(this===ls&&watch.has(k)){W[k]=Date.now();try{sset.call(ls,WK,JSON.stringify(W))}catch(e){}}};
const gsig=()=>{try{const s=JSON.parse(ls.getItem(SIG));return s&&s.id?s:null}catch(e){return null}};
const dts=k=>{let m=0;try{m=(window.LANSYNC&&LANSYNC.meta()[k])||0}catch(e){}return Math.max(W[k]||0,m)};
function arkiv(name,sig,data){const ak='rs_arkiv_'+name+'_v1';let A=[];try{A=JSON.parse(ls.getItem(ak))||[]}catch(e){}
  A.push({id:sig.id,ts:sig.ts,arkiverad:Date.now(),data});A=A.slice(-5);
  for(let n=A.length;n>=1;n--){try{sset.call(ls,ak,JSON.stringify(A.slice(-n)));return true}catch(e){}}return false}
const blk=c=>{(typeof c.keys==='function'?c.keys({}):c.keys).forEach(k=>blocked.add(k));(c.watch||[]).forEach(k=>blocked.add(k))};
function run(c,live){const sig=gsig();if(!sig)return false;const mk='rs_seen_'+c.name;
  if(ls.getItem(mk)===sig.id){/* redan hanterad av en annan sida i samma webbläsare (t.ex. Klocka): öppen sida måste ladda om så att data i minnet inte skrivs tillbaka */
    if(live&&!c.noreload&&c.seen0!==sig.id&&!(c.skip&&c.skip(sig))){c.seen0=sig.id;blk(c);setTimeout(()=>location.reload(),400)}return false}
  sset.call(ls,mk,sig.id);
  if(c.skip&&c.skip(sig))return false;
  if(live&&!c.noreload)blk(c);
  const grace=live?1500:0,data={},del=[];
  (typeof c.keys==='function'?c.keys(sig):c.keys).forEach(k=>{const v=ls.getItem(k);if(v==null)return;if(dts(k)>(+sig.ts||0)+grace)return;data[k]=v;del.push(k)});
  if(del.length)arkiv(c.name,sig,data);
  del.forEach(k=>{ls.removeItem(k);delete W[k]});try{sset.call(ls,WK,JSON.stringify(W))}catch(e){}
  if(c.after)c.after(sig,del);
  if(live&&!c.noreload)setTimeout(()=>location.reload(),400);
  return true}
const all=live=>cfgs.forEach(c=>{try{run(c,live)}catch(e){}});
addEventListener('storage',e=>{if(e.key===SIG)all(true)});setInterval(()=>all(true),3000);
window.MKRESET={register(c){cfgs.push(c);(c.watch||(typeof c.keys==='function'?[]:c.keys)).forEach(k=>watch.add(k));run(c,false);c.seen0=ls.getItem('rs_seen_'+c.name)},now(){cfgs.forEach(c=>{try{run(c,false)}catch(e){}})},SIG};
})();
