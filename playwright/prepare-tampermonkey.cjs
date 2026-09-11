const fs=require('node:fs');
const path=require('node:path');
const {extensionId,digest,delay,getWorker,inventoryFromStorage,readInventory,compareInventory,parseArgs}=require('./verify-tampermonkey.cjs');

// The only writes below are the normal Tampermonkey editor Save and Modify UI.
// Never rewrite extension trust records, enabled choices, or GM storage directly.
async function saveScript(context, expectedScript, replacementSource, {allowLocalModificationReset=false}={}) {
  const worker=await getWorker(context);
  const beforeStorage=await worker.evaluate(()=>chrome.storage.local.get(null));
  const before=inventoryFromStorage(beforeStorage);
  const uuid=typeof expectedScript==='string'?expectedScript:expectedScript.uuid;
  const expected=typeof expectedScript==='string'?before.scripts.find(s=>s.uuid===uuid):expectedScript;
  const current=before.scripts.find(s=>s.uuid===uuid);
  if(!current||!expected)throw new Error('Script is absent from the installed profile');
  for(const key of ['sourceHash','storageHash','enabled'])if(current[key]!==expected[key])throw new Error('Script '+key+' changed before editor save: '+uuid);
  const sourceKey='!extdb.@source#'+uuid;
  const sourceRecord=beforeStorage[sourceKey];
  if(typeof sourceRecord?.value!=='string')throw new Error('Unsupported Tampermonkey source format');
  const source=sourceRecord.value;
  if(replacementSource!==undefined){
    if(typeof replacementSource!=='string')throw new Error('Replacement source must be a string');
    const body=text=>text.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\r?\n?/,'');
    if(body(source)!==body(replacementSource))throw new Error('Only userscript metadata changes are permitted by this helper');
  }
  const desiredSource=replacementSource??source;
  const desiredHash=digest({...sourceRecord,value:desiredSource});
  const previousPages=new Set(context.pages());
  const page=await context.newPage();
  let ask;
  try {
    await page.goto(`chrome-extension://${extensionId}/options.html#nav=${uuid}+editor`);
    const editor=page.locator('.CodeMirror:visible');
    await editor.waitFor({timeout:20000});
    const editorSource=await editor.evaluate(element=>element.CodeMirror.getValue());
    if(editorSource!==source)throw new Error('Editor source differs from stored source: '+uuid);
    if(replacementSource!==undefined)await editor.evaluate((element,value)=>element.CodeMirror.setValue(value),desiredSource);
    await page.bringToFront();
    await editor.evaluate(element=>element.CodeMirror.focus());
    await page.keyboard.press('Control+s');
    const deadline=Date.now()+25000;
    let approved=false;
    while(Date.now()<deadline){
      ask=context.pages().find(candidate=>!previousPages.has(candidate)&&candidate!==page&&candidate.url().startsWith(`chrome-extension://${extensionId}/ask.html`));
      if(ask&&!approved){
        const modify=ask.getByRole('button',{name:'Modify',exact:true});
        await modify.waitFor({timeout:15000});
        // Dispatch the normal button event because headless Chromium may suspend
        // animation frames used by Playwright's stability check in popup windows.
        await modify.dispatchEvent('click');
        approved=true;
      }
      const afterStorage=await worker.evaluate(()=>chrome.storage.local.get(null));
      const after=inventoryFromStorage(afterStorage);
      const updated=after.scripts.find(s=>s.uuid===uuid);
      if(updated?.sourceHash===desiredHash&&!updated.evilness&&(approved||Date.now()>deadline-23500)){
        for(const old of before.scripts){
          const now=after.scripts.find(s=>s.uuid===old.uuid);
          if(!now||old.storageHash!==now.storageHash||old.enabled!==now.enabled)throw new Error('Editor save altered storage or enabled choice: '+old.uuid);
          if(old.uuid!==uuid&&old.sourceHash!==now.sourceHash)throw new Error('Editor save altered another script: '+old.uuid);
          if(old.checkForUpdates!==now.checkForUpdates)throw new Error('Editor save altered update preference: '+old.uuid);
          if((old.uuid!==uuid||(!allowLocalModificationReset&&replacementSource===undefined))&&old.locallyModified!==now.locallyModified)throw new Error('Editor save altered local modification status: '+old.uuid);
        }
        if(updated.enabled!==current.enabled)throw new Error('Editor save altered enabled choice: '+uuid);
        return updated;
      }
      await delay(200);
    }
    throw new Error('Tampermonkey editor approval did not finish: '+uuid);
  }finally{
    if(ask&&!ask.isClosed())await ask.close().catch(()=>{});
    await page.close().catch(()=>{});
  }
}

function runPowerShell(root, file, args=[]) {
  return new Promise((resolve,reject)=>{
    require('node:child_process').execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,file),...args],{windowsHide:true,timeout:60000,maxBuffer:65536},(error,stdout)=>error?reject(new Error(file+' did not complete successfully')):resolve(stdout));
  });
}
function hasPersistentExtension(root) {
  for(const name of ['Secure Preferences','Preferences']){
    const file=path.join(root,'browser-profile','Default',name);
    if(!fs.existsSync(file))continue;
    const preferences=JSON.parse(fs.readFileSync(file,'utf8'));
    const item=preferences.extensions?.settings?.[extensionId];
    if(item?.location===4&&typeof item.path==='string'&&path.resolve(item.path).toLowerCase()===path.join(root,'extension').toLowerCase())return true;
  }
  return false;
}
async function registerPersistentExtension(root) {
  const {openBrowser}=require(path.join(root,'open-browser.cjs'));
  const {context,close}=await openBrowser(root,{testMode:true},false);
  try {
    const session=await context.browser().newBrowserCDPSession();
    const initial=await session.send('Extensions.getExtensions');
    if(hasPersistentExtension(root)&&initial.extensions.some(item=>item.id===extensionId&&item.enabled&&path.resolve(item.path).toLowerCase()===path.join(root,'extension').toLowerCase()))return;
    const settings=await context.newPage();
    for(const page of context.pages())if(page!==settings)await page.close().catch(()=>{});
    await settings.goto('chrome://extensions/');
    await settings.evaluate(()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true}));
    await settings.getByRole('button',{name:'Load unpacked',exact:true}).waitFor({timeout:20000});
    const {processInfo}=await session.send('SystemInfo.getProcessInfo');
    const browserPid=processInfo.find(item=>item.type==='browser')?.id;
    if(!Number.isSafeInteger(browserPid))throw new Error('Cannot identify the owned browser process');
    // Chrome's normal Load unpacked picker creates a persistent installation.
    // CDP Extensions.loadUnpacked is temporary and retriggers Tampermonkey's
    // first-install protection after every browser restart.
    await Promise.all([
      runPowerShell(root,'Select-ExtensionFolder.ps1',['-BrowserPid',String(browserPid),'-ExtensionPath',path.join(root,'extension')]),
      settings.evaluate(()=>chrome.developerPrivate.loadUnpacked({failQuietly:false}))
    ]);
    const installed=await session.send('Extensions.getExtensions');
    if(!installed.extensions.some(item=>item.id===extensionId&&item.enabled&&path.resolve(item.path).toLowerCase()===path.join(root,'extension').toLowerCase()))throw new Error('Persistent Tampermonkey installation was not enabled at the destination');
  }finally{await close();}
  if(!hasPersistentExtension(root))throw new Error('Chrome did not persist the bundled Tampermonkey extension');
}

async function prepareMain(){
  const options=parseArgs(process.argv.slice(2));
  const expected=JSON.parse(fs.readFileSync(options.manifest,'utf8'));
  await runPowerShell(options.root,'owned-browser.ps1',['-CheckOnly']);
  await registerPersistentExtension(options.root);
  const {openBrowser}=require(path.join(options.root,'open-browser.cjs'));
  const {ensureUserScripts}=require(path.join(options.root,'ensure-user-scripts.cjs'));
  let result;
  for(let pass=0;pass<3;pass++){
    const {context,close}=await openBrowser(options.root,{testMode:true},true);
    try {
      await ensureUserScripts(context);
      await delay(3000);
      const actual=await readInventory(context);
      compareInventory(expected,actual,{requireApproval:pass>0});
      if(pass===0){
        const blocked=expected.scripts.filter(s=>s.requiredApproval&&actual.scripts.find(a=>a.uuid===s.uuid)?.evilness);
        console.log('Restoring approvals for '+blocked.length+' scripts while preserving enabled choices.');
        for(const script of blocked)await saveScript(context,script);
      }
      result=compareInventory(expected,await readInventory(context));
    }finally{await close();}
  }
  console.log(JSON.stringify({...result,restartsVerified:2}));
}
module.exports={saveScript,registerPersistentExtension,hasPersistentExtension};
if(require.main===module)prepareMain().catch(error=>{console.error(error.message);process.exitCode=1;});
