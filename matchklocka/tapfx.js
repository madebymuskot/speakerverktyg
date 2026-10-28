/* Tryckeffekt: knappar blir tillfälligt gula (#FFB000, mörk text) vid tryck, mus/touch/tangentbord.
   Delegerat på document, så ingen knapp behöver ändras. Lägg <script src="tapfx.js"></script> i en modul för att aktivera.
   Undantag: disabled-knappar och knappar med data-nofx. Knappar med data-tapfx="red" får röd tryckfeedback i stället (bara Mute i Klocka). Ändrar aldrig storlek (bara färg), och klassen tas bort efter ~300 ms. */
(()=>{if(window.TAPFX)return;window.TAPFX=1;
const st=document.createElement('style');
st.textContent='button.tapfx:not(:disabled):not([data-tapfx]),button:not(:disabled):not([data-nofx]):not([data-tapfx]):active{background:#FFB000!important;color:#111!important;border-color:#FFB000!important;box-shadow:none}button.tapfx:not(:disabled):not([data-tapfx]) *,button:not(:disabled):not([data-nofx]):not([data-tapfx]):active *{color:#111!important}'
+'button[data-tapfx="red"].tapfx:not(:disabled),button[data-tapfx="red"]:not(:disabled):active{background:#E5383B!important;color:#fff!important;border-color:#fff!important;box-shadow:none}button[data-tapfx="red"].tapfx:not(:disabled) *,button[data-tapfx="red"]:not(:disabled):active *{color:#fff!important}';
(document.head||document.documentElement).appendChild(st);
const MIN=300,T=new WeakMap();
const btn=e=>{const t=e.target;const b=t&&t.closest?t.closest('button'):null;return b&&!b.disabled&&!b.hasAttribute('data-nofx')?b:null};
const off=b=>{clearTimeout(T.get(b));T.set(b,setTimeout(()=>b.classList.remove('tapfx'),MIN))};
const on=(b,safe)=>{clearTimeout(T.get(b));b.classList.add('tapfx');if(safe)T.set(b,setTimeout(()=>b.classList.remove('tapfx'),safe))};
let cur=null,since=0;
document.addEventListener('pointerdown',e=>{if(e.button>0)return;const b=btn(e);if(!b)return;cur=b;since=Date.now();on(b,2500)},true);
const up=()=>{if(!cur)return;const b=cur;cur=null;const rest=Math.max(0,MIN-(Date.now()-since));clearTimeout(T.get(b));T.set(b,setTimeout(()=>b.classList.remove('tapfx'),Math.max(rest,150)))};
document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
document.addEventListener('click',e=>{const b=btn(e);if(!b)return;if(e.detail===0){on(b);off(b)}else if(!b.classList.contains('tapfx')){on(b);off(b)}},true);
})();
