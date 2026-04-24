// ==UserScript==
// @name         GWPC Header Timeout Monitor
// @namespace    homebot.gwpc-header-timeout
// @version      2.2.1
// @description  Fresh GWPC timeout + saved-selector gatherer. Watches the live Guidewire header, has a persistent instant ON/OFF safety override for timeout actions, and saves timeout or selected errors into the shared GWPC payload flow without posting or closing tabs.
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
  try { window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Home Bot: Guidewire Header Timeout';
  const VERSION = '2.2';
  const UI_MARKER_ATTR = 'data-tm-timeout-ui';

  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';

  const KEYS = {
    panelPos: 'tm_pc_header_timeout_panel_pos_v112',
    identityCache: 'tm_pc_header_timeout_identity_cache_v2',
    selectorRules: 'tm_pc_header_timeout_selector_rules_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    autoPayload: 'tm_pc_auto_quote_grab_payload_v1',
    runtime: 'tm_pc_header_timeout_runtime_v2',
    pendingPost: 'tm_pc_header_timeout_pending_post_v2',
    sentEvents: 'tm_pc_header_timeout_sent_events_v2',
    selectorPauseState: 'tm_pc_header_timeout_selector_pause_state_v1',
    timeoutEnabled: 'tm_pc_header_timeout_enabled_v1'
  };

  const CFG = {
    scanMs: 500,
    uiMs: 250,
    bootstrapRetryMs: 500,
    timeoutMs: 120000,
    maxLogLines: 140,
    maxSentEvents: 300,
    maxRuleText: 280,
    zIndex: 2147483647,
    panelWidth: 320,
    selectorOutlineColor: '#fca5a5',
    selectorFillColor: 'rgba(252,165,165,0.14)',
    observerThrottleMs: 60
  };

  const state = {
    runtimeStarted: false,
    destroyed: false,
    running: true,
    timeoutEnabled: true,
    logs: [],
    els: {},
    panel: null,
    bootstrapTimer: null,
    tickTimer: null,
    uiTimer: null,
    mutationObserver: null,
    scanQueued: false,
    observeScheduled: false,
    selectorMode: false,
    modalOpen: false,
    selectorListeners: [],
    hoverBoxEl: null,
    hoveredEl: null,
    current: {
      azId: '',
      submission: '',
      product: '',
      productLabel: '',
      header: '',
      headerSinceMs: 0,
      pageName: '',
      pageAddress: ''
    },
    lastStatus: '',
    lastHeaderLogKey: '',
    lastStageLogKey: '',
    lastWaitLogKey: '',
    lastUnknownStageKey: '',
    lastScanAt: 0,
    lastRuntimePersistKey: '',
    pausedAtMs: 0,
    frozenElapsedMs: 0
  };

  boot();

  function boot() {
    tryStartRuntime();
    if (state.runtimeStarted) return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryStartRuntime, { once: true });
    }
    window.addEventListener('load', tryStartRuntime, { once: true });
    window.addEventListener('pageshow', tryStartRuntime, { once: true });

    if (state.bootstrapTimer) clearInterval(state.bootstrapTimer);
    state.bootstrapTimer = setInterval(() => {
      tryStartRuntime();
      if (state.runtimeStarted && state.bootstrapTimer) {
        clearInterval(state.bootstrapTimer);
        state.bootstrapTimer = null;
      }
    }, CFG.bootstrapRetryMs);
  }

  function tryStartRuntime() {
    if (state.destroyed) return;
    if (!document.documentElement) return;
    if (!buildUi()) return;

    if (state.runtimeStarted) {
      renderAll();
      return;
    }

    state.runtimeStarted = true;
    state.timeoutEnabled = readTimeoutEnabled();
    restoreStaleSelectorPause();
    clearOwnedSendArtifacts();
    log(`Script started v${VERSION}`);
    log(`Origin: ${location.origin}`);
    log('Fresh timeout gatherer armed');

    scheduleObserve();
    scheduleScan('start');

    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = setInterval(() => {
      try {
        if (state.running) scheduleScan('tick');
      } catch (err) {
        log(`Tick failed: ${err?.message || err}`);
        setStatus('Tick failed');
      }
    }, CFG.scanMs);

    if (state.uiTimer) clearInterval(state.uiTimer);
    state.uiTimer = setInterval(renderAll, CFG.uiMs);

    window.addEventListener('beforeunload', handleBeforeUnload, true);
    window.addEventListener('pagehide', handleBeforeUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    document.addEventListener('visibilitychange', handleVisibilityChange, true);

    window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__ = cleanup;
    setStatus('Watching header');
    renderAll();
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;

    try { clearInterval(state.bootstrapTimer); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.uiTimer); } catch {}
    try { state.mutationObserver?.disconnect(); } catch {}

    try { window.removeEventListener('beforeunload', handleBeforeUnload, true); } catch {}
    try { window.removeEventListener('pagehide', handleBeforeUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { document.removeEventListener('visibilitychange', handleVisibilityChange, true); } catch {}

    closeSelectorSession('', { logIt: false, restorePause: true });

    try { state.hoverBoxEl?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__; } catch {}
  }

  function $(selector, root = document) {
    try { return root.querySelector(selector); } catch { return null; }
  }

  function $$(selector, root = document) {
    try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
  }

  function safeJsonParse(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return nowIso(); }
  }

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCompare(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\.,#]/g, ' ')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bhighway\b/g, 'hwy')
      .replace(/\btrail\b/g, 'trl')
      .replace(/\bterrace\b/g, 'ter')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\s+/g, ' ')
      .trim();
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

  function hashString(str) {
    let h = 0;
    const input = String(str || '');
    for (let i = 0; i < input.length; i += 1) {
      h = ((h << 5) - h) + input.charCodeAt(i);
      h |= 0;
    }
    return `h${Math.abs(h)}`;
  }

  function createEventId() {
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function cssEscape(value) {
    const input = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(input);
    }
    return input.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    try {
      const style = (el.ownerDocument?.defaultView || window).getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '00:00';
    const total = Math.floor(ms / 1000);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  function truncateText(value, max = CFG.maxRuleText) {
    const text = normalizeText(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}...`;
  }

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    if (state.els.logs) {
      state.els.logs.value = state.logs.join('\n');
      state.els.logs.scrollTop = 0;
    }
    console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function readTimeoutEnabled() {
    try {
      const raw = localStorage.getItem(KEYS.timeoutEnabled);
      if (raw == null || raw === '') return true;
      if (raw === '1' || raw === 'true') return true;
      if (raw === '0' || raw === 'false') return false;
      return true;
    } catch {
      return true;
    }
  }

  function writeTimeoutEnabled(enabled) {
    state.timeoutEnabled = !!enabled;
    try { localStorage.setItem(KEYS.timeoutEnabled, state.timeoutEnabled ? '1' : '0'); } catch {}
    renderButtons();
    renderAll();
    return state.timeoutEnabled;
  }

  function timeoutActionsEnabled() {
    state.timeoutEnabled = readTimeoutEnabled();
    return state.timeoutEnabled;
  }

  function logWait(key, message) {
    if (state.lastWaitLogKey === key) return;
    state.lastWaitLogKey = key;
    log(message);
  }

  function clearWaitLog() {
    state.lastWaitLogKey = '';
  }

  function setStatus(text) {
    state.lastStatus = normalizeText(text);
    if (state.els.status) state.els.status.textContent = state.lastStatus || 'Idle';
  }

  function getAllDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        for (let i = 0; i < win.frames.length; i += 1) walk(win.frames[i]);
      } catch {}
    }

    walk(window);
    return docs;
  }

  function firstVisibleTextBySelectors(selectors) {
    for (const doc of getAllDocs()) {
      for (const selector of selectors) {
        const el = $(selector, doc);
        if (!el || !isVisible(el)) continue;
        const text = normalizeText(el.textContent);
        if (text) return text;
      }
    }
    return '';
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

  function hasLabelExactAnyDoc(labelText) {
    const wanted = normalizeText(labelText);
    if (!wanted) return false;
    for (const doc of getAllDocs()) {
      const hits = $$('.gw-label, .gw-LabelWidget, .gw-vw--value, .gw-infoValue', doc)
        .some((el) => isVisible(el) && normalizeText(el.textContent) === wanted);
      if (hits) return true;
    }
    return false;
  }

  function detectProduct() {
    const hasAuto = hasLabelExactAnyDoc('Personal Auto');
    const hasHome = hasLabelExactAnyDoc('Homeowners');
    if (hasAuto) return { product: 'auto', label: 'Personal Auto' };
    if (hasHome) return { product: 'home', label: 'Homeowners' };
    return { product: '', label: '' };
  }

  function getAccountNameFromPage() {
    for (const doc of getAllDocs()) {
      const exact = $('div#SubmissionWizard-JobWizardInfoBar-AccountName > div.gw-label.gw-infoValue:nth-of-type(2)', doc);
      const exactText = normalizeText(exact?.textContent || '');
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

  function looksLikeAddress(value) {
    return /\d{1,6}\s+.+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/.test(normalizeText(value));
  }

  function getMailingAddressFromPage() {
    const selectors = [
      'div#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput > div.gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput .gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-label.gw-infoValue'
    ];

    for (const doc of getAllDocs()) {
      for (const selector of selectors) {
        const el = $(selector, doc);
        const text = normalizeText(el?.textContent || '');
        if (text && looksLikeAddress(text)) return text;
      }
    }

    for (const doc of getAllDocs()) {
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

  function getIdentityCache() {
    return safeJsonParse(sessionStorage.getItem(KEYS.identityCache), {}) || {};
  }

  function setIdentityCache(cache) {
    try { sessionStorage.setItem(KEYS.identityCache, JSON.stringify(cache)); } catch {}
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

  function getPageIdentity(submission) {
    const sub = normalizeText(submission);
    const cache = getIdentityCache();
    const cached = isPlainObject(cache[sub]) ? cache[sub] : {};
    return {
      name: normalizeText(getAccountNameFromPage()) || normalizeText(cached['Name'] || ''),
      mailingAddress: normalizeText(getMailingAddressFromPage()) || normalizeText(cached['Mailing Address'] || ''),
      submissionNumber: sub || normalizeText(cached['SubmissionNumber'] || '')
    };
  }

  function normalizeCurrentJob(raw) {
    const out = {
      'AZ ID': '',
      'Name': '',
      'Mailing Address': '',
      'SubmissionNumber': '',
      'updatedAt': '',
      'First Name': '',
      'Last Name': '',
      'Email': '',
      'Phone': '',
      'DOB': '',
      'Street Address': '',
      'City': '',
      'State': '',
      'Zip': ''
    };

    if (!isPlainObject(raw)) return out;

    const az = isPlainObject(raw.az) ? raw.az : {};
    const legacyName = [az['AZ Name'], az['AZ Last']]
      .map((v) => normalizeText(v))
      .filter(Boolean)
      .join(' ')
      .trim();
    const legacyAddress = [
      normalizeText(az['AZ Street Address']),
      normalizeText(az['AZ City']),
      normalizeText(az['AZ State']),
      normalizeText(az['AZ Postal Code'])
    ].filter(Boolean).join(', ');

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.updatedAt || '');
    out['First Name'] = normalizeText(raw['First Name'] || raw.firstName || az['First Name'] || az['AZ Name'] || '');
    out['Last Name'] = normalizeText(raw['Last Name'] || raw.lastName || az['Last Name'] || az['AZ Last'] || '');
    out['Email'] = normalizeText(raw['Email'] || raw.email || az['Email'] || az['AZ Email'] || '');
    out['Phone'] = normalizeText(raw['Phone'] || raw.phone || az['Phone'] || az['AZ Phone'] || '');
    out['DOB'] = normalizeText(raw['DOB'] || raw.dob || az['DOB'] || az['AZ DOB'] || '');
    out['Street Address'] = normalizeText(raw['Street Address'] || raw.streetAddress || az['Street Address'] || az['AZ Street Address'] || '');
    out['City'] = normalizeText(raw['City'] || raw.city || az['City'] || az['AZ City'] || '');
    out['State'] = normalizeText(raw['State'] || raw.state || az['State'] || az['AZ State'] || '');
    out['Zip'] = normalizeText(raw['Zip'] || raw.zip || raw.zipCode || az['Zip'] || az['AZ Postal Code'] || '');
    return out;
  }

  function readCurrentJob() {
    const candidates = [
      safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null),
      safeJsonParse(localStorage.getItem(LEGACY_SHARED_JOB_KEY), null),
      safeJsonParse(localStorage.getItem(BUNDLE_KEY), null),
      safeJsonParse(localStorage.getItem(KEYS.homePayload), null)?.currentJob,
      safeJsonParse(localStorage.getItem(KEYS.autoPayload), null)?.currentJob
    ];

    for (const candidate of candidates) {
      const job = normalizeCurrentJob(candidate);
      if (job['AZ ID']) return job;
    }
    return normalizeCurrentJob(null);
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    if (!next['AZ ID']) return next;
    next.updatedAt = nowIso();
    try { localStorage.setItem(CURRENT_JOB_KEY, JSON.stringify(next, null, 2)); } catch {}
    return next;
  }

  function mergeCurrentJob(update) {
    const current = readCurrentJob();
    const incoming = normalizeCurrentJob(update || {});
    if (current['AZ ID'] && incoming['AZ ID'] && current['AZ ID'] !== incoming['AZ ID']) {
      return current;
    }

    const next = {
      'AZ ID': incoming['AZ ID'] || current['AZ ID'] || '',
      'Name': incoming['Name'] || current['Name'] || '',
      'Mailing Address': incoming['Mailing Address'] || current['Mailing Address'] || '',
      'SubmissionNumber': incoming['SubmissionNumber'] || current['SubmissionNumber'] || '',
      'updatedAt': nowIso(),
      'First Name': incoming['First Name'] || current['First Name'] || '',
      'Last Name': incoming['Last Name'] || current['Last Name'] || '',
      'Email': incoming['Email'] || current['Email'] || '',
      'Phone': incoming['Phone'] || current['Phone'] || '',
      'DOB': incoming['DOB'] || current['DOB'] || '',
      'Street Address': incoming['Street Address'] || current['Street Address'] || '',
      'City': incoming['City'] || current['City'] || '',
      'State': incoming['State'] || current['State'] || '',
      'Zip': incoming['Zip'] || current['Zip'] || ''
    };
    return writeCurrentJob(next);
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
      'AZ ID': normalizeText(job?.['AZ ID']),
      'Name': normalizeText(job?.['Name']),
      'Mailing Address': normalizeText(job?.['Mailing Address']),
      'SubmissionNumber': normalizeText(job?.['SubmissionNumber']),
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

  function ensureBundleForJob(job) {
    const azId = normalizeText(job?.['AZ ID']);
    if (!azId) return null;

    const current = readBundle();
    if (!isPlainObject(current) || normalizeText(current['AZ ID']) !== azId) {
      return writeBundle(emptyBundleForJob(job));
    }

    current['Name'] = normalizeText(job['Name']) || current['Name'] || '';
    current['Mailing Address'] = normalizeText(job['Mailing Address']) || current['Mailing Address'] || '';
    current['SubmissionNumber'] = normalizeText(job['SubmissionNumber']) || current['SubmissionNumber'] || '';
    current.timeout = isPlainObject(current.timeout) ? current.timeout : { ready: false, events: [] };
    if (!Array.isArray(current.timeout.events)) current.timeout.events = [];
    current.meta = isPlainObject(current.meta) ? current.meta : {};
    current.meta.updatedAt = nowIso();
    current.meta.lastWriter = SCRIPT_NAME;
    current.meta.version = VERSION;
    return writeBundle(current);
  }

  function emptyPayloadForJob(product, job) {
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'gwpc_timeout_gathered',
      product,
      ready: false,
      'AZ ID': normalizeText(job?.['AZ ID']),
      currentJob: normalizeCurrentJob(job),
      savedAt: nowIso(),
      page: {
        url: location.href,
        title: document.title
      },
      errors: [],
      latestError: null
    };

    if (product === 'home') {
      payload.row = {
        'Done?': '',
        'Result': ''
      };
      payload['Done?'] = '';
      payload['Result'] = '';
    } else {
      payload.row = {
        'Auto': ''
      };
      payload['Auto'] = '';
    }

    return payload;
  }

  function readProductPayload(product) {
    const key = product === 'home' ? KEYS.homePayload : KEYS.autoPayload;
    return {
      key,
      value: safeJsonParse(localStorage.getItem(key), null)
    };
  }

  function ensurePayloadForJob(product, job) {
    const { key, value } = readProductPayload(product);
    const azId = normalizeText(job?.['AZ ID']);
    const payload = isPlainObject(value) ? deepClone(value) : null;
    if (!payload || normalizeText(payload['AZ ID'] || payload?.currentJob?.['AZ ID'] || '') !== azId) {
      return { key, payload: emptyPayloadForJob(product, job) };
    }
    return { key, payload };
  }

  function mergeEventList(list, event) {
    const next = Array.isArray(list) ? list.map((item) => deepClone(item)) : [];
    const idx = next.findIndex((item) => normalizeText(item?.eventId || item?.id) === normalizeText(event.eventId));
    if (idx >= 0) next[idx] = deepClone(event);
    else next.push(deepClone(event));
    return next;
  }

  function saveEventToPayload(product, job, event) {
    const { key, payload } = ensurePayloadForJob(product, job);
    payload.script = SCRIPT_NAME;
    payload.version = VERSION;
    payload.event = 'gwpc_timeout_gathered';
    payload.product = product;
    payload['AZ ID'] = job['AZ ID'];
    payload.currentJob = normalizeCurrentJob({
      ...(isPlainObject(payload.currentJob) ? payload.currentJob : {}),
      ...job
    });
    payload.savedAt = nowIso();
    payload.page = { url: location.href, title: document.title };
    payload.errors = mergeEventList(payload.errors, event);
    payload.latestError = deepClone(event);
    payload.ready = payload.ready === true;

    payload.row = isPlainObject(payload.row) ? payload.row : {};

    if (product === 'home') {
      payload.row['Done?'] = event.resultValue;
      payload.row['Result'] = event.errorText;
      payload['Done?'] = event.resultValue;
      payload['Result'] = event.errorText;
    } else {
      payload.row['Auto'] = event.resultValue;
      payload['Auto'] = event.resultValue;
    }

    localStorage.setItem(key, JSON.stringify(payload, null, 2));
    return payload;
  }

  function saveEventToBundle(product, job, event) {
    const bundle = ensureBundleForJob(job);
    if (!bundle) throw new Error('Missing current AZ job');

    const next = deepClone(bundle);
    next.timeout = isPlainObject(next.timeout) ? next.timeout : { ready: false, events: [] };
    next.timeout.ready = true;
    next.timeout.events = mergeEventList(next.timeout.events, event);
    next.timeout.lastEvent = deepClone(event);

    const section = isPlainObject(next[product]) ? deepClone(next[product]) : {};
    section.ready = section.ready === true;
    section.savedAt = nowIso();
    section.script = SCRIPT_NAME;
    section.version = VERSION;
    section.data = isPlainObject(section.data) ? section.data : {};
    section.data.errors = mergeEventList(section.data.errors, event);
    section.data.latestError = deepClone(event);

    if (product === 'home') {
      section.data['Done?'] = event.resultValue;
      section.data['Result'] = event.errorText;
      if (isPlainObject(section.data.row)) {
        section.data.row['Done?'] = event.resultValue;
        section.data.row['Result'] = event.errorText;
      }
    } else {
      section.data['Auto'] = event.resultValue;
      if (isPlainObject(section.data.row)) {
        section.data.row['Auto'] = event.resultValue;
      }
    }

    next[product] = section;
    next['AZ ID'] = job['AZ ID'];
    next['Name'] = normalizeText(job['Name']) || next['Name'] || '';
    next['Mailing Address'] = normalizeText(job['Mailing Address']) || next['Mailing Address'] || '';
    next['SubmissionNumber'] = normalizeText(job['SubmissionNumber']) || next['SubmissionNumber'] || '';
    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = nowIso();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;

    localStorage.setItem(BUNDLE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function buildSignatureJobBundle(job, bundle) {
    const sigObj = {
      'AZ ID': job['AZ ID'] || '',
      currentJob: deepClone(job),
      home: bundle?.home?.data || null,
      auto: bundle?.auto?.data || null,
      timeout: Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events : []
    };
    return hashString(JSON.stringify(sigObj));
  }

  function readRuntimeState() {
    const runtime = safeJsonParse(localStorage.getItem(KEYS.runtime), null);
    return isPlainObject(runtime) ? runtime : {};
  }

  function writeRuntimeState(runtime) {
    localStorage.setItem(KEYS.runtime, JSON.stringify(runtime, null, 2));
    return runtime;
  }

  function shiftCurrentRuntimeByPauseDelta(pauseDeltaMs) {
    if (!pauseDeltaMs || pauseDeltaMs <= 0) return;
    if (!state.current.header || !Number.isFinite(Number(state.current.headerSinceMs))) return;

    state.current.headerSinceMs = Number(state.current.headerSinceMs) + pauseDeltaMs;

    const runtime = readRuntimeState();
    const runtimeKey = normalizeText(runtime.key || '');
    if (runtimeKey && runtimeKey === normalizeText(state.lastRuntimePersistKey || '')) {
      runtime.headerSinceMs = Number(runtime.headerSinceMs || state.current.headerSinceMs) + pauseDeltaMs;
      runtime.updatedAt = nowIso();
      runtime.source = SCRIPT_NAME;
      runtime.version = VERSION;
      writeRuntimeState(runtime);
    }
  }

  function clearOwnedSendArtifacts() {
    try { localStorage.removeItem(KEYS.pendingPost); } catch {}
  }

  function readSentEventsStore() {
    const current = safeJsonParse(localStorage.getItem(KEYS.sentEvents), null);
    if (!isPlainObject(current)) {
      return { byId: {}, byDedupeKey: {}, order: [] };
    }
    current.byId = isPlainObject(current.byId) ? current.byId : {};
    current.byDedupeKey = isPlainObject(current.byDedupeKey) ? current.byDedupeKey : {};
    current.order = Array.isArray(current.order) ? current.order : [];
    return current;
  }

  function writeSentEventsStore(store) {
    localStorage.setItem(KEYS.sentEvents, JSON.stringify(store, null, 2));
    return store;
  }

  function pruneSentEventsStore(store) {
    const next = deepClone(store);
    while (next.order.length > CFG.maxSentEvents) {
      const oldestId = next.order.shift();
      const record = next.byId[oldestId];
      delete next.byId[oldestId];
      if (record?.dedupeKey && next.byDedupeKey[record.dedupeKey] === oldestId) {
        delete next.byDedupeKey[record.dedupeKey];
      }
    }
    return next;
  }

  function rememberDispatchedEvent(event) {
    const store = readSentEventsStore();
    const record = {
      eventId: event.eventId,
      dedupeKey: event.dedupeKey,
      azId: event.identity?.['AZ ID'] || '',
      product: event.product,
      ruleId: normalizeText(event.selectorRuleId || ''),
      signature: '',
      requestAt: normalizeText(event.detectedAt || nowIso()),
      sentAt: '',
      source: normalizeText(event.triggerType || SCRIPT_NAME)
    };
    store.byId[event.eventId] = record;
    if (event.dedupeKey) store.byDedupeKey[event.dedupeKey] = event.eventId;
    store.order = Array.isArray(store.order) ? store.order.filter((id) => id !== event.eventId) : [];
    store.order.push(event.eventId);
    writeSentEventsStore(pruneSentEventsStore(store));
  }

  function hasSentOrPendingDedupe(dedupeKey) {
    const normalized = normalizeText(dedupeKey);
    if (!normalized) return false;
    const store = readSentEventsStore();
    return !!normalizeText(store.byDedupeKey[normalized] || '');
  }

  function handleBeforeUnload() {
    if (state.selectorMode || state.modalOpen) {
      restoreSelectorPause();
    }
    persistPanelPos();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      scheduleObserve();
      scheduleScan('visible');
    }
  }

  function scheduleObserve() {
    if (state.observeScheduled || state.destroyed) return;
    state.observeScheduled = true;
    setTimeout(() => {
      state.observeScheduled = false;
      installMutationObserver();
    }, 0);
  }

  function installMutationObserver() {
    if (state.destroyed || !document.documentElement) return;
    try { state.mutationObserver?.disconnect(); } catch {}
    state.mutationObserver = new MutationObserver(() => {
      if (state.destroyed) return;
      if (state.scanQueued) return;
      state.scanQueued = true;
      setTimeout(() => {
        state.scanQueued = false;
        scheduleScan('mutation');
      }, CFG.observerThrottleMs);
    });
    try {
      state.mutationObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden', 'aria-label']
      });
    } catch {}
  }

  function scheduleScan(reason) {
    if (state.destroyed) return;
    try {
      scanPage(reason);
    } catch (err) {
      log(`Scan failed: ${err?.message || err}`);
      setStatus('Scan failed');
    }
  }

  function scanPage(reason) {
    state.lastScanAt = Date.now();

    const job = readCurrentJob();
    const productInfo = detectProduct();
    const header = normalizeText(getGuidewireHeader());
    const submission = normalizeText(getSubmissionNumber());

    updateIdentityCache(submission);
    const pageIdentity = getPageIdentity(submission);

    if (submission && job['AZ ID']) {
      mergeCurrentJob({
        'AZ ID': job['AZ ID'],
        'Name': job['Name'] || pageIdentity.name,
        'Mailing Address': job['Mailing Address'] || pageIdentity.mailingAddress,
        'SubmissionNumber': submission || job['SubmissionNumber']
      });
    }

    syncCurrentContext({
      job: readCurrentJob(),
      product: productInfo.product,
      productLabel: productInfo.label,
      header,
      submission,
      pageIdentity
    });

    if (!state.running || state.selectorMode || state.modalOpen) {
      renderAll();
      return;
    }

    if (!state.current.product && state.current.header) {
      const key = `${state.current.header}|${state.current.azId || ''}`;
      if (state.lastUnknownStageKey !== key) {
        state.lastUnknownStageKey = key;
        log(`Unknown stage for header "${state.current.header}"`);
      }
    } else {
      state.lastUnknownStageKey = '';
    }

    processSelectorMatches();
    processHeaderTimeout();
    renderAll();
  }

  function syncCurrentContext(context) {
    const nextAzId = normalizeText(context.job?.['AZ ID'] || '');
    const nextSubmission = normalizeText(context.submission || context.job?.['SubmissionNumber'] || '');
    const nextProduct = normalizeText(context.product || '');
    const nextProductLabel = normalizeText(context.productLabel || '');
    const nextHeader = normalizeText(context.header || '');
    const pageName = normalizeText(context.pageIdentity?.name || '');
    const pageAddress = normalizeText(context.pageIdentity?.mailingAddress || '');

    const stored = readRuntimeState();
    const runtimeKey = nextAzId && nextProduct && nextHeader ? [nextAzId, nextProduct, nextHeader].join('|') : '';
    let headerSinceMs = nextHeader ? Date.now() : 0;

    if (runtimeKey && normalizeText(stored.key || '') === runtimeKey && Number.isFinite(Number(stored.headerSinceMs))) {
      headerSinceMs = Number(stored.headerSinceMs) || headerSinceMs;
    }

    if (runtimeKey && normalizeText(state.lastRuntimePersistKey) !== runtimeKey) {
      headerSinceMs = normalizeText(stored.key || '') === runtimeKey ? headerSinceMs : Date.now();
      writeRuntimeState({
        key: runtimeKey,
        azId: nextAzId,
        product: nextProduct,
        productLabel: nextProductLabel,
        header: nextHeader,
        submissionNumber: nextSubmission,
        headerSinceMs,
        updatedAt: nowIso(),
        source: SCRIPT_NAME,
        version: VERSION
      });
      state.lastRuntimePersistKey = runtimeKey;
    } else if (runtimeKey) {
      const maybeUpdate = !stored.updatedAt || (Date.now() - Date.parse(stored.updatedAt || '')) > 5000 || normalizeText(stored.submissionNumber || '') !== nextSubmission;
      if (maybeUpdate) {
        writeRuntimeState({
          ...stored,
          key: runtimeKey,
          azId: nextAzId,
          product: nextProduct,
          productLabel: nextProductLabel,
          header: nextHeader,
          submissionNumber: nextSubmission,
          headerSinceMs,
          updatedAt: nowIso(),
          source: SCRIPT_NAME,
          version: VERSION
        });
      }
      state.lastRuntimePersistKey = runtimeKey;
    } else {
      state.lastRuntimePersistKey = '';
    }

    const headerLogKey = [nextAzId, nextProduct, nextHeader, headerSinceMs].join('|');
    if (nextHeader && state.lastHeaderLogKey !== headerLogKey) {
      state.lastHeaderLogKey = headerLogKey;
      log(`Header change: ${nextHeader}`);
    }

    const stageLogKey = [nextAzId, nextProduct, nextProductLabel].join('|');
    if (nextProductLabel && state.lastStageLogKey !== stageLogKey) {
      state.lastStageLogKey = stageLogKey;
      log(`Stage: ${nextProductLabel}`);
    }

    state.current = {
      azId: nextAzId,
      submission: nextSubmission,
      product: nextProduct,
      productLabel: nextProductLabel,
      header: nextHeader,
      headerSinceMs,
      pageName,
      pageAddress
    };
  }

  function buildEventContext() {
    const job = readCurrentJob();
    if (!job['AZ ID']) {
      return { ok: false, reason: 'Waiting for tm_pc_current_job_v1 / AZ ID' };
    }

    if (!state.current.product) {
      return { ok: false, reason: 'Unknown stage' };
    }
    if (!state.current.header) {
      return { ok: false, reason: 'Waiting for Guidewire header' };
    }

    const identity = getPageIdentity(state.current.submission);
    if (job['Name'] && identity.name && !namesLikelySame(job['Name'], identity.name)) {
      return { ok: false, reason: `Blocked save: current job Name mismatch | job=${job['Name']} | page=${identity.name}` };
    }
    if (job['Mailing Address'] && identity.mailingAddress && !addressesLikelySame(job['Mailing Address'], identity.mailingAddress)) {
      return { ok: false, reason: 'Blocked save: current job address mismatch' };
    }

    const mergedJob = mergeCurrentJob({
      'AZ ID': job['AZ ID'],
      'Name': job['Name'] || identity.name,
      'Mailing Address': job['Mailing Address'] || identity.mailingAddress,
      'SubmissionNumber': state.current.submission || job['SubmissionNumber']
    });

    return {
      ok: true,
      job: mergedJob,
      identity,
      product: state.current.product,
      productLabel: state.current.productLabel,
      header: state.current.header,
      headerSinceMs: Number(state.current.headerSinceMs) || Date.now(),
      submission: state.current.submission || mergedJob['SubmissionNumber'] || ''
    };
  }

  function buildTimeoutEvent(context) {
    const resultValue = `Header "${context.header}" did not change for 120 seconds`;
    const eventId = createEventId();
    const dedupeKey = [
      'timeout',
      context.job['AZ ID'],
      context.product,
      context.header,
      String(context.headerSinceMs)
    ].join('|');

    return {
      eventId,
      id: eventId,
      dedupeKey,
      actionKey: `${context.product}_header_timeout`,
      triggerType: 'timeout',
      product: context.product,
      productLabel: context.productLabel,
      errorType: 'HeaderTimeout',
      errorName: context.product === 'home' ? 'HOME timeout' : 'AUTO timeout',
      errorMessage: resultValue,
      errorText: resultValue,
      resultField: context.product === 'home' ? 'Done?' : 'Auto',
      resultValue,
      headerText: context.header,
      submissionNumber: context.submission,
      selectorRuleId: '',
      detectedAt: nowIso(),
      source: SCRIPT_NAME,
      sourceVersion: VERSION,
      page: {
        url: location.href,
        title: document.title
      },
      identity: {
        'AZ ID': context.job['AZ ID'],
        'Name': context.job['Name'] || context.identity.name || '',
        'Mailing Address': context.job['Mailing Address'] || context.identity.mailingAddress || '',
        'SubmissionNumber': context.submission || context.job['SubmissionNumber'] || ''
      }
    };
  }

  function buildSelectorEvent(context, rule, matchEl) {
    const savedErrorText = normalizeText(rule.savedErrorText || rule.errorText || '');
    const eventId = createEventId();
    const dedupeKey = [
      'selector',
      context.job['AZ ID'],
      context.product,
      normalizeText(rule.ruleId || rule.id || '')
    ].join('|');

    return {
      eventId,
      id: eventId,
      dedupeKey,
      actionKey: `${context.product}_saved_selector_error`,
      triggerType: 'selector',
      product: context.product,
      productLabel: context.productLabel,
      errorType: 'SavedSelectorMatch',
      errorName: normalizeText(rule.label || 'Saved selector error'),
      errorMessage: savedErrorText,
      errorText: savedErrorText,
      resultField: context.product === 'home' ? 'Done?' : 'Auto',
      resultValue: savedErrorText,
      headerText: context.header,
      submissionNumber: context.submission,
      selectorRuleId: normalizeText(rule.ruleId || rule.id || ''),
      selector: normalizeText(rule.selector || ''),
      detectedAt: nowIso(),
      source: SCRIPT_NAME,
      sourceVersion: VERSION,
      capturedElementHtml: truncateText(matchEl?.outerHTML || '', 4000),
      capturedText: truncateText(matchEl?.innerText || matchEl?.textContent || '', 600),
      page: {
        url: location.href,
        title: document.title
      },
      identity: {
        'AZ ID': context.job['AZ ID'],
        'Name': context.job['Name'] || context.identity.name || '',
        'Mailing Address': context.job['Mailing Address'] || context.identity.mailingAddress || '',
        'SubmissionNumber': context.submission || context.job['SubmissionNumber'] || ''
      }
    };
  }

  function dispatchEvent(event) {
    if (!timeoutActionsEnabled()) {
      log('Timeout actions are OFF. Event skipped.');
      setStatus(state.running ? 'Watching header' : 'Stopped');
      return false;
    }

    const context = buildEventContext();
    if (!context.ok) {
      log(context.reason);
      return false;
    }

    if (hasSentOrPendingDedupe(event.dedupeKey)) {
      return false;
    }

    try {
      saveEventToPayload(context.product, context.job, event);
      saveEventToBundle(context.product, context.job, event);
      rememberDispatchedEvent(event);
      log(`Saved ${context.product.toUpperCase()} ${event.triggerType} event to payload/bundle`);
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderAll();
      return true;
    } catch (err) {
      log(`Save failed: ${err?.message || err}`);
      setStatus('Save failed');
      renderAll();
      return false;
    }
  }

  function processHeaderTimeout() {
    if (!timeoutActionsEnabled()) return;
    const context = buildEventContext();
    if (!context.ok) {
      logWait(`timeout:${context.reason}`, context.reason);
      return;
    }

    clearWaitLog();

    const ageMs = Date.now() - Number(context.headerSinceMs || Date.now());
    if (ageMs < CFG.timeoutMs) return;

    const event = buildTimeoutEvent(context);
    if (hasSentOrPendingDedupe(event.dedupeKey)) return;
    dispatchEvent(event);
  }

  function buildRuleId(selector, textFingerprint) {
    return `rule_${hashString([normalizeText(selector), normalizeText(textFingerprint)].join('|'))}`;
  }

  function getStableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((name) => /^gw-|^iv360-|^mat-|^mdc-/.test(name))
      .slice(0, 4);
  }

  function buildElementFingerprint(el) {
    if (!(el instanceof Element)) return {};
    return {
      tag: String(el.tagName || '').toLowerCase(),
      id: normalizeText(el.id || ''),
      name: normalizeText(el.getAttribute('name') || ''),
      role: normalizeText(el.getAttribute('role') || ''),
      ariaLabel: normalizeText(el.getAttribute('aria-label') || ''),
      classTokens: getStableClassTokens(el),
      textFingerprint: truncateText(el.innerText || el.textContent || '', 160)
    };
  }

  function isUniqueSelector(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function buildStableSelector(el) {
    if (!(el instanceof Element)) return '';
    const doc = el.ownerDocument || document;

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = normalizeText(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(selector, doc)) return selector;
    }

    const aria = normalizeText(el.getAttribute('aria-label') || '');
    if (aria) {
      const selector = `${el.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector, doc)) return selector;
    }

    const role = normalizeText(el.getAttribute('role') || '');
    if (role && aria) {
      const selector = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector, doc)) return selector;
    }

    let current = el;
    const parts = [];
    while (current && current.nodeType === 1 && current !== doc.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }

      const classes = getStableClassTokens(current);
      if (classes.length) {
        part += `.${classes.map(cssEscape).join('.')}`;
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children)
          .filter((node) => node.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (isUniqueSelector(candidate, doc)) return candidate;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function normalizeRule(raw) {
    if (!isPlainObject(raw)) return null;
    const selector = normalizeText(raw.selector || raw.cssSelector || '');
    if (!selector) return null;

    const savedErrorText = normalizeText(
      raw.savedErrorText ||
      raw.errorText ||
      raw.customMessage ||
      raw.resultValue ||
      raw.textSample ||
      raw.errorName ||
      ''
    );
    if (!savedErrorText) return null;

    const textFingerprint = truncateText(
      raw.fingerprint?.textFingerprint ||
      raw.textFingerprint ||
      raw.textSample ||
      '',
      160
    );

    const fingerprint = isPlainObject(raw.fingerprint)
      ? {
          tag: normalizeText(raw.fingerprint.tag || ''),
          id: normalizeText(raw.fingerprint.id || ''),
          name: normalizeText(raw.fingerprint.name || ''),
          role: normalizeText(raw.fingerprint.role || ''),
          ariaLabel: normalizeText(raw.fingerprint.ariaLabel || ''),
          classTokens: Array.isArray(raw.fingerprint.classTokens)
            ? raw.fingerprint.classTokens.map((value) => normalizeText(value)).filter(Boolean).slice(0, 4)
            : [],
          textFingerprint
        }
      : {
          tag: '',
          id: '',
          name: '',
          role: '',
          ariaLabel: '',
          classTokens: [],
          textFingerprint
        };

    return {
      ruleId: normalizeText(raw.ruleId || raw.id || buildRuleId(selector, textFingerprint)),
      selector,
      label: normalizeText(raw.label || raw.errorName || 'Saved selector error'),
      savedErrorText,
      fingerprint,
      createdAt: normalizeText(raw.createdAt || nowIso()),
      updatedAt: normalizeText(raw.updatedAt || raw.createdAt || nowIso())
    };
  }

  function getSelectorRules() {
    const parsed = safeJsonParse(localStorage.getItem(KEYS.selectorRules), []);
    const list = Array.isArray(parsed) ? parsed : [];
    const normalized = list.map(normalizeRule).filter(Boolean);
    return normalized;
  }

  function saveSelectorRules(rules) {
    localStorage.setItem(KEYS.selectorRules, JSON.stringify(rules, null, 2));
    renderAll();
  }

  function isScriptUiElement(el) {
    return !!(el instanceof Element && el.closest(`[${UI_MARKER_ATTR}="1"]`));
  }

  function resolveSelectableElementAtPoint(clientX, clientY) {
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [];

    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (isScriptUiElement(node)) return null;
      if (!isVisible(node)) continue;
      if (node === document.documentElement || node === document.body) continue;
      return node;
    }
    return null;
  }

  function ensureHoverBox() {
    if (state.hoverBoxEl && document.contains(state.hoverBoxEl)) return state.hoverBoxEl;
    const box = document.createElement('div');
    box.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex - 1),
      pointerEvents: 'none',
      border: `1px solid ${CFG.selectorOutlineColor}`,
      background: CFG.selectorFillColor,
      boxSizing: 'border-box',
      borderRadius: '4px',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBoxEl = box;
    return box;
  }

  function hideHoverBox() {
    state.hoveredEl = null;
    if (state.hoverBoxEl) state.hoverBoxEl.style.display = 'none';
  }

  function updateHoverBox(target) {
    if (!(target instanceof Element) || !isVisible(target) || isScriptUiElement(target)) {
      hideHoverBox();
      return;
    }
    const box = ensureHoverBox();
    const rect = target.getBoundingClientRect();
    const inset = 2;
    state.hoveredEl = target;
    Object.assign(box.style, {
      display: 'block',
      top: `${Math.max(0, rect.top + inset)}px`,
      left: `${Math.max(0, rect.left + inset)}px`,
      width: `${Math.max(0, rect.width - (inset * 2))}px`,
      height: `${Math.max(0, rect.height - (inset * 2))}px`
    });
  }

  function bindSelectorListeners() {
    unbindSelectorListeners();

    const onMove = (event) => {
      if (!state.selectorMode) return;
      if (isScriptUiElement(event.target)) {
        hideHoverBox();
        return;
      }
      updateHoverBox(resolveSelectableElementAtPoint(event.clientX, event.clientY));
    };

    const onClick = (event) => {
      if (!state.selectorMode) return;
      if (isScriptUiElement(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = resolveSelectableElementAtPoint(event.clientX, event.clientY);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();
      openSaveRuleModal(target);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSelectorSession('Selector canceled');
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);

    state.selectorListeners = [
      () => document.removeEventListener('mousemove', onMove, true),
      () => document.removeEventListener('click', onClick, true),
      () => document.removeEventListener('keydown', onKeyDown, true)
    ];
  }

  function unbindSelectorListeners() {
    for (const cleanupFn of state.selectorListeners) {
      try { cleanupFn(); } catch {}
    }
    state.selectorListeners = [];
  }

  function publishSelectorPause() {
    const alreadyPaused = localStorage.getItem(GLOBAL_PAUSE_KEY) === '1';
    const pauseState = {
      active: true,
      createdPause: !alreadyPaused,
      previousPause: alreadyPaused,
      savedAt: nowIso(),
      source: SCRIPT_NAME
    };

    try {
      localStorage.setItem(KEYS.selectorPauseState, JSON.stringify(pauseState, null, 2));
      localStorage.setItem(GLOBAL_PAUSE_KEY, '1');
    } catch {}
  }

  function restoreSelectorPause() {
    const pauseState = safeJsonParse(localStorage.getItem(KEYS.selectorPauseState), null);
    if (!isPlainObject(pauseState)) return;

    try {
      if (pauseState.createdPause) {
        localStorage.removeItem(GLOBAL_PAUSE_KEY);
      }
    } catch {}

    try { localStorage.removeItem(KEYS.selectorPauseState); } catch {}
  }

  function restoreStaleSelectorPause() {
    const pauseState = safeJsonParse(localStorage.getItem(KEYS.selectorPauseState), null);
    if (!isPlainObject(pauseState)) return;
    if (!pauseState.active) {
      try { localStorage.removeItem(KEYS.selectorPauseState); } catch {}
      return;
    }
    restoreSelectorPause();
  }

  function startSelectorMode() {
    if (state.selectorMode || state.modalOpen) return;

    publishSelectorPause();
    state.selectorMode = true;
    state.modalOpen = false;
    bindSelectorListeners();
    hideHoverBox();
    setStatus('Selector mode');
    log('Selector mode enabled');
    renderButtons();
    renderAll();
  }

  function closeSelectorSession(message, options = {}) {
    state.selectorMode = false;
    state.modalOpen = false;
    unbindSelectorListeners();
    hideHoverBox();
    removeSaveRuleModal();
    if (options.restorePause !== false) restoreSelectorPause();
    if (options.logIt !== false && normalizeText(message)) log(message);
    if (!state.destroyed) setStatus(state.running ? 'Watching header' : 'Stopped');
    renderButtons();
    renderAll();
  }

  function openSaveRuleModal(target) {
    if (!(target instanceof Element)) return;

    state.selectorMode = false;
    state.modalOpen = true;
    unbindSelectorListeners();
    hideHoverBox();

    const draft = {
      selector: buildStableSelector(target),
      fingerprint: buildElementFingerprint(target),
      previewText: truncateText(target.innerText || target.textContent || '', 400),
      previewHtml: truncateText(target.outerHTML || '', 1200)
    };

    if (!draft.selector) {
      closeSelectorSession('Selector save failed: could not build a stable selector');
      return;
    }

    removeSaveRuleModal();

    const overlay = document.createElement('div');
    overlay.id = 'tm-timeout-save-rule-overlay';
    overlay.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: String(CFG.zIndex),
      background: 'rgba(2, 6, 23, 0.78)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    });

    overlay.innerHTML = `
      <div ${UI_MARKER_ATTR}="1" style="width:min(560px,100%);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,0.12);border-radius:16px;box-shadow:0 22px 60px rgba(0,0,0,.45);padding:18px;">
        <div ${UI_MARKER_ATTR}="1" style="font-size:16px;font-weight:800;margin-bottom:10px;">Save the error message for this element</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;opacity:.85;margin-bottom:8px;">Selector</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;line-height:1.45;background:#111827;border:1px solid #243041;border-radius:10px;padding:10px;margin-bottom:10px;word-break:break-all;">${escapeHtml(draft.selector)}</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;opacity:.85;margin-bottom:8px;">Element preview</div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:12px;line-height:1.45;background:#111827;border:1px solid #243041;border-radius:10px;padding:10px;max-height:110px;overflow:auto;margin-bottom:12px;white-space:pre-wrap;">${escapeHtml(draft.previewText || '(no visible text found)')}</div>
        <label ${UI_MARKER_ATTR}="1" for="tm-timeout-saved-error-text" style="display:block;font-size:12px;font-weight:700;margin-bottom:6px;">Saved error text</label>
        <textarea ${UI_MARKER_ATTR}="1" id="tm-timeout-saved-error-text" rows="4" style="width:100%;padding:10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb;resize:vertical;"></textarea>
        <div ${UI_MARKER_ATTR}="1" id="tm-timeout-save-rule-error" style="display:none;color:#fca5a5;font-size:12px;margin-top:8px;">Error text is required.</div>
        <div ${UI_MARKER_ATTR}="1" style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-save-rule-cancel" type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#475569;color:#fff;font-weight:700;cursor:pointer;">Cancel</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-save-rule-save" type="button" style="border:0;border-radius:10px;padding:8px 12px;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">Save Rule</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    const textarea = $('#tm-timeout-saved-error-text', overlay);
    const errorEl = $('#tm-timeout-save-rule-error', overlay);
    const cancelBtn = $('#tm-timeout-save-rule-cancel', overlay);
    const saveBtn = $('#tm-timeout-save-rule-save', overlay);

    try { textarea?.focus(); } catch {}

    const closeModal = (message) => closeSelectorSession(message);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeModal('Selector canceled');
      }
    });

    cancelBtn?.addEventListener('click', () => closeModal('Selector canceled'));

    saveBtn?.addEventListener('click', () => {
      const savedErrorText = normalizeText(textarea?.value || '');
      if (!savedErrorText) {
        if (errorEl) errorEl.style.display = 'block';
        return;
      }

      const rules = getSelectorRules();
      const ruleId = buildRuleId(draft.selector, draft.fingerprint.textFingerprint || draft.previewText || '');
      const nextRule = {
        ruleId,
        selector: draft.selector,
        label: savedErrorText,
        savedErrorText,
        fingerprint: draft.fingerprint,
        createdAt: nowIso(),
        updatedAt: nowIso()
      };

      const existingIdx = rules.findIndex((rule) => normalizeText(rule.ruleId) === ruleId || normalizeText(rule.selector) === draft.selector);
      if (existingIdx >= 0) {
        nextRule.createdAt = normalizeText(rules[existingIdx].createdAt || nowIso());
        rules[existingIdx] = nextRule;
      } else {
        rules.push(nextRule);
      }

      saveSelectorRules(rules);
      closeSelectorSession('Selector rule saved');
      scheduleScan('rule-saved');
    });

    setStatus('Selector config');
    renderButtons();
    renderAll();
  }

  function removeSaveRuleModal() {
    const overlay = $('#tm-timeout-save-rule-overlay');
    if (overlay) overlay.remove();
  }

  function matchRuleToElement(rule, el) {
    if (!(el instanceof Element) || isScriptUiElement(el) || !isVisible(el)) return false;
    const fingerprint = isPlainObject(rule.fingerprint) ? rule.fingerprint : {};
    const current = buildElementFingerprint(el);

    if (fingerprint.id && current.id && fingerprint.id === current.id) return true;

    let required = 0;
    let score = 0;

    if (fingerprint.tag) {
      required += 1;
      if (fingerprint.tag === current.tag) score += 1;
    }
    if (fingerprint.name) {
      required += 1;
      if (fingerprint.name === current.name) score += 1;
    }
    if (fingerprint.role) {
      required += 1;
      if (fingerprint.role === current.role) score += 1;
    }
    if (fingerprint.ariaLabel) {
      required += 1;
      if (fingerprint.ariaLabel === current.ariaLabel) score += 1;
    }
    if (Array.isArray(fingerprint.classTokens) && fingerprint.classTokens.length) {
      required += 1;
      const currentSet = new Set(current.classTokens || []);
      const allFound = fingerprint.classTokens.every((token) => currentSet.has(token));
      if (allFound) score += 1;
    }
    if (fingerprint.textFingerprint) {
      required += 1;
      const savedText = normalizeText(fingerprint.textFingerprint);
      const currentText = normalizeText(current.textFingerprint);
      if (savedText && currentText && (currentText.includes(savedText) || savedText.includes(currentText))) {
        score += 1;
      }
    }

    if (required === 0) return true;
    if (required === 1) return score === 1;
    return score >= 2;
  }

  function findRuleMatch(rule) {
    const selector = normalizeText(rule.selector || '');
    if (!selector) return null;

    for (const doc of getAllDocs()) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll(selector)); } catch {}
      for (const node of nodes) {
        if (matchRuleToElement(rule, node)) return node;
      }
    }
    return null;
  }

  function processSelectorMatches() {
    const context = buildEventContext();
    if (!context.ok) return;

    for (const rule of getSelectorRules()) {
      const dedupeKey = ['selector', context.job['AZ ID'], context.product, normalizeText(rule.ruleId || '')].join('|');
      if (hasSentOrPendingDedupe(dedupeKey)) continue;
      const match = findRuleMatch(rule);
      if (!match) continue;
      const event = buildSelectorEvent(context, rule, match);
      dispatchEvent(event);
      return;
    }
  }

  function buildUi() {
    if (!document.documentElement) return false;

    const existing = $('#tm-pc-header-timeout-panel');
    if (existing) {
      state.panel = existing;
      bindUi(existing);
      return true;
    }

    const panel = document.createElement('div');
    panel.id = 'tm-pc-header-timeout-panel';
    panel.setAttribute(UI_MARKER_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '16px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.42)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden',
      backdropFilter: 'blur(10px)'
    });

    panel.innerHTML = `
      <div ${UI_MARKER_ATTR}="1" id="tm-pc-header-timeout-handle" style="padding:10px 12px;background:linear-gradient(90deg,#0f172a,#1e293b);cursor:move;display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div ${UI_MARKER_ATTR}="1">
          <div ${UI_MARKER_ATTR}="1" style="font-weight:800;letter-spacing:.2px;">${SCRIPT_NAME}</div>
          <div ${UI_MARKER_ATTR}="1" style="font-size:11px;opacity:.72;">Live header timeout monitor</div>
        </div>
        <div ${UI_MARKER_ATTR}="1" style="font-size:11px;opacity:.7;">v${VERSION}</div>
      </div>
      <div ${UI_MARKER_ATTR}="1" style="padding:12px;">
        <div ${UI_MARKER_ATTR}="1" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">STOP</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-enable-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">TIMEOUT ON</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-selector" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0891b2;color:#fff;font-weight:800;cursor:pointer;">SELECTOR MODE</button>
          <button ${UI_MARKER_ATTR}="1" id="tm-timeout-copy-logs" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">COPY LOGS</button>
        </div>
        <div ${UI_MARKER_ATTR}="1" id="tm-timeout-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching header</div>
        <div ${UI_MARKER_ATTR}="1" style="display:grid;grid-template-columns:72px 1fr;gap:5px 8px;margin-bottom:10px;">
          <div ${UI_MARKER_ATTR}="1" style="opacity:.75;">Header</div>
          <div ${UI_MARKER_ATTR}="1" id="tm-timeout-header" style="word-break:break-word;">-</div>
          <div ${UI_MARKER_ATTR}="1" style="opacity:.75;">Timer</div>
          <div ${UI_MARKER_ATTR}="1" id="tm-timeout-live-timer">00:00</div>
        </div>
        <textarea ${UI_MARKER_ATTR}="1" id="tm-timeout-logs" readonly style="width:100%;min-height:150px;max-height:190px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    loadPanelPos();
    makeDraggable(panel, $('#tm-pc-header-timeout-handle', panel));
    bindUi(panel);
    return true;
  }

  function bindUi(panel) {
    state.panel = panel;
    state.els.toggle = $('#tm-timeout-toggle', panel);
    state.els.timeoutEnableToggle = $('#tm-timeout-enable-toggle', panel);
    state.els.selector = $('#tm-timeout-selector', panel);
    state.els.copyLogs = $('#tm-timeout-copy-logs', panel);
    state.els.status = $('#tm-timeout-status', panel);
    state.els.header = $('#tm-timeout-header', panel);
    state.els.liveTimer = $('#tm-timeout-live-timer', panel);
    state.els.logs = $('#tm-timeout-logs', panel);

    state.els.toggle.onclick = () => {
      state.running = !state.running;
      if (!state.running) {
        state.pausedAtMs = Date.now();
        state.frozenElapsedMs = state.current.header
          ? Math.max(0, Date.now() - Number(state.current.headerSinceMs || Date.now()))
          : 0;
        closeSelectorSession('', { logIt: false, restorePause: true });
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        if (state.pausedAtMs) {
          shiftCurrentRuntimeByPauseDelta(Date.now() - state.pausedAtMs);
        }
        state.pausedAtMs = 0;
        state.frozenElapsedMs = 0;
        setStatus('Watching header');
        log('Monitoring started');
        scheduleScan('manual-start');
      }
      renderButtons();
      renderAll();
    };

    state.els.timeoutEnableToggle.onclick = () => {
      const enabled = writeTimeoutEnabled(!timeoutActionsEnabled());
      if (!enabled) {
        clearOwnedSendArtifacts();
        log('Timeout actions OFF');
      } else {
        log('Timeout actions ON');
        scheduleScan('timeout-enabled');
      }
      setStatus(state.running ? 'Watching header' : 'Stopped');
      renderButtons();
      renderAll();
    };

    state.els.selector.onclick = () => {
      if (state.selectorMode || state.modalOpen) {
        closeSelectorSession('Selector canceled');
      } else {
        startSelectorMode();
      }
    };

    state.els.copyLogs.onclick = () => copyLogsToClipboard();

    renderButtons();
    renderAll();
  }

  function renderButtons() {
    if (!state.els.toggle) return;
    state.els.toggle.textContent = state.running ? 'STOP' : 'START';
    state.els.toggle.style.background = state.running ? '#dc2626' : '#16a34a';

    if (state.els.timeoutEnableToggle) {
      state.els.timeoutEnableToggle.textContent = state.timeoutEnabled ? 'TIMEOUT ON' : 'TIMEOUT OFF';
      state.els.timeoutEnableToggle.style.background = state.timeoutEnabled ? '#16a34a' : '#475569';
      state.els.timeoutEnableToggle.style.color = '#fff';
    }

    if (state.els.selector) {
      state.els.selector.textContent = state.selectorMode || state.modalOpen ? 'CANCEL SELECTOR' : 'SELECTOR MODE';
      state.els.selector.style.background = state.selectorMode || state.modalOpen ? '#f59e0b' : '#0891b2';
      state.els.selector.disabled = false;
      state.els.selector.style.opacity = '1';
      state.els.selector.style.cursor = 'pointer';
    }

  }

  function renderAll() {
    if (!state.panel) return;

    const liveMs = !state.running && state.pausedAtMs
      ? Math.max(0, Number(state.frozenElapsedMs || 0))
      : state.current.header
        ? Math.max(0, Date.now() - Number(state.current.headerSinceMs || Date.now()))
        : 0;

    if (state.els.status) {
      const statusText =
        state.modalOpen ? 'Selector config' :
        state.selectorMode ? 'Selector mode' :
        state.running ? (state.lastStatus || 'Watching header') :
        'Stopped';

      state.els.status.textContent = statusText;
      state.els.status.style.color =
        state.selectorMode || state.modalOpen ? '#67e8f9' :
        state.running ? '#86efac' : '#fca5a5';
    }

    if (state.els.header) state.els.header.textContent = state.current.header || '-';
    if (state.els.liveTimer) state.els.liveTimer.textContent = state.current.header ? formatDuration(liveMs) : '--:--';
    if (state.els.logs) state.els.logs.value = state.logs.join('\n');
    renderButtons();
  }

  function copyLogsToClipboard() {
    const text = state.logs.join('\n');
    if (!text) return;

    const fallbackCopy = () => {
      const ta = document.createElement('textarea');
      ta.setAttribute(UI_MARKER_ATTR, '1');
      ta.value = text;
      Object.assign(ta.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0'
      });
      document.documentElement.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => log('Logs copied'))
        .catch(() => {
          fallbackCopy();
          log('Logs copied');
        });
      return;
    }

    fallbackCopy();
    log('Logs copied');
  }

  function loadPanelPos() {
    const saved = safeJsonParse(localStorage.getItem(KEYS.panelPos), null);
    if (!isPlainObject(saved) || !state.panel) return;
    if (saved.left) state.panel.style.left = saved.left;
    if (saved.top) state.panel.style.top = saved.top;
    if (saved.right) state.panel.style.right = saved.right;
    if (saved.bottom) state.panel.style.bottom = saved.bottom;
    keepPanelInView();
  }

  function persistPanelPos() {
    if (!state.panel) return;
    localStorage.setItem(KEYS.panelPos, JSON.stringify({
      left: state.panel.style.left || '',
      top: state.panel.style.top || '',
      right: state.panel.style.right || '',
      bottom: state.panel.style.bottom || ''
    }, null, 2));
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let nextLeft = rect.left;
    let nextTop = rect.top;

    if (rect.right > window.innerWidth) nextLeft = Math.max(0, window.innerWidth - rect.width - 8);
    if (rect.bottom > window.innerHeight) nextTop = Math.max(0, window.innerHeight - rect.height - 8);
    if (rect.left < 0) nextLeft = 8;
    if (rect.top < 0) nextTop = 8;

    state.panel.style.left = `${nextLeft}px`;
    state.panel.style.top = `${nextTop}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        left: panel.getBoundingClientRect().left,
        top: panel.getBoundingClientRect().top
      };
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const nextLeft = drag.left + (event.clientX - drag.startX);
      const nextTop = drag.top + (event.clientY - drag.startY);
      panel.style.left = `${Math.max(0, nextLeft)}px`;
      panel.style.top = `${Math.max(0, nextTop)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    const endDrag = () => {
      if (!drag) return;
      drag = null;
      keepPanelInView();
      persistPanelPos();
    };

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }
})();
