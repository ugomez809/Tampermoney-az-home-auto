// ==UserScript==
// @name         GWPC Payload Mirror + Non-AZ Tab Closer
// @namespace    homebot.payload-mirror-non-az-tab-closer
// @version      1.0.10
// @description  After webhook success, mirrors the final GWPC payload into shared GM storage, waits 5 seconds, then best-effort closes non-AZ GWPC/LEX tabs from the shared close signal while leaving AgencyZoom available and showing mirrored payload state correctly on AZ.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://app.agencyzoom.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/payload-mirror-non-az-tab-closer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/payload-mirror-non-az-tab-closer.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Payload Mirror + Non-AZ Tab Closer';
  const VERSION = '1.0.10';

  const GM_KEYS = {
    success: 'tm_pc_webhook_post_success_v1',
    finalPayload: 'tm_az_gwpc_final_payload_v1',
    finalReady: 'tm_az_gwpc_final_payload_ready_v1',
    closeSignal: 'tm_pc_payload_mirror_close_signal_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    autoPayload: 'tm_pc_auto_quote_grab_payload_v1'
  };

  const LS_KEYS = {
    running: 'tm_pc_payload_mirror_running_v1',
    panelPos: 'tm_pc_payload_mirror_panel_pos_v1'
  };

  const SS_KEYS = {
    handledSignal: 'tm_pc_payload_mirror_last_handled_signal_v1',
    closeAttempted: 'tm_pc_payload_mirror_close_attempted_v1'
  };

  const GWPC_KEYS = [
    'tm_pc_webhook_bundle_v1',
    'tm_pc_current_job_v1',
    'tm_pc_home_quote_grab_payload_v1',
    'tm_pc_auto_quote_grab_payload_v1',
    'tm_pc_header_timeout_runtime_v2',
    'tm_pc_header_timeout_sent_events_v2'
  ];

  const CFG = {
    tickMs: 400,
    maxSignalAgeMs: 90000,
    closeDelayMs: 5000,
    maxLogLines: 70,
    zIndex: 2147483647,
    panelWidth: 330,
    closeRetryMs: 1200,
    maxCloseAttempts: 6
  };

  const state = {
    destroyed: false,
    running: loadRunning(),
    logs: [],
    panel: null,
    ui: {},
    tickTimer: null,
    gmSuccessListener: null,
    gmReadyListener: null,
    activeSignal: null,
    activeSignalKey: '',
    countdownEndsAt: 0,
    mirrored: false,
    closeAttempted: false,
    closeAttempts: 0,
    closeSignalKey: ''
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    renderAll();

    log(`Loaded v${VERSION}`);
    log(`Host: ${location.hostname}`);
    setStatus(state.running ? 'Watching for webhook success' : 'Stopped');

    if (typeof GM_addValueChangeListener === 'function') {
      try {
        state.gmSuccessListener = GM_addValueChangeListener(GM_KEYS.success, () => {
          scheduleImmediateCheck('gm-success');
        });
      } catch {}

      try {
        state.gmReadyListener = GM_addValueChangeListener(GM_KEYS.finalReady, () => {
          scheduleImmediateCheck('gm-ready');
        });
      } catch {}

      try {
        GM_addValueChangeListener(GM_KEYS.closeSignal, () => {
          scheduleImmediateCheck('gm-close');
        });
      } catch {}
    }

    state.tickTimer = setInterval(() => tick(), CFG.tickMs);
    window.addEventListener('beforeunload', persistPanelPos, true);
    window.addEventListener('pagehide', persistPanelPos, true);
    window.addEventListener('resize', keepPanelInView, true);

    tick();
    window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.tickTimer); } catch {}
    try { window.removeEventListener('beforeunload', persistPanelPos, true); } catch {}
    try { window.removeEventListener('pagehide', persistPanelPos, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__; } catch {}
  }

  function loadRunning() {
    try { return localStorage.getItem(LS_KEYS.running) !== '0'; }
    catch { return true; }
  }

  function saveRunning(on) {
    try { localStorage.setItem(LS_KEYS.running, on ? '1' : '0'); } catch {}
  }

  function readJson(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return nowIso(); }
  }

  function isGwpcHost() {
    return /^policycenter(?:-2|-3)?\.farmersinsurance\.com$/i.test(location.hostname);
  }

  function isLexHost() {
    return /^farmersagent\.lightning\.force\.com$/i.test(location.hostname);
  }

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function readGM(key, fallback = null) {
    try { return readJson(GM_getValue(key, fallback), fallback); }
    catch { return fallback; }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
  }

  function readLocalJson(key) {
    try { return readJson(localStorage.getItem(key), null); }
    catch { return null; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; }
    catch { return ''; }
  }

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();
    console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function setStatus(text) {
    if (state.ui.status) state.ui.status.textContent = text;
  }

  function buildSignalKey(signal) {
    const explicit = norm(signal?.signalKey || '');
    if (explicit) return explicit;
    return `${norm(signal?.azId || '')}|${norm(signal?.postedAt || signal?.signalPostedAt || '')}`;
  }

  function isFreshSuccessSignal(signal) {
    if (!isPlainObject(signal) || signal.ok !== true) return false;
    const azId = norm(signal.azId || '');
    const postedAt = norm(signal.postedAt || '');
    if (!azId || !postedAt) return false;
    const postedMs = Date.parse(postedAt);
    if (!Number.isFinite(postedMs)) return false;
    return (Date.now() - postedMs) <= CFG.maxSignalAgeMs;
  }

  function readSuccessSignal() {
    const gmValue = readGM(GM_KEYS.success, null);
    if (isFreshSuccessSignal(gmValue)) return gmValue;

    const localValue = readLocalJson(GM_KEYS.success);
    if (isFreshSuccessSignal(localValue)) return localValue;

    return null;
  }

  function readReadySignal() {
    const ready = readGM(GM_KEYS.finalReady, null);
    return isPlainObject(ready) ? ready : null;
  }

  function readMirroredPayloadMeta() {
    const payload = readGM(GM_KEYS.finalPayload, null);
    const ready = readGM(GM_KEYS.finalReady, null);
    const azId = norm(payload?.azId || ready?.azId || '');
    const savedAt = norm(payload?.savedAt || ready?.savedAt || '');
    const signalPostedAt = norm(payload?.signalPostedAt || ready?.signalPostedAt || '');
    if (!azId) return null;
    return {
      azId,
      savedAt,
      signalPostedAt,
      ready: ready?.ready === true
    };
  }

  function pickPreferredPayload(localValue, gmValue, getId, getSavedMs) {
    const localOk = isPlainObject(localValue) && norm(getId(localValue));
    const gmOk = isPlainObject(gmValue) && norm(getId(gmValue));
    if (localOk && !gmOk) return localValue;
    if (!localOk && gmOk) return gmValue;
    if (!localOk && !gmOk) return null;

    const localMs = Number(getSavedMs(localValue) || 0);
    const gmMs = Number(getSavedMs(gmValue) || 0);
    if (localMs && gmMs && localMs !== gmMs) return localMs > gmMs ? localValue : gmValue;
    return localValue;
  }

  function readPreferredMirroredFinalPayload() {
    const localPayload = readLocalJson(GM_KEYS.finalPayload);
    const gmPayload = readGM(GM_KEYS.finalPayload, null);
    return pickPreferredPayload(
      localPayload,
      gmPayload,
      (value) => norm(value?.azId || ''),
      (value) => {
        const candidates = [value?.savedAt, value?.signalPostedAt];
        let best = 0;
        for (const candidate of candidates) {
          const ms = Date.parse(norm(candidate || ''));
          if (Number.isFinite(ms) && ms > best) best = ms;
        }
        return best;
      }
    );
  }

  function readPreferredMirroredProductPayload(key) {
    const localPayload = readLocalJson(key);
    const gmPayload = readGM(key, null);
    return pickPreferredPayload(
      localPayload,
      gmPayload,
      (value) => extractProductAzId(value),
      (value) => getProductSavedMs(value)
    );
  }

  function readDownloadableMirrorSnapshot() {
    const finalPayload = readPreferredMirroredFinalPayload();
    const finalReady = readGM(GM_KEYS.finalReady, null);
    const homePayload = readPreferredMirroredProductPayload(GM_KEYS.homePayload);
    const autoPayload = readPreferredMirroredProductPayload(GM_KEYS.autoPayload);

    const azId = norm(
      finalPayload?.azId
      || finalReady?.azId
      || extractProductAzId(homePayload)
      || extractProductAzId(autoPayload)
      || ''
    );

    if (!azId && !isPlainObject(finalPayload) && !isPlainObject(homePayload) && !isPlainObject(autoPayload)) {
      return null;
    }

    return {
      exportedAt: nowIso(),
      host: location.hostname,
      origin: location.origin,
      sourceScript: SCRIPT_NAME,
      sourceVersion: VERSION,
      azId,
      finalPayload: isPlainObject(finalPayload) ? deepClone(finalPayload) : {},
      finalReady: isPlainObject(finalReady) ? deepClone(finalReady) : {},
      homePayload: isPlainObject(homePayload) ? deepClone(homePayload) : {},
      autoPayload: isPlainObject(autoPayload) ? deepClone(autoPayload) : {}
    };
  }

  function buildDownloadFilename(snapshot) {
    const azId = norm(snapshot?.azId || 'unknown');
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')
      .replace('T', '_');
    return `gwpc-payload-mirror_${azId}_${stamp}.json`;
  }

  function downloadMirrorSnapshot() {
    const snapshot = readDownloadableMirrorSnapshot();
    if (!snapshot) {
      log('Download skipped: no mirrored payload available yet');
      setStatus('No mirrored payload to download');
      return;
    }

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildDownloadFilename(snapshot);
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    log(`Mirror downloaded for AZ ${snapshot.azId || '(unknown)'}`);
    setStatus('Mirror downloaded');
  }

  function readCloseSignal() {
    const value = readGM(GM_KEYS.closeSignal, null);
    return isPlainObject(value) ? value : null;
  }

  function isFreshCloseSignal(signal) {
    if (!isPlainObject(signal)) return false;
    const azId = norm(signal.azId || '');
    const postedAt = norm(signal.postedAt || '');
    if (!azId || !postedAt) return false;
    const postedMs = Date.parse(postedAt);
    if (!Number.isFinite(postedMs)) return false;
    return (Date.now() - postedMs) <= CFG.maxSignalAgeMs;
  }

  function readyMatchesSignal(signal) {
    const ready = readReadySignal();
    if (!ready || ready.ready !== true) return false;
    return buildSignalKey(ready) === buildSignalKey(signal);
  }

  function unwrapProductPayload(raw) {
    if (!isPlainObject(raw)) return {};
    return isPlainObject(raw.data) ? raw.data : raw;
  }

  function extractProductAzId(raw) {
    const data = unwrapProductPayload(raw);
    return norm(
      raw?.['AZ ID']
      || data?.['AZ ID']
      || raw?.currentJob?.['AZ ID']
      || data?.currentJob?.['AZ ID']
      || ''
    );
  }

  function getProductSavedMs(raw) {
    const data = unwrapProductPayload(raw);
    const candidates = [
      raw?.savedAt,
      data?.savedAt,
      raw?.meta?.updatedAt,
      data?.meta?.updatedAt,
      raw?.currentJob?.updatedAt,
      data?.currentJob?.updatedAt
    ];
    let best = 0;
    for (const value of candidates) {
      const ms = Date.parse(norm(value || ''));
      if (Number.isFinite(ms) && ms > best) best = ms;
    }
    return best;
  }

  function getProductRow(raw) {
    const data = unwrapProductPayload(raw);
    if (isPlainObject(raw?.row)) return raw.row;
    if (isPlainObject(data?.row)) return data.row;
    return {};
  }

  function scoreProductPayload(product, raw) {
    if (!isPlainObject(raw)) return -1;
    const data = unwrapProductPayload(raw);
    const row = getProductRow(raw);
    let score = 0;

    if (raw.ready === true || data.ready === true) score += 20;
    if (norm(raw?.currentJob?.SubmissionNumber || data?.currentJob?.SubmissionNumber || '')) score += 4;

    if (product === 'home') {
      score += countFilledKeys(row, [
        'CFP?',
        'Reconstruction Cost',
        'Year Built',
        'Square FT',
        '# of Story',
        'Water Device?',
        'Standard Pricing No Auto Discount',
        'Enhance Pricing No Auto Discount',
        'Standard Pricing Auto Discount',
        'Enhance Pricing Auto Discount',
        'Submission Number',
        'Done?'
      ]) * 3;
    } else {
      score += countFilledKeys(row, [
        'Auto',
        'Submission Number (Auto)',
        'Total Policy Premium',
        'PrimaryInsuredName',
        'PA_All_Coverages'
      ]) * 4;
      if (Array.isArray(raw?.drivers) && raw.drivers.length) score += 4;
      if (Array.isArray(raw?.vehicles) && raw.vehicles.length) score += 4;
      if (Array.isArray(data?.drivers) && data.drivers.length) score += 4;
      if (Array.isArray(data?.vehicles) && data.vehicles.length) score += 4;
    }

    return score;
  }

  function shouldReplaceProductPayload(product, existing, next) {
    if (!isPlainObject(next) || !extractProductAzId(next)) return false;
    if (!isPlainObject(existing) || !extractProductAzId(existing)) return true;

    const existingMs = getProductSavedMs(existing);
    const nextMs = getProductSavedMs(next);
    if (existingMs && nextMs && existingMs !== nextMs) return nextMs > existingMs;
    if (!existingMs && nextMs) return true;

    const existingScore = scoreProductPayload(product, existing);
    const nextScore = scoreProductPayload(product, next);
    if (existingScore !== nextScore) return nextScore > existingScore;

    const existingKey = `${extractProductAzId(existing)}|${existingMs}|${existingScore}`;
    const nextKey = `${extractProductAzId(next)}|${nextMs}|${nextScore}`;
    return existingKey !== nextKey;
  }

  function syncMirroredProductPayload(product, key) {
    if (!isGwpcHost()) return false;
    const localPayload = readLocalJson(key);
    if (!isPlainObject(localPayload) || !extractProductAzId(localPayload)) return false;

    const existing = readGM(key, null);
    if (!shouldReplaceProductPayload(product, existing, localPayload)) return false;

    writeGM(key, localPayload);
    log(`${product === 'home' ? 'Home' : 'Auto'} payload mirrored for AZ ${extractProductAzId(localPayload)}`);
    return true;
  }

  function countFilledKeys(value, keys) {
    if (!isPlainObject(value)) return 0;
    let count = 0;
    for (const key of keys) {
      if (norm(value[key] || '')) count += 1;
    }
    return count;
  }

  function scoreMirroredPayload(payload) {
    if (!isPlainObject(payload)) return -1;
    const bundle = isPlainObject(payload.bundle) ? payload.bundle : {};
    const homePayload = isPlainObject(payload.homePayload) ? payload.homePayload : {};
    const autoPayload = isPlainObject(payload.autoPayload) ? payload.autoPayload : {};
    const homeData = isPlainObject(bundle.home?.data) ? bundle.home.data : homePayload;
    const autoData = isPlainObject(bundle.auto?.data) ? bundle.auto.data : autoPayload;
    const homeRow = isPlainObject(homeData?.row) ? homeData.row : {};
    const autoRow = isPlainObject(autoData?.row) ? autoData.row : {};
    const scoreKeysHome = [
      'CFP?',
      'Reconstruction Cost',
      'Year Built',
      'Square FT',
      '# of Story',
      'Water Device?',
      'Standard Pricing No Auto Discount',
      'Enhance Pricing No Auto Discount',
      'Standard Pricing Auto Discount',
      'Enhance Pricing Auto Discount',
      'Submission Number',
      'Done?'
    ];
    const scoreKeysAuto = [
      'Auto',
      'Submission Number (Auto)',
      'Total Policy Premium',
      'PrimaryInsuredName',
      'PA_All_Coverages'
    ];

    let score = 0;
    if (norm(payload.currentJob?.['SubmissionNumber'] || '')) score += 5;
    if (bundle.home?.ready === true || homePayload.ready === true) score += 20;
    if (bundle.auto?.ready === true || autoPayload.ready === true) score += 20;
    score += countFilledKeys(homeRow, scoreKeysHome) * 3;
    score += countFilledKeys(autoRow, scoreKeysAuto) * 4;
    if (Array.isArray(autoPayload.drivers) && autoPayload.drivers.length) score += 4;
    if (Array.isArray(autoPayload.vehicles) && autoPayload.vehicles.length) score += 4;
    if (Array.isArray(bundle.timeout?.events) && bundle.timeout.events.length) score += 2;
    return score;
  }

  function collectGwpcPayloads(signal) {
    const rawKeysFound = [];
    const currentJob = readLocalKey('tm_pc_current_job_v1', rawKeysFound) || {};
    const bundle = readLocalKey('tm_pc_webhook_bundle_v1', rawKeysFound) || {};
    const homePayload = readLocalKey('tm_pc_home_quote_grab_payload_v1', rawKeysFound) || {};
    const autoPayload = readLocalKey('tm_pc_auto_quote_grab_payload_v1', rawKeysFound) || {};
    const timeoutRuntime = readLocalKey('tm_pc_header_timeout_runtime_v2', rawKeysFound);
    const timeoutSentEvents = readLocalKey('tm_pc_header_timeout_sent_events_v2', rawKeysFound);

    const timeoutPayload = {};
    if (isPlainObject(bundle?.timeout) || Array.isArray(bundle?.timeout?.events)) {
      timeoutPayload.bundleTimeout = deepClone(bundle.timeout);
    }
    if (isPlainObject(timeoutRuntime)) {
      timeoutPayload.runtime = timeoutRuntime;
    }
    if (isPlainObject(timeoutSentEvents)) {
      timeoutPayload.sentEvents = timeoutSentEvents;
    }

    return {
      azId: norm(signal?.azId || currentJob?.['AZ ID'] || bundle?.['AZ ID'] || homePayload?.['AZ ID'] || autoPayload?.['AZ ID'] || ''),
      savedAt: nowIso(),
      signalPostedAt: norm(signal?.postedAt || ''),
      signalKey: buildSignalKey(signal),
      source: 'GWPC',
      currentJob: isPlainObject(currentJob) ? currentJob : {},
      bundle: isPlainObject(bundle) ? bundle : {},
      homePayload: isPlainObject(homePayload) ? homePayload : {},
      autoPayload: isPlainObject(autoPayload) ? autoPayload : {},
      timeoutPayload: Object.keys(timeoutPayload).length ? timeoutPayload : {},
      rawKeysFound
    };
  }

  function readLocalKey(key, foundKeys) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      foundKeys.push(key);
      return readJson(raw, null);
    } catch {
      return null;
    }
  }

  function mirrorPayloadFromGwpc(signal) {
    if (!isGwpcHost()) return false;

    const payload = collectGwpcPayloads(signal);
    if (!payload.azId) {
      log('Mirror skipped: AZ ID not found in GWPC payload keys');
      return false;
    }

    const existing = readGM(GM_KEYS.finalPayload, null);
    const existingKey = norm(existing?.signalKey || '');
    const nextKey = norm(payload.signalKey || '');
    if (isPlainObject(existing) && norm(existing.azId || '') === payload.azId) {
      const existingSignalMs = Date.parse(norm(existing.signalPostedAt || ''));
      const nextSignalMs = Date.parse(norm(payload.signalPostedAt || ''));
      if (existingKey && nextKey && existingKey === nextKey) {
        const existingScore = scoreMirroredPayload(existing);
        const nextScore = scoreMirroredPayload(payload);
        if (nextScore < existingScore) {
          log(`Mirror skipped: existing payload score ${existingScore} is better than ${nextScore}`);
          state.mirrored = true;
          return false;
        }
      } else if (Number.isFinite(existingSignalMs) && Number.isFinite(nextSignalMs) && existingSignalMs > nextSignalMs) {
        log('Mirror skipped: existing payload is from a newer webhook success');
        state.mirrored = true;
        return false;
      }
    }

    writeGM(GM_KEYS.finalPayload, payload);
    writeGM(GM_KEYS.finalReady, {
      ready: true,
      azId: payload.azId,
      savedAt: payload.savedAt,
      signalPostedAt: payload.signalPostedAt,
      signalKey: payload.signalKey
    });

    state.mirrored = true;
    log(`Final payload mirrored for AZ ${payload.azId}`);
    return true;
  }

  function syncMirroredProductPayloadsFromGwpc() {
    if (!isGwpcHost()) return false;
    const homeChanged = syncMirroredProductPayload('home', GM_KEYS.homePayload);
    const autoChanged = syncMirroredProductPayload('auto', GM_KEYS.autoPayload);
    return homeChanged || autoChanged;
  }

  function bridgePayloadToAzLocal() {
    if (!isAzHost()) return false;
    const payload = readGM(GM_KEYS.finalPayload, null);
    const ready = readGM(GM_KEYS.finalReady, null);
    if (!isPlainObject(payload)) return false;
    try { localStorage.setItem(GM_KEYS.finalPayload, JSON.stringify(payload, null, 2)); } catch {}
    if (isPlainObject(ready)) {
      try { localStorage.setItem(GM_KEYS.finalReady, JSON.stringify(ready, null, 2)); } catch {}
    }
    state.mirrored = true;
    return true;
  }

  function bridgeProductPayloadsToAzLocal() {
    if (!isAzHost()) return false;
    let bridged = false;
    for (const key of [GM_KEYS.homePayload, GM_KEYS.autoPayload]) {
      const payload = readGM(key, null);
      if (!isPlainObject(payload) || !extractProductAzId(payload)) continue;
      try {
        localStorage.setItem(key, JSON.stringify(payload, null, 2));
        bridged = true;
      } catch {}
    }
    return bridged;
  }

  function scheduleImmediateCheck(reason) {
    try { tick(reason); } catch {}
  }

  function shouldIgnoreSignal(signalKey) {
    return !!signalKey && readSession(SS_KEYS.handledSignal) === signalKey;
  }

  function markSignalHandled(signalKey) {
    writeSession(SS_KEYS.handledSignal, signalKey);
  }

  function startCountdown(signal) {
    if (!signal || !buildSignalKey(signal)) return;
    if (state.countdownEndsAt) return;

    state.countdownEndsAt = Date.now() + CFG.closeDelayMs;
    state.closeAttempted = false;
    state.closeAttempts = 0;
    state.mirrored = readyMatchesSignal(signal);
    markSignalHandled(buildSignalKey(signal));
    log(`Close countdown started for AZ ${signal.azId}`);
    setStatus('Closing non-AZ tab soon');
  }

  function publishCloseSignal(signal) {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || state.closeSignalKey === signalKey) return;
    state.closeSignalKey = signalKey;
    writeGM(GM_KEYS.closeSignal, {
      azId: norm(signal.azId || ''),
      postedAt: norm(signal.postedAt || ''),
      closeAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    log(`Close signal published for AZ ${signal.azId}`);
  }

  function closeSignalMatches(signal) {
    const closeSignal = readCloseSignal();
    if (!closeSignal) return false;
    return buildSignalKey(closeSignal) === buildSignalKey(signal);
  }

  function tryCloseCurrentTab() {
    const wasClosed = !!window.closed;
    try { window.close(); } catch {}
    if (window.closed || wasClosed) return;

    try { window.open(location.href, '_self'); } catch {}
    try { window.close(); } catch {}
    if (window.closed) return;

    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}
    if (window.closed) return;

    try { window.top?.close?.(); } catch {}
    if (window.closed) return;

    setTimeout(() => {
      if (window.closed) return;
      try { location.replace('about:blank'); } catch {}
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 100);
    }, 350);
  }

  function attemptClose() {
    if (!state.activeSignal && !isFreshCloseSignal(readCloseSignal())) return;
    state.closeAttempted = true;
    writeSession(SS_KEYS.closeAttempted, '1');

    state.closeAttempts += 1;
    log(`Attempting to close current non-AZ tab (${state.closeAttempts}/${CFG.maxCloseAttempts})`);
    setStatus(`Attempting to close tab (${state.closeAttempts})`);
    tryCloseCurrentTab();

    setTimeout(() => {
      if (state.destroyed || window.closed) return;
      if (state.closeAttempts < CFG.maxCloseAttempts) {
        attemptClose();
        return;
      }
      log('Close blocked by browser after repeated attempts');
      setStatus('Close blocked');
    }, CFG.closeRetryMs);
  }

  function activateForSignal(signal, reason = '') {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || shouldIgnoreSignal(signalKey)) return;

    if (state.activeSignalKey !== signalKey) {
      state.activeSignal = signal;
      state.activeSignalKey = signalKey;
      state.countdownEndsAt = 0;
      state.mirrored = false;
      state.closeAttempted = false;
      state.closeAttempts = 0;
      log(`Webhook success detected for AZ ${signal.azId}${reason ? ` | ${reason}` : ''}`);
    }

    if (isGwpcHost() && !readyMatchesSignal(signal)) {
      mirrorPayloadFromGwpc(signal);
    }
    if (isAzHost()) {
      bridgePayloadToAzLocal();
    }

    if (readyMatchesSignal(signal)) {
      startCountdown(signal);
    } else {
      setStatus('Waiting for mirrored payload');
    }
  }

  function tick(reason = 'tick') {
    if (state.destroyed) return;
    if (!state.running) {
      setStatus('Stopped');
      renderAll();
      return;
    }

    if (isGwpcHost()) syncMirroredProductPayloadsFromGwpc();

    const signal = readSuccessSignal();
    const closeSignal = readCloseSignal();
    const mirroredMeta = readMirroredPayloadMeta();
    if (isAzHost()) {
      const bridged = bridgePayloadToAzLocal();
      bridgeProductPayloadsToAzLocal();
      if (mirroredMeta?.azId && (!state.activeSignal || !norm(state.activeSignal.azId))) {
        state.activeSignal = {
          azId: mirroredMeta.azId,
          postedAt: mirroredMeta.savedAt || ''
        };
      }
      if ((bridged || mirroredMeta?.azId) && !signal) {
        setStatus('Mirrored payload available in AZ');
        state.mirrored = true;
      }
    }
    if (signal) {
      activateForSignal(signal, reason);
    }

    if (state.countdownEndsAt) {
      if (Date.now() >= state.countdownEndsAt) {
        publishCloseSignal(state.activeSignal || signal);
        if (closeSignalMatches(state.activeSignal || signal)) {
          attemptClose();
        }
      }
    } else if (!isAzHost() && isFreshCloseSignal(closeSignal) && !state.closeAttempted) {
      const signalKey = buildSignalKey(closeSignal);
      if (signalKey && state.activeSignalKey !== signalKey) {
        state.activeSignal = {
          azId: norm(closeSignal.azId || ''),
          postedAt: norm(closeSignal.postedAt || '')
        };
        state.activeSignalKey = signalKey;
      }
      log('Shared close signal received');
      attemptClose();
    } else if (!signal && isAzHost() && mirroredMeta?.azId) {
      setStatus('Mirrored payload available in AZ');
    } else if (!signal) {
      setStatus('Watching for webhook success');
    } else if (closeSignalMatches(state.activeSignal || signal) && !state.closeAttempted) {
      log('Shared close signal received');
      attemptClose();
    }

    renderAll();
  }

  function renderAll() {
    const mirroredMeta = readMirroredPayloadMeta();
    if (state.ui.azId) state.ui.azId.textContent = norm(state.activeSignal?.azId || mirroredMeta?.azId || '-') || '-';
    if (state.ui.mirrored) state.ui.mirrored.textContent = state.mirrored || readyMatchesSignal(state.activeSignal) ? 'Yes' : 'No';

    if (state.ui.countdown) {
      if (state.countdownEndsAt) {
        const remaining = Math.max(0, state.countdownEndsAt - Date.now());
        state.ui.countdown.textContent = `${(remaining / 1000).toFixed(1)}s`;
      } else {
        state.ui.countdown.textContent = '-';
      }
    }

    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }

    if (state.ui.download) {
      const canDownload = !!readDownloadableMirrorSnapshot();
      state.ui.download.disabled = !canDownload;
      state.ui.download.style.opacity = canDownload ? '1' : '.55';
      state.ui.download.style.cursor = canDownload ? 'pointer' : 'not-allowed';
    }

    renderLogs();
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.value = state.logs.join('\n');
    state.ui.logs.scrollTop = 0;
  }

  function buildUi() {
    const panel = document.createElement('div');
    panel.id = 'tm-payload-mirror-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '14px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div id="tm-payload-mirror-head" style="padding:10px 12px;background:linear-gradient(90deg,#111827,#1f2937);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div>
          <div style="font-weight:800;">${SCRIPT_NAME}</div>
          <div style="font-size:11px;opacity:.72;">Webhook mirror + non-AZ tab closer</div>
        </div>
        <div style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div style="padding:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button id="tm-payload-mirror-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button id="tm-payload-mirror-download" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#1d4ed8;color:#fff;font-weight:800;cursor:pointer;">DOWNLOAD MIRROR</button>
        </div>
        <div id="tm-payload-mirror-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching for webhook success</div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div style="opacity:.72;">AZ ID</div><div id="tm-payload-mirror-azid">-</div>
          <div style="opacity:.72;">Payload mirrored</div><div id="tm-payload-mirror-mirrored">No</div>
          <div style="opacity:.72;">Close countdown</div><div id="tm-payload-mirror-countdown">-</div>
        </div>
        <textarea id="tm-payload-mirror-logs" readonly style="width:100%;min-height:140px;max-height:190px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-payload-mirror-head');
    state.ui.toggle = panel.querySelector('#tm-payload-mirror-toggle');
    state.ui.download = panel.querySelector('#tm-payload-mirror-download');
    state.ui.status = panel.querySelector('#tm-payload-mirror-status');
    state.ui.azId = panel.querySelector('#tm-payload-mirror-azid');
    state.ui.mirrored = panel.querySelector('#tm-payload-mirror-mirrored');
    state.ui.countdown = panel.querySelector('#tm-payload-mirror-countdown');
    state.ui.logs = panel.querySelector('#tm-payload-mirror-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);
      if (!state.running) {
        state.countdownEndsAt = 0;
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        setStatus('Watching for webhook success');
        log('Monitoring started');
        tick('manual-start');
      }
      renderAll();
    });

    state.ui.download?.addEventListener('click', () => {
      downloadMirrorSnapshot();
      renderAll();
    });
  }

  function persistPanelPos() {
    if (!state.panel) return;
    try {
      localStorage.setItem(LS_KEYS.panelPos, JSON.stringify({
        left: state.panel.style.left || '',
        top: state.panel.style.top || '',
        right: state.panel.style.right || '',
        bottom: state.panel.style.bottom || ''
      }));
    } catch {}
  }

  function restorePanelPos() {
    try {
      const saved = readJson(localStorage.getItem(LS_KEYS.panelPos), null);
      if (!isPlainObject(saved) || !state.panel) return;
      if (saved.left) state.panel.style.left = saved.left;
      if (saved.top) state.panel.style.top = saved.top;
      if (saved.right) state.panel.style.right = saved.right;
      if (saved.bottom) state.panel.style.bottom = saved.bottom;
      keepPanelInView();
    } catch {}
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    const margin = 8;

    if (rect.right > window.innerWidth - margin) left -= (rect.right - (window.innerWidth - margin));
    if (rect.bottom > window.innerHeight - margin) top -= (rect.bottom - (window.innerHeight - margin));
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
      };
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(8, event.clientX - drag.dx)}px`;
      panel.style.top = `${Math.max(8, event.clientY - drag.dy)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }, true);

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      keepPanelInView();
    }, true);
  }
})();
