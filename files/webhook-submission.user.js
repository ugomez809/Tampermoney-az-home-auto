// ==UserScript==
// @name         AZ TO GWPC Home Bot: Webhook Submission
// @namespace    homebot.webhook-submission
// @version      1.14
// @description  Single GWPC sender. Waits for tm_pc_current_job_v1 handoff, accepts home-only payload flow, builds a synthetic bundle when needed, then sends one webhook payload while retaining stored payloads for later reuse/testing.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/webhook-submission.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/webhook-submission.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TO_GWPC_WEBHOOK_SUBMISSION_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'AZ TO GWPC Home Bot: Webhook Submission';
  const VERSION = '1.14';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FORCE_SEND_KEY = 'tm_pc_force_send_now_v1';

  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const HOME_KEY = 'tm_pc_home_quote_grab_payload_v1';
  const AUTO_KEY = 'tm_pc_auto_quote_grab_payload_v1';

  const CFG = {
    webhookUrlKey: 'tm_pc_webhook_submit_url_v17',
    sentMetaKey: 'tm_pc_webhook_submit_sent_meta_v17',
    panelPosKey: 'tm_pc_webhook_submit_panel_pos_v17',
    stoppedKey: 'tm_pc_webhook_submit_stopped_v17',

    tickMs: 900,
    quoteVisibleDelayMs: 5000,
    requestTimeoutMs: 45000,
    maxSendAttempts: 3,
    maxLogLines: 140,
    panelWidth: 430,
    zIndex: 2147483647
  };

  const state = {
    running: sessionStorage.getItem(CFG.stoppedKey) !== '1',
    busy: false,
    quoteSeenAt: 0,
    destroyed: false,
    tickTimer: null,
    panel: null,
    statusEl: null,
    logsEl: null,
    webhookUrlEl: null,
    activeUrlEl: null,
    toggleBtn: null,
    sendBtn: null,
    testBtn: null,
    copyLogsBtn: null,
    clearLogsBtn: null,
    logLines: [],
    drag: null,
    savedWebhookUrl: '',
    lastWaitKey: ''
  };

  init();

  function init() {
    clearStaleSharedPause();
    hydrateWebhookStorage();
    buildUI();
    syncWebhookUi();
    renderButtons();
    log('Script loaded');
    log('Single sender armed');
    log(`Active webhook: ${getWebhookUrl() || '(empty)'}`);
    setStatus('Waiting for current job handoff');

    state.tickTimer = setInterval(tick, CFG.tickMs);

    window.addEventListener('beforeunload', persistWebhookBeforeUnload, { once: true, capture: true });
    window.addEventListener('pagehide', persistWebhookBeforeUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);

    tick();
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;

    try { persistWebhookFromUi(false); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('pagehide', persistWebhookBeforeUnload, true); } catch {}
    try { document.removeEventListener('visibilitychange', onVisibilityChange, true); } catch {}
    try { state.panel?.remove(); } catch {}
  }

  window.__AZ_TO_GWPC_WEBHOOK_SUBMISSION_CLEANUP__ = cleanup;

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
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

  function normalizeSpace(v) {
    return String(v == null ? '' : v).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(v) {
    return normalizeSpace(v);
  }

  function normalizeCompare(v) {
    return normalizeSpace(v)
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
    if (!aa || !bb) return false;
    return aa === bb || aa.includes(bb) || bb.includes(aa);
  }

  function isVisible(el) {
    if (!el) return false;
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

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return `h${Math.abs(h)}`;
  }

  function log(msg) {
    const line = `[${timeNow()}] ${msg}`;
    state.logLines.unshift(line);
    state.logLines = state.logLines.slice(0, CFG.maxLogLines);
    renderLogs();
    console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function logWait(key, msg) {
    if (state.lastWaitKey === key) return;
    state.lastWaitKey = key;
    log(msg);
  }

  function clearWaitLog() {
    state.lastWaitKey = '';
  }

  function renderLogs() {
    if (!state.logsEl) return;
    state.logsEl.value = state.logLines.join('\n');
    state.logsEl.scrollTop = 0;
  }

  function clearLogs() {
    state.logLines = [];
    renderLogs();
    log('Logs cleared');
  }

  function setStatus(text) {
    if (state.statusEl) state.statusEl.textContent = text;
  }

  function readWebhookUrlFromGM() {
    try {
      return normalizeText(GM_getValue(CFG.webhookUrlKey, ''));
    } catch {
      return '';
    }
  }

  function readWebhookUrlFromLocal() {
    try {
      return normalizeText(localStorage.getItem(CFG.webhookUrlKey) || '');
    } catch {
      return '';
    }
  }

  function mirrorWebhookUrl(url) {
    const normalized = normalizeText(url);

    try { GM_setValue(CFG.webhookUrlKey, normalized); } catch {}
    try { localStorage.setItem(CFG.webhookUrlKey, normalized); } catch {}
    try { sessionStorage.setItem(CFG.webhookUrlKey, normalized); } catch {}

    state.savedWebhookUrl = normalized;
    return normalized;
  }

  function hydrateWebhookStorage() {
    const gmUrl = readWebhookUrlFromGM();
    const localUrl = readWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || '';

    if (resolved) mirrorWebhookUrl(resolved);
    else state.savedWebhookUrl = '';
  }

  function getWebhookUrl() {
    const gmUrl = readWebhookUrlFromGM();
    const localUrl = readWebhookUrlFromLocal();
    const resolved = gmUrl || localUrl || state.savedWebhookUrl || '';

    if (resolved && (gmUrl !== resolved || localUrl !== resolved || state.savedWebhookUrl !== resolved)) {
      mirrorWebhookUrl(resolved);
    } else {
      state.savedWebhookUrl = resolved;
    }

    return resolved;
  }

  function getCurrentWebhookUrlFromUi() {
    const uiValue = normalizeSpace(state.webhookUrlEl?.value || '');
    return uiValue || getWebhookUrl();
  }

  function persistWebhookFromUi(withLog = false) {
    const current = normalizeSpace(state.webhookUrlEl?.value || '');
    const before = getWebhookUrl();
    const saved = mirrorWebhookUrl(current);
    updateActiveWebhookUi(saved);

    if (withLog && saved !== before) {
      log(saved ? 'Webhook URL saved' : 'Webhook URL cleared');
    }

    return saved;
  }

  function persistWebhookBeforeUnload() {
    try { persistWebhookFromUi(false); } catch {}
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      try { persistWebhookFromUi(false); } catch {}
    }
  }

  function isValidHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  function truncateMiddle(text, max = 100) {
    const value = String(text || '');
    if (value.length <= max) return value;
    const part = Math.max(12, Math.floor((max - 3) / 2));
    return `${value.slice(0, part)}...${value.slice(-part)}`;
  }

  function updateActiveWebhookUi(url) {
    const current = normalizeText(url);
    if (state.activeUrlEl) {
      state.activeUrlEl.textContent = current ? truncateMiddle(current, 110) : '(empty)';
      state.activeUrlEl.title = current || '';
    }
  }

  function syncWebhookUi() {
    const url = getWebhookUrl();
    if (state.webhookUrlEl && state.webhookUrlEl.value !== url) state.webhookUrlEl.value = url;
    updateActiveWebhookUi(url);
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
    const legacyAddress = [
      normalizeText(az['AZ Street Address']),
      normalizeText(az['AZ City']),
      normalizeText(az['AZ State']) && normalizeText(az['AZ Postal Code']) ? `${normalizeText(az['AZ State'])} ${normalizeText(az['AZ Postal Code'])}` : ''
    ].filter(Boolean).join(', ');

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

    try { raw = GM_getValue(CURRENT_JOB_KEY, null); } catch { raw = null; }
    job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    try { raw = GM_getValue(LEGACY_SHARED_JOB_KEY, null); } catch { raw = null; }
    job = normalizeCurrentJob(raw);
    return job;
  }

  function readBundleRaw() {
    return safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
  }

  function readHomePayload() {
    return safeJsonParse(localStorage.getItem(HOME_KEY), null);
  }

  function readAutoPayload() {
    return safeJsonParse(localStorage.getItem(AUTO_KEY), null);
  }

  function hasMeaningfulHome(bundle) {
    return !!(bundle?.home?.ready && isPlainObject(bundle?.home?.data));
  }

  function hasMeaningfulAuto(bundle) {
    return !!(bundle?.auto?.ready && isPlainObject(bundle?.auto?.data));
  }

  function hasPendingTimeout(bundle) {
    return !!(bundle?.timeout?.ready && Array.isArray(bundle?.timeout?.events) && bundle.timeout.events.length);
  }

  function getTimeoutEvents(bundle) {
    return Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events : [];
  }

  function hasSectionErrors(section) {
    if (!isPlainObject(section?.data)) return false;
    if (Array.isArray(section.data.errors) && section.data.errors.length) return true;
    return !!(isPlainObject(section.data.latestError) && normalizeText(section.data.latestError.errorType || section.data.latestError.errorName || section.data.latestError.errorText));
  }

  function hasHomeError(bundle) {
    if (hasSectionErrors(bundle?.home)) return true;
    return getTimeoutEvents(bundle).some((event) => normalizeText(event?.product).toLowerCase() === 'home');
  }

  function hasAutoError(bundle) {
    if (hasSectionErrors(bundle?.auto)) return true;
    return getTimeoutEvents(bundle).some((event) => normalizeText(event?.product).toLowerCase() === 'auto');
  }

  function hasHomeSuccess(bundle) {
    return hasMeaningfulHome(bundle) && !hasHomeError(bundle);
  }

  function hasAutoSuccess(bundle) {
    return hasMeaningfulAuto(bundle) && !hasAutoError(bundle);
  }

  function shouldWaitForAuto(bundle) {
    return hasHomeSuccess(bundle) && !hasMeaningfulAuto(bundle) && !hasAutoError(bundle);
  }

  function buildHomeOnlySyntheticBundle(job, homePayload) {
    const row = isPlainObject(homePayload?.row) ? homePayload.row : null;
    if (!row) return null;

    const payloadAzId = normalizeText(homePayload?.['AZ ID'] || homePayload?.currentJob?.['AZ ID'] || '');
    if (!payloadAzId || payloadAzId !== job['AZ ID']) return null;

    const name = normalizeText(row['Name'] || row.name || '');
    const address = normalizeText(row['Mailing Address'] || row.mailingAddress || '');

    if (!name || !address) return null;
    if (!namesLikelySame(job['Name'], name)) return null;
    if (!addressesLikelySame(job['Mailing Address'], address)) return null;

    return {
      'AZ ID': job['AZ ID'],
      home: {
        ready: true,
        data: deepClone(row),
        sourcePayload: deepClone(homePayload),
        sourceKey: HOME_KEY
      },
      auto: {
        ready: false,
        data: null
      },
      timeout: {
        ready: false,
        events: []
      },
      meta: {
        synthetic: true,
        builtFrom: HOME_KEY,
        builtAt: nowIso()
      }
    };
  }

  function getEffectiveBundle(job) {
    const rawBundle = readBundleRaw();

    if (isPlainObject(rawBundle) &&
        normalizeText(rawBundle['AZ ID']) === job['AZ ID'] &&
        (hasMeaningfulHome(rawBundle) || hasMeaningfulAuto(rawBundle) || hasPendingTimeout(rawBundle))) {
      return {
        bundle: rawBundle,
        source: 'bundle'
      };
    }

    const homePayload = readHomePayload();
    const synthetic = buildHomeOnlySyntheticBundle(job, homePayload);
    if (synthetic) {
      return {
        bundle: synthetic,
        source: 'home-payload'
      };
    }

    return {
      bundle: null,
      source: ''
    };
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

  function getSentMeta() {
    return safeJsonParse(localStorage.getItem(CFG.sentMetaKey), null);
  }

  function setSentMeta(meta) {
    localStorage.setItem(CFG.sentMetaKey, JSON.stringify(meta));
  }

  function clearSentMeta() {
    localStorage.removeItem(CFG.sentMetaKey);
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  function readForceSendRequest() {
    return safeJsonParse(localStorage.getItem(FORCE_SEND_KEY), null);
  }

  function hasForceSendRequest() {
    const request = readForceSendRequest();
    return !!(request && typeof request === 'object' && request.requestedAt);
  }

  function requestForceSend(reason = 'manual-send') {
    const request = {
      requestedAt: nowIso(),
      reason: normalizeText(reason || 'manual-send'),
      source: SCRIPT_NAME
    };
    try { localStorage.setItem(GLOBAL_PAUSE_KEY, '1'); } catch {}
    try { localStorage.setItem(FORCE_SEND_KEY, JSON.stringify(request, null, 2)); } catch {}
    log(`Force send requested: ${request.reason}`);
    setStatus('Force send requested');
    state.quoteSeenAt = 0;
    return request;
  }

  function clearForceSendRequest() {
    try { localStorage.removeItem(FORCE_SEND_KEY); } catch {}
    try { localStorage.removeItem(GLOBAL_PAUSE_KEY); } catch {}
  }

  function clearStaleSharedPause() {
    if (hasForceSendRequest()) return;
    try {
      if (localStorage.getItem(GLOBAL_PAUSE_KEY) === '1') {
        localStorage.removeItem(GLOBAL_PAUSE_KEY);
      }
    } catch {}
  }

  function isSameBundleAlreadySent(job, bundle) {
    const meta = getSentMeta();
    if (!meta || !meta.signature) return false;
    return meta.signature === buildSignatureJobBundle(job, bundle);
  }

  function getAllDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        for (let i = 0; i < win.frames.length; i++) walk(win.frames[i]);
      } catch {}
    }

    walk(window);
    return docs;
  }

  function findQuoteHeader() {
    for (const doc of getAllDocs()) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll('div.gw-TitleBar--title, .gw-TitleBar--title[role="heading"]')); } catch {}
      for (const el of nodes) {
        if (normalizeSpace(el.textContent) === 'Quote' && isVisible(el)) return el;
      }
    }
    return null;
  }

  function strongClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: el.ownerDocument?.defaultView || window
        }));
      } catch {}
    }
    try { el.click(); return true; } catch { return false; }
  }

  function validateCurrentJobAndBundle(job, bundle) {
    if (!job['AZ ID']) return { ok: false, reason: 'Waiting for tm_pc_current_job_v1 / AZ ID' };
    if (!job['Name'] || !job['Mailing Address']) return { ok: false, reason: 'Waiting for full tm_pc_current_job_v1 identity' };
    if (!isPlainObject(bundle)) return { ok: false, reason: 'Waiting for home payload / bundle' };
    if (normalizeText(bundle['AZ ID']) !== job['AZ ID']) return { ok: false, reason: 'Bundle AZ ID mismatch' };
    if (!(hasMeaningfulHome(bundle) || hasMeaningfulAuto(bundle) || hasPendingTimeout(bundle))) {
      return { ok: false, reason: 'Waiting for gathered data' };
    }
    return { ok: true };
  }

  function buildRequestBody(job, bundle, signature, test = false) {
    return {
      event: test ? 'az_to_gwpc_bundle_test' : 'az_to_gwpc_bundle',
      test,
      sender: {
        script: SCRIPT_NAME,
        version: VERSION,
        sentAt: nowIso(),
        pageUrl: location.href,
        pageTitle: document.title,
        signature
      },
      currentJob: deepClone(job),
      bundle: deepClone(bundle),
      summary: {
        hasHome: hasMeaningfulHome(bundle),
        hasAuto: hasMeaningfulAuto(bundle),
        hasTimeout: hasPendingTimeout(bundle),
        hasHomeError: hasHomeError(bundle),
        hasAutoError: hasAutoError(bundle),
        timeoutCount: Array.isArray(bundle?.timeout?.events) ? bundle.timeout.events.length : 0
      }
    };
  }

  function gmPostJson(url, data, timeoutMs) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(data),
        timeout: timeoutMs,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timeout'))
      });
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function afterSuccess(_job, _bundle) {
    state.running = false;
    sessionStorage.setItem(CFG.stoppedKey, '1');
    clearForceSendRequest();
    renderButtons();
    log('Stored payloads retained after send');
    setStatus('Sent | Payload retained | Stopped');
  }

  async function sendTestWebhook() {
    if (state.busy) {
      log('Test skipped: already busy');
      return;
    }

    const endpoint = getCurrentWebhookUrlFromUi();
    if (!isValidHttpUrl(endpoint)) {
      setStatus('Webhook URL missing');
      log('Test failed: webhook URL missing or invalid');
      return;
    }

    persistWebhookFromUi(false);

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle || {
      'AZ ID': job['AZ ID'] || '',
      home: { ready: false, data: null },
      auto: { ready: false, data: null },
      timeout: { ready: false, events: [] },
      meta: { synthetic: true, builtAt: nowIso(), builtFrom: 'test-fallback' }
    };

    const requestBody = buildRequestBody(job, bundle, `test_${Date.now()}`, true);

    state.busy = true;
    renderButtons();
    setStatus('Sending test...');
    log(`TEST POST ${endpoint}`);

    try {
      const res = await gmPostJson(endpoint, requestBody, CFG.requestTimeoutMs);
      const raw = typeof res?.responseText === 'string' ? res.responseText : '';
      const json = safeJsonParse(raw, null);

      if (res.status < 200 || res.status >= 400) {
        throw new Error(`HTTP ${res.status}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
      }
      if (json && json.ok === false) {
        throw new Error(json.error || json.message || 'Receiver returned ok:false');
      }

      setStatus('Test sent');
      log('Test webhook success');
    } catch (err) {
      setStatus('Test failed');
      log(`Test failed: ${err?.message || err}`);
    } finally {
      state.busy = false;
      renderButtons();
    }
  }

  function shouldSendNow(bundle) {
    if (hasHomeError(bundle)) return true;
    if (hasAutoError(bundle)) return true;
    if (shouldWaitForAuto(bundle)) {
      state.quoteSeenAt = 0;
      return false;
    }
    if (hasPendingTimeout(bundle)) return true;

    if (!(hasMeaningfulHome(bundle) || hasMeaningfulAuto(bundle))) {
      state.quoteSeenAt = 0;
      return false;
    }

    const quoteHeader = findQuoteHeader();
    if (!quoteHeader) {
      state.quoteSeenAt = 0;
      return false;
    }

    if (!state.quoteSeenAt) {
      state.quoteSeenAt = Date.now();
      setStatus('Quote found, waiting 5 seconds');
      return false;
    }

    const age = Date.now() - state.quoteSeenAt;
    if (age < CFG.quoteVisibleDelayMs) {
      setStatus(`Quote stable... ${Math.ceil((CFG.quoteVisibleDelayMs - age) / 1000)}s`);
      return false;
    }

    return true;
  }

  async function sendBundle(force = false) {
    if (state.busy) {
      log('Send skipped: already busy');
      return;
    }
    if (isGloballyPaused() && !force) {
      setStatus('Paused by shared selector');
      return;
    }
    if (!state.running && !force) return;

    const endpoint = getCurrentWebhookUrlFromUi();
    if (!isValidHttpUrl(endpoint)) {
      setStatus('Webhook URL missing');
      log('Send failed: webhook URL missing or invalid');
      return;
    }

    persistWebhookFromUi(false);

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle;
    const source = resolved.source || 'none';

    const valid = validateCurrentJobAndBundle(job, bundle);
    if (!valid.ok) {
      setStatus(valid.reason);
      if (force) log(`Send blocked: ${valid.reason}`);
      return;
    }

    if (!force && !shouldSendNow(bundle)) return;

    clearWaitLog();

    const signature = buildSignatureJobBundle(job, bundle);
    if (!force && isSameBundleAlreadySent(job, bundle)) {
      setStatus('Already sent');
      log('Same bundle already sent');
      return;
    }

    state.busy = true;
    renderButtons();
    setStatus('Sending...');
    log(`POST ${endpoint}`);
    log(`Current Job AZ ID: ${job['AZ ID']}`);
    log(`Bundle source: ${source}`);
    log(`Bundle sections -> home:${hasMeaningfulHome(bundle) ? 'yes' : 'no'} auto:${hasMeaningfulAuto(bundle) ? 'yes' : 'no'} timeout:${hasPendingTimeout(bundle) ? 'yes' : 'no'}`);
    log(`Bundle errors -> home:${hasHomeError(bundle) ? 'yes' : 'no'} auto:${hasAutoError(bundle) ? 'yes' : 'no'}`);

    const requestBody = buildRequestBody(job, bundle, signature, false);

    let lastErr = null;
    for (let attempt = 1; attempt <= CFG.maxSendAttempts; attempt++) {
      try {
        log(`Send attempt ${attempt}/${CFG.maxSendAttempts}`);
        const res = await gmPostJson(endpoint, requestBody, CFG.requestTimeoutMs);
        const raw = typeof res?.responseText === 'string' ? res.responseText : '';
        const json = safeJsonParse(raw, null);

        if (res.status < 200 || res.status >= 400) {
          throw new Error(`HTTP ${res.status}${raw ? ` | ${raw.slice(0, 300)}` : ''}`);
        }
        if (json && json.ok === false) {
          throw new Error(json.error || json.message || 'Receiver returned ok:false');
        }

        setSentMeta({ signature, sentAt: nowIso(), azId: job['AZ ID'] });
        log('Webhook send success');
        await afterSuccess(job, bundle);
        state.busy = false;
        renderButtons();
        return;
      } catch (err) {
        lastErr = err;
        log(`Send attempt failed: ${err?.message || err}`);
      }
    }

    setStatus('Send failed');
    state.busy = false;
    renderButtons();
    log(`Send failed: ${lastErr?.message || lastErr || 'Unknown error'}`);
  }

  function tick() {
    if (state.destroyed || state.busy) return;
    const forceSend = hasForceSendRequest();
    if (isGloballyPaused() && !forceSend) {
      setStatus('Paused by shared selector');
      return;
    }
    if (!state.running && !forceSend) {
      setStatus('Stopped');
      return;
    }

    const job = readCurrentJob();
    const resolved = getEffectiveBundle(job);
    const bundle = resolved.bundle;

    if (!job['AZ ID']) {
      state.quoteSeenAt = 0;
      setStatus(forceSend ? 'Force send waiting for current job handoff' : 'Waiting for current job handoff');
      logWait(forceSend ? 'force-wait-job' : 'wait-job', 'Waiting for tm_pc_current_job_v1 / AZ ID');
      return;
    }

    if (!job['Name'] || !job['Mailing Address']) {
      state.quoteSeenAt = 0;
      setStatus(forceSend ? 'Force send waiting for full current job' : 'Waiting for full current job');
      logWait(forceSend ? 'force-wait-job-identity' : 'wait-job-identity', 'Waiting for tm_pc_current_job_v1 identity');
      return;
    }

    if (!bundle) {
      state.quoteSeenAt = 0;
      setStatus(forceSend ? 'Force send waiting for payload / bundle' : 'Waiting for home payload / bundle');
      logWait(forceSend ? 'force-wait-payload' : 'wait-payload', 'Waiting for tm_pc_home_quote_grab_payload_v1 or tm_pc_webhook_bundle_v1');
      return;
    }

    clearWaitLog();

    if (forceSend) {
      setStatus('Force send ready');
      sendBundle(true);
      return;
    }

    if (shouldWaitForAuto(bundle)) {
      state.quoteSeenAt = 0;
      setStatus('Home complete, waiting for auto');
      logWait('wait-auto-after-home', 'Home complete. Waiting for AUTO completion or AUTO error before sending');
      return;
    }

    if (hasHomeError(bundle)) {
      setStatus('Home error ready');
      sendBundle(false);
      return;
    }

    if (hasAutoError(bundle)) {
      setStatus('Auto error ready');
      sendBundle(false);
      return;
    }

    if (hasPendingTimeout(bundle)) {
      setStatus('Timeout bundle ready');
      sendBundle(false);
      return;
    }

    if (hasMeaningfulHome(bundle) || hasMeaningfulAuto(bundle)) {
      sendBundle(false);
      return;
    }

    state.quoteSeenAt = 0;
    setStatus('Waiting for gathered data');
    logWait('wait-gathered', 'Waiting for gathered data');
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;

    if (rect.right > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 8);
    if (rect.bottom > window.innerHeight) top = Math.max(0, window.innerHeight - rect.height - 8);
    if (left < 0) left = 0;
    if (top < 0) top = 0;

    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
  }

  function savePanelPos() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    localStorage.setItem(CFG.panelPosKey, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function restorePanelPos() {
    if (!state.panel) return;
    const saved = safeJsonParse(localStorage.getItem(CFG.panelPosKey), null);
    if (!saved || typeof saved.left !== 'number' || typeof saved.top !== 'number') return;
    state.panel.style.left = `${Math.max(0, saved.left)}px`;
    state.panel.style.top = `${Math.max(0, saved.top)}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    keepPanelInView();
  }

  function beginDrag(ev) {
    if (!state.panel || ev.target.closest('button, input, textarea')) return;
    const rect = state.panel.getBoundingClientRect();
    state.drag = {
      startX: ev.clientX,
      startY: ev.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      prevUserSelect: document.body.style.userSelect || ''
    };
    state.panel.style.left = `${rect.left}px`;
    state.panel.style.top = `${rect.top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onDragMove, true);
    window.addEventListener('mouseup', endDrag, true);
    ev.preventDefault();
  }

  function onDragMove(ev) {
    if (!state.drag || !state.panel) return;
    const dx = ev.clientX - state.drag.startX;
    const dy = ev.clientY - state.drag.startY;
    let left = state.drag.startLeft + dx;
    let top = state.drag.startTop + dy;
    left = Math.max(0, Math.min(window.innerWidth - state.panel.offsetWidth, left));
    top = Math.max(0, Math.min(window.innerHeight - state.panel.offsetHeight, top));
    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
  }

  function endDrag() {
    if (!state.drag) return;
    document.body.style.userSelect = state.drag.prevUserSelect || '';
    state.drag = null;
    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', endDrag, true);
    savePanelPos();
  }

  function renderButtons() {
    if (state.toggleBtn) {
      state.toggleBtn.textContent = state.running ? 'STOP' : 'START';
      state.toggleBtn.style.background = state.running ? '#dc2626' : '#16a34a';
    }
    if (state.sendBtn) state.sendBtn.disabled = state.busy;
    if (state.testBtn) state.testBtn.disabled = state.busy;
  }

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #az-to-gwpc-webhook-panel{position:fixed;right:12px;bottom:12px;width:${CFG.panelWidth}px;background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.35);z-index:${CFG.zIndex};font:12px/1.35 Arial,sans-serif;overflow:hidden}
      #az-to-gwpc-webhook-panel *{box-sizing:border-box}
      #az-to-gwpc-webhook-panel .hb-head{padding:10px 12px;background:#0f172a;border-bottom:1px solid #374151;cursor:move;font-weight:700}
      #az-to-gwpc-webhook-panel .hb-body{padding:10px 12px}
      #az-to-gwpc-webhook-panel .hb-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
      #az-to-gwpc-webhook-panel button,#az-to-gwpc-webhook-panel input,#az-to-gwpc-webhook-panel textarea{font:12px Arial,sans-serif}
      #az-to-gwpc-webhook-panel button{border:0;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer;color:#fff}
      #az-to-gwpc-webhook-panel .hb-btn-blue{background:#2563eb}
      #az-to-gwpc-webhook-panel .hb-btn-gray{background:#4b5563}
      #az-to-gwpc-webhook-panel .hb-btn-orange{background:#d97706}
      #az-to-gwpc-webhook-panel .hb-btn-red{background:#dc2626}
      #az-to-gwpc-webhook-panel .hb-status{margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937;word-break:break-word}
      #az-to-gwpc-webhook-panel .hb-field{display:flex;flex-direction:column;gap:4px;flex:1 1 100%}
      #az-to-gwpc-webhook-panel .hb-label{opacity:.85;font-size:11px}
      #az-to-gwpc-webhook-panel input{width:100%;border:1px solid #374151;border-radius:8px;background:#0b1220;color:#f9fafb;padding:7px 8px}
      #az-to-gwpc-webhook-panel textarea{width:100%;height:220px;border:1px solid #243041;border-radius:8px;background:#0b1220;color:#f9fafb;padding:8px;resize:vertical}
      #az-to-gwpc-webhook-panel .hb-active{padding:6px 8px;border-radius:8px;background:#0b1220;border:1px solid #243041;word-break:break-all}
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'az-to-gwpc-webhook-panel';
    panel.innerHTML = `
      <div class="hb-head">${SCRIPT_NAME} V${VERSION}</div>
      <div class="hb-body">
        <div class="hb-row">
          <button id="hb-toggle" class="hb-btn-red">STOP</button>
          <button id="hb-send" class="hb-btn-blue">SEND NOW</button>
          <button id="hb-test" class="hb-btn-orange">TEST SEND</button>
        </div>
        <div class="hb-field" style="margin-bottom:8px">
          <div class="hb-label">Paste your webhook here</div>
          <input id="hb-webhook-url" type="text" placeholder="https://...">
        </div>
        <div class="hb-field" style="margin-bottom:8px">
          <div class="hb-label">Active webhook</div>
          <div id="hb-active-url" class="hb-active">(empty)</div>
        </div>
        <div id="hb-status" class="hb-status">Waiting for current job handoff</div>
        <div class="hb-row">
          <button id="hb-copy-logs" class="hb-btn-gray">COPY LOGS</button>
          <button id="hb-clear-logs" class="hb-btn-gray">CLEAR LOGS</button>
        </div>
        <textarea id="hb-logs" spellcheck="false" readonly></textarea>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.panel = panel;
    state.statusEl = panel.querySelector('#hb-status');
    state.logsEl = panel.querySelector('#hb-logs');
    state.webhookUrlEl = panel.querySelector('#hb-webhook-url');
    state.activeUrlEl = panel.querySelector('#hb-active-url');
    state.toggleBtn = panel.querySelector('#hb-toggle');
    state.sendBtn = panel.querySelector('#hb-send');
    state.testBtn = panel.querySelector('#hb-test');
    state.copyLogsBtn = panel.querySelector('#hb-copy-logs');
    state.clearLogsBtn = panel.querySelector('#hb-clear-logs');

    panel.querySelector('.hb-head').addEventListener('mousedown', beginDrag, true);

    state.toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      if (state.running) sessionStorage.removeItem(CFG.stoppedKey);
      else sessionStorage.setItem(CFG.stoppedKey, '1');
      if (state.running) clearSentMeta();
      renderButtons();
      setStatus(state.running ? 'Running' : 'Stopped');
      log(state.running ? 'Sender resumed' : 'Stopped for this page session');
      clearWaitLog();
      state.quoteSeenAt = 0;
    });

    state.sendBtn.addEventListener('click', () => {
      requestForceSend('manual-send');
      state.running = true;
      sessionStorage.removeItem(CFG.stoppedKey);
      renderButtons();
      tick();
    });
    state.testBtn.addEventListener('click', sendTestWebhook);

    state.webhookUrlEl.addEventListener('input', () => { persistWebhookFromUi(false); });
    state.webhookUrlEl.addEventListener('change', () => { persistWebhookFromUi(true); });
    state.webhookUrlEl.addEventListener('blur', () => { persistWebhookFromUi(true); });
    state.webhookUrlEl.addEventListener('paste', () => {
      setTimeout(() => persistWebhookFromUi(true), 0);
    });
    state.webhookUrlEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        persistWebhookFromUi(true);
        try { state.webhookUrlEl.blur(); } catch {}
      }
    });

    state.copyLogsBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(state.logLines.join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    state.clearLogsBtn.addEventListener('click', clearLogs);

    restorePanelPos();
  }
})();
