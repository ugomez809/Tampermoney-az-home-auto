const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../auto/az-zillow-ticket-enricher.user.js'), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser.close(); });
async function fixture(t, html, extra = '') {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto('https://app.agencyzoom.com/referral/pipeline');
  await page.evaluate(() => {
    window.storage = {};
    window.GM_getValue = (k, d) => storage[k] ?? d;
    window.GM_setValue = (k, v) => { storage[k] = v; };
    window.GM_deleteValue = k => { delete storage[k]; };
  });
  await page.addScriptTag({ content: source.replace('  init();', `
    window.api = { strongClick, resolveEditableTarget, setFieldValue, readCurrentFieldValue, applyZillowResultToTicket, saveRunning, loadRunning, runAzWorkflow, state, getJob };
    sleep = async () => {};
    state.running = true;
    ${extra}
  `) });
  return page;
}
test('one click produces one submission', async t => {
  const p = await fixture(t, '<button onclick="window.count=(window.count||0)+1">Update</button>');
  assert.equal(await p.evaluate(() => { api.strongClick(document.querySelector('button')); return count; }), 1);
});
test('a stopped run remains stopped after reloading settings', async t => {
  const p = await fixture(t, '<main></main>');
  assert.equal(await p.evaluate(() => { api.saveRunning(false); return api.loadRunning(); }), false);
});
test('a captured input wins over a neighboring select', async t => {
  const p = await fixture(t, '<div class="form-group"><input id="beds"><select><option>Keep</option></select></div>');
  assert.equal(await p.evaluate(() => api.resolveEditableTarget(document.querySelector('#beds')).id), 'beds');
});
test('closing a rejected inline editor is not a successful write', async t => {
  const p = await fixture(t, '<span id="value">Empty</span><div class="editable-container"><input><button class="editable-submit" onclick="this.parentElement.remove()">Save</button></div>');
  assert.equal(await p.evaluate(async () => (await api.setFieldValue({ selector: '#value' }, '4')).ok), false);
});
test('a cleared input does not inherit its stale HTML value', async t => {
  const p = await fixture(t, '<input value="4">');
  assert.equal(await p.evaluate(() => { const el = document.querySelector('input'); el.value = ''; return api.readCurrentFieldValue(el); }), '');
});
test('an existing value is preserved', async t => {
  const p = await fixture(t, '<input id="beds" value="5">');
  assert.deepEqual(await p.evaluate(async () => {
    const result = await api.setFieldValue({ selector: '#beds' }, '4');
    return { skipped: result.skipped, value: document.querySelector('#beds').value };
  }), { skipped: 'existing-value', value: '5' });
});
for (const accepted of [false, true, 'partial']) {
  test(`completion requires persisted values after reopening (accepted=${accepted})`, async t => {
    const p = await fixture(t, '<form><input id="url"><input id="beds"><input id="baths"><input id="type"></form>', `
      const fields = { 'Zillow URL': '#url', Bedrooms: '#beds', Bathrooms: '#baths', 'Home Type': '#type' };
      storage[GM_KEYS.fieldTargets] = Object.fromEntries(Object.entries(fields).map(([k, selector]) => [k, { selector }]));
      getActivePipelineTicketContext = () => ({ ok: true });
      getVisibleStageCards = () => [{ getAttribute: () => 'TEST' }];
      window.tags = 0; window.reopens = 0; window.saved = {};
      clickUpdateButton = async () => {
        if (${JSON.stringify(accepted)}) document.querySelectorAll('input').forEach(el => { saved[el.id] = el.value; });
        if (${JSON.stringify(accepted)} === 'partial') delete saved.baths;
        return true;
      };
      closeTicketDrawer = async () => { document.querySelector('form').remove(); return true; };
      openCard = async () => {
        reopens++;
        document.body.innerHTML = '<form><input id="url"><input id="beds"><input id="baths"><input id="type"></form>';
        document.querySelectorAll('input').forEach(el => { el.value = saved[el.id] || ''; });
        return true;
      };
      ensureMainTab = async () => true;
      applyConfiguredTagReplacement = async () => { tags++; return true; };
    `);
    const result = await p.evaluate(async () => ({
      ok: await api.applyZillowResultToTicket({ ticketId: 'TEST', result: { zillowUrl: 'https://www.zillow.com/homedetails/example/', bedrooms: '4', bathrooms: '2', homeType: 'SingleFamily' } }),
      tags, reopens,
    }));
    assert.deepEqual(result, { ok: accepted === true, tags: accepted === true ? 1 : 0, reopens: 1 });
  });
}
test('missing targets cannot complete or replace tags', async t => {
  const p = await fixture(t, '<main></main>', `
    getActivePipelineTicketContext = () => ({ ok: true });
    window.tags = 0;
    applyConfiguredTagReplacement = async () => { tags++; return true; };
  `);
  assert.deepEqual(await p.evaluate(async () => ({ ok: await api.applyZillowResultToTicket({ ticketId: 'TEST', result: { bedrooms: '4' } }), tags })), { ok: false, tags: 0 });
});
test('workflow stops a failed save without webhook or completion', async t => {
  const p = await fixture(t, '<main></main>', `
    hasAllTagTargets = () => true;
    ensureIgnoredV2Filter = async () => true;
    getOpenTicketInfo = () => ({ ticketId: 'TEST' });
    isTicketProcessed = () => false;
    handleExistingZillowJob = async () => false;
    ensureMainTab = async () => true;
    getActivePipelineTicketContext = () => ({ ok: true });
    readAzAddressInfo = () => ({ address: 'fixture address' });
    validateZillowAddressInfo = () => ({ ok: true });
    jobMatchesTicket = () => true;
    saveJob({ ticketId: 'TEST', address: 'fixture address', status: 'result-ready', result: { bedrooms: '4' } });
    window.webhooks = 0; window.completions = 0;
    sendWebhookForJob = async () => { webhooks++; return true; };
    markProcessedTicket = () => { completions++; };
  `);
  assert.deepEqual(await p.evaluate(async () => {
    await api.runAzWorkflow();
    return { running: api.state.running, savedRunning: api.loadRunning(), jobStatus: api.getJob().status, webhooks, completions };
  }), { running: false, savedRunning: false, jobStatus: 'apply-failed', webhooks: 0, completions: 0 });
});
