const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../auto/az-zillow-ticket-enricher.user.js'), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ headless: false }); });
after(async () => { await browser.close(); });
async function fixture(t, html, extra = '', url = 'https://app.agencyzoom.com/referral/pipeline') {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  await page.goto(url);
  await page.evaluate(() => {
    window.storage = {};
    window.GM_getValue = (k, d) => storage[k] ?? d;
    window.GM_setValue = (k, v) => { storage[k] = v; };
    window.GM_deleteValue = k => { delete storage[k]; };
  });
  await page.addScriptTag({ content: source.replace('  init();', `
    window.api = { init, cleanup, launchZillowSearch, ensureMainTab, handleExistingZillowJob, scrapeZillowResult, buildFallbackResult, getFieldTargets, canonicalFieldLabel, strongClick, resolveEditableTarget, setFieldValue, readCurrentFieldValue, applyZillowResultToTicket, saveRunning, loadRunning, runAzWorkflow, state, getJob };
    sleep = async () => {};
    CFG.mainReadyMs = 800;
    state.running = true;
    ${extra}
  `) });
  return page;
}
test('one click produces one submission', async t => {
  const p = await fixture(t, '<button onclick="window.count=(window.count||0)+1">Update</button>');
  assert.equal(await p.evaluate(() => { api.strongClick(document.querySelector('button')); return count; }), 1);
});
test('the supplied script defaults to starting on reload', async t => {
  const p = await fixture(t, '<main></main>');
  assert.equal(await p.evaluate(() => { api.saveRunning(false); return api.loadRunning(); }), true);
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
test('the supplied script replaces a stale value with the Zillow value', async t => {
  const p = await fixture(t, '<input id="beds" value="5">');
  assert.deepEqual(await p.evaluate(async () => {
    const result = await api.setFieldValue({ selector: '#beds' }, '4');
    return { overwritten: result.overwritten, value: document.querySelector('#beds').value };
  }), { overwritten: true, value: '4' });
});
for (const accepted of [false, true, 'partial']) {
  test(`completion requires persisted values after reopening (accepted=${accepted})`, async t => {
    const p = await fixture(t, '<form><input id="url"><input id="beds"><input id="baths"><input id="type"><input id="year"><input id="area"></form>', `
      const fields = { 'Zillow URL': '#url', Bedrooms: '#beds', Bathrooms: '#baths', 'Home Type': '#type', 'Year Built': '#year', 'Home Sqft': '#area' };
      storage[GM_KEYS.fieldTargets] = Object.fromEntries(Object.entries(fields).map(([k, selector]) => [k, { selector }]));
      getActivePipelineTicketContext = () => ({ ok: true });
      getVisibleStageCards = () => [{ getAttribute: () => 'TEST' }];
      window.tags = 0; window.reopens = 0; window.saved = {};
      clickUpdateButton = async () => {
        if (${JSON.stringify(accepted)}) document.querySelectorAll('input').forEach(el => { saved[el.id] = el.value; });
        if (${JSON.stringify(accepted)} === 'partial') { delete saved.year; delete saved.area; }
        return true;
      };
      closeTicketDrawer = async () => { document.querySelector('form').remove(); return true; };
      openCard = async () => {
        reopens++;
        document.body.innerHTML = '<form><input id="url"><input id="beds"><input id="baths"><input id="type"><input id="year"><input id="area"></form>';
        document.querySelectorAll('input').forEach(el => { el.value = saved[el.id] || ''; });
        return true;
      };
      ensureMainTab = async () => true;
      applyConfiguredTagReplacement = async () => { tags++; return true; };
    `);
    const result = await p.evaluate(async () => ({
      ok: await api.applyZillowResultToTicket({ ticketId: 'TEST', result: { zillowUrl: 'https://www.zillow.com/homedetails/example/', bedrooms: '4', bathrooms: '2', homeType: 'SingleFamily', yearBuilt: '1987', squareFeet: '1,850' } }),
      tags, reopens,
    }));
    assert.deepEqual(result, { ok: accepted === true, tags: accepted === true ? 1 : 0, reopens: 1 });
    if (accepted === true) assert.deepEqual(await p.evaluate(() => [saved.year, saved.area]), ['1987', '1850']);
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
test('a failed save stays retryable without webhook or completion', async t => {
  const p = await fixture(t, '<main></main>', `
    hasAllTagTargets = () => true;
    ensureIgnoredV2Filter = async () => true;
    getOpenTicketInfo = () => ({ ticketId: 'TEST' });
    handleExistingZillowJob = async () => false;
    ensureMainTab = async () => true;
    getActivePipelineTicketContext = () => ({ ok: true });
    readAzAddressInfo = () => ({ address: 'fixture address' });
    validateZillowAddressInfo = () => ({ ok: true });
    jobMatchesTicket = () => true;
    saveJob({ ticketId: 'TEST', address: 'fixture address', status: 'result-ready', result: { bedrooms: '4' } });
    window.webhooks = 0; window.completions = 0;
    sendWebhookForJob = async () => { webhooks++; return true; };
    clearJob = () => { completions++; };
  `);
  assert.deepEqual(await p.evaluate(async () => {
    await api.runAzWorkflow();
    return { running: api.state.running, savedRunning: api.loadRunning(), jobStatus: api.getJob().status, webhooks, completions };
  }), { running: true, savedRunning: true, jobStatus: 'result-ready', webhooks: 0, completions: 0 });
});

test('year and living area survive scraping and fallback without nearby-home contamination', async t => {
  const property = { zpid: 123, yearBuilt: 1987, livingArea: 1850, bedrooms: 4, bathrooms: 2, homeType: 'SingleFamily' };
  const nearby = { ...property, zpid: 999, yearBuilt: 2020, livingArea: 9999 };
  const data = { props: { pageProps: { gdpClientCache: JSON.stringify({ nearby: { property: nearby }, selected: { property } }) } } };
  const p = await fixture(t, `<main>Built in 2020 9,999 sqft</main><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`, '', 'https://www.zillow.com/homedetails/example/123_zpid/');
  assert.deepEqual(await p.evaluate(() => {
    const result = api.buildFallbackResult({}, api.scrapeZillowResult());
    return [result.yearBuilt, result.squareFeet];
  }), ['1987', '1850']);
});

test('visible Zillow facts provide year and interior area, not lot size', async t => {
  const p = await fixture(t, '<main>8,000 sqft lot Built in 1985 Total interior livable area: 1,950 sqft</main>');
  assert.deepEqual(await p.evaluate(() => {
    const r = api.scrapeZillowResult(); return [r.yearBuilt, r.squareFeet];
  }), ['1985', '1950']);
});



test('slow Zillow startup remains searching at 40 seconds', async t => {
  const p = await fixture(t, '<main></main>', `
    state.activeTicketId = 'TEST';
    window.job = { ticketId: 'TEST', jobId: 'slow', status: 'searching', searchOpenedAt: new Date(Date.now() - 40000).toISOString(), launchCount: 1 };
  `);
  assert.deepEqual(await p.evaluate(async () => {
    await api.handleExistingZillowJob(job); return { status: job.status, result: job.result || null };
  }), { status: 'searching', result: null });
});

for (const delay of [350, 12000]) {
test(`Main tab waits for the asynchronously inserted drawer form (${delay}ms)`, async t => {
  const p = await fixture(t, '<main></main>', 'CFG.mainReadyMs = 15000;');
  assert.equal(await p.evaluate(async delay => {
    setTimeout(() => { document.body.innerHTML = '<a href="#tabDetail" data-toggle="tab" class="active">Main</a><div id="tabDetail" class="active"></div>'; }, 100);
    setTimeout(() => { document.querySelector('#tabDetail').innerHTML = '<form id="detailDockform"><input></form>'; }, delay);
    const ready = await api.ensureMainTab();
    return ready && !!document.querySelector('#detailDockform');
  }, delay), true);
});
}



test('Zillow opens in the foreground through Tampermonkey', async t => {
  const p = await fixture(t, '<main></main>');
  assert.deepEqual(await p.evaluate(() => {
    window.GM_openInTab = (url, options) => { window.openOptions = options; };
    const ok = api.launchZillowSearch({ jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' });
    return { ok, active: openOptions.active };
  }), { ok: true, active: true });
});

test('fallback Zillow window keeps focus instead of returning to AgencyZoom', async t => {
  const p = await fixture(t, '<main></main>');
  assert.deepEqual(await p.evaluate(async () => {
    let focused = 0, blurred = 0, parentFocused = 0;
    window.open = () => ({ focus: () => focused++, blur: () => blurred++ });
    window.focus = () => parentFocused++;
    const ok = api.launchZillowSearch({ jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' });
    await new Promise(resolve => setTimeout(resolve, 300));
    return { ok, focused, blurred, parentFocused };
  }), { ok: true, focused: 1, blurred: 0, parentFocused: 0 });
});

for (const origin of ['https://app.agencyzoom.com/referral/pipeline', 'https://www.zillow.com/homedetails/example/123_zpid/']) {
  test(`startup clears the job and starts only on AgencyZoom: ${new URL(origin).hostname}`, async t => {
    const p = await fixture(t, '<main></main>', `
      buildUi = bindUi = restorePanelPos = ensureHoverBox = syncWebhookUi = renderAll = tick = zillowTick = () => {};
      state.running = false; saveRunning(false);
      saveJob({ jobId: 'TEST', ticketId: 'TEST', status: 'result-ready', result: { bedrooms: '3' } });
    `, origin);
    const result = await p.evaluate(() => {
      api.init();
      const r = { job: api.getJob()?.jobId || null, running: api.state.running, savedRunning: api.loadRunning() };
      api.cleanup(); return r;
    });
    assert.deepEqual(result, origin.includes('agencyzoom')
      ? { job: null, running: true, savedRunning: true }
      : { job: 'TEST', running: false, savedRunning: true });
  });
}


test('Zillow extraction and result handling remain identical to the supplied v1.4.17 script', () => {
  const crypto = require('node:crypto');
  const hashes = require('./fixtures/zillow-v1.4.17-contract.json');
  for (const [name, expected] of Object.entries(hashes)) {
    const fn = source.match(new RegExp('^  (?:async )?function ' + name + '\\([^\\n]*\\) \\{\\n.*?^  \\}', 'ms'))?.[0];
    assert.ok(fn, name);
    assert.equal(crypto.createHash('sha256').update(fn).digest('hex'), expected, name);
  }
  assert.match(source, /@run-at\s+document-end/);
});

test('Tampermonkey is explicitly allowed to close the redirected Zillow tab', () => {
  assert.match(source, /^\/\/ @grant\s+window\.close$/m);
});

test('Main tab readiness ignores an old hidden form and waits for actual fields', async t => {
  const p = await fixture(t, '<form id="detailDockform" hidden><input></form><a href="#tabDetail" data-toggle="tab" class="active">Main</a><div id="tabDetail" class="active"></div>');
  assert.equal(await p.evaluate(async () => {
    setTimeout(() => { document.querySelector('#tabDetail').innerHTML = '<form id="detailDockform"><input id="fresh"></form>'; }, 250);
    return await api.ensureMainTab() && !!document.querySelector('#fresh');
  }), true);
});

test('a delayed saved field is awaited before writing', async t => {
  const p = await fixture(t, '<main></main>');
  assert.deepEqual(await p.evaluate(async () => {
    setTimeout(() => { document.body.innerHTML = '<input id="late">'; }, 250);
    const result = await api.setFieldValue({ selector: '#late' }, '1986');
    return { ok: result.ok, value: document.querySelector('#late')?.value };
  }), { ok: true, value: '1986' });
});
