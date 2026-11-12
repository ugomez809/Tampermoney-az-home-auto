// Node 22+ built-ins only. Called by watchdog.ps1 after checking ownership of the port.
const fs = require('node:fs');
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fingerprint(snapshot) {
  return digest(snapshot.pages.filter(p => p.url.startsWith('https://app.agencyzoom.com/')).map(p => ({
    url:p.url, ready:p.ready, panel:p.panel, ticket:p.ticket, fields:p.fields, completed:p.completed,
    status:p.status.replace(/\(\d+s\)/g,'(countdown)').replace(/\d+m without Zillow/g,'idle without Zillow')
  })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function decide(snapshot, previous) {
  const az = snapshot.pages.filter(p => p.url.startsWith('https://app.agencyzoom.com/'));
  if (!az.length || az.some(p => p.ready !== 'complete' || !p.panel || p.status === 'Stopped')) return 'restart';
  return previous?.fingerprint === fingerprint(snapshot) ? 'restart' : 'healthy';
}
function call(wsUrl, method, params={}) {
  const u = new URL(wsUrl);
  if (u.protocol !== 'ws:' || !['127.0.0.1','localhost'].includes(u.hostname)) throw Error('Non-local debug socket rejected');
  return new Promise((resolve,reject) => {
    const ws = new WebSocket(wsUrl);
    let settled=false;
    const finish = (err,value) => { if(settled) return; settled=true; clearTimeout(timer); try { ws.close(); } catch {} err ? reject(err) : resolve(value); };
    const timer = setTimeout(()=>finish(Error('Chrome did not answer within 15 seconds')),15000);
    ws.onopen = () => ws.send(JSON.stringify({id:1,method,params}));
    ws.onerror = () => finish(Error('Chrome debug connection failed'));
    ws.onmessage = event => {
      let data; try { data=JSON.parse(event.data); } catch { return; }
      if(data.id===1) finish(data.error ? Error(data.error.message) : null,data.result);
    };
  });
}
async function inspect(port) {
  if(!Number.isInteger(port)||port<1||port>65535) throw Error('Invalid debugging port');
  const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw Error('Chrome tab discovery failed');
  const tabs=await response.json();
  const pages=[];
  for(const tab of tabs.filter(t=>t.type==='page')) {
    if(!/^https:\/\/(app\.agencyzoom\.com|(?:www\.)?zillow\.com)\//.test(tab.url)) {
      const u=new URL(tab.url); pages.push({url:u.origin+u.pathname,focused:null}); continue;
    }
    if(Number(new URL(tab.webSocketDebuggerUrl).port)!==port) throw Error('Unexpected debug socket port');
    // Read only visible page content. Never copy cookies, credentials or application storage.
    const result=await call(tab.webSocketDebuggerUrl,'Runtime.evaluate',{returnByValue:true,expression:`JSON.stringify((()=>{
      const panel=document.querySelector('#tm-az-zillow-ticket-enricher-panel');
      const status=document.querySelector('#tm-az-zillow-ticket-enricher-status')?.textContent?.trim()||'';
      const header=document.querySelector('#notePanelContainer h3')?.textContent||'';
      const logs=document.querySelector('#tm-az-zillow-ticket-enricher-logs')?.value||'';
      const completed=(logs.match(/[^\\n]*Completed ticket [^\\n]+/g)||[]).at(-1)||'';
      return {url:location.origin+location.pathname,ready:document.readyState,focused:document.hasFocus(),
        panel:!!panel,status,ticket:(header.match(/ID:\\s*(\\d+)/)||[])[1]||'',completed,
        fields:Array.from(document.querySelectorAll('#detailDockform input:not([type=hidden]):not([type=password]),#detailDockform select')).map(e=>e.value)};
    })())`});
    if(result.exceptionDetails||!result.result?.value) throw Error('Page state inspection failed');
    const page=JSON.parse(result.result.value);
    page.fields=digest(page.fields); // Record changes without writing customer field values to the log.
    pages.push(page);
  }
  return {pages};
}
if(require.main===module) (async()=>{
  const snapshot=await inspect(Number(process.argv[2]));
  const stateFile=process.argv[3];
  let previous=null;
  if(fs.existsSync(stateFile)) previous=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const action=decide(snapshot,previous);
  const record={at:new Date().toISOString(),action,fingerprint:fingerprint(snapshot),...snapshot};
  fs.writeFileSync(stateFile+'.tmp',JSON.stringify(record,null,2));
  fs.renameSync(stateFile+'.tmp',stateFile);
  console.log(JSON.stringify(record));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={decide,fingerprint,call,inspect};
