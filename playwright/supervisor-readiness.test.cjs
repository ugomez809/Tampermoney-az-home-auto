const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = probe(); if (value) return value; await sleep(50); }
  throw new Error('Timed out waiting for isolated supervisor state');
}
test('installation readiness requires browser confirmation and resets for each worker', { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gwpc-supervisor-readiness-'));
  const state = path.join(root, 'monitor-state');
  for (const name of ['supervisor.cjs', 'watchdog.cjs']) fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
  fs.writeFileSync(path.join(root, 'owned-browser.ps1'), 'exit 0\n');
  fs.writeFileSync(path.join(root, 'monitor-config.json'), JSON.stringify({ inactivityMs: 60000, closeGraceMs: 1000, restartDelayMs: 100 }));
  fs.writeFileSync(path.join(root, 'launch.cjs'), `
    const fs = require('node:fs'), path = require('node:path');
    const marker = path.join(__dirname,'started-once');
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker,'first');
      setTimeout(() => process.send({type:'ready'}),700);
      setTimeout(() => process.exit(0),6200);
    }
    const hold = setInterval(() => {},1000);
    process.on('message', message => { if (message.type === 'close') { clearInterval(hold); process.disconnect(); } });
  `);
  const child = spawn(process.execPath, [path.join(root, 'supervisor.cjs')], { windowsHide: true, stdio: 'ignore' });
  const status = () => { try { return JSON.parse(fs.readFileSync(path.join(state, 'status.json'))); } catch { return null; } };
  try {
    const first = await until(status);
    assert.equal(first.browserReady, false, 'A running worker alone must not count as a working browser');
    await until(() => status()?.browserReady === true);
    const replacement = await until(() => { const value = status(); return value?.workerPid !== first.workerPid && value; });
    assert.equal(replacement.browserReady, false, 'Replacement worker must confirm its own browser readiness');
  } finally {
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(path.join(state, 'paused'), 'test complete');
    await until(() => child.exitCode !== null, 5000);
    assert.ok(root.startsWith(path.join(os.tmpdir(), 'gwpc-supervisor-readiness-')));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
