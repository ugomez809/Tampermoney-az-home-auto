// ==UserScript==
// @name         11 AUTO GWPC Payload Mirror + Non-AZ Tab Closer
// @namespace    autoflow.payload-mirror-non-az-tab-closer
// @version      1.0.19.2
// @description  After webhook success, mirrors the final GWPC payload into shared GM storage, waits 5 seconds, then best-effort closes non-AZ tabs from the shared close signal while ensuring LEX consumes each close signal only once and leaving AgencyZoom available with mirrored payload state on AZ.
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
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/payload-mirror-non-az-tab-closer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/payload-mirror-non-az-tab-closer.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = '11 AUTO GWPC Payload Mirror + Non-AZ Tab Closer';
  const VERSION = '1.0.19.2';
  const LEGACY_TIMEOUT_SCRIPT_NAME = 'GWPC Header Timeout Monitor';

  const LOG_PERSIST_KEY = (() => {
    const host = String(location.host || '');
    if (host.includes('agencyzoom.com')) return 'tm_az_payload_mirror_logs_v1';
    if (host.includes('lightning.force.com')) return 'tm_apex_payload_mirror_logs_v1';
    return 'tm_pc_payload_mirror_logs_v1';
  })();
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';

  const GM_KEYS = {
    success: 'tm_pc_webhook_post_success_v1',
    finalPayload: 'tm_az_gwpc_final_payload_v1',
    finalReady: 'tm_az_gwpc_final_payload_ready_v1',
    closeSignal: 'tm_pc_payload_mirror_close_signal_v1',
    lexCloseConsumed: 'tm_pc_payload_mirror_lex_close_consumed_signal_v1',
    ignoreCloseLease: 'tm_pc_payload_mirror_ignore_close_lease_v1',
    webhookFatalHold: 'tm_pc_webhook_fatal_error_hold_v1',
    tabHeartbeats: 'tm_payload_mirror_tab_heartbeats_v1',
    homePayload: 'tm_pc_auto_quote_grab_payload_v1',
    azCurrentJob: 'tm_az_current_job_v1',
    currentJob: 'tm_pc_current_job_v1',
    sharedJob: 'tm_shared_az_job_v1'
  };

  const LS_KEYS = {
    running: 'tm_pc_payload_mirror_running_v1',
    apexWakeEnabled: 'tm_payload_mirror_apex_wake_enabled_v1',
    panelPos: 'tm_pc_payload_mirror_panel_pos_v1'
  };

  const SS_KEYS = {
    handledSignal: 'tm_pc_payload_mirror_last_handled_signal_v1',
    closeAttempted: 'tm_pc_payload_mirror_close_attempted_v1'
  };

  const GWPC_KEYS = [
    'tm_pc_webhook_bundle_v1',
    'tm_pc_current_job_v1',
    'tm_pc_auto_quote_grab_payload_v1',
    'tm_pc_header_timeout_runtime_v2',
    'tm_pc_header_timeout_sent_events_v2'
  ];

  const CFG = {
    tickMs: 400,
    maxSignalAgeMs: 90000,
    closeSignalMaxAgeMs: 20000,
    closeDelayMs: 5000,
    samePageCloseMs: 5 * 60 * 1000,
    tabHeartbeatMs: 5000,
    apexWakeMissingMs: 2 * 60 * 1000,
    apexWakeOpenMs: 20000,
    apexWakeCooldownMs: 60000,
    apexWakeMaxWithoutOpenMs: 10 * 60 * 1000,
    apexWakeUrls: [
      'https://farmersagent.lightning.force.com/',
      'https://farmersagent.lightning.force.com/lightning/page/home'
    ],
    ignoreCloseLeaseTtlMs: 8000,
    ignoreCloseLeaseHeartbeatMs: 1500,
    maxLogLines: 70,
    zIndex: 2147483647,
    panelWidth: 330,
    closeRetryMs: 1200,
    maxCloseAttempts: 6
  };

  const state = {
    destroyed: false,
    tabStartedAt: Date.now(),
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
    closeRetryTimer: null,
    closeSignalKey: '',
    logsIntervalTimer: null,
    tabId: `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    apexWakeEnabled: loadApexWakeEnabled(),
    apexWakeMonitorStartedAt: Date.now(),
    apexWakeTab: null,
    apexWakeCloseAt: 0,
    apexWakeStatus: '',
    lastTabHeartbeatAt: 0,
    lastApexWakeLogKey: '',
    lastIgnoreCloseLeaseHeartbeatAt: 0,
    lastIgnoreCloseSignalKey: '',
    lastWebhookFatalHoldLogKey: '',
    samePageSignature: '',
    samePageSinceAt: 0,
    samePageCloseAttempted: false,
    samePageLoggedArmed: false
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    renderAll();

    log(`Loaded v${VERSION}`);
    log(`Host: ${location.hostname}`);
    writeTabHeartbeat(true);
    if (isAzHost()) log(`APEX wake monitor ${state.apexWakeEnabled ? 'ON' : 'OFF'}`);
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

      try {
        GM_addValueChangeListener(GM_KEYS.ignoreCloseLease, () => {
          scheduleImmediateCheck('gm-ignore-close');
        });
      } catch {}
    }

    state.tickTimer = setInterval(() => tick(), CFG.tickMs);
    state.logsIntervalTimer = setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('beforeunload', handlePageUnload, true);
    window.addEventListener('pagehide', handlePageUnload, true);
    window.addEventListener('resize', keepPanelInView, true);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();

    tick();
    window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    clearPendingCloseRetry();
    try { clearIgnoreCloseLeaseIfOwned(); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('beforeunload', handlePageUnload, true); } catch {}
    try { window.removeEventListener('pagehide', handlePageUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__; } catch {}
  }

  function loadRunning() {
    try { localStorage.removeItem(LS_KEYS.running); } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.removeItem(LS_KEYS.running);
      else localStorage.setItem(LS_KEYS.running, '0');
    } catch {}
  }

  function clearPendingCloseRetry() {
    if (!state.closeRetryTimer) return;
    try { clearTimeout(state.closeRetryTimer); } catch {}
    state.closeRetryTimer = null;
  }

  function loadApexWakeEnabled() {
    try { return localStorage.getItem(LS_KEYS.apexWakeEnabled) !== '0'; }
    catch { return true; }
  }

  function saveApexWakeEnabled(on) {
    try { localStorage.setItem(LS_KEYS.apexWakeEnabled, on ? '1' : '0'); } catch {}
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

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();
    persistLogsThrottled();
    console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function persistLogsThrottled() {
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: nowIso(),
      lines: state.logs
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function logsTick() {
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    let req = null;
    try { req = JSON.parse(event.newValue || 'null'); } catch {}
    const at = norm(req?.requestedAt || '');
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logs = [];
    renderLogs();
  }

  function readGM(key, fallback = null) {
    try { return GM_getValue(key, fallback); }
    catch { return fallback; }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
  }

  function readLocalJson(key, fallback = null) {
    try { return readJson(localStorage.getItem(key), fallback); }
    catch { return fallback; }
  }

  function writeLocalJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value, null, 2)); } catch {}
  }

  function readSession(key, fallback = '') {
    try { return sessionStorage.getItem(key) ?? fallback; }
    catch { return fallback; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, String(value)); } catch {}
  }

  function setStatus(text) {
    if (state.ui.status) state.ui.status.textContent = text;
  }

  function parseTimeMs(value) {
    const ms = Date.parse(norm(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function buildSignalKey(signal) {
    if (!isPlainObject(signal)) return '';
    const azId = norm(signal.azId || '');
    const postedAt = norm(signal.postedAt || '');
    return azId && postedAt ? `${azId}|${postedAt}` : '';
  }

  function isFreshSuccessSignal(signal) {
    if (!isPlainObject(signal)) return false;
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

  function readCloseSignal() {
    const value = readGM(GM_KEYS.closeSignal, null);
    return isPlainObject(value) ? value : null;
  }

  function readIgnoreCloseLease() {
    const value = readGM(GM_KEYS.ignoreCloseLease, null);
    return isPlainObject(value) ? value : null;
  }

  function getActiveIgnoreCloseLease() {
    const lease = readIgnoreCloseLease();
    if (!isPlainObject(lease)) return null;
    const ownerTabId = norm(lease.ownerTabId || '');
    const updatedAtMs = parseTimeMs(lease.updatedAt || lease.claimedAt || '');
    if (!ownerTabId || !updatedAtMs) return null;
    if ((Date.now() - updatedAtMs) > CFG.ignoreCloseLeaseTtlMs) return null;
    return lease;
  }

  function isIgnoreCloseLeaseOwnedByThisTab(lease = null) {
    const active = lease || getActiveIgnoreCloseLease();
    return !!active && norm(active.ownerTabId || '') === state.tabId;
  }

  function setIgnoreCloseEnabledForThisPage(on) {
    if (on) {
      writeGM(GM_KEYS.ignoreCloseLease, {
        ownerTabId: state.tabId,
        ownerHost: location.hostname,
        claimedAt: nowIso(),
        updatedAt: nowIso(),
        source: SCRIPT_NAME,
        version: VERSION
      });
      log('Ignore close ON for this page load');
      return;
    }
    const lease = getActiveIgnoreCloseLease();
    if (lease && norm(lease.ownerTabId || '') === state.tabId) {
      writeGM(GM_KEYS.ignoreCloseLease, null);
      log('Ignore close OFF for this page load');
    }
  }

  function shouldIgnoreCloseForActiveLease(signal = null) {
    const lease = getActiveIgnoreCloseLease();
    if (!lease) return false;
    return true;
  }

  function writeTabHeartbeat(force = false) {
    const now = Date.now();
    if (!force && (now - state.lastTabHeartbeatAt) < CFG.tabHeartbeatMs) return;
    state.lastTabHeartbeatAt = now;
    const beats = readGM(GM_KEYS.tabHeartbeats, {});
    const next = isPlainObject(beats) ? deepClone(beats) : {};
    next[state.tabId] = {
      host: location.hostname,
      url: location.href,
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeGM(GM_KEYS.tabHeartbeats, next);
  }

  function handlePageUnload() {
    const beats = readGM(GM_KEYS.tabHeartbeats, {});
    if (!isPlainObject(beats) || !beats[state.tabId]) return;
    const next = deepClone(beats);
    delete next[state.tabId];
    writeGM(GM_KEYS.tabHeartbeats, next);
  }

  function readyMatchesSignal(signal) {
    const ready = readReadySignal();
    if (!isPlainObject(ready) || !isPlainObject(signal)) return false;
    return buildSignalKey(ready) === buildSignalKey(signal);
  }

  function readMirroredPayloadMeta() {
    const payload = readGM(GM_KEYS.finalPayload, null);
    const ready = readGM(GM_KEYS.finalReady, null);
    const azId = norm(payload?.azId || ready?.azId || '');
    const savedAt = norm(payload?.savedAt || ready?.savedAt || '');
    if (!azId) return null;
    return { azId, savedAt };
  }

  function shouldHoldOpenForWebhookFatalError() {
    const hold = readGM(GM_KEYS.webhookFatalHold, null);
    if (!isPlainObject(hold)) return false;
    const raisedAtMs = parseTimeMs(hold.raisedAt || '');
    if (!raisedAtMs) return false;
    return (Date.now() - raisedAtMs) <= 90000;
  }

  function readCurrentAzIdForCloseFallback() {
    const job = readGM(GM_KEYS.currentJob, null) || readGM(GM_KEYS.azCurrentJob, null) || readGM(GM_KEYS.sharedJob, null);
    if (!isPlainObject(job)) return '';
    return norm(job.azId || job.ticketId || job['AZ ID'] || '');
  }

  function syncMirroredProductPayloadsFromGwpc() {
    return false;
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
    return false;
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

  function attemptClose(signal = null) {
    if (state.destroyed || !state.running) return;
    const effectiveSignal = isPlainObject(signal) ? signal : (state.activeSignal || readCloseSignal());
    if (!state.activeSignal && !isFreshCloseSignal(effectiveSignal)) return;
    if (shouldHoldOpenForWebhookFatalError()) return;
    if (shouldIgnoreCloseForActiveLease(effectiveSignal)) return;

    const signalKey = buildSignalKey(effectiveSignal);
    if (isLexHost()) {
      if (!signalKey) return;
      const existing = readGM(GM_KEYS.lexCloseConsumed, null);
      const existingKey = buildSignalKey(existing);
      if (existingKey && existingKey === signalKey && norm(existing.claimedBy || '') !== state.tabId) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(signalKey);
        log('LEX close already consumed for this signal');
        setStatus('LEX close already consumed');
        return;
      }
      writeGM(GM_KEYS.lexCloseConsumed, {
        azId: norm(effectiveSignal.azId || ''),
        postedAt: norm(effectiveSignal.postedAt || ''),
        claimedBy: state.tabId,
        claimedAt: nowIso(),
        source: SCRIPT_NAME,
        version: VERSION
      });
    }

    state.closeAttempted = true;
    state.countdownEndsAt = 0;
    writeSession(SS_KEYS.closeAttempted, '1');
    if (signalKey) markSignalHandled(signalKey);

    state.closeAttempts += 1;

    if (state.closeAttempts === 1) {
      log(`[CLOSE-TAB-DIAG] payload-mirror FIRING close | signalKey=${signalKey || '(none)'} | azId=${norm(effectiveSignal?.azId || '(none)')} | signalPostedAt=${norm(effectiveSignal?.postedAt || '(none)')} | hadCountdown=${Boolean(state.countdownEndsAt)} | host=${location.hostname} | url=${location.href}`);
      _lastLogPersistAt = 0;
      persistLogsThrottled();
    }

    log(`Attempting to close current non-AZ tab (${state.closeAttempts}/${CFG.maxCloseAttempts})`);
    setStatus(`Attempting to close tab (${state.closeAttempts})`);
    tryCloseCurrentTab();

    clearPendingCloseRetry();
    state.closeRetryTimer = setTimeout(() => {
      state.closeRetryTimer = null;
      if (state.destroyed || window.closed || !state.running) return;
      if (state.closeAttempts < CFG.maxCloseAttempts) {
        attemptClose(effectiveSignal);
        return;
      }
      log('Close blocked by browser after repeated attempts');
      setStatus('Close blocked');
      state.countdownEndsAt = 0;
    }, CFG.closeRetryMs);
  }

  function isFreshCloseSignal(signal) {
    if (!isPlainObject(signal)) return false;
    const azId = norm(signal.azId || '');
    const postedAt = norm(signal.postedAt || '');
    if (!azId || !postedAt) return false;
    const postedMs = Date.parse(postedAt);
    if (!Number.isFinite(postedMs)) return false;
    if (postedMs + 1000 < state.tabStartedAt) return false;
    return (Date.now() - postedMs) <= CFG.closeSignalMaxAgeMs;
  }

  function activateForSignal(signal, reason = '') {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || shouldIgnoreSignal(signalKey)) return;

    const signalAzId = norm(signal?.azId || '');
    const sameAzCloseInFlight = !!signalAzId
      && signalAzId === norm(state.activeSignal?.azId || '')
      && (state.countdownEndsAt || state.closeAttempted || !!state.closeRetryTimer);
    if (sameAzCloseInFlight) return;

    if (state.activeSignalKey !== signalKey) {
      clearPendingCloseRetry();
      state.activeSignal = signal;
      state.activeSignalKey = signalKey;
      state.countdownEndsAt = 0;
      state.mirrored = false;
      state.closeAttempted = false;
      state.closeAttempts = 0;
      log(`Webhook success detected for AZ ${signal.azId}${reason ? ` | ${reason}` : ''}`);
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

  function checkGwpcSamePageCloseWatchdog() {
    if (!isGwpcHost() || !state.running) return;
    const header = document.title || '';
    const signature = `${location.pathname}|${header}`;
    if (state.samePageSignature !== signature) {
      state.samePageSignature = signature;
      state.samePageSinceAt = Date.now();
      state.samePageCloseAttempted = false;
      state.samePageLoggedArmed = false;
      return;
    }

    if (state.samePageCloseAttempted) return;
    const ageMs = Date.now() - Number(state.samePageSinceAt || Date.now());
    if (!state.samePageLoggedArmed && ageMs >= 1000) {
      state.samePageLoggedArmed = true;
      log('GWPC same-page close watchdog armed for 5m');
    }
    if (ageMs < CFG.samePageCloseMs) return;

    const signal = {
      ok: true,
      azId: readCurrentAzIdForCloseFallback() || 'unknown',
      postedAt: nowIso(),
      signalKey: `same-page|${state.samePageSinceAt}`,
      source: SCRIPT_NAME,
      version: VERSION,
      reason: 'same-page-watchdog'
    };

    state.samePageCloseAttempted = true;
    state.activeSignal = signal;
    state.activeSignalKey = buildSignalKey(signal);
    log(`GWPC same-page watchdog reached 5m; closing tab | AZ ${signal.azId}`);
    attemptClose(signal);
  }

  function closeOwnedApexWakeTabIfReady() {}
  function refreshIgnoreCloseLeaseHeartbeat() {
    const lease = getActiveIgnoreCloseLease();
    if (!lease || norm(lease.ownerTabId || '') !== state.tabId) return;
    const now = Date.now();
    if ((now - state.lastIgnoreCloseLeaseHeartbeatAt) < CFG.ignoreCloseLeaseHeartbeatMs) return;
    state.lastIgnoreCloseLeaseHeartbeatAt = now;
    writeGM(GM_KEYS.ignoreCloseLease, {
      ...lease,
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
  }
  function checkApexWakeMonitor() {}

  function tick(reason = 'tick') {
    if (state.destroyed) return;
    writeTabHeartbeat();
    closeOwnedApexWakeTabIfReady();
    refreshIgnoreCloseLeaseHeartbeat();
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
      if (!state.closeAttempted && Date.now() >= state.countdownEndsAt) {
        publishCloseSignal(state.activeSignal || signal);
        if (closeSignalMatches(state.activeSignal || signal)) {
          if (shouldIgnoreCloseForActiveLease(state.activeSignal || signal)) {
            renderAll();
            return;
          }
          attemptClose(state.activeSignal || signal);
        }
      }
    } else if (!isAzHost() && isFreshCloseSignal(closeSignal) && !state.closeAttempted) {
      if (shouldIgnoreCloseForActiveLease(closeSignal)) {
        renderAll();
        return;
      }
      const signalKey = buildSignalKey(closeSignal);
      if (signalKey && state.activeSignalKey !== signalKey) {
        state.activeSignal = {
          azId: norm(closeSignal.azId || ''),
          postedAt: norm(closeSignal.postedAt || '')
        };
        state.activeSignalKey = signalKey;
        state.closeAttempted = false;
        state.closeAttempts = 0;
      }
      log('Shared close signal received');
      attemptClose(closeSignal);
    } else if (!signal && isAzHost() && mirroredMeta?.azId) {
      setStatus('Mirrored payload available in AZ');
    } else if (!signal) {
      if (!getActiveIgnoreCloseLease()) state.lastIgnoreCloseSignalKey = '';
      setStatus(getActiveIgnoreCloseLease() ? 'Ignoring shared close until refresh' : 'Watching for webhook success');
    } else if (closeSignalMatches(state.activeSignal || signal) && !state.closeAttempted) {
      if (shouldIgnoreCloseForActiveLease(state.activeSignal || signal)) {
        renderAll();
        return;
      }
      log('Shared close signal received');
      attemptClose(state.activeSignal || signal);
    }

    checkGwpcSamePageCloseWatchdog();
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

    if (state.ui.ignoreClose) {
      const lease = getActiveIgnoreCloseLease();
      const active = !!lease;
      const owned = isIgnoreCloseLeaseOwnedByThisTab(lease);
      state.ui.ignoreClose.textContent = owned ? 'IGNORE CLOSE ON' : (active ? 'IGNORE CLOSE ACTIVE' : 'IGNORE CLOSE OFF');
      state.ui.ignoreClose.style.background = owned ? '#b45309' : (active ? '#7c2d12' : '#475569');
      state.ui.ignoreClose.style.opacity = active && !owned ? '.92' : '1';
    }

    if (state.ui.apexWake) {
      state.ui.apexWake.textContent = state.apexWakeEnabled ? 'APEX WAKE ON' : 'APEX WAKE OFF';
      state.ui.apexWake.style.background = state.apexWakeEnabled ? '#0f766e' : '#475569';
      state.ui.apexWake.disabled = !isAzHost();
      state.ui.apexWake.style.opacity = isAzHost() ? '1' : '.55';
      state.ui.apexWake.style.cursor = isAzHost() ? 'pointer' : 'not-allowed';
    }

    if (state.ui.apexWakeStatus) {
      state.ui.apexWakeStatus.textContent = state.apexWakeStatus || (isAzHost() ? 'Watching' : 'AZ only');
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
          <button id="tm-payload-mirror-ignore-close" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">IGNORE CLOSE OFF</button>
          <button id="tm-payload-mirror-apex-wake" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">APEX WAKE ON</button>
        </div>
        <div id="tm-payload-mirror-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching for webhook success</div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div style="opacity:.72;">AZ ID</div><div id="tm-payload-mirror-azid">-</div>
          <div style="opacity:.72;">Payload mirrored</div><div id="tm-payload-mirror-mirrored">No</div>
          <div style="opacity:.72;">Close countdown</div><div id="tm-payload-mirror-countdown">-</div>
          <div style="opacity:.72;">APEX wake</div><div id="tm-payload-mirror-apex-wake-status">Watching</div>
        </div>
        <textarea id="tm-payload-mirror-logs" readonly style="width:100%;min-height:140px;max-height:190px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-payload-mirror-head');
    state.ui.toggle = panel.querySelector('#tm-payload-mirror-toggle');
    state.ui.ignoreClose = panel.querySelector('#tm-payload-mirror-ignore-close');
    state.ui.apexWake = panel.querySelector('#tm-payload-mirror-apex-wake');
    state.ui.status = panel.querySelector('#tm-payload-mirror-status');
    state.ui.azId = panel.querySelector('#tm-payload-mirror-azid');
    state.ui.mirrored = panel.querySelector('#tm-payload-mirror-mirrored');
    state.ui.countdown = panel.querySelector('#tm-payload-mirror-countdown');
    state.ui.apexWakeStatus = panel.querySelector('#tm-payload-mirror-apex-wake-status');
    state.ui.logs = panel.querySelector('#tm-payload-mirror-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);
      if (!state.running) {
        clearPendingCloseRetry();
        state.countdownEndsAt = 0;
        state.closeAttempted = false;
        state.closeAttempts = 0;
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        setStatus('Watching for webhook success');
        log('Monitoring started');
        tick('manual-start');
      }
      renderAll();
    });

    state.ui.ignoreClose?.addEventListener('click', () => {
      const lease = getActiveIgnoreCloseLease();
      const owned = isIgnoreCloseLeaseOwnedByThisTab(lease);
      setIgnoreCloseEnabledForThisPage(!owned);
      tick('manual-ignore-close');
    });

    state.ui.apexWake?.addEventListener('click', () => {
      if (!isAzHost()) {
        log('APEX wake toggle is only active on AgencyZoom');
        return;
      }
      state.apexWakeEnabled = !state.apexWakeEnabled;
      saveApexWakeEnabled(state.apexWakeEnabled);
      if (!state.apexWakeEnabled) {
        state.apexWakeStatus = 'Off';
        log('APEX wake monitor OFF');
      } else {
        state.apexWakeMonitorStartedAt = Date.now();
        state.apexWakeStatus = 'Watching';
        log('APEX wake monitor ON');
      }
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
