// ==UserScript==
// @name         Home Bot: Guidewire Header Timeout
// @namespace    homebot.gwpc-header-timeout
// @version      1.23
// @description  Home/Auto header timeout + AUTO no-table/no-vehicles gatherer. Watches Guidewire header state, captures detected errors into the shared GWPC payload flow, supports selector-based error capture, and never sends directly.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-header-timeout.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-header-timeout.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: Guidewire Header Timeout';
  const VERSION = '1.23';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FORCE_SEND_KEY = 'tm_pc_force_send_now_v1';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';

  const CFG = {
    tickMs: 1000,
    timeoutMs: 120000,
    autoMissingStableMs: 3000,
    maxLogLines: 18,
    selectorOutlineColor: '#22d3ee',
    selectorOutlineWidth: 2
  };

  const KEYS = {
    panelPos: 'tm_pc_header_timeout_panel_pos_v112',
    identityCache: 'tm_pc_header_timeout_identity_cache_v2',
    selectorRules: 'tm_pc_header_timeout_selector_rules_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    autoPayload: 'tm_pc_auto_quote_grab_payload_v1'
  };

  const AUTO_VEHICLES_LV_ID = 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PriorCarrier_ExtScreen-PAVehiclesExtPanelSet-VehiclesLV';
  const AUTO_VEHICLES_EMPTY_TEXT = 'No data to display';
  const HOME_IV360_CONTAINER_ID = 'iv360-valuationContainer';

  const state = {
    enabled: true,
    saving: false,
    lastSubmission: '',
    lastHeader: '',
    lastHeaderAt: 0,
    lastProduct: '',
    autoVehiclesIssueSince: 0,
    logs: [],
    panel: null,
    els: {},
    tickTimer: null,
    uiTimer: null,
    selectorMode: false,
    selectorDialogOpen: false,
    selectorTargetEl: null,
    hoveredEl: null,
    hoveredPrevOutline: '',
    hoveredPrevOffset: '',
    capturedRuleId: '',
    savedEventIds: Object.create(null)
  };

  boot();

  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    } else {
      onReady();
    }
  }

  function onReady() {
    clearStaleSharedPause();
    buildUi();
    log('Script started');
    log('Shared-payload error gatherer armed');
    log('Selector mode publishes tm_pc_global_pause_v1');
    renderStatus();

    if (state.tickTimer) clearInterval(state.tickTimer);
    if (state.uiTimer) clearInterval(state.uiTimer);
    state.tickTimer = setInterval(tick, CFG.tickMs);
    state.uiTimer = setInterval(renderLiveUi, 250);
    window.addEventListener('beforeunload', cleanupSelectorMode, true);
    renderLiveUi();
    tick();
  }

  function $(selector, root = document) {
    try { return root.querySelector(selector); } catch { return null; }
  }

  function $$(selector, root = document) {
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  }

  function tick() {
    if (!state.enabled || state.saving || state.selectorMode || state.selectorDialogOpen) return;

    const submission = normalizeText(getSubmissionNumber());
    const product = detectProduct();
    const header = normalizeText(getGuidewireHeader());
    const headerChanged = !!header && header !== state.lastHeader;

    if (headerChanged) {
      state.lastHeader = header;
      state.lastHeaderAt = Date.now();
      state.autoVehiclesIssueSince = 0;
      log(`Header change: ${header}`);
    }

    if (!submission) {
      state.lastSubmission = '';
      state.lastProduct = product || state.lastProduct || '';
      setUiValues('', header, getHeaderElapsedMs());
      return;
    }

    updateIdentityCache(submission);

    if (submission !== state.lastSubmission) {
      state.lastSubmission = submission;
      state.savedEventIds = Object.create(null);
      setUiValues(submission, header, getHeaderElapsedMs());
      return;
    }

    if (product !== state.lastProduct) {
      state.lastProduct = product;
      state.autoVehiclesIssueSince = 0;
      setUiValues(submission, header, getHeaderElapsedMs());
      return;
    }

    if (!header) {
      setUiValues(submission, '', getHeaderElapsedMs());
      detectSavedSelectorErrors(product, submission);
      return;
    }

    if (headerChanged) {
      setUiValues(submission, header, getHeaderElapsedMs());
      detectSavedSelectorErrors(product, submission);
      return;
    }

    const ageMs = getHeaderElapsedMs();
    setUiValues(submission, header, ageMs);
    detectSavedSelectorErrors(product, submission);

    if (product === 'auto') {
      const autoTableState = getAutoVehiclesState();
      if (autoTableState !== 'present') {
        if (!state.autoVehiclesIssueSince) {
          state.autoVehiclesIssueSince = Date.now();
          log(`AUTO vehicles ${autoTableState}. Waiting for stability...`);
        } else if ((Date.now() - state.autoVehiclesIssueSince) >= CFG.autoMissingStableMs) {
          const message = autoTableState === 'missing'
            ? 'AUTO vehicles table missing'
            : AUTO_VEHICLES_EMPTY_TEXT;
          gatherError({
            product: 'auto',
            actionKey: 'auto_no_vehicles',
            errorType: autoTableState === 'missing' ? 'AutoVehiclesTableMissing' : 'AutoVehiclesEmpty',
            errorName: autoTableState === 'missing' ? 'AUTO table missing' : 'NO AUTO/SKIPEED',
            errorText: message,
            headerText: header,
            source: 'auto-vehicles-check'
          });
          return;
        }
      } else {
        state.autoVehiclesIssueSince = 0;
      }
    } else {
      state.autoVehiclesIssueSince = 0;
    }

    if (product === 'home' && hasVisibleIv360ValuationContainer()) {
      gatherError({
        product: 'home',
        actionKey: 'home_no_360_value_present',
        errorType: 'No360Value',
        errorName: 'No 360 Value',
        errorText: 'SKIPPED/NO 360 VALUE',
        headerText: header,
        source: 'iv360-container-present',
        resultField: 'Done?',
        resultValue: 'SKIPPED/NO 360 VALUE'
      });
      return;
    }

    if (ageMs < CFG.timeoutMs) return;

    if (product === 'home') {
      const hasIv360 = hasVisibleIv360ValuationContainer();
      const errorText = hasIv360 && normalizeText(header).toLowerCase() === 'dwelling'
        ? 'No 360 Value'
        : `Header "${header}" did not change for 120 seconds`;

      gatherError({
        product: 'home',
        actionKey: 'home_timeout',
        errorType: hasIv360 && normalizeText(header).toLowerCase() === 'dwelling' ? 'No360Value' : 'HeaderTimeout',
        errorName: hasIv360 && normalizeText(header).toLowerCase() === 'dwelling' ? 'No 360 Value' : 'HOME timeout',
        errorText,
        headerText: header,
        source: 'header-timeout'
      });
      return;
    }

    if (product === 'auto') {
      gatherError({
        product: 'auto',
        actionKey: 'auto_timeout',
        errorType: 'HeaderTimeout',
        errorName: 'AUTO timeout',
        errorText: `Header "${header}" did not change for 120 seconds`,
        headerText: header,
        source: 'header-timeout'
      });
    }
  }

  function gatherError(details) {
    if (state.saving) return;

    const context = buildErrorContext(details);
    if (!context.ok) {
      log(context.reason, 'error');
      return;
    }

    const event = buildErrorEvent(context.job, context.identity, details);
    if (alreadySavedEvent(event.id)) return;

    state.saving = true;
    renderStatus();

    try {
      saveErrorToPayload(context.productPayloadKey, context.product, context.job, event);
      saveErrorToBundle(context.product, context.job, event);
      markSavedEvent(event.id);
      requestForceSend(details.actionKey || 'header-timeout-error');
      log(`Saved ${details.product.toUpperCase()} error: ${event.errorName}`);
      setStatusText(`Saved ${details.product.toUpperCase()} error`);
    } catch (err) {
      log(`Save failed: ${err?.message || err}`, 'error');
      setStatusText('Save failed');
    } finally {
      state.saving = false;
      renderStatus();
    }
  }

  function buildErrorContext(details) {
    const job = readCurrentJob();
    if (!job['AZ ID']) {
      return { ok: false, reason: 'Missing tm_pc_current_job_v1 / AZ ID' };
    }

    const identity = getPageIdentity();
    if (job['Name'] && identity.name && !namesLikelySame(job['Name'], identity.name)) {
      return { ok: false, reason: `Blocked error save: current job Name mismatch | job=${job['Name']} | page=${identity.name}` };
    }
    if (job['Mailing Address'] && identity.mailingAddress && !addressesLikelySame(job['Mailing Address'], identity.mailingAddress)) {
      return { ok: false, reason: 'Blocked error save: current job address mismatch' };
    }

    return {
      ok: true,
      job,
      identity,
      product: details.product === 'home' ? 'home' : 'auto',
      productPayloadKey: details.product === 'home' ? KEYS.homePayload : KEYS.autoPayload
    };
  }

  function buildErrorEvent(job, identity, details) {
    const errorText = normalizeText(details.errorText || '');
    const headerText = normalizeText(details.headerText || '');
    const submissionNumber = normalizeText(identity.submissionNumber || state.lastSubmission || '');
    const selectorRuleId = normalizeText(details.selectorRuleId || '');
    const actionKey = normalizeText(details.actionKey || 'gwpc_error');
    const baseId = [
      job['AZ ID'],
      details.product,
      actionKey,
      details.errorType || '',
      selectorRuleId || '',
      errorText || headerText
    ].join('|');

    return {
      id: hashString(baseId),
      actionKey,
      product: details.product,
      errorType: normalizeText(details.errorType || 'GuidewireError'),
      errorName: normalizeText(details.errorName || details.errorType || 'Guidewire error'),
      errorMessage: errorText || headerText || 'Unknown Guidewire error',
      errorText: errorText || headerText || 'Unknown Guidewire error',
      postMode: normalizeText(details.postMode || 'visible_text'),
      ruleKind: normalizeText(details.ruleKind || 'error'),
      resultField: normalizeText(details.resultField || 'Done?'),
      resultValue: normalizeText(details.resultValue || errorText || headerText || 'Unknown Guidewire error'),
      headerText,
      submissionNumber,
      selectorRuleId,
      customMessage: normalizeText(details.customMessage || ''),
      capturedElementHtml: normalizeText(details.capturedElementHtml || ''),
      capturedText: normalizeText(details.capturedText || ''),
      detectedAt: nowIso(),
      source: normalizeText(details.source || SCRIPT_NAME),
      sourceScript: SCRIPT_NAME,
      sourceVersion: VERSION,
      page: {
        url: location.href,
        title: document.title
      },
      identity: {
        'AZ ID': job['AZ ID'],
        'Name': job['Name'] || identity.name || '',
        'Mailing Address': job['Mailing Address'] || identity.mailingAddress || '',
        'SubmissionNumber': job['SubmissionNumber'] || submissionNumber || ''
      }
    };
  }

  function saveErrorToPayload(payloadKey, product, job, event) {
    const current = safeJsonParse(localStorage.getItem(payloadKey), null);
    const next = isPlainObject(current) ? deepClone(current) : {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'gwpc_error_gathered',
      product,
      'AZ ID': job['AZ ID'],
      currentJob: normalizeCurrentJob(job),
      savedAt: nowIso(),
      page: {
        url: location.href,
        title: document.title
      }
    };

    const payloadAzId = normalizeText(next['AZ ID'] || next?.currentJob?.['AZ ID'] || '');
    if (payloadAzId && payloadAzId !== job['AZ ID']) {
      throw new Error(`Payload AZ ID mismatch (${payloadAzId} != ${job['AZ ID']})`);
    }

    next.script = SCRIPT_NAME;
    next.version = VERSION;
    next.product = product;
    next['AZ ID'] = job['AZ ID'];
    next.currentJob = normalizeCurrentJob({
      ...(isPlainObject(next.currentJob) ? next.currentJob : {}),
      ...job
    });
    next.savedAt = nowIso();
    next.page = { url: location.href, title: document.title };
    next.errors = mergeEventList(next.errors, event);
    next.latestError = deepClone(event);
    if (event.resultField && event.resultValue) next[event.resultField] = event.resultValue;

    localStorage.setItem(payloadKey, JSON.stringify(next, null, 2));
  }

  function saveErrorToBundle(product, job, event) {
    const bundle = ensureBundleForJob(job);
    if (!bundle) throw new Error('Missing current AZ job for bundle save');

    const next = deepClone(bundle);
    next.timeout = isPlainObject(next.timeout) ? next.timeout : {};
    next.timeout.ready = true;
    next.timeout.events = mergeEventList(next.timeout.events, event);
    next.timeout.lastEvent = deepClone(event);

    const section = isPlainObject(next[product]) ? next[product] : {};
    section.ready = section.ready === true;
    section.savedAt = nowIso();
    section.script = SCRIPT_NAME;
    section.version = VERSION;
    section.data = isPlainObject(section.data) ? section.data : {};
    section.data.errors = mergeEventList(section.data.errors, event);
    section.data.latestError = deepClone(event);
    if (event.resultField && event.resultValue) section.data[event.resultField] = event.resultValue;
    next[product] = section;

    next['AZ ID'] = job['AZ ID'];
    next['Name'] = next['Name'] || normalizeText(job['Name']);
    next['Mailing Address'] = next['Mailing Address'] || normalizeText(job['Mailing Address']);
    next['SubmissionNumber'] = next['SubmissionNumber'] || normalizeText(job['SubmissionNumber']);
    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = nowIso();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;

    localStorage.setItem(BUNDLE_KEY, JSON.stringify(next, null, 2));
  }

  function ensureBundleForJob(job) {
    const azId = normalizeText(job && job['AZ ID']);
    if (!azId) return null;

    const current = safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
    if (!isPlainObject(current) || !normalizeText(current['AZ ID'])) {
      return writeBundle(emptyBundleForJob(job));
    }

    if (normalizeText(current['AZ ID']) !== azId) {
      return writeBundle(emptyBundleForJob(job));
    }

    current['Name'] = current['Name'] || normalizeText(job['Name']);
    current['Mailing Address'] = current['Mailing Address'] || normalizeText(job['Mailing Address']);
    current['SubmissionNumber'] = current['SubmissionNumber'] || normalizeText(job['SubmissionNumber']);
    current.timeout = isPlainObject(current.timeout) ? current.timeout : { ready: false, events: [] };
    if (!Array.isArray(current.timeout.events)) current.timeout.events = [];
    current.meta = isPlainObject(current.meta) ? current.meta : {};
    current.meta.updatedAt = nowIso();
    current.meta.lastWriter = SCRIPT_NAME;
    current.meta.version = VERSION;
    return writeBundle(current);
  }

  function emptyBundleForJob(job) {
    return {
      'AZ ID': normalizeText(job && job['AZ ID']),
      'Name': normalizeText(job && job['Name']),
      'Mailing Address': normalizeText(job && job['Mailing Address']),
      'SubmissionNumber': normalizeText(job && job['SubmissionNumber']),
      home: {},
      auto: {},
      timeout: {
        ready: false,
        events: []
      },
      meta: {
        updatedAt: nowIso(),
        lastWriter: SCRIPT_NAME,
        version: VERSION
      }
    };
  }

  function writeBundle(bundle) {
    localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle, null, 2));
    return bundle;
  }

  function mergeEventList(list, event) {
    const out = Array.isArray(list) ? list.map(deepClone) : [];
    const idx = out.findIndex((item) => normalizeText(item?.id) === event.id);
    if (idx >= 0) out[idx] = deepClone(event);
    else out.push(deepClone(event));
    return out;
  }

  function alreadySavedEvent(id) {
    return !!state.savedEventIds[id];
  }

  function markSavedEvent(id) {
    state.savedEventIds[id] = true;
  }

  function requestForceSend(reason) {
    const request = {
      requestedAt: nowIso(),
      reason: normalizeText(reason || 'header-timeout-error'),
      source: SCRIPT_NAME
    };

    try { localStorage.setItem(GLOBAL_PAUSE_KEY, '1'); } catch {}
    try { localStorage.setItem(FORCE_SEND_KEY, JSON.stringify(request, null, 2)); } catch {}
    log(`Force send requested: ${request.reason}`);
  }

  function hasForceSendRequest() {
    const request = safeJsonParse(localStorage.getItem(FORCE_SEND_KEY), null);
    return !!(request && typeof request === 'object' && request.requestedAt);
  }

  function clearStaleSharedPause() {
    if (hasForceSendRequest()) return;
    try {
      if (localStorage.getItem(GLOBAL_PAUSE_KEY) === '1') {
        localStorage.removeItem(GLOBAL_PAUSE_KEY);
      }
    } catch {}
  }

  function resetSubmissionState(submission, product, header) {
    state.lastSubmission = submission || '';
    state.lastProduct = product || '';
    state.lastHeader = header || '';
    state.lastHeaderAt = header ? Date.now() : 0;
    state.autoVehiclesIssueSince = 0;
    state.savedEventIds = Object.create(null);
  }

  function getHeaderElapsedMs() {
    return state.lastHeaderAt ? Math.max(0, Date.now() - state.lastHeaderAt) : 0;
  }

  function renderLiveUi() {
    if (!state.enabled) return;
    const currentSubmission = normalizeText(getSubmissionNumber()) || state.lastSubmission || '';
    const currentHeader = normalizeText(getGuidewireHeader()) || state.lastHeader || '';
    setUiValues(currentSubmission, currentHeader, getHeaderElapsedMs());
  }

  function getAutoVehiclesState() {
    const root = findAutoVehiclesRoot();
    if (!root) return 'missing';

    const emptyCell = $$('.gw-ListView--empty-info-cell', root)
      .find((el) => isVisible(el) && normalizeText(el.textContent) === AUTO_VEHICLES_EMPTY_TEXT);
    if (emptyCell) return 'empty';

    const bodyRows = $$('tbody tr', root).filter(isVisible);
    if (!bodyRows.length) {
      const anyText = normalizeText(root.textContent);
      if (anyText.includes(AUTO_VEHICLES_EMPTY_TEXT)) return 'empty';
      return 'missing';
    }

    return 'present';
  }

  function findAutoVehiclesRoot() {
    for (const doc of getDocs()) {
      const root = doc.getElementById(AUTO_VEHICLES_LV_ID) || queryByCssId(doc, AUTO_VEHICLES_LV_ID);
      if (root && isVisible(root)) return root;
    }
    return null;
  }

  function hasVisibleIv360ValuationContainer() {
    for (const doc of getDocs()) {
      const el = doc.getElementById(HOME_IV360_CONTAINER_ID) || queryByCssId(doc, HOME_IV360_CONTAINER_ID);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  function queryByCssId(root, id) {
    try {
      return root.querySelector(`#${cssEscape(id)}`);
    } catch {
      return null;
    }
  }

  function getPageIdentity() {
    const submissionNumber = normalizeText(getSubmissionNumber());
    const cache = getIdentityCache();
    const cached = isPlainObject(cache[submissionNumber]) ? cache[submissionNumber] : {};

    const name = normalizeText(getAccountNameFromPage()) || normalizeText(cached['Name'] || '');
    const mailingAddress = normalizeText(getMailingAddressFromPage()) || normalizeText(cached['Mailing Address'] || '');

    return {
      name,
      mailingAddress,
      submissionNumber
    };
  }

  function updateIdentityCache(submission) {
    const sub = normalizeText(submission);
    if (!sub) return;

    const name = normalizeText(getAccountNameFromPage());
    const mailingAddress = normalizeText(getMailingAddressFromPage());
    if (!name || !mailingAddress) return;

    const cache = getIdentityCache();
    cache[sub] = {
      'Name': name,
      'Mailing Address': mailingAddress,
      'SubmissionNumber': sub,
      seenAt: nowIso()
    };
    setIdentityCache(cache);
  }

  function getIdentityCache() {
    return safeJsonParse(sessionStorage.getItem(KEYS.identityCache), {}) || {};
  }

  function setIdentityCache(cache) {
    try { sessionStorage.setItem(KEYS.identityCache, JSON.stringify(cache)); } catch {}
  }

  function readCurrentJob() {
    let raw = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    let job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    raw = safeJsonParse(localStorage.getItem(LEGACY_SHARED_JOB_KEY), null);
    job = normalizeCurrentJob(raw);
    return job;
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

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || '');
    return out;
  }

  function detectProduct() {
    const isAuto = hasLabelExactAnyDoc('Personal Auto');
    const isHome = hasLabelExactAnyDoc('Homeowners');
    if (isAuto) return 'auto';
    if (isHome) return 'home';
    return '';
  }

  function hasLabelExactAnyDoc(labelText) {
    const wanted = normalizeText(labelText);
    if (!wanted) return false;
    for (const doc of getDocs()) {
      const hit = $$('.gw-label', doc).some((el) => isVisible(el) && normalizeText(el.textContent) === wanted);
      if (hit) return true;
    }
    return false;
  }

  function getSubmissionNumber() {
    const titleText = firstVisibleTextBySelectors([
      '.gw-Wizard--Title',
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '[role="heading"][aria-level="1"]'
    ]);
    const match = titleText.match(/Submission\s+(\d{6,})/i);
    return match ? match[1] : '';
  }

  function getGuidewireHeader() {
    return firstVisibleTextBySelectors([
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '.gw-Wizard--Title',
      '[role="heading"][aria-level="1"]',
      '#iv360-valuationContainer .iv360-page-title-container .iv360-page-header',
      '#iv360-valuationContainer .iv360-page-title-container h1',
      '.iv360-page-title-container .iv360-page-header',
      '.iv360-page-title-container h1'
    ]);
  }

  function getAccountNameFromPage() {
    for (const doc of getDocs()) {
      const exact = $('div#SubmissionWizard-JobWizardInfoBar-AccountName > div.gw-label.gw-infoValue:nth-of-type(2)', doc);
      const exactText = normalizeText(exact && exact.textContent);
      if (exactText) return exactText;

      const wrap = $('#SubmissionWizard-JobWizardInfoBar-AccountName', doc);
      if (!wrap) continue;

      const values = $$('.gw-label.gw-infoValue, .gw-infoValue', wrap)
        .map((el) => normalizeText(el.textContent))
        .filter(Boolean);

      if (values[1]) return values[1];
      if (values[0]) return values[0];
    }
    return '';
  }

  function getMailingAddressFromPage() {
    const selectors = [
      'div#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput > div.gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput .gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-label.gw-infoValue'
    ];

    for (const doc of getDocs()) {
      for (const selector of selectors) {
        const el = $(selector, doc);
        const text = normalizeText(el && el.textContent);
        if (text && looksLikeAddress(text)) return text;
      }
    }

    for (const doc of getDocs()) {
      const nodes = [
        ...$$('.gw-infoValue', doc),
        ...$$('.gw-label.gw-infoValue', doc),
        ...$$('.gw-vw--value', doc)
      ];

      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const text = normalizeText(el.textContent);
        if (text && looksLikeAddress(text)) return text;
      }
    }

    return '';
  }

  function looksLikeAddress(value) {
    return /\d{1,6}\s+.+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/.test(normalizeText(value));
  }

  function getDocs() {
    const docs = [];
    try { docs.push(document); } catch {}
    for (const frame of $$('iframe, frame', document)) {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch {}
    }
    return docs;
  }

  function firstVisibleTextBySelectors(selectors) {
    for (const doc of getDocs()) {
      for (const selector of selectors) {
        const el = $(selector, doc);
        if (!el || !isVisible(el)) continue;
        const text = normalizeText(el.textContent);
        if (text) return text;
      }
    }
    return '';
  }

  function buildUi() {
    if (!document.documentElement) return false;
    const existing = $('#tm-pc-header-timeout-panel');
    if (existing) return true;

    const panel = document.createElement('div');
    panel.id = 'tm-pc-header-timeout-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: '390px',
      zIndex: 2147483647,
      background: 'rgba(17,24,39,0.96)',
      color: '#f9fafb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '12px',
      boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
      font: '12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div id="tm-pc-header-timeout-handle" style="padding:8px 10px;background:rgba(255,255,255,0.06);cursor:move;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.75;">v${VERSION}</div>
      </div>
      <div style="padding:10px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
          <button id="tm-pc-header-timeout-toggle" style="border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:#16a34a;color:#fff;font-weight:700;">STOP</button>
          <button id="tm-pc-header-timeout-selector" style="border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:#0891b2;color:#fff;font-weight:700;">ERROR SELECTOR</button>
          <div id="tm-pc-header-timeout-status" style="font-weight:700;color:#86efac;">RUNNING</div>
        </div>
        <div style="display:grid;grid-template-columns:92px 1fr;gap:4px 8px;margin-bottom:8px;">
          <div style="opacity:.8;">Submission</div>
          <div id="tm-pc-header-timeout-submission">—</div>
          <div style="opacity:.8;">Header</div>
          <div id="tm-pc-header-timeout-header" style="word-break:break-word;">—</div>
          <div style="opacity:.8;">No change</div>
          <div id="tm-pc-header-timeout-age">—</div>
          <div style="opacity:.8;">Action in</div>
          <div id="tm-pc-header-timeout-deadline">—</div>
        </div>
        <div id="tm-pc-header-timeout-logs" style="max-height:190px;overflow:auto;background:rgba(0,0,0,0.22);border-radius:8px;padding:8px;white-space:pre-wrap;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    loadPanelPos(panel);
    makeDraggable(panel, $('#tm-pc-header-timeout-handle', panel));

    state.panel = panel;
    state.els.toggle = $('#tm-pc-header-timeout-toggle', panel);
    state.els.selector = $('#tm-pc-header-timeout-selector', panel);
    state.els.status = $('#tm-pc-header-timeout-status', panel);
    state.els.submission = $('#tm-pc-header-timeout-submission', panel);
    state.els.header = $('#tm-pc-header-timeout-header', panel);
    state.els.age = $('#tm-pc-header-timeout-age', panel);
    state.els.deadline = $('#tm-pc-header-timeout-deadline', panel);
    state.els.logs = $('#tm-pc-header-timeout-logs', panel);

    state.els.toggle.addEventListener('click', () => {
      state.enabled = !state.enabled;
      renderStatus();
      log(state.enabled ? 'Manual START.' : 'Manual STOP for this page session.');
    });

    state.els.selector.addEventListener('click', () => {
      if (state.selectorMode) cancelSelectorMode('Selector canceled');
      else enterSelectorMode();
    });

    renderStatus();
    renderLogs();
    return true;
  }

  function enterSelectorMode() {
    state.selectorMode = true;
    publishGlobalPause(true);
    updateSelectorButton();
    log('Selector mode started. Hover an error and click to save rule. Press Esc to cancel.');

    document.addEventListener('mousemove', onSelectorMove, true);
    document.addEventListener('click', onSelectorClick, true);
    document.addEventListener('keydown', onSelectorKeydown, true);
  }

  function cancelSelectorMode(message = 'Selector mode ended') {
    cleanupSelectorMode();
    log(message);
  }

  function cleanupSelectorMode() {
    if (!state.selectorMode && !state.selectorDialogOpen) return;
    state.selectorMode = false;
    state.selectorDialogOpen = false;
    state.selectorTargetEl = null;
    publishGlobalPause(false);
    clearHoveredHighlight();
    updateSelectorButton();
    document.removeEventListener('mousemove', onSelectorMove, true);
    document.removeEventListener('click', onSelectorClick, true);
    document.removeEventListener('keydown', onSelectorKeydown, true);
    removeSelectorDialog();
  }

  function updateSelectorButton() {
    if (!state.els.selector) return;
    state.els.selector.textContent = state.selectorMode ? 'EXIT SELECTOR' : 'ERROR SELECTOR';
    state.els.selector.style.background = state.selectorMode ? '#dc2626' : '#0891b2';
  }

  function onSelectorMove(event) {
    const rawEl = event.target instanceof Element ? event.target : null;
    if (!rawEl || (state.panel && state.panel.contains(rawEl))) return;
    const usableEl = getUsableSelectorTarget(rawEl) || rawEl;
    if (state.panel && state.panel.contains(usableEl)) return;
    setHoveredElement(usableEl);
  }

  function onSelectorClick(event) {
    const rawEl = event.target instanceof Element ? event.target : null;
    if (!rawEl || (state.panel && state.panel.contains(rawEl))) return;
    const usableEl = getUsableSelectorTarget(rawEl) || rawEl;
    if (state.panel && state.panel.contains(usableEl)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.selectorMode = false;
    state.selectorDialogOpen = true;
    state.selectorTargetEl = usableEl;
    clearHoveredHighlight();
    document.removeEventListener('mousemove', onSelectorMove, true);
    document.removeEventListener('click', onSelectorClick, true);
    document.removeEventListener('keydown', onSelectorKeydown, true);
    openSelectorDialog(rawEl, usableEl, detectProduct() || state.lastProduct || 'home');
  }

  function onSelectorKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelSelectorMode('Selector canceled');
    }
  }

  function setHoveredElement(el) {
    if (state.hoveredEl === el) return;
    clearHoveredHighlight();
    state.hoveredEl = el;
    if (!el) return;
    state.hoveredPrevOutline = el.style.outline || '';
    state.hoveredPrevOffset = el.style.outlineOffset || '';
    el.style.outline = `${CFG.selectorOutlineWidth}px solid ${CFG.selectorOutlineColor}`;
    el.style.outlineOffset = '2px';
  }

  function clearHoveredHighlight() {
    if (!state.hoveredEl) return;
    state.hoveredEl.style.outline = state.hoveredPrevOutline;
    state.hoveredEl.style.outlineOffset = state.hoveredPrevOffset;
    state.hoveredEl = null;
    state.hoveredPrevOutline = '';
    state.hoveredPrevOffset = '';
  }

  function buildSelectorRule(el, product) {
    const textSample = normalizeText(el.innerText || el.textContent || '').slice(0, 180);
    const selector = buildStableSelector(el);
    const errorName = textSample || normalizeText(el.getAttribute('aria-label') || `${el.tagName.toLowerCase()} error`);
    const id = hashString([product, selector, textSample].join('|'));

    return {
      id,
      product,
      selector,
      textSample,
      errorName,
      targetMode: 'clicked',
      ruleKind: 'error',
      postMode: 'visible_text',
      customMessage: '',
      createdAt: nowIso()
    };
  }

  function getUsableSelectorTarget(el) {
    if (!(el instanceof Element)) return null;

    const direct = normalizeInteractiveTarget(el, true);
    if (direct) return direct;

    const wrapperUpgraded = upgradeFrameworkWrapperTarget(el);
    if (wrapperUpgraded) return wrapperUpgraded;

    const wrapper = findTargetWrapper(el) || el;
    const upgraded = findPreferredTargetIn(wrapper);
    return normalizeInteractiveTarget(upgraded || wrapper || el, false) || upgraded || wrapper || el;
  }

  function upgradeFrameworkWrapperTarget(el) {
    const wrapper = findTargetWrapper(el);
    if (!wrapper) return null;

    const preferred = [
      'input[type="radio"]',
      'input[type="checkbox"]',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      'button',
      'a[href]',
      'a[role="link"]',
      'label[for]',
      'label',
      '[role="button"]',
      '[role="link"]'
    ];

    for (const selector of preferred) {
      const match = $$(selector, wrapper).find(isVisible);
      if (match) return normalizeInteractiveTarget(match, false);
    }

    const clickableWrapper = findClickableIv360Container(wrapper);
    if (clickableWrapper) return clickableWrapper;

    let current = wrapper;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      for (const selector of preferred) {
        const siblingMatch = $$(selector, current).find((node) => isVisible(node) && (node === wrapper || node.contains(wrapper) || wrapper.contains(node) || node.closest?.('mat-radio-button, mat-radio-group, iv360-question-row, iv360-widget-integer, iv360-page-link, iv360-quality-section, iv360-page-area, iv360-quality-no-slider') === wrapper));
        if (siblingMatch) return normalizeInteractiveTarget(siblingMatch, false);
      }
      const clickableParent = findClickableIv360Container(current);
      if (clickableParent) return clickableParent;
    }

    return null;
  }

  function findTargetWrapper(el) {
    let current = el;
    while (current && current.nodeType === 1) {
      const tag = String(current.tagName || '').toLowerCase();
      if (tag.startsWith('iv360-') || tag.startsWith('mat-')) return current;
      current = current.parentElement;
    }
    return null;
  }

  function findPreferredTargetIn(root) {
    if (!(root instanceof Element)) return null;

    const selectors = [
      'input[type="radio"]',
      'input[type="checkbox"]',
      'input:not([type="hidden"])',
      'textarea',
      'select',
      'button',
      'a[href]',
      'a[role="link"]',
      'label[for]',
      'label',
      '[role="button"]',
      '[role="link"]'
    ];

    for (const selector of selectors) {
      const match = $$(selector, root).find(isVisible);
      if (match) return normalizeInteractiveTarget(match, false);
    }

    const labelled = root.closest?.('label[for]');
    if (labelled) return normalizeInteractiveTarget(labelled, false);

    const clickableWrapper = findClickableIv360Container(root);
    if (clickableWrapper) return clickableWrapper;

    return null;
  }

  function normalizeInteractiveTarget(el, strict = false) {
    if (!(el instanceof Element)) return null;

    if (el.matches?.('label[for]')) {
      const forId = normalizeText(el.getAttribute('for') || '');
      const linked = forId ? el.ownerDocument.getElementById(forId) : null;
      return linked && isVisible(linked) ? linked : el;
    }

    if (el.matches?.('mat-radio-button')) {
      const radio = el.querySelector('input[type="radio"]');
      if (radio && isVisible(radio)) return radio;
    }

    if (el.matches?.('input:not([type="hidden"]), textarea, select, button, a[href], a[role="link"], [role="button"], [role="link"], label')) {
      return el;
    }

    const clickableWrapper = findClickableIv360Container(el);
    if (clickableWrapper) return clickableWrapper;

    const inner = el.querySelector?.('input[type="radio"], input[type="checkbox"], input:not([type="hidden"]), textarea, select, button, a[href], a[role="link"], [role="button"], [role="link"], label[for], label');
    if (inner instanceof Element && isVisible(inner)) {
      return normalizeInteractiveTarget(inner, false);
    }

    const radioWrapper = el.closest?.('mat-radio-button');
    if (radioWrapper) {
      const radio = radioWrapper.querySelector('input[type="radio"]');
      if (radio && isVisible(radio)) return radio;
    }

    return strict ? null : el;
  }

  function findClickableIv360Container(el) {
    let current = el instanceof Element ? el : null;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (!isVisible(current)) continue;
      const tag = String(current.tagName || '').toLowerCase();
      const classText = Array.from(current.classList || []).join(' ');
      const ariaExpanded = current.getAttribute?.('aria-expanded');
      const role = normalizeText(current.getAttribute?.('role') || '');
      const cursor = getElementCursor(current);
      const looksIv360Clickable = /iv360-(page-link|quality-section-title-container|quality-section-controls|section-heading|pageArea|page-area)/i.test(classText) ||
        /iv360-quality-section-title/i.test(classText) ||
        /iv360-link-text/i.test(classText) ||
        /iv360-.*quality-section/i.test(current.id || '');

      if (tag === 'div' && (
        role === 'button' ||
        role === 'link' ||
        ariaExpanded === 'true' ||
        ariaExpanded === 'false' ||
        cursor === 'pointer' ||
        looksIv360Clickable
      )) {
        return current;
      }
    }
    return null;
  }

  function getElementCursor(el) {
    try { return String(window.getComputedStyle(el).cursor || '').toLowerCase(); }
    catch { return ''; }
  }

  function openSelectorDialog(clickedEl, upgradedEl, product) {
    removeSelectorDialog();

    const clickedRule = buildSelectorRule(clickedEl, product);
    const upgradedRule = upgradedEl && upgradedEl !== clickedEl ? buildSelectorRule(upgradedEl, product) : null;
    const baseRule = upgradedRule || clickedRule;
    const overlay = document.createElement('div');
    overlay.id = 'tm-pc-header-timeout-selector-dialog';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 2147483647,
      background: 'rgba(15,23,42,0.82)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '18px'
    });

    overlay.innerHTML = `
      <div style="width:min(520px,100%);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 16px 40px rgba(0,0,0,.35);padding:16px;">
        <div style="font-weight:700;font-size:15px;margin-bottom:10px;">Save Selector Rule</div>
        <div style="font-size:12px;opacity:.85;margin-bottom:12px;white-space:pre-wrap;max-height:88px;overflow:auto;">${escapeHtml(baseRule.textSample || baseRule.selector || '(no text found)')}</div>
        <label style="display:block;font-size:12px;margin-bottom:4px;">Rule Name</label>
        <input id="tm-pc-rule-name" type="text" value="${escapeAttr(baseRule.errorName || '')}" style="width:100%;margin-bottom:10px;padding:8px;border-radius:8px;border:1px solid #334155;background:#111827;color:#e5e7eb;">
        <label style="display:block;font-size:12px;margin-bottom:4px;">Rule Type</label>
        <select id="tm-pc-rule-kind" style="width:100%;margin-bottom:10px;padding:8px;border-radius:8px;border:1px solid #334155;background:#111827;color:#e5e7eb;">
          <option value="error">Error</option>
          <option value="blocker">Blocker / stop condition</option>
        </select>
        <label style="display:block;font-size:12px;margin-bottom:4px;">Selection target</label>
        <select id="tm-pc-rule-target" style="width:100%;margin-bottom:10px;padding:8px;border-radius:8px;border:1px solid #334155;background:#111827;color:#e5e7eb;">
          <option value="clicked">Exact clicked element</option>
          ${upgradedRule ? '<option value="upgraded" selected>Upgraded inner/native target</option>' : ''}
        </select>
        <label style="display:block;font-size:12px;margin-bottom:4px;">What to post</label>
        <select id="tm-pc-rule-post-mode" style="width:100%;margin-bottom:10px;padding:8px;border-radius:8px;border:1px solid #334155;background:#111827;color:#e5e7eb;">
          <option value="visible_text">Visible text</option>
          <option value="full_element">Full element HTML</option>
          <option value="presence_only">Element present only</option>
          <option value="custom_text">Custom text</option>
        </select>
        <label style="display:block;font-size:12px;margin-bottom:4px;">Custom text override</label>
        <textarea id="tm-pc-rule-custom" rows="3" style="width:100%;margin-bottom:12px;padding:8px;border-radius:8px;border:1px solid #334155;background:#111827;color:#e5e7eb;"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="tm-pc-rule-cancel" style="border:0;border-radius:8px;padding:8px 12px;background:#475569;color:#fff;font-weight:700;cursor:pointer;">Cancel</button>
          <button id="tm-pc-rule-save" style="border:0;border-radius:8px;padding:8px 12px;background:#0891b2;color:#fff;font-weight:700;cursor:pointer;">Save Rule</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    const nameEl = $('#tm-pc-rule-name', overlay);
    const targetEl = $('#tm-pc-rule-target', overlay);
    const postModeEl = $('#tm-pc-rule-post-mode', overlay);
    const customEl = $('#tm-pc-rule-custom', overlay);
    const cancelEl = $('#tm-pc-rule-cancel', overlay);
    const saveEl = $('#tm-pc-rule-save', overlay);

    const updateCustomHint = () => {
      const mode = normalizeText(postModeEl?.value || 'visible_text');
      if (customEl) {
        customEl.placeholder = mode === 'presence_only'
          ? 'Optional text to save when the element is present'
          : mode === 'custom_text'
            ? 'Text to save instead of the element content'
            : 'Optional override text';
      }
    };

    postModeEl?.addEventListener('change', updateCustomHint);
    updateCustomHint();
    try { nameEl?.focus(); nameEl?.select(); } catch {}

    cancelEl?.addEventListener('click', () => cancelSelectorMode('Selector canceled'));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cancelSelectorMode('Selector canceled');
    });
    saveEl?.addEventListener('click', () => {
      const kindEl = $('#tm-pc-rule-kind', overlay);
      const selectedMode = normalizeText(targetEl?.value || (upgradedRule ? 'upgraded' : 'clicked'));
      const selectedBase = selectedMode === 'clicked' || !upgradedRule ? clickedRule : upgradedRule;
      const rule = {
        ...selectedBase,
        targetMode: selectedMode,
        errorName: normalizeText(nameEl?.value || selectedBase.errorName || 'Selected rule'),
        ruleKind: normalizeText(kindEl?.value || 'error'),
        postMode: normalizeText(postModeEl?.value || 'visible_text'),
        customMessage: normalizeText(customEl?.value || '')
      };
      const idBase = [
        rule.product,
        rule.selector,
        rule.errorName,
        rule.ruleKind,
        rule.postMode,
        rule.textSample
      ].join('|');
      rule.id = hashString(idBase);

      const rules = getSelectorRules();
      const existingIdx = rules.findIndex((item) => item.id === rule.id || (item.selector === rule.selector && item.product === rule.product));
      if (existingIdx >= 0) rules[existingIdx] = rule;
      else rules.push(rule);
      setSelectorRules(rules);
      state.capturedRuleId = rule.id;
      cleanupSelectorMode();
      log(`Selector rule saved: ${rule.errorName}`);
    });
  }

  function removeSelectorDialog() {
    const dialog = $('#tm-pc-header-timeout-selector-dialog');
    if (dialog) dialog.remove();
  }

  function buildStableSelector(el) {
    if (el.id) return `#${cssEscape(el.id)}`;

    if (el.matches?.('label[for]')) {
      const forId = normalizeText(el.getAttribute('for') || '');
      if (forId) {
        const selector = `label[for="${cssEscapeAttr(forId)}"]`;
        if (isUniqueSelector(selector, el.ownerDocument)) return selector;
      }
    }

    if (el.matches?.('input, textarea, select, button') && el.id) {
      return `#${cssEscape(el.id)}`;
    }

    const labelledBy = normalizeText(el.getAttribute?.('aria-labelledby') || '');
    if (labelledBy) {
      const selector = `${el.tagName.toLowerCase()}[aria-labelledby="${cssEscapeAttr(labelledBy)}"]`;
      if (isUniqueSelector(selector, el.ownerDocument)) return selector;
    }

    const aria = normalizeText(el.getAttribute('aria-label') || '');
    if (aria) {
      const attrSelector = `${el.tagName.toLowerCase()}[aria-label="${cssEscapeAttr(aria)}"]`;
      if (isUniqueSelector(attrSelector, el.ownerDocument)) return attrSelector;
    }

    const dataAttrs = ['data-gw-id', 'data-testid', 'name', 'role', 'type', 'value'];
    for (const attr of dataAttrs) {
      const value = normalizeText(el.getAttribute(attr) || '');
      if (!value) continue;
      const attrSelector = `${el.tagName.toLowerCase()}[${attr}="${cssEscapeAttr(value)}"]`;
      if (isUniqueSelector(attrSelector, el.ownerDocument)) return attrSelector;
    }

    const radioWrapper = el.closest?.('mat-radio-button');
    if (radioWrapper?.id) {
      const input = radioWrapper.querySelector('input[type="radio"]');
      if (input?.id) return `#${cssEscape(input.id)}`;
      return `#${cssEscape(radioWrapper.id)}`;
    }

    let current = el;
    while (current && current.nodeType === 1 && current !== document.body) {
      if (current.id) {
        const withinId = buildScopedSelectorFromAncestor(current, el);
        if (withinId) return withinId;
        break;
      }
      current = current.parentElement;
    }

    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }

      const stableClasses = Array.from(current.classList || [])
        .filter((name) => /^iv360-|^mat-|^mdc-|^gw-/.test(name))
        .slice(0, 2);
      if (stableClasses.length) part += `.${stableClasses.map(cssEscape).join('.')}`;

      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((node) => node.tagName === current.tagName)
        : [];
      if (siblings.length > 1 && !stableClasses.length) {
        const idx = siblings.indexOf(current) + 1;
        part += `:nth-of-type(${idx})`;
      }

      parts.unshift(part);
      const selector = parts.join(' > ');
      if (isUniqueSelector(selector, el.ownerDocument)) return selector;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function buildScopedSelectorFromAncestor(ancestor, target) {
    if (!(ancestor instanceof Element) || !(target instanceof Element) || !ancestor.id) return '';
    if (ancestor === target) return `#${cssEscape(ancestor.id)}`;

    const steps = [];
    let current = target;
    while (current && current !== ancestor && current.nodeType === 1 && steps.length < 4) {
      let step = current.tagName.toLowerCase();

      if (current.id) {
        steps.unshift(`#${cssEscape(current.id)}`);
        break;
      }

      const forId = normalizeText(current.getAttribute?.('for') || '');
      if (forId && current.matches?.('label')) {
        step += `[for="${cssEscapeAttr(forId)}"]`;
        steps.unshift(step);
        current = current.parentElement;
        continue;
      }

      const aria = normalizeText(current.getAttribute?.('aria-label') || '');
      if (aria) {
        step += `[aria-label="${cssEscapeAttr(aria)}"]`;
        steps.unshift(step);
        current = current.parentElement;
        continue;
      }

      const stableClasses = Array.from(current.classList || [])
        .filter((name) => /^iv360-|^mat-|^mdc-|^gw-/.test(name))
        .slice(0, 2);
      if (stableClasses.length) {
        step += `.${stableClasses.map(cssEscape).join('.')}`;
      }

      steps.unshift(step);
      current = current.parentElement;
    }

    if (current !== ancestor) return '';
    const selector = `#${cssEscape(ancestor.id)} > ${steps.join(' > ')}`;
    return isUniqueSelector(selector, target.ownerDocument) ? selector : '';
  }

  function isUniqueSelector(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function getSelectorRules() {
    return safeJsonParse(localStorage.getItem(KEYS.selectorRules), []) || [];
  }

  function setSelectorRules(rules) {
    localStorage.setItem(KEYS.selectorRules, JSON.stringify(rules, null, 2));
  }

  function detectSavedSelectorErrors(product, submission) {
    if (!submission || !product) return;
    for (const rule of getSelectorRules()) {
      if (normalizeText(rule.product) && normalizeText(rule.product) !== product) continue;
      const match = findRuleMatch(rule);
      if (!match) continue;

      gatherError({
        product,
        actionKey: 'selected_error',
        errorType: normalizeText(rule.ruleKind === 'blocker' ? 'SelectedPresenceBlocker' : 'SelectedError'),
        errorName: normalizeText(rule.errorName || 'Selected error'),
        errorText: getRulePostText(rule, match),
        headerText: normalizeText(getGuidewireHeader()),
        selectorRuleId: rule.id,
        source: 'selector-rule',
        postMode: normalizeText(rule.postMode || 'visible_text'),
        ruleKind: normalizeText(rule.ruleKind || 'error'),
        customMessage: normalizeText(rule.customMessage || ''),
        capturedElementHtml: normalizeText((match.outerHTML || '').slice(0, 4000)),
        capturedText: normalizeText(match.innerText || match.textContent || '')
      });
      return;
    }
  }

  function getRulePostText(rule, match) {
    const mode = normalizeText(rule?.postMode || 'visible_text');
    const customMessage = normalizeText(rule?.customMessage || '');
    const visibleText = normalizeText(match?.innerText || match?.textContent || rule?.textSample || '');
    const fullElement = normalizeText((match?.outerHTML || '').slice(0, 4000));

    if (mode === 'presence_only') {
      return customMessage || `Element present: ${normalizeText(rule?.errorName || 'Selected rule')}`;
    }
    if (mode === 'custom_text') {
      return customMessage || visibleText || normalizeText(rule?.errorName || 'Selected rule');
    }
    if (mode === 'full_element') {
      return fullElement || customMessage || visibleText || normalizeText(rule?.errorName || 'Selected rule');
    }
    return customMessage || visibleText || fullElement || normalizeText(rule?.errorName || 'Selected rule');
  }

  function findRuleMatch(rule) {
    const selector = normalizeText(rule.selector);
    if (!selector) return null;
    for (const doc of getDocs()) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll(selector)); } catch {}
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = normalizeText(node.innerText || node.textContent || '');
        if (rule.textSample && text && !text.includes(normalizeText(rule.textSample))) continue;
        return node;
      }
    }
    return null;
  }

  function publishGlobalPause(value) {
    try {
      if (value) localStorage.setItem(GLOBAL_PAUSE_KEY, '1');
      else localStorage.removeItem(GLOBAL_PAUSE_KEY);
    } catch {}
  }

  function renderStatus() {
    if (!state.els.status || !state.els.toggle) return;
    const running = state.enabled && !state.saving && !state.selectorMode && !state.selectorDialogOpen;
    state.els.status.textContent =
      state.selectorDialogOpen ? 'SELECTOR CONFIG' :
      state.selectorMode ? 'SELECTOR MODE' :
      state.saving ? 'SAVING...' :
      running ? 'RUNNING' : 'STOPPED';
    state.els.status.style.color =
      state.selectorDialogOpen ? '#93c5fd' :
      state.selectorMode ? '#67e8f9' :
      state.saving ? '#facc15' :
      running ? '#86efac' : '#fca5a5';
    state.els.toggle.textContent = running ? 'STOP' : 'START';
    state.els.toggle.style.background = running ? '#16a34a' : '#6b7280';
  }

  function setStatusText(text) {
    if (state.els.status) state.els.status.textContent = text;
  }

  function setUiValues(submission, header, ageMs) {
    const displayHeader = header || state.lastHeader || '-';
    if (state.els.submission) state.els.submission.textContent = submission || '-';
    if (state.els.header) state.els.header.textContent = displayHeader;
    if (state.els.age) state.els.age.textContent = state.lastHeaderAt ? `${Math.max(0, Math.floor(ageMs / 1000))}s` : '-';
    if (state.els.deadline) {
      const remainingMs = state.lastHeaderAt ? Math.max(0, CFG.timeoutMs - ageMs) : 0;
      state.els.deadline.textContent = state.lastHeaderAt ? `${Math.ceil(remainingMs / 1000)}s` : '-';
    }
  }

  function log(message, type = 'info') {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    if (state.logs.length > CFG.maxLogLines) state.logs.length = CFG.maxLogLines;
    renderLogs();
    if (type === 'error') console.error(`[${SCRIPT_NAME}] ${message}`);
    else console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function renderLogs() {
    if (state.els.logs) state.els.logs.textContent = state.logs.join('\n');
  }

  function savePanelPos() {
    if (!state.panel) return;
    localStorage.setItem(KEYS.panelPos, JSON.stringify({
      left: state.panel.style.left || '',
      top: state.panel.style.top || '',
      right: state.panel.style.right || '',
      bottom: state.panel.style.bottom || ''
    }));
  }

  function loadPanelPos(panel) {
    const raw = safeJsonParse(localStorage.getItem(KEYS.panelPos), null);
    if (!raw || !isPlainObject(raw)) return;
    if (raw.left) panel.style.left = raw.left;
    if (raw.top) panel.style.top = raw.top;
    if (raw.right) panel.style.right = raw.right;
    if (raw.bottom) panel.style.bottom = raw.bottom;
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      panel.style.left = `${Math.max(4, startLeft + (event.clientX - startX))}px`;
      panel.style.top = `${Math.max(4, startTop + (event.clientY - startY))}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      savePanelPos();
    });
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function namesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function addressesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function normalizeCompare(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\.,#]/g, '')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bsouth\b/g, 's')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return `e${Math.abs(hash)}`;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function cssEscapeAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }
})();
