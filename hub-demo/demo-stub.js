/* Visningsversion: inga anrop till Swehockey, NDI-hjälpare eller LAN-hubb. */
(()=>{
if(window.__HUBDEMO_STUB)return;window.__HUBDEMO_STUB=1;
const raw=window.fetch.bind(window);
window.fetch=function(input,init){
  const url=String((input&&input.url)||input||'');
  if(/version\.json/i.test(url))return raw(input,init);
  if(/stats\.swehockey\.se|\/api\/ndi|127\.0\.0\.1|localhost:\d+/i.test(url)){
    const html=/swehockey\.se/i.test(url);
    return Promise.resolve(new Response(html?'':'{}',{status:200,headers:{'Content-Type':html?'text/html;charset=utf-8':'application/json'}}));
  }
  return raw(input,init);
};
window.WebSocket=function(url){
  return {url:String(url||''),readyState:3,bufferedAmount:0,extensions:'',protocol:'',
    close(){},send(){},addEventListener(){},removeEventListener(){},dispatchEvent(){return true},
    onopen:null,onclose:null,onerror:null,onmessage:null};
};
window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;
})();
