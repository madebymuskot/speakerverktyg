/* NDI/broadcast-hjälp: ?bg=transparent|green|#hex|färgnamn, ?ndi=1, ?pos=tl|tr|bl|br|bc|tc, ?dur=sek, ?scale=1 */
(()=>{const Q=new URLSearchParams(location.search),N=window.NDI={Q,RED:'#AF2E32',YEL:'#FFD100'};
const bg=(Q.get('bg')||'transparent').trim(),M={green:'#00b140',blue:'#0047bb',black:'#000',svart:'#000',gron:'#00b140',grön:'#00b140'};
N.bg=bg==='transparent'||bg==='none'?'transparent':(M[bg]||(/^[0-9a-f]{3,8}$/i.test(bg)?'#'+bg:bg));
const css=document.createElement('style');css.textContent=`html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden!important;background:${N.bg}!important;cursor:none!important}::-webkit-scrollbar{display:none}#appnew,#appv{display:none!important}
.stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;font-family:system-ui,'Segoe UI',Roboto,Arial,sans-serif;color:#fff}`;document.head.appendChild(css);
const fit=()=>{const s=document.querySelector('.stage');if(!s)return;const k=Math.min(innerWidth/1920,innerHeight/1080);s.style.transform=`translate(${(innerWidth-1920*k)/2}px,${(innerHeight-1080*k)/2}px) scale(${k})`};
addEventListener('resize',fit);addEventListener('DOMContentLoaded',fit);N.fit=fit;
N.pos=Q.get('pos');N.dur=(+Q.get('dur')||8)*1000;
N.col=t=>t?N.YEL:N.RED;N.fg=t=>t?'#000':'#fff';
N.short=n=>(n||'').replace(/\s+(HC|IF|HF|SK|BK|IK|HK)$/i,'').toUpperCase();
/* Speaker-protokoll: hitta spelare kopplade till klockhändelse-id */
N.proto=id=>{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(!/^speakerapp_protokoll_/.test(k))continue;try{const p=JSON.parse(localStorage.getItem(k)||'[]').find(x=>x.ev===id);if(p)return p}catch(e){}}return null};
N.pl=p=>p?('#'+p.no+(p.name?' '+p.name:'')):'';
N.since=Date.now()-(+Q.get('replay')||0)*1000;})();
