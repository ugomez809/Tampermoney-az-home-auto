const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const { pageSnapshot } = require('./watchdog.cjs');
test('real DOM fingerprint ignores clock/spinner/hidden changes but sees headers, fields and tabs', async () => {
  const browser = await chromium.launch({ executablePath: path.join(__dirname, 'browser-engine', 'gwpc-lab.exe'), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Ticket Alpha</h1><div role="tab" aria-selected="true">Drivers</div><input value="A"><time>10:01</time><div class="spinner">1</div><div id="tm_panel">1</div><div hidden id="hidden">1</div>');
    const original = await page.evaluate(pageSnapshot);
    await page.evaluate(() => { document.querySelector('time').textContent='10:02'; document.querySelector('.spinner').textContent='2'; document.querySelector('#tm_panel').textContent='2'; document.querySelector('#hidden').textContent='2'; });
    assert.equal((await page.evaluate(pageSnapshot)).content, original.content);
    await page.locator('h1').evaluate(el => el.textContent='Ticket Beta');
    const header = (await page.evaluate(pageSnapshot)).content;
    assert.notEqual(header, original.content);
    await page.locator('input').fill('B');
    const form = (await page.evaluate(pageSnapshot)).content;
    assert.notEqual(form, header);
    await page.locator('[role=tab]').evaluate(el => el.setAttribute('aria-selected','false'));
    assert.notEqual((await page.evaluate(pageSnapshot)).content, form);
  } finally { await browser.close(); }
});
