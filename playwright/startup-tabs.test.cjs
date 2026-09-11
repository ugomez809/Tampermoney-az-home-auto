const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTampermonkeyStartupTab } = require('./startup-tabs.cjs');
test('recognizes the actual Tampermonkey website update tab', () => {
  assert.equal(isTampermonkeyStartupTab('https://www.tampermonkey.net/index.php?version=5.5.0&ext=dhdg&updated=true'), true);
  assert.equal(isTampermonkeyStartupTab('https://tampermonkey.net/index.php?version=5.5.0&ext=dhdg&updated=true'), true);
});
test('recognizes the extension dashboard without matching unrelated websites', () => {
  assert.equal(isTampermonkeyStartupTab('chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#settings'), true);
  assert.equal(isTampermonkeyStartupTab('https://app.agencyzoom.com/referral/pipeline'), false);
  assert.equal(isTampermonkeyStartupTab('https://tampermonkey.net.evil.example/index.php?updated=true'), false);
  assert.equal(isTampermonkeyStartupTab('about:blank'), false);
});
