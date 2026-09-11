const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function run(mode, installed = true) {
  const commands = [], destinations = [], events = {};
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const page = { on: () => {}, url: () => 'about:blank', goto: async url => destinations.push(url), bringToFront: async () => { events.close(); resolveDone(); } };
  const context = {
    serviceWorkers: () => [{ url: () => 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/background.js', evaluate: async () => ({available:true,registered:2}) }],
    on: (event, callback) => { events[event] = callback; },
    close: async () => { events.close(); resolveDone(); }, newPage: async () => page, pages: () => [page],
    browser: () => ({ newBrowserCDPSession: async () => ({ send: async name => { commands.push(name); return { extensions: installed ? [{ id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo', enabled: true, path: path.join(__dirname,'extension') }] : [] }; }, detach: async () => {} }) })
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'launch.cjs'), 'utf8'), {
    __dirname, console, setTimeout, clearTimeout,
    process: { argv: ['node','launch.cjs',mode], on: () => {}, send: () => {}, connected: false },
    require: name => name === 'node:child_process' ? { spawn: () => { resolveDone(); } }
      : name === './open-browser.cjs' ? { openBrowser: async () => ({context,close:context.close}) }
      : name === './prepare-tampermonkey.cjs' ? {registerPersistentExtension:async()=>{commands.push('persistentInstall');installed=true;}}
      : name === 'playwright' ? { chromium: { launchPersistentContext: async () => context } }
      : name === 'node:fs' ? { existsSync: () => false, readFileSync: () => '{"startUrl":"https://example.test/pipeline"}' }
      : require(name)
  });
  await done;
  return { commands, destinations };
}
test('normal startup does not reload Tampermonkey or open its dashboard', async () => {
  const result = await run('--worker');
  assert.deepEqual(result.commands, ['Extensions.getExtensions']);
  assert.deepEqual(result.destinations, ['https://example.test/pipeline']);
});
test('login setup opens AgencyZoom without reloading Tampermonkey', async () => {
  const result = await run('--setup');
  assert.deepEqual(result.commands, ['Extensions.getExtensions']);
  assert.deepEqual(result.destinations, ['https://example.test/pipeline']);
});
test('installation registers a missing migrated extension', async () => {
  const result = await run('--install-extension', false);
  assert.deepEqual(result.commands, ['persistentInstall','Extensions.getExtensions']);
  assert.deepEqual(result.destinations, []);
});

test('missing extension stops startup without a temporary install', async () => {
  const result = await run('--worker', false);
  assert.ok(result.commands.length > 1);
  assert.ok(result.commands.every(command => command === 'Extensions.getExtensions'));
  assert.deepEqual(result.destinations, []);
});
