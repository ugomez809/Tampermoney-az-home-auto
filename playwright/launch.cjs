const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openBrowser } = require('./open-browser.cjs');
const { pageSnapshot, hash } = require('./watchdog.cjs');
const { isTampermonkeyStartupTab } = require('./startup-tabs.cjs');
const { ensureUserScripts } = require('./ensure-user-scripts.cjs');
if (!process.argv.includes('--worker') && !process.argv.includes('--setup') && !process.argv.includes('--install-extension')) {
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'Start-Monitor.ps1')], { stdio: 'inherit', windowsHide: true });
} else {
  main().catch(error => {
    // Only error class is persisted: no page text, URLs or credentials.
    console.error('Browser worker failed:', error.name);
    process.send?.({ type: 'failure' }); process.exitCode = 1; process.disconnect?.();
  });
}
async function main() {
  const setup = process.argv.includes('--setup');
  const installExtension = process.argv.includes('--install-extension');
  if (installExtension) await require('./prepare-tampermonkey.cjs').registerPersistentExtension(__dirname);
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'monitor-config.json')));
  const sessions = path.join(__dirname, 'browser-profile', 'Default', 'Sessions');
  if (fs.existsSync(sessions)) {
    const saved = fs.readdirSync(sessions).filter(name => /^(Session|Tabs)_\d+$/.test(name));
    if (saved.length) {
      const archive = path.join(__dirname, 'browser-profile', 'startup-session-backups', String(Date.now()));
      fs.mkdirSync(archive, { recursive: true });
      for (const name of saved) fs.renameSync(path.join(sessions, name), path.join(archive, name));
    }
  }
  const { context, close: closeBrowser } = await openBrowser(__dirname, config, installExtension);
  let closing = false;
  async function close() {
    if (closing) return; closing = true;
    await closeBrowser().catch(() => {});
    if (process.connected) process.disconnect();
  }
  process.on('message', message => { if (message?.type === 'close') close(); });
  process.on('disconnect', () => close());
  context.on('close', () => { closing = true; if (process.connected) process.disconnect(); });
  try {
    // A migrated unpacked extension may need registration at its new path.
    // The dashboard is never an automation page, including late startup tabs.
    if (!setup && !installExtension) {
      const dismissDashboard = candidate => {
        const dismiss = () => {
          if (isTampermonkeyStartupTab(candidate.url())) candidate.close().catch(() => {});
        };
        candidate.on('framenavigated', dismiss);
        dismiss();
      };
      context.on('page', dismissDashboard);
      context.pages().forEach(dismissDashboard);
    }
    const session = await context.browser().newBrowserCDPSession();
    const ready = installed => installed.extensions.some(extension => extension.id === 'dhdgffkkebhmkfjojejmpbldmpobfkfo'
      && extension.enabled && path.resolve(extension.path).toLowerCase() === path.join(__dirname, 'extension').toLowerCase());
    let installed = await session.send('Extensions.getExtensions');
    const extensionDeadline = Date.now() + 5000;
    while (!ready(installed) && Date.now() < extensionDeadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      installed = await session.send('Extensions.getExtensions');
    }
    if (!ready(installed)) throw new Error('Tampermonkey is not installed at this location. Run INSTALL.bat again.');
    await session.detach();
    await ensureUserScripts(context);
    if (installExtension) {
      return;
    }
    const page = await context.newPage();
    for (const old of context.pages()) if (old !== page) await old.close().catch(() => {});
    if (setup) {
      await page.goto(config.startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.bringToFront();
      return;
    }
    process.send?.({ type: 'ready' });
    page.goto(config.startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.bringToFront();
    const ids = new WeakMap(); let nextId = 0, foreground = page;
    while (!closing) {
      const pages = context.pages().filter(p => !p.isClosed());
      if (!pages.length) break;
      const samples = await Promise.all(pages.map(async p => ({ page: p, value: await bounded(p.evaluate(pageSnapshot), 1800) })));
      const focused = samples.find(s => s.value?.focused);
      const visible = samples.filter(s => s.value?.visible);
      foreground = focused?.page || (visible.length === 1 ? visible[0].page : foreground);
      const current = samples.find(s => s.page === foreground);
      if (current?.value && (current.value.visible || current.value.focused)) {
        if (!ids.has(foreground)) ids.set(foreground, ++nextId);
        const frames = await Promise.all(foreground.frames().filter(f => f !== foreground.mainFrame()).map(async f => {
          const shown = await bounded((async () => {
            const element = await f.frameElement();
            try { return await element.evaluate(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'); }
            finally { await element.dispose(); }
          })(), 1000);
          if (shown === false) return { content: '<hidden-frame>' };
          if (shown === null) return null;
          return bounded(f.evaluate(pageSnapshot), 1000);
        }));
        if (frames.every(Boolean)) process.send?.({ type: 'activity', fingerprint: hash(JSON.stringify([ids.get(foreground), current.value.content, frames.map(f => f.content)])) });
      }
      await new Promise(resolve => setTimeout(resolve, config.pollMs));
    }
  } catch (error) { await close(); throw error; }
  finally { if (!setup) await close(); }
}
async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise.catch(() => null), new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]); }
  finally { clearTimeout(timer); }
}
