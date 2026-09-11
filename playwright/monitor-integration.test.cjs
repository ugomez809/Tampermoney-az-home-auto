const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(500); }
  throw new Error('Timed out waiting for integration condition');
}
test('relocated profile, full browser restart, duplicate guard and Windows check', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'monitor-test-'));
  console.log('Isolated test folder:', path.basename(dir));
  for (const file of ['launch.cjs','supervisor.cjs','watchdog.cjs','startup-tabs.cjs','ensure-user-scripts.cjs','open-browser.cjs','owned-browser.ps1','Start-Monitor.ps1','Install.ps1','prepare-tampermonkey.cjs','verify-tampermonkey.cjs','Select-ExtensionFolder.ps1']) fs.copyFileSync(path.join(__dirname,file),path.join(dir,file));
  for (const folder of ['browser-engine','browser-profile','extension','runtime']) {
    const source = folder === 'browser-profile' && process.env.GWPC_TEST_PROFILE ? process.env.GWPC_TEST_PROFILE : path.join(__dirname,folder);
    fs.cpSync(source,path.join(dir,folder),{recursive:true});
  }
  fs.symlinkSync(path.join(__dirname,'node_modules'),path.join(dir,'node_modules'),'junction');
  let hits = 0;
  const server = http.createServer((req,res) => { if (req.url === '/') hits++; res.end('<html><head><title>Local watchdog test</title></head><body><h1>Ticket Alpha</h1><time id="clock">0</time><script>setInterval(()=>document.querySelector("time").textContent=Date.now(),100)</script></body></html>'); });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  fs.writeFileSync(path.join(dir,'monitor-config.json'),JSON.stringify({ startUrl:'http://127.0.0.1:'+server.address().port+'/', inactivityMs:7000,pollMs:300,restartDelayMs:500,closeGraceMs:2000,testMode:true }));
  let child, other;
  try {
    execFileSync(path.join(dir,'runtime','node.exe'),[path.join(dir,'launch.cjs'),'--install-extension'],{windowsHide:true});
    // Verify extension identity and stored data survive a different absolute folder.
    const context = await chromium.launchPersistentContext(path.join(dir,'browser-profile'), {
      executablePath:path.join(dir,'browser-engine','gwpc-lab.exe'),headless:true,ignoreDefaultArgs:['--disable-extensions'],
      args:['--enable-unsafe-extension-debugging','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
    });
    try {
      const extension = { id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo' };
      const session = await context.browser().newBrowserCDPSession();
      const extensions = await session.send('Extensions.getExtensions');
      assert.ok(extensions.extensions.some(e => e.id === extension.id && e.enabled),'Installer must persist the extension across restarts');
      const extensionPage = await context.newPage();
      await extensionPage.goto('chrome-extension://' + extension.id + '/options.html');
      const count = await extensionPage.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).length);
      assert.ok(count > 0, 'Tampermonkey storage must be preserved');
      console.log('Relocated Tampermonkey extension and nonempty storage verified');
    } finally { await context.close(); }
    other = await chromium.launch({executablePath:path.join(__dirname,'browser-engine','gwpc-lab.exe'),headless:true});
    const otherPage = await other.newPage(); await otherPage.setContent('<h1>Other Playwright job</h1>');
    child = spawn(path.join(dir,'runtime','node.exe'),[path.join(dir,'supervisor.cjs')],{windowsHide:true,stdio:'ignore'});
    await until(() => hits >= 1);
    const startupPort = fs.readFileSync(path.join(dir,'browser-profile','DevToolsActivePort'),'utf8').split(/\r?\n/)[0];
    // Observer connections must not enable Playwright focus emulation: that
    // makes background tabs appear focused and changes the behavior under test.
    const startupBrowser = await chromium.connectOverCDP('http://127.0.0.1:' + startupPort, { noDefaults: true });
    await sleep(2500);
    assert.equal(startupBrowser.contexts()[0].pages().filter(p => p.url().startsWith('chrome-extension://')).length,0,'Normal startup must not open Tampermonkey tabs');
    assert.ok(startupBrowser.contexts()[0].serviceWorkers().some(w => w.url().includes('dhdgffkkebhmkfjojejmpbldmpobfkfo')),'Tampermonkey must stay enabled in the background');
    await startupBrowser.close();
    console.log('Normal startup has no Tampermonkey tab; extension remains running');
    const status = () => JSON.parse(fs.readFileSync(path.join(dir,'monitor-state','status.json')));
    const first = status().workerPid;
    const duplicate = spawn(path.join(dir,'runtime','node.exe'),[path.join(dir,'supervisor.cjs')],{windowsHide:true,stdio:'ignore'});
    await new Promise(r=>duplicate.once('exit',r));
    assert.equal(duplicate.exitCode,0);
    await until(() => hits >= 2);
    await until(() => status().workerPid !== first);
    assert.notEqual(status().workerPid,first);
    assert.equal(await otherPage.locator('h1').innerText(),'Other Playwright job');
    console.log('Stalled page restarted completely; unrelated browser survived');
    const portFile = path.join(dir,'browser-profile','DevToolsActivePort');
    await until(() => fs.existsSync(portFile));
    const port = fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
    const attached = await chromium.connectOverCDP('http://127.0.0.1:' + port, { noDefaults: true });
    const active = attached.contexts()[0].pages().find(p => p.url().startsWith('http://127.0.0.1'));
    await active.evaluate(() => { window.changer = setInterval(() => document.querySelector('h1').textContent = 'Ticket ' + Date.now(),100); });
    const progressingHits = hits;
    await sleep(10000);
    assert.equal(hits,progressingHits,'Meaningful foreground changes must keep browser running');
    const background = await attached.contexts()[0].newPage();
    await background.setContent('<h1>Background</h1><script>setInterval(()=>document.querySelector("h1").textContent=Date.now(),100)</script>');
    await active.bringToFront();
    await active.evaluate(() => clearInterval(window.changer));
    await sleep(1000);
    active.evaluate(() => { while (true) {} }).catch(()=>{});
    await until(() => hits > progressingHits);
    assert.equal(await otherPage.locator('h1').innerText(),'Other Playwright job');
    await attached.close().catch(()=>{});
    console.log('Foreground progress kept browser alive; hung foreground restarted despite background updates');
    fs.writeFileSync(path.join(dir,'monitor-state','paused'),'test pause');
    await until(() => child.exitCode !== null);
    const hitCount = hits;
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'Start-Monitor.ps1'),'-CheckOnly'],{windowsHide:true});
    await sleep(1200); assert.equal(hits,hitCount);
    fs.unlinkSync(path.join(dir,'monitor-state','paused'));
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'Start-Monitor.ps1'),'-CheckOnly'],{windowsHide:true});
    await until(() => hits > hitCount);
    console.log('Independent check restarted missing supervisor; intentional pause respected');
  } finally {
    fs.mkdirSync(path.join(dir,'monitor-state'),{recursive:true}); fs.writeFileSync(path.join(dir,'monitor-state','paused'),'test complete');
    await sleep(4500);
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'owned-browser.ps1')],{windowsHide:true});
    await other?.close(); server.close();
  }
});
