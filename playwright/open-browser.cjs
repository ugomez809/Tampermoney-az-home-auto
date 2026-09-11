const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

async function openBrowser(root, config, headless = false) {
  const profile = path.join(root, 'browser-profile');
  const endpointFile = path.join(profile, 'DevToolsActivePort');
  if (fs.existsSync(endpointFile)) fs.unlinkSync(endpointFile);
  const child = spawn(path.join(root, 'browser-engine', 'gwpc-lab.exe'), [
    '--user-data-dir=' + profile, '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--no-startup-window',
    ...(headless ? ['--headless=new'] : []),
    ...(config.testMode || headless ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] : [])
  ], { stdio: 'ignore', windowsHide: true });
  const childExited = new Promise(resolve => child.once('exit', resolve));
  let launchError;
  child.on('error', error => { launchError = error; });
  const deadline = Date.now() + 60000;
  let browser;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Private browser exited during launch');
    if (fs.existsSync(endpointFile)) {
      const [port] = fs.readFileSync(endpointFile, 'utf8').split(/\r?\n/);
      if (/^\d+$/.test(port)) {
        browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { noDefaults: true, timeout: 2000 }).catch(() => null);
        if (browser) break;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!browser) { child.kill(); throw new Error('Private browser connection timed out'); }
  return {
    context: browser.contexts()[0],
    close: async () => {
      try {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close');
      } finally {
        await browser.close().catch(() => {});
        // CDP disconnects before Chromium finishes flushing and releases the profile.
        let timer;
        try {
          await Promise.race([childExited, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Private browser did not finish closing')), 15000);
          })]);
        } finally { clearTimeout(timer); }
      }
    }
  };
}
module.exports = { openBrowser };
