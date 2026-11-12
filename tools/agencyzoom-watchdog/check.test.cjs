const {test}=require('node:test');
const assert=require('node:assert/strict');
const {decide,fingerprint}=require('./check.cjs');
const page={url:'https://app.agencyzoom.com/referral/pipeline',ready:'complete',panel:true,status:'Waiting for Zillow (74s)',ticket:'TEST',fields:'abc',completed:'',focused:true};
test('first loaded observation establishes baseline; unchanged next check restarts',()=>{
 const s={pages:[page]}; assert.equal(decide(s,null),'healthy');
 assert.equal(decide(s,{fingerprint:fingerprint(s)}),'restart');
});
test('countdown changes do not hide a stuck ticket',()=>{
 assert.equal(fingerprint({pages:[page]}),fingerprint({pages:[{...page,status:'Waiting for Zillow (12s)'}]}));
});
test('real field or completion progress keeps the browser running',()=>{
 const old={fingerprint:fingerprint({pages:[page]})};
 for(const change of [{fields:'new'},{completed:'Completed ticket NEXT'}]) assert.equal(decide({pages:[{...page,...change}]},old),'healthy');
});
test('missing AgencyZoom, unloaded page, missing script and stopped script recover',()=>{
 for(const pages of [[],[{...page,ready:'loading'}],[{...page,panel:false}],[{...page,status:'Stopped'}]]) assert.equal(decide({pages},null),'restart');
});
test('browser inspection reads DOM state and hashes private form values',async()=>{
 const {inspect}=require('./check.cjs');
 const originalFetch=global.fetch, originalWs=global.WebSocket;
 global.fetch=async()=>({ok:true,json:async()=>[{type:'page',url:page.url,webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/page/TEST'}]});
 global.WebSocket=class {
   constructor(){queueMicrotask(()=>this.onopen());}
   close(){}
   send(raw){
     const command=JSON.parse(raw); assert.equal(command.method,'Runtime.evaluate');
     const document={readyState:'complete',hasFocus:()=>true,querySelector:s=>({
       '#tm-az-zillow-ticket-enricher-panel':{},
       '#tm-az-zillow-ticket-enricher-status':{textContent:'Ready'},
       '#notePanelContainer h3':{textContent:'ID: 123'},
       '#tm-az-zillow-ticket-enricher-logs':{value:'Completed ticket 122'}
     })[s],querySelectorAll:()=>[{value:'private fixture'}]};
     const location={origin:'https://app.agencyzoom.com',pathname:'/referral/pipeline'};
     const value=require('node:vm').runInNewContext(command.params.expression,{document,location});
     queueMicrotask(()=>this.onmessage({data:JSON.stringify({id:1,result:{result:{value}}})}));
   }
 };
 try {
   const snapshot=await inspect(12345); assert.equal(snapshot.pages[0].ticket,'123');
   assert.equal(snapshot.pages[0].fields.length,64);
   assert.ok(!JSON.stringify(snapshot).includes('private fixture'));
 } finally {global.fetch=originalFetch;global.WebSocket=originalWs;}
});
