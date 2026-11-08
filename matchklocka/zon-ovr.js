/* OVR: Zon & tekningspunkter. Läser zon_v1 + skott_v1 (+ matchklocka_state_v1 för lagnamn). Skriver ingenting. Följer OVR:s periodfilter (F). */
(()=>{const C=window.ZONCORE;if(!C)return;const el=document.getElementById('zonRep');if(!el)return;
const J=k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const mm=ms=>{const s=Math.round(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const pc=(a,b)=>b?Math.round(a*100/b)+'%':'–';
let last='';
function draw(){const Z=J('zon_v1'),X=J('skott_v1'),S=J('matchklocka_state_v1');
 const tm=t=>(S&&(S.short&&S.short[t]||(t?S.away:S.home)))||(t?'Borta':'Hemma');
 const Fv=typeof F!=='undefined'?F:'Alla',PP=Fv==='Alla'?['P1','P2','P3','OT']:[Fv];
 const key=JSON.stringify([Z&&Z.acc,Z&&Z.fo,X&&X.d,Fv,tm(0),tm(1)]);if(key===last)return;last=key;
 if(!Z){el.innerHTML='<h2>Zoner</h2><p class="mut">Zonmodulen har ingen data för den här matchen.</p>';return}
 const R=C.report(Z,X,PP),zn={hd:'Försvarszon '+tm(0),nz:'Neutral zon',bd:'Försvarszon '+tm(1),u:'Ej markerad zon'};
 const used=PP.filter(p=>Z.acc[p]&&C.ZN.some(z=>Z.acc[p][z].some(v=>v>0)));
 const row=(lab,a,T)=>{const s=a[0]+a[1]+a[2];return `<tr><td>${esc(lab)}</td><td><b>${mm(s)}</b> <small class="mut">${pc(s,T)}</small></td><td>${mm(a[0])} <small class="mut">${pc(a[0],a[0]+a[1])}</small></td><td>${mm(a[1])} <small class="mut">${pc(a[1],a[0]+a[1])}</small></td><td class="mut">${mm(a[2])}</td></tr>`};
 const tab=(lab,o)=>{const T=C.ZN.reduce((x,z)=>x+o[z][0]+o[z][1]+o[z][2],0);return `<h3>${esc(lab)}</h3><table class="num"><tr><th>Zon</th><th>Speltid (andel)</th><th>Innehav ${esc(tm(0))}</th><th>Innehav ${esc(tm(1))}</th><th>Inget/okänt innehav</th></tr>`+C.ZN.filter(z=>z!=='u'||o.u.some(v=>v>0)).map(z=>row(zn[z],o[z],T)).join('')+`<tr class="tot"><td>Totalt</td><td><b>${mm(T)}</b></td><td>${mm(C.ZN.reduce((x,z)=>x+o[z][0],0))}</td><td>${mm(C.ZN.reduce((x,z)=>x+o[z][1],0))}</td><td class="mut">${mm(C.ZN.reduce((x,z)=>x+o[z][2],0))}</td></tr></table>`};
 let h='<h2>Zoner <small class="mut">(speltid m:ss, bara när klockan gick · innehav från Skott &amp; innehav · % innehav = lagets andel av lagens innehav i zonen)</small></h2>';
 if(!used.length)h+='<p class="mut">Ingen zontid registrerad'+(Fv==='Alla'?'':' i '+esc(Fv))+'.</p>';
 else{if(PP.length>1)h+=tab('Hela matchen',R.tot);used.forEach(p=>h+=tab(p,R.per[p]))}
 const DN={c:'Mittpunkten',h1:'Försv.zon '+tm(0)+' – båssidan',h2:'Försv.zon '+tm(0)+' – bortre sidan',b1:'Försv.zon '+tm(1)+' – båssidan',b2:'Försv.zon '+tm(1)+' – bortre sidan',nh1:'Neutral vid '+tm(0)+'s blå – båssidan',nh2:'Neutral vid '+tm(0)+'s blå – bortre sidan',nb1:'Neutral vid '+tm(1)+'s blå – båssidan',nb2:'Neutral vid '+tm(1)+'s blå – bortre sidan',ospec:'Ingen punkt angiven'};
 const fot=(lab,o)=>{const ks=C.DOTS.concat(['ospec']).filter(k=>o[k]);if(!ks.length)return'';return `<h3>${esc(lab)}</h3><table class="num"><tr><th>Tekningspunkt</th><th>${esc(tm(0))}</th><th>${esc(tm(1))}</th><th>Totalt</th></tr>`+ks.map(k=>`<tr><td>${esc(DN[k])}</td><td>${o[k][0]}</td><td>${o[k][1]}</td><td><b>${o[k][0]+o[k][1]}</b></td></tr>`).join('')+'</table>'};
 let f=(PP.length>1?fot('Hela matchen',R.fo.tot):'')+PP.map(p=>fot(p,R.fo.per[p]||{})).join('');
 h+='<h2>Tekningar per punkt <small class="mut">(vunna tekningar; vinnare från Skott &amp; innehav, punkt från Zon)</small></h2>'+(f||'<p class="mut">Inga tekningar registrerade.</p>');
 el.innerHTML=h}
draw();setInterval(draw,2000);addEventListener('storage',e=>{if(e.key==='zon_v1'||e.key==='skott_v1')draw()});
document.addEventListener('click',()=>setTimeout(()=>{last='';draw()},50));
})();
