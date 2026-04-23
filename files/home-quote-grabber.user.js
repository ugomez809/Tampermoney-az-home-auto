// ==UserScript==
// @name         Home Bot: Home Quote Grabber
// @namespace    homebot.home-quote-grabber
// @version      2.3
// @description  Waits for exact .gw-label = Submission (Quoted), grabs Policy Info + Home quote fields from Dwelling/Coverages/Quote, clicks Exclusions and Conditions, defaults CFP to NO, normalizes Water Device to Yes/No, and saves payload to localStorage.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/home-quote-grabber.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/home-quote-grabber.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: Home Quote Grabber';
  const VERSION = '2.3';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';

  const KEYS = {
    payload: 'tm_pc_home_quote_grab_payload_v1',
    panelPos: 'tm_pc_home_quote_grab_panel_pos_v1'
  };

  const CFG = {
    tickMs: 1000,
    triggerDelayMs: 3000,
    waitTimeoutMs: 20000,
    waitPollMs: 250,
    afterClickMs: 800,
    maxLogLines: 24
  };

  const IDS = {
    policyInfoTab: 'SubmissionWizard-LOBWizardStepGroup-PolicyInfo',
    dwellingTab: 'SubmissionWizard-LOBWizardStepGroup-HomeownersDwelling',
    coveragesTab: 'SubmissionWizard-LOBWizardStepGroup-HOCoveragesSideBySide',
    exclusionsTab: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideScreenBasePanelSet-SideBySideScreenPanelSet-HOPolicyLevelExclusionsAndConditionsCardTab',
    quoteTab: 'SubmissionWizard-ViewQuote',

    name: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Name_Input',
    mailingAddress: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyAddressDisplayInputSet-PolicyAddress_Ext_Input',

    fireCode: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HOFirelineCode_Input',
    fireBlock: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-7',
    protectionBlock: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-5',
    reconstruction: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-VRsikUpdateDV-reconstructionCostId_Input',
    yearBuilt: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-YearBuilt_Input',
    squareFeet: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-ApproxSqFoot_Input',
    stories: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-NumberOfStoriesorStyle_Input',
    waterDevice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-HoWaterProtectionDevice_Input',

    pricingTable: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    standardPrice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-periodInfoPremiumIterator-0-PremiumValue',
    enhancePrice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-periodInfoPremiumIterator-1-PremiumValue',

    autoDiscountLV: 'SubmissionWizard-SubmissionWizard_QuoteScreen-HOCrossSellDetailsPanelSet-potentialLV'
  };

  const state = {
    running: true,
    busy: false,
    doneThisLoad: false,
    triggerSince: 0,
    lastWaitReason: '',
    logLines: [],
    ui: null
  };

  init();

  function safeJsonParse(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return isPlainObject(stage) ? stage : {};
  }

  function matchesStage(product, step, azId = '') {
    const stage = readFlowStage();
    if (normalizeText(stage.product) !== normalizeText(product)) return false;
    if (normalizeText(stage.step) !== normalizeText(step)) return false;
    if (!normalizeText(stage.azId) || !normalizeText(azId)) return true;
    return normalizeText(stage.azId) === normalizeText(azId);
  }

  function writeFlowStage(product, step, azId = '') {
    const next = {
      product: normalizeText(product),
      step: normalizeText(step),
      azId: normalizeText(azId),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function buildMailingAddress(address, city, stateValue, zipCode) {
    const a = normalizeText(address);
    const c = normalizeText(city);
    const s = normalizeText(stateValue);
    const z = normalizeText(zipCode);
    if (a && c && s && z) return `${a}, ${c}, ${s} ${z}`.trim();
    return [a, c, s, z].filter(Boolean).join(', ').trim();
  }

  function normalizeCurrentJob(raw) {
    const out = {
      'AZ ID': '',
      'Name': '',
      'Mailing Address': '',
      'SubmissionNumber': '',
      'updatedAt': ''
    };

    if (!isPlainObject(raw)) return out;

    const az = isPlainObject(raw.az) ? raw.az : {};
    const legacyName = [az['AZ Name'], az['AZ Last']].map(v => normalizeText(v)).filter(Boolean).join(' ').trim();
    const legacyAddress = buildMailingAddress(az['AZ Street Address'], az['AZ City'], az['AZ State'], az['AZ Postal Code']);

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.lastUpdatedAt || raw?.meta?.createdAt || '');
    return out;
  }

  function readCurrentJob() {
    let raw = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    let job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    raw = safeJsonParse(localStorage.getItem(LEGACY_SHARED_JOB_KEY), null);
    job = normalizeCurrentJob(raw);
    return job;
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    next.updatedAt = next.updatedAt || new Date().toISOString();
    try { localStorage.setItem(CURRENT_JOB_KEY, JSON.stringify(next, null, 2)); } catch {}
    return next;
  }

  function mergeCurrentJob(update) {
    const current = readCurrentJob();
    const incoming = normalizeCurrentJob(update || {});

    if (current['AZ ID'] && incoming['AZ ID'] && current['AZ ID'] !== incoming['AZ ID']) {
      return { ok: false, reason: `AZ ID mismatch (${current['AZ ID']} != ${incoming['AZ ID']})`, current };
    }

    const next = {
      'AZ ID': incoming['AZ ID'] || current['AZ ID'] || '',
      'Name': incoming['Name'] || current['Name'] || '',
      'Mailing Address': incoming['Mailing Address'] || current['Mailing Address'] || '',
      'SubmissionNumber': incoming['SubmissionNumber'] || current['SubmissionNumber'] || '',
      'updatedAt': new Date().toISOString()
    };

    return { ok: true, current, next: writeCurrentJob(next) };
  }

  function readBundle() {
    return safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
  }

  function writeBundle(bundle) {
    localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle, null, 2));
    return bundle;
  }

  function emptyBundleForJob(job) {
    return {
      'AZ ID': normalizeText(job && job['AZ ID']),
      'Name': normalizeText(job && job['Name']),
      'Mailing Address': normalizeText(job && job['Mailing Address']),
      'SubmissionNumber': normalizeText(job && job['SubmissionNumber']),
      home: {},
      auto: {},
      timeout: { events: [] },
      meta: {
        updatedAt: new Date().toISOString(),
        lastWriter: SCRIPT_NAME,
        version: VERSION
      }
    };
  }

  function ensureBundleForJob(job) {
    const azId = normalizeText(job && job['AZ ID']);
    if (!azId) return null;

    const bundle = readBundle();
    if (!isPlainObject(bundle) || !normalizeText(bundle['AZ ID'])) {
      return writeBundle(emptyBundleForJob(job));
    }

    if (normalizeText(bundle['AZ ID']) !== azId) {
      return writeBundle(emptyBundleForJob(job));
    }

    bundle['Name'] = bundle['Name'] || normalizeText(job['Name']);
    bundle['Mailing Address'] = bundle['Mailing Address'] || normalizeText(job['Mailing Address']);
    bundle['SubmissionNumber'] = bundle['SubmissionNumber'] || normalizeText(job['SubmissionNumber']);
    bundle.timeout = isPlainObject(bundle.timeout) ? bundle.timeout : { events: [] };
    if (!Array.isArray(bundle.timeout.events)) bundle.timeout.events = [];
    bundle.meta = isPlainObject(bundle.meta) ? bundle.meta : {};
    bundle.meta.updatedAt = new Date().toISOString();
    bundle.meta.lastWriter = SCRIPT_NAME;
    bundle.meta.version = VERSION;
    return writeBundle(bundle);
  }

  function saveBundleSection(sectionName, sectionValue, job, extra = {}) {
    const bundle = ensureBundleForJob(job);
    if (!bundle) return { ok: false, reason: 'Missing current AZ job' };

    const next = deepClone(bundle);
    next['Name'] = normalizeText(job['Name']) || next['Name'] || '';
    next['Mailing Address'] = normalizeText(job['Mailing Address']) || next['Mailing Address'] || '';

    if (extra.submissionNumber) {
      next['SubmissionNumber'] = normalizeText(extra.submissionNumber);
      mergeCurrentJob({ 'AZ ID': job['AZ ID'], 'SubmissionNumber': next['SubmissionNumber'] });
    }

    next[sectionName] = {
      ready: true,
      savedAt: new Date().toISOString(),
      script: SCRIPT_NAME,
      version: VERSION,
      payloadKey: extra.payloadKey || '',
      submissionNumber: normalizeText(extra.submissionNumber || ''),
      data: deepClone(sectionValue)
    };

    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = new Date().toISOString();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;
    writeBundle(next);
    return { ok: true, bundle: next };
  }

  function init() {
    buildUI();
    log('Script started');
    log('Auto-run armed');
    setStatus('Waiting for HOME quote-grabber trigger');
    setInterval(tick, CFG.tickMs);
    tick();
  }

  function tick() {
    if (!state.running || state.busy || state.doneThisLoad) return;

    const currentJob = readCurrentJob();
    if (!matchesStage('home', 'quote_grabber', currentJob['AZ ID'])) {
      state.triggerSince = 0;
      setWaiting('Waiting for HOME quote-grabber trigger');
      return;
    }

    if (hasVisibleExactLabel('Personal Auto')) {
      state.triggerSince = 0;
      setWaiting('Blocked: Personal Auto present');
      return;
    }

    if (!state.triggerSince) {
      state.triggerSince = Date.now();
      log('Trigger found: HOME quote-grabber stage');
      setStatus('Trigger found, waiting 3 seconds');
      return;
    }

    const elapsed = Date.now() - state.triggerSince;
    if (elapsed < CFG.triggerDelayMs) {
      setStatus(`Trigger stable... ${Math.ceil((CFG.triggerDelayMs - elapsed) / 1000)}s`);
      return;
    }

    state.busy = true;
    runGrab()
      .catch((err) => {
        log(`Failed: ${err?.message || err}`);
        setStatus('Failed');
      })
      .finally(() => {
        state.busy = false;
      });
  }

  async function runGrab() {
    log('Starting grab flow');

    const submissionNumberEarly = extractSubmissionNumber();
    if (submissionNumberEarly) log(`Submission Number found: ${submissionNumberEarly}`);

    setStatus('Opening Policy Info');
    await goToPolicyInfo();
    await sleep(CFG.afterClickMs);
    const policyInfoData = extractPolicyInfoFields();
    log(`Policy Info fields read: ${JSON.stringify(policyInfoData)}`);

    setStatus('Opening Dwelling');
    await goToDwelling();
    await sleep(CFG.afterClickMs);
    const dwellingData = extractDwellingFields();
    log(`Dwelling fields read: ${JSON.stringify(dwellingData)}`);

    setStatus('Opening Coverages');
    await goToCoverages();
    await sleep(CFG.afterClickMs);
    const pricingData = extractPricingFields();
    const submissionNumber = extractSubmissionNumber() || submissionNumberEarly || '';
    log(`Pricing fields read: ${JSON.stringify(pricingData)}`);
    if (submissionNumber) log(`Submission Number confirmed: ${submissionNumber}`);

    setStatus('Opening Exclusions and Conditions');
    await goToExclusionsAndConditions();
    await sleep(CFG.afterClickMs);
    log('Exclusions and Conditions clicked');

    setStatus('Opening Quote');
    await goToQuote();
    await sleep(CFG.afterClickMs);
    const quoteData = extractQuoteFields();
    log(`Quote fields read: ${JSON.stringify(quoteData)}`);

    const row = {
      'Name': policyInfoData['Name'] || '',
      'Mailing Address': policyInfoData['Mailing Address'] || '',
      'Fire Code': dwellingData['Fire Code'] || '',
      'Protection Class': dwellingData['Protection Class'] || '',
      'CFP?': 'NO',
      'Reconstruction Cost': dwellingData['Reconstruction Cost'] || '',
      'Year Built': dwellingData['Year Built'] || '',
      'Square FT': dwellingData['Square FT'] || '',
      '# of Story': dwellingData['# of Story'] || '',
      'Water Device?': dwellingData['Water Device?'] || '',
      'Standard Pricing': pricingData['Standard Pricing'] || '',
      'Enhance Pricing': pricingData['Enhance Pricing'] || '',
      'Submission Number': submissionNumber || '',
      'Auto Discount': quoteData['Auto Discount'] || '',
      'Date Processed?': formatDate(new Date()),
      'Done?': '',
      'Result': ''
    };

    const missing = Object.entries(row)
      .filter(([key, value]) => !value && key !== 'Done?' && key !== 'Result')
      .map(([key]) => key);

    if (missing.length) {
      row['Done?'] = 'No';
      row['Result'] = `Missing: ${missing.join(', ')}`;
      log(`Missing fields: ${missing.join(', ')}`);
    } else {
      row['Done?'] = 'Yes';
      row['Result'] = 'Grabbed to localStorage';
      log('All fields grabbed successfully');
    }

    const currentJob = readCurrentJob();
    if (!currentJob['AZ ID']) {
      throw new Error('Missing tm_pc_current_job_v1 / AZ ID');
    }

    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'home_quote_gathered',
      product: 'home',
      'AZ ID': currentJob['AZ ID'],
      currentJob,
      savedAt: new Date().toISOString(),
      page: {
        url: location.href,
        title: document.title
      },
      tabsUsed: {
        policyInfo: true,
        dwelling: true,
        coverages: true,
        exclusionsAndConditions: true,
        quote: true,
        cfpDefaultedToNo: true
      },
      row
    };

    const mergeJob = mergeCurrentJob({
      'AZ ID': currentJob['AZ ID'],
      'Name': currentJob['Name'] || row['Name'],
      'Mailing Address': currentJob['Mailing Address'] || row['Mailing Address'],
      'SubmissionNumber': row['Submission Number'] || currentJob['SubmissionNumber']
    });
    if (!mergeJob.ok) {
      throw new Error(mergeJob.reason || 'Current job merge failed');
    }

    localStorage.setItem(KEYS.payload, JSON.stringify(payload, null, 2));
    const bundleSave = saveBundleSection('home', payload, mergeJob.next || currentJob, {
      submissionNumber: row['Submission Number'] || '',
      payloadKey: KEYS.payload
    });
    if (!bundleSave.ok) {
      throw new Error(bundleSave.reason || 'Bundle save failed');
    }
    log(`Payload saved: ${KEYS.payload}`);
    log('Bundle merged: tm_pc_webhook_bundle_v1.home');
    writeFlowStage('home', 'handoff', (mergeJob.next || currentJob)['AZ ID']);
    setStatus('Grab complete');
    state.doneThisLoad = true;
  }

  async function goToPolicyInfo() {
    await navigateToTab(
      'Policy Info',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.policyInfoTab)} > div.gw-action--inner`)),
        () => findActionByText('Policy Info')
      ],
      () => !!findByIdInDocs(IDS.name) || !!findByIdInDocs(IDS.mailingAddress)
    );
  }

  async function goToDwelling() {
    await navigateToTab(
      'Dwelling',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.dwellingTab)} > div.gw-action--inner`)),
        () => findActionByText('Dwelling')
      ],
      () => !!findByIdInDocs(IDS.fireCode) || !!findByIdInDocs(IDS.reconstruction)
    );
  }

  async function goToCoverages() {
    await navigateToTab(
      'Coverages',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.coveragesTab)} > div.gw-action--inner`)),
        () => findActionByText('Coverages')
      ],
      () => !!findByIdInDocs(IDS.standardPrice) || !!findByIdInDocs(IDS.pricingTable)
    );
  }

  async function goToExclusionsAndConditions() {
    await navigateToTab(
      'Exclusions and Conditions',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.exclusionsTab)} > div.gw-action--inner`)),
        () => findActionByText('Exclusions and Conditions')
      ],
      () => {
        const inner = findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.exclusionsTab)} > div.gw-action--inner`));
        if (!inner) return false;
        const selected = inner.getAttribute('aria-selected');
        return selected === 'true' || inner.classList.contains('gw-focus');
      }
    );
  }

  async function goToQuote() {
    await navigateToTab(
      'Quote',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.quoteTab)} > div.gw-action--inner`)),
        () => findActionByText('Quote')
      ],
      () => !!findByIdInDocs(IDS.autoDiscountLV) || isTitleLike('Quote')
    );
  }

  async function navigateToTab(name, resolvers, readyFn) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const el = resolveFirst(resolvers);
      if (!el) {
        log(`${name} tab not found, attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      log(`Clicking ${name}, attempt ${attempt}/3`);
      safeClick(el);

      const ok = await waitFor(readyFn, CFG.waitTimeoutMs, `${name} readiness`);
      if (ok) {
        log(`${name} ready`);
        return;
      }

      log(`${name} did not become ready`);
    }

    throw new Error(`Could not open ${name}`);
  }

  function extractPolicyInfoFields() {
    const nameRaw =
      getDisplayValueById(IDS.name) ||
      extractWithRegex(getTextById(IDS.name), /^Name\s+(.+)$/i);

    const mailingAddressRaw =
      getDisplayValueById(IDS.mailingAddress) ||
      extractWithRegex(getTextById(IDS.mailingAddress), /^Mailing\s*Address\s+(.+)$/i);

    return {
      'Name': normalizeSimpleValue(nameRaw),
      'Mailing Address': normalizeSimpleValue(mailingAddressRaw)
    };
  }

  function extractDwellingFields() {
    const fireRaw =
      getDisplayValueById(IDS.fireCode) ||
      extractWithRegex(getTextById(IDS.fireBlock), /FireLine\s*Code\s+(.+?)(?:\s+Slope|\s*$)/i);

    const protectionRaw =
      extractWithRegex(getTextById(IDS.protectionBlock), /Code\s+([A-Z0-9-]+)/i);

    const reconstructionRaw =
      getDisplayValueById(IDS.reconstruction) ||
      extractWithRegex(getTextById(IDS.reconstruction), /Reconstruction\s*Cost\s+(.+)$/i);

    const yearBuiltRaw =
      getDisplayValueById(IDS.yearBuilt) ||
      extractWithRegex(getTextById(IDS.yearBuilt), /Year\s*Built\s+(.+)$/i);

    const squareFeetRaw =
      getDisplayValueById(IDS.squareFeet) ||
      extractWithRegex(getTextById(IDS.squareFeet), /Square\s*Feet\s+(.+)$/i);

    const storiesRaw =
      getDisplayValueById(IDS.stories) ||
      extractWithRegex(getTextById(IDS.stories), /Number\s*of\s*Stories\/Style\s+(.+)$/i);

    const waterRaw =
      getDisplayValueById(IDS.waterDevice) ||
      extractWithRegex(getTextById(IDS.waterDevice), /Water\s*Protection\s+(.+)$/i);

    return {
      'Fire Code': normalizeFireCode(fireRaw),
      'Protection Class': normalizeSimpleValue(protectionRaw),
      'Reconstruction Cost': normalizeMoneyText(reconstructionRaw),
      'Year Built': normalizeSimpleValue(yearBuiltRaw),
      'Square FT': normalizeSimpleValue(squareFeetRaw),
      '# of Story': normalizeSimpleValue(storiesRaw),
      'Water Device?': normalizeWaterDevice(waterRaw)
    };
  }

  function extractPricingFields() {
    let standard = getTextById(IDS.standardPrice);
    let enhance = getTextById(IDS.enhancePrice);

    if (!standard || !enhance) {
      const row2 = findInDocs((doc) => {
        const root = doc.getElementById(IDS.pricingTable);
        return root?.querySelector('table tbody tr:nth-of-type(2)') || null;
      });

      if (row2) {
        standard = standard || getElementText(row2.querySelector('td:nth-of-type(3)'));
        enhance = enhance || getElementText(row2.querySelector('td:nth-of-type(5)'));
      }
    }

    return {
      'Standard Pricing': normalizeMoneyText(standard),
      'Enhance Pricing': normalizeMoneyText(enhance)
    };
  }

  function extractQuoteFields() {
    const raw = getTextById(IDS.autoDiscountLV);
    const amount = extractFirstMoney(raw);

    return {
      'Auto Discount': amount
    };
  }

  function extractSubmissionNumber() {
    const titleEl = findInDocs((doc) => {
      const nodes = doc.querySelectorAll('div.gw-Wizard--Title');
      for (const el of nodes) {
        const text = normalizeText(el.textContent);
        if (/^Submission\s+\d+/i.test(text)) return el;
      }
      return null;
    });

    if (!titleEl) return '';
    const text = normalizeText(titleEl.textContent);
    const m = text.match(/Submission\s+(\d+)/i);
    return m ? m[1] : '';
  }

  function findQuotedTriggerElement() {
    return findInDocs((doc) => {
      const nodes = doc.querySelectorAll('div.gw-label');
      for (const el of nodes) {
        if (normalizeText(el.textContent) === 'Submission (Quoted)') return el;
      }
      return null;
    });
  }

  function findActionByText(text) {
    return findInDocs((doc) => {
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="menuitem"], div[role="tab"]');
      for (const el of candidates) {
        if (normalizeText(el.textContent).includes(text)) return el;
      }
      return null;
    });
  }

  function isTitleLike(word) {
    return !!findInDocs((doc) => {
      const nodes = doc.querySelectorAll('title, .gw-TitleBar--Title, .gw-TitleBar--title, .gw-TabBar, .gw-Wizard--Title');
      for (const el of nodes) {
        if (normalizeText(el.textContent).includes(word)) return el;
      }
      return null;
    });
  }

  function getDisplayValueById(id) {
    const el = findByIdInDocs(id);
    if (!el) return '';

    const candidates = [
      el.querySelector('.gw-value-readonly-wrapper'),
      el.querySelector('.gw-vw--value'),
      el.querySelector('.gw-value'),
      el.querySelector('[data-gw-getset="text"]')
    ];

    for (const c of candidates) {
      const value = getElementText(c);
      if (value && value !== 'Code') return value;
    }

    return '';
  }

  function getTextById(id) {
    const el = findByIdInDocs(id);
    return getElementText(el);
  }

  function getElementText(el) {
    if (!el) return '';
    return normalizeText(el.innerText || el.textContent || '');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSimpleValue(value) {
    return normalizeText(value);
  }

  function normalizeMoneyText(value) {
    const text = normalizeText(value);
    const money = extractFirstMoney(text);
    return money || text;
  }

  function normalizeFireCode(value) {
    const text = normalizeText(value);
    const m = text.match(/(?:^|\b)Code\s+([A-Z0-9.-]+)/i);
    if (m) return m[1];
    return text;
  }

  function normalizeWaterDevice(value) {
    const text = normalizeText(value);
    if (!text) return 'No';

    if (
      /^(none|no|n\/a|na|null|no device|not installed|not present|not applicable)$/i.test(text) ||
      /\b(no device|none|not installed|not present|not applicable)\b/i.test(text)
    ) {
      return 'No';
    }

    return 'Yes';
  }

  function extractFirstMoney(text) {
    const m = normalizeText(text).match(/\$[\d,]+(?:\.\d{2})?/);
    return m ? m[0] : '';
  }

  function extractWithRegex(text, regex) {
    const m = normalizeText(text).match(regex);
    return m ? normalizeText(m[1]) : '';
  }

  function findByIdInDocs(id) {
    return findInDocs((doc) => doc.getElementById(id));
  }

  function findInDocs(resolver) {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      try {
        const found = resolver(doc);
        if (found === true) return true;
        if (found) return found;
      } catch {}
    }
    return null;
  }

  function getAccessibleDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);

        if (win.document) docs.push(win.document);

        for (let i = 0; i < win.frames.length; i++) {
          try {
            walk(win.frames[i]);
          } catch {}
        }
      } catch {}
    }

    walk(window.top);
    return docs;
  }

  function resolveFirst(resolvers) {
    for (const fn of resolvers) {
      try {
        const value = fn();
        if (value) return value;
      } catch {}
    }
    return null;
  }

  function safeClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}

    const events = [
      ['pointerdown', MouseEvent],
      ['mousedown', MouseEvent],
      ['pointerup', MouseEvent],
      ['mouseup', MouseEvent],
      ['click', MouseEvent]
    ];

    for (const [type, Ctor] of events) {
      try {
        el.dispatchEvent(new Ctor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    try { el.click(); } catch {}
  }

  async function waitFor(checkFn, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (checkFn()) return true;
      } catch {}
      await sleep(CFG.waitPollMs);
    }
    log(`Timeout waiting for ${label}`);
    return false;
  }

  function formatDate(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function setWaiting(msg) {
    if (state.lastWaitReason === msg) return;
    state.lastWaitReason = msg;
    log(msg);
    setStatus(msg);
  }

  function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'hb-home-quote-grabber-panel';
    panel.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'right:12px',
      'bottom:12px',
      'width:360px',
      'background:#111827',
      'color:#f9fafb',
      'border:1px solid #374151',
      'border-radius:12px',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
      'font:12px/1.35 Arial,sans-serif',
      'user-select:none'
    ].join(';');

    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <div id="hb-home-quote-grabber-head" style="padding:8px 10px;cursor:move;border-bottom:1px solid #374151;background:#0f172a;border-radius:12px 12px 0 0;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.8;">V${VERSION}</div>
      </div>
      <div style="padding:8px 10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;">
          <button id="hb-home-quote-grabber-toggle" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#dc2626;color:#fff;">STOP</button>
          <button id="hb-home-quote-grabber-copylogs" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff;">COPY LOGS</button>
          <button id="hb-home-quote-grabber-copypayload" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#4b5563;color:#fff;">COPY PAYLOAD</button>
        </div>
        <div id="hb-home-quote-grabber-status" style="margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937;">Waiting...</div>
        <div id="hb-home-quote-grabber-logs" style="max-height:220px;overflow:auto;background:#0b1220;border:1px solid #243041;border-radius:8px;padding:6px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-home-quote-grabber-head');
    const toggleBtn = panel.querySelector('#hb-home-quote-grabber-toggle');
    const copyLogsBtn = panel.querySelector('#hb-home-quote-grabber-copylogs');
    const copyPayloadBtn = panel.querySelector('#hb-home-quote-grabber-copypayload');

    toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      toggleBtn.textContent = state.running ? 'STOP' : 'START';
      toggleBtn.style.background = state.running ? '#dc2626' : '#16a34a';
      log(state.running ? 'Resumed' : 'Stopped for this page session');
      setStatus(state.running ? 'Running' : 'Stopped');

      if (state.running) {
        state.triggerSince = 0;
        state.doneThisLoad = false;
      }
    });

    copyLogsBtn.addEventListener('click', async () => {
      try {
        const text = [...state.logLines].reverse().join('\n');
        await navigator.clipboard.writeText(text);
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    copyPayloadBtn.addEventListener('click', async () => {
      try {
        const value = localStorage.getItem(KEYS.payload) || '';
        await navigator.clipboard.writeText(value);
        log('Payload copied');
      } catch {
        log('Copy payload failed');
      }
    });

    makeDraggable(panel, head);

    state.ui = {
      panel,
      status: panel.querySelector('#hb-home-quote-grabber-status'),
      logs: panel.querySelector('#hb-home-quote-grabber-logs')
    };
  }

  function setStatus(text) {
    if (state.ui?.status) state.ui.status.textContent = text;
  }

  function log(message) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;
    state.logLines.unshift(line);
    if (state.logLines.length > CFG.maxLogLines) state.logLines.length = CFG.maxLogLines;
    console.log(`[${SCRIPT_NAME}] ${message}`);

    if (state.ui?.logs) {
      state.ui.logs.innerHTML = state.logLines
        .map((x) => `<div style="margin-bottom:4px;">${escapeHtml(x)}</div>`)
        .join('');
    }
  }

  function makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    function onMove(e) {
      if (!dragging) return;
      const left = startLeft + (e.clientX - startX);
      const top = startTop + (e.clientY - startY);
      panel.style.left = `${Math.max(0, left)}px`;
      panel.style.top = `${Math.max(0, top)}px`;
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      savePanelPos({
        left: panel.style.left,
        top: panel.style.top
      });
    }
  }

  function savePanelPos(pos) {
    try {
      localStorage.setItem(KEYS.panelPos, JSON.stringify(pos));
    } catch {}
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.panelPos) || 'null');
    } catch {
      return null;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
