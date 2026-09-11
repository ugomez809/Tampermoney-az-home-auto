const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const extensionId = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getWorker(context) {
  for (let attempt=0; attempt<80; attempt++) {
    const worker=context.serviceWorkers().find(w=>w.url().startsWith(`chrome-extension://${extensionId}/`));
    if(worker)return worker;
    await delay(250);
  }
  throw new Error('Tampermonkey service worker did not start');
}
function inventoryFromStorage(storage, registered=0) {
  const scripts=Object.entries(storage).filter(([key,record])=>key.startsWith('!extdb.@meta#')&&record?.value?.uuid&&record?.value?.name).map(([, {value:meta}])=>({
    uuid:meta.uuid,name:meta.name,version:meta.version,enabled:!!meta.enabled,deleted:!!meta.deleted,
    checkForUpdates:!!meta.options?.check_for_updates,locallyModified:!!meta.options?.user_modified,
    evilness:meta.evilness||0,requiredApproval:!!meta.enabled&&!meta.deleted&&!meta.evilness,
    sourceHash:digest(storage['!extdb.@source#'+meta.uuid]),storageHash:digest(storage['!extdb.@st#'+meta.uuid])
  })).sort((a,b)=>a.uuid.localeCompare(b.uuid));
  return {schema:1,extensionId,scripts,registered};
}
async function readInventory(context) {
  const worker=await getWorker(context);
  const storage=await worker.evaluate(()=>chrome.storage.local.get(null));
  const registered=await worker.evaluate(async()=>chrome.userScripts?(await chrome.userScripts.getScripts()).length:0);
  return inventoryFromStorage(storage,registered);
}
function compareInventory(expected,actual,{requireApproval=true}={}) {
  if(!Array.isArray(expected.scripts)||!expected.scripts.length)throw new Error('Tampermonkey manifest has no scripts');
  if(expected.scripts.length!==actual.scripts.length)throw new Error('Tampermonkey script count mismatch');
  let enabled=0,blocked=0;
  for(const before of expected.scripts){
    const after=actual.scripts.find(s=>s.uuid===before.uuid);
    if(!after)throw new Error('Tampermonkey script missing: '+before.uuid);
    for(const key of ['name','version','enabled','sourceHash','storageHash']){
      if(before[key]!==after[key])throw new Error('Tampermonkey '+key+' mismatch: '+before.uuid);
    }
    for(const key of ['checkForUpdates','locallyModified'])if(before[key]!==undefined&&before[key]!==after[key])throw new Error('Tampermonkey '+key+' mismatch: '+before.uuid);
    if(before.deleted!==undefined&&before.deleted!==after.deleted)throw new Error('Tampermonkey deleted state mismatch: '+before.uuid);
    if(before.requiredApproval){enabled++;if(after.evilness||after.deleted)blocked++;}
  }
  if(requireApproval&&blocked)throw new Error('Tampermonkey approval missing for '+blocked+' enabled scripts');
  if(requireApproval&&!actual.registered)throw new Error('Tampermonkey has no registered dispatcher bundles');
  return {scripts:actual.scripts.length,enabled,disabled:actual.scripts.filter(s=>!s.enabled).length,blocked,registered:actual.registered};
}
function parseArgs(argv){const options={root:__dirname};for(let i=0;i<argv.length;i++){const option=argv[i];if(!['--root','--manifest','--capture'].includes(option)||!argv[i+1])throw new Error('Invalid verifier argument');options[option.slice(2)]=path.resolve(argv[++i]);}options.manifest||=path.join(options.root,'tampermonkey-manifest.json');return options;}
async function verifyMain(){
  const options=parseArgs(process.argv.slice(2));
  const {openBrowser}=require(path.join(options.root,'open-browser.cjs'));
  const {ensureUserScripts}=require(path.join(options.root,'ensure-user-scripts.cjs'));
  const {context,close}=await openBrowser(options.root,{testMode:true},true);
  try {
    await ensureUserScripts(context);
    await delay(3000);
    const actual=await readInventory(context);
    if(options.capture){fs.writeFileSync(options.capture,JSON.stringify(actual,null,2));console.log(JSON.stringify({captured:actual.scripts.length,requiredApproval:actual.scripts.filter(s=>s.requiredApproval).length}));}
    else console.log(JSON.stringify(compareInventory(JSON.parse(fs.readFileSync(options.manifest,'utf8')),actual)));
  }finally{await close();}
}
module.exports={extensionId,digest,delay,getWorker,inventoryFromStorage,readInventory,compareInventory,parseArgs};
if(require.main===module)verifyMain().catch(error=>{console.error(error.message);process.exitCode=1;});
