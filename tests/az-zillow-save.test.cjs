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
    window.api = { bindJobNotifications, saveJob, closeCurrentTabSoon, closeFinishedZillowTab, tick, init, cleanup, launchZillowSearch, ensureMainTab, handleExistingZillowJob, scrapeZillowResult, buildFallbackResult, getFieldTargets, canonicalFieldLabel, strongClick, resolveEditableTarget, setFieldValue, readCurrentFieldValue, applyZillowResultToTicket, saveRunning, loadRunning, runAzWorkflow, state, getJob };
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
    window.webhooks = 0; window.completions = 0; window.recoveries = 0; requestBootstrapReload = () => { recoveries++; };
    sendWebhookForJob = async () => { webhooks++; return true; };
    clearJob = () => { completions++; };
  `);
  assert.deepEqual(await p.evaluate(async () => {
    await api.runAzWorkflow();
    return { running: api.state.running, savedRunning: api.loadRunning(), jobStatus: api.getJob().status, webhooks, completions };
  }), { running: true, savedRunning: true, jobStatus: 'result-ready', webhooks: 0, completions: 0 });
  assert.deepEqual(await p.evaluate(async () => {
    for (let i = 0; i < 4; i++) await api.tick();
    return { running: api.state.running, attempts: api.getJob().applyFailureCount, recoveries, webhooks, completions };
  }), { running: true, attempts: 3, recoveries: 1, webhooks: 0, completions: 0 });
  assert.equal(await p.evaluate(async () => {
    api.state.recoveryReloadAt = Date.now() - 16000;
    await api.tick();
    return recoveries;
  }), 2);
  assert.equal(await p.evaluate(async () => {
    api.state.running = false;
    api.state.recoveryReloadAt = Date.now() - 16000;
    await api.tick();
    return recoveries;
  }), 2);
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



test('Zillow opens in the background through Tampermonkey', async t => {
  const p = await fixture(t, '<main></main>');
  assert.deepEqual(await p.evaluate(() => {
    window.GM_openInTab = (url, options) => { window.openOptions = options; };
    const ok = api.launchZillowSearch({ jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' });
    return { ok, active: openOptions.active };
  }), { ok: true, active: false });
});

test('fallback Zillow launch does not force focus', async t => {
  const p = await fixture(t, '<main></main>');
  assert.deepEqual(await p.evaluate(async () => {
    let focused = 0, blurred = 0, parentFocused = 0;
    window.open = () => ({ focus: () => focused++, blur: () => blurred++ });
    window.focus = () => parentFocused++;
    const ok = api.launchZillowSearch({ jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' });
    await new Promise(resolve => setTimeout(resolve, 300));
    return { ok, focused, blurred, parentFocused };
  }), { ok: true, focused: 0, blurred: 0, parentFocused: 0 });
});

for (const origin of ['https://app.agencyzoom.com/referral/pipeline', 'https://www.zillow.com/homedetails/example/123_zpid/']) {
  test(`startup clears the job and starts only on AgencyZoom: ${new URL(origin).hostname}`, async t => {
    const p = await fixture(t, '<main></main>', `
      buildUi = bindUi = restorePanelPos = ensureHoverBox = syncWebhookUi = renderAll = tick = zillowTick = () => {};
      state.running = false; saveRunning(false);
      storage[GM_KEYS.job] = { jobId: 'TEST', ticketId: 'TEST', status: 'result-ready', result: { bedrooms: '3' } };
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

for (const age of [61000, 91000, 300000]) {
  test(`no response after ${age}ms keeps the Zillow job waiting, not NotFound`, async t => {
    const p = await fixture(t, '<main></main>', `
      state.activeTicketId = 'TEST';
      window.job = { ticketId: 'TEST', jobId: 'TEST', status: 'searching', launchCount: 1, searchOpenedAt: new Date(Date.now() - ${age}).toISOString() };
    `);
    assert.deepEqual(await p.evaluate(async () => {
      await api.handleExistingZillowJob(job);
      return { status: job.status, result: job.result || null };
    }), { status: 'searching', result: null });
  });
}

test('an overdue listing result is not replaced with empty data', async t => {
  const p = await fixture(t, '<main></main>', `
    state.activeTicketId = 'TEST';
    window.job = { ticketId: 'TEST', jobId: 'TEST', status: 'searching', launchCount: 1, listingSeenAt: new Date().toISOString(), searchOpenedAt: new Date(Date.now() - 120000).toISOString() };
  `);
  assert.deepEqual(await p.evaluate(async () => {
    await api.handleExistingZillowJob(job); return [job.status, job.result || null];
  }), ['searching', null]);
});

test('late Zillow startup does not delete the job it needs to answer', async t => {
  const p = await fixture(t, '<main></main>', `
    zillowTick = () => {};
    storage[GM_KEYS.job] = { jobId: 'LATE', ticketId: 'TEST', status: 'searching', searchOpenedAt: new Date(Date.now() - 120000).toISOString() };
  `, 'https://www.zillow.com/homedetails/example/123_zpid/');
  assert.equal(await p.evaluate(() => { api.init(); const id = api.getJob()?.jobId; api.cleanup(); return id; }), 'LATE');
});

test('an unanswered job still triggers the five-minute AgencyZoom refresh', async t => {
  const p = await fixture(t, '<main></main>', `
    saveJob({ jobId: 'TEST', ticketId: 'TEST', status: 'searching' });
    setLastZillowOpenAt(new Date(Date.now() - 301000).toISOString());
    window.refreshes = 0; window.runs = 0;
    requestBootstrapReload = () => { refreshes++; };
    runAzWorkflow = async () => { runs++; };
  `);
  assert.deepEqual(await p.evaluate(async () => { await api.tick(); return [refreshes, runs]; }), [1,0]);
});

test('AgencyZoom closes its finished Zillow tab using the opener handle', async t => {
  const p = await fixture(t, '<main></main>', `
    runAzWorkflow = async () => {};
    window.closes = 0;
    window.GM_openInTab = () => ({ close() { closes++; } });
  `);
  assert.equal(await p.evaluate(async () => {
    const job = { jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' };
    api.launchZillowSearch(job);
    storage.tm_az_zillow_ticket_enricher_job_v4 = { ...job, status: 'result-ready', result: { bedrooms: '3' } };
    await api.tick(); await api.tick();
    return closes;
  }), 1);
});

test('AgencyZoom does not close a Zillow tab still searching', async t => {
  const p = await fixture(t, '<main></main>', `
    runAzWorkflow = async () => {};
    window.closes = 0;
    window.GM_openInTab = () => ({ close() { closes++; } });
  `);
  assert.equal(await p.evaluate(async () => {
    api.launchZillowSearch({ jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' });
    await api.tick(); return closes;
  }), 0);
});

for (const mode of ['busy', 'captcha', 'result-ready']) {
  test('idle refresh preserves ' + mode, async t => {
    const p = await fixture(t, '<main></main>', `
      saveJob({ jobId: 'TEST', status: '${mode === 'busy' ? 'searching' : mode}' });
      state.busy = ${mode === 'busy'};
      setLastZillowOpenAt(new Date(Date.now() - 301000).toISOString());
      window.refreshes = 0;
      requestBootstrapReload = () => { refreshes++; };
      runAzWorkflow = async () => {};
    `);
    assert.equal(await p.evaluate(async () => { await api.tick(); return refreshes; }), 0);
  });
}

test('idle refresh closes its stale Zillow tab before reloading', async t => {
  const p = await fixture(t, '<main></main>', `
    window.actions = [];
    window.GM_openInTab = () => ({ close() { actions.push('close'); } });
    requestBootstrapReload = () => { actions.push('reload'); };
    runAzWorkflow = async () => {};
  `);
  assert.deepEqual(await p.evaluate(async () => {
    api.launchZillowSearch({ jobId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' });
    localStorage.setItem('tm_az_zillow_ticket_enricher_last_zillow_open_at_v1', new Date(Date.now() - 301000).toISOString());
    await api.tick(); return actions;
  }), ['close', 'reload']);
});


test('Main activation invokes the page click handler even when Bootstrap is available', async t => {
  const p = await fixture(t, '<a href="#tabDetail" data-toggle="tab">Main</a><div id="tabDetail"></div>', `
    document.querySelector('a').onclick = () => { document.querySelector('#tabDetail').innerHTML = '<form id="detailDockform"><input></form>'; };
    window.jQuery = () => ({ tab() {} });
  `);
  assert.equal(await p.evaluate(() => api.ensureMainTab()), true);
});

test('Main readiness retries the replacement control after a missed first activation', async t => {
  const p = await fixture(t, '<a href="#tabDetail" data-toggle="tab">Main</a><div id="tabDetail"></div>', `
    CFG.mainReadyMs = 7000;
    window.clicks = 0;
    window.jQuery = () => ({ tab() {} });
    document.querySelector('a').onclick = () => {
      clicks++;
      setTimeout(() => {
        const old = document.querySelector('a');
        const fresh = old.cloneNode(true);
        fresh.onclick = () => { clicks++; document.querySelector('#tabDetail').innerHTML = '<form id="detailDockform"><input></form>'; };
        old.replaceWith(fresh);
      }, 100);
    };
  `);
  assert.deepEqual(await p.evaluate(async () => [await api.ensureMainTab(), clicks]), [true, 2]);
});


test('stopping while Main loads prevents verification from continuing', async t => {
  const p = await fixture(t, '<a href="#tabDetail" data-toggle="tab">Main</a><div id="tabDetail"></div>', `
    document.querySelector('a').onclick = () => { setTimeout(() => { state.running = false; }, 100); };
  `);
  assert.equal(await p.evaluate(() => api.ensureMainTab()), false);
});


test('field setup can still open Main while automation is already stopped', async t => {
  const p = await fixture(t, '<a href="#tabDetail" data-toggle="tab">Main</a><div id="tabDetail"></div>', `
    state.running = false;
    document.querySelector('a').onclick = () => { document.querySelector('#tabDetail').innerHTML = '<form id="detailDockform"><input></form>'; };
  `);
  assert.equal(await p.evaluate(() => api.ensureMainTab()), true);
});


for (const mode of ['silent', 'heartbeat', 'progress', 'retried', 'close-failed']) {
  test('unresponsive Zillow recovery: ' + mode, async t => {
    const p = await fixture(t, '<main></main>', `
      state.activeTicketId = 'TEST';
      window.actions = [];
      window.GM_openInTab = () => { actions.push('open'); return { close() { actions.push('close'); ${mode === 'close-failed' ? "throw Error('blocked');" : ''} } }; };
    `);
    const result = await p.evaluate(async mode => {
      const job = { jobId: 'TEST', ticketId: 'TEST', searchUrl: 'https://www.zillow.com/homes/example/' };
      api.launchZillowSearch(job);
      job.searchOpenedAt = job.lastLaunchAt = new Date(Date.now() - 91000).toISOString();
      if (mode === 'heartbeat') storage.tm_az_zillow_ticket_enricher_zillow_tab_heartbeat_v1 = { ts: Date.now() };
      if (mode === 'progress') job.listingSeenAt = new Date().toISOString();
      if (mode === 'retried') job.launchCount = 2;
      storage.tm_az_zillow_ticket_enricher_job_v4 = job;
      await api.handleExistingZillowJob(job);
      return { actions, status: api.getJob().status, result: api.getJob().result };
    }, mode);
    assert.deepEqual(result.actions, mode === 'silent' ? ['open','close','open'] : mode === 'close-failed' ? ['open','close'] : ['open']);
    assert.equal(result.status, 'searching');
    assert.equal(result.result, null);
  });
}


const notificationMocks = `
  window.listeners = {}; window.removed = [];
  window.GM_addValueChangeListener = (key, fn) => { listeners[key] = fn; return key; };
  window.GM_removeValueChangeListener = key => { removed.push(key); delete listeners[key]; };
`;

test('remote result is acknowledged and wakes AgencyZoom without waiting for a timer', async t => {
  const p = await fixture(t, '<main></main>', notificationMocks + `
    window.runs = 0;
    runAzWorkflow = async () => { runs++; };
    bindJobNotifications();
  `);
  assert.deepEqual(await p.evaluate(async () => {
    const key = 'tm_az_zillow_ticket_enricher_job_v4';
    const job = { jobId: 'TEST', ticketId: 'TEST', status: 'result-ready', result: { bedrooms: '3' } };
    storage[key] = job;
    listeners[key](key, null, job, true);
    await Promise.resolve();
    return [runs, storage.tm_az_zillow_ticket_enricher_result_receipt_v1];
  }), [1, 'TEST']);
  assert.equal(await p.evaluate(() => { api.cleanup(); return Object.keys(listeners).length; }), 0);
});

test('old job notifications cannot acknowledge or run a different ticket', async t => {
  const p = await fixture(t, '<main></main>', notificationMocks + `
    window.runs = 0; runAzWorkflow = async () => { runs++; }; bindJobNotifications();
  `);
  assert.deepEqual(await p.evaluate(() => {
    const key = 'tm_az_zillow_ticket_enricher_job_v4';
    storage[key] = { jobId: 'NEW', status: 'searching' };
    listeners[key](key, null, { jobId: 'OLD', status: 'result-ready', result: {} }, true);
    return [runs, storage.tm_az_zillow_ticket_enricher_result_receipt_v1 || null];
  }), [0, null]);
});

for (const complete of [true, false]) {
  test('stored listing facts only advance when complete: ' + complete, async t => {
    const p = await fixture(t, '<main></main>');
    assert.equal(await p.evaluate(complete => {
      storage.tm_az_zillow_ticket_enricher_job_v4 = {
        jobId: 'TEST', status: 'searching', listingSeenAt: new Date(Date.now()-10000).toISOString(),
        result: { zillowUrl: 'https://www.zillow.com/homedetails/example/123_zpid/', bedrooms: '3', bathrooms: '2', homeType: 'Single Family', yearBuilt: '1983', squareFeet: complete ? '1677' : '' }
      };
      api.closeFinishedZillowTab();
      return api.getJob().status;
    }, complete), complete ? 'result-ready' : 'searching');
  });
}

test('Zillow reports startup and waits for receipt before scheduling its close', async t => {
  const p = await fixture(t, '<main></main>', notificationMocks + `
    storage[GM_KEYS.job] = { jobId: 'TEST', ticketId: 'TEST', status: 'searching' };
    bindJobNotifications();
    window.closeTimers = 0; window.setTimeout = () => { closeTimers++; };
  `, 'https://www.zillow.com/homedetails/example/123_zpid/');
  assert.deepEqual(await p.evaluate(() => {
    const job = api.getJob();
    const started = !!job.workerStartedAt;
    api.saveJob({ ...job, status: 'result-ready', result: { bedrooms: '3' } });
    api.closeCurrentTabSoon();
    const before = closeTimers;
    const key = 'tm_az_zillow_ticket_enricher_result_receipt_v1';
    storage[key] = 'TEST'; listeners[key](key, null, 'TEST', true);
    api.saveJob({ ...job, status: 'searching' });
    return [started, before, closeTimers, api.getJob().status];
  }), [true, 0, 4, 'result-ready']);
});

test('late Zillow writes cannot replace the next ticket job', async t => {
  const p = await fixture(t, '<main></main>', '', 'https://www.zillow.com/homedetails/example/123_zpid/');
  assert.equal(await p.evaluate(() => {
    storage.tm_az_zillow_ticket_enricher_job_v4 = { jobId: 'NEW', status: 'searching' };
    api.saveJob({ jobId: 'OLD', status: 'result-ready', result: { bedrooms: '3' } });
    return api.getJob().jobId;
  }), 'NEW');
});


test('Home Type accepts the same longer dropdown label it selects', async t => {
  const p = await fixture(t, '<select id="type"><option value="">Choose</option><option value="sf">Single Family Residence</option><option value="condo">Condominium</option></select>');
  assert.deepEqual(await p.evaluate(async () => {
    const record = { selector: '#type' };
    const first = await api.setFieldValue(record, 'Single Family', 'Home Type');
    const second = await api.setFieldValue(record, 'Single Family', 'Home Type');
    return [first.ok, second.ok, second.skipped, document.querySelector('#type').value];
  }), [true, true, 'existing-value', 'sf']);
});

test('unmatched dropdown values preserve the existing selection', async t => {
  const p = await fixture(t, '<select id="type"><option value="sf">Single Family Residence</option><option value="condo">Condominium</option></select>');
  assert.deepEqual(await p.evaluate(async () => {
    const result = await api.setFieldValue({ selector: '#type' }, 'Manufactured', 'Home Type');
    return [result.ok, document.querySelector('#type').value];
  }), [false, 'sf']);
});


const azMainFields = '<form id="detailDockform"><div class="row"><select id="unrelated"><option value="keep">Keep</option></select><div class="az-form-group field-customfields-cf55246"><label for="customfields-cf55246">Home Type</label><input type="text" id="customfields-cf55246" name="customFields[cf55246]"></div><div class="form-group"><label for="customfields-cf48147">Home Sqft</label><input type="number" name="customFields[cf48147]"></div><div class="form-group"><label for="customfields-cf48146">Year Built</label><input type="number" name="customFields[cf48146]"></div></div></form>';

test('Zillow unknown home type uses its displayed label and preserves published zero bathrooms', async t => {
  const data = { property: { zpid: 123, bedrooms: 4, bathrooms: 0, homeType: 'HOME_TYPE_UNKNOWN', yearBuilt: 1989, livingArea: 2000 } };
  const p = await fixture(t, `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`, '', 'https://www.zillow.com/homedetails/example/123_zpid/');
  assert.deepEqual(await p.evaluate(() => {
    const result = api.scrapeZillowResult();
    const pending = api.buildFallbackResult({ result: { homeType: 'HOME_TYPE_UNKNOWN' } });
    return [result.homeType, result.bathrooms, pending.homeType];
  }), ['Unknown', '0', 'Unknown']);
});

for (const selector of ['#unrelated', '.row', '#missing-old-target']) {
  test('AgencyZoom label finds Home Type despite saved target ' + selector, async t => {
    const p = await fixture(t, azMainFields);
    assert.deepEqual(await p.evaluate(async selector => {
      const result = await api.setFieldValue({ selector }, 'Single Family', 'Home Type');
      return [result.ok, document.querySelector('[name="customFields[cf55246]"]').value, document.querySelector('#unrelated').value];
    }, selector), [true, 'Single Family', 'keep']);
  });
}

test('AgencyZoom labels resolve numeric custom fields even without matching input IDs', async t => {
  const p = await fixture(t, azMainFields);
  assert.deepEqual(await p.evaluate(async () => {
    const year = await api.setFieldValue({ selector: '#unrelated' }, '2005', 'Year Built');
    const area = await api.setFieldValue({ selector: '#unrelated' }, '2064', 'Square Feet');
    return [year.ok, area.ok, document.querySelector('[name="customFields[cf48146]"]').value, document.querySelector('[name="customFields[cf48147]"]').value];
  }), [true, true, '2005', '2064']);
});


test('label-based fields save and verify after reopening with stale saved targets', async t => {
  const html = azMainFields.replace('</form>', '<div class="form-group"><label for="url">Zillow URL</label><input id="url"></div><div class="form-group"><label for="beds">Bedrooms</label><input id="beds"></div><div class="form-group"><label for="baths">Bathrooms</label><input id="baths"></div></form>');
  const p = await fixture(t, html, `
    storage[GM_KEYS.fieldTargets] = Object.fromEntries(FIELD_ORDER.map(label => [label, { selector: '#unrelated' }]));
    getActivePipelineTicketContext = () => ({ ok: true });
    getVisibleStageCards = () => [{ getAttribute: () => 'TEST' }];
    window.tags = 0; window.updates = 0; window.saved = [];
    const original = document.body.innerHTML;
    clickUpdateButton = async () => { updates++; saved = [...document.querySelectorAll('input')].map(el => el.value); return true; };
    closeTicketDrawer = async () => { document.body.innerHTML = ''; return true; };
    openCard = async () => { document.body.innerHTML = original; [...document.querySelectorAll('input')].forEach((el,i) => { el.value = saved[i]; }); return true; };
    ensureMainTab = async () => true;
    applyConfiguredTagReplacement = async () => { tags++; return true; };
  `);
  assert.deepEqual(await p.evaluate(async () => {
    const ok = await api.applyZillowResultToTicket({ ticketId: 'TEST', result: { zillowUrl: 'https://www.zillow.com/homedetails/example/123_zpid/', bedrooms: '4', bathrooms: '2', homeType: 'Single Family', yearBuilt: '2005', squareFeet: '2064' } });
    return { ok, tags, updates, type: document.querySelector('[name="customFields[cf55246]"]').value, unrelated: document.querySelector('#unrelated').value };
  }), { ok: true, tags: 1, updates: 1, type: 'Single Family', unrelated: 'keep' });
});

test('duplicate visible field labels cannot redirect a write to a saved unrelated target', async t => {
  const p = await fixture(t, azMainFields.replace('</form>', '<div class="form-group"><label for="second-type">Home Type</label><input id="second-type"></div></form>'));
  assert.deepEqual(await p.evaluate(async () => {
    const result = await api.setFieldValue({ selector: '#unrelated' }, 'Single Family', 'Home Type');
    return [result.ok, document.querySelector('#unrelated').value, document.querySelector('#second-type').value];
  }), [false, 'keep', '']);
});
