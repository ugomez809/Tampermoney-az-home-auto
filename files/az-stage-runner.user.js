// ==UserScript==
// @name         AgencyZoom Quote Launcher + Payload Grabber
// @namespace    homebot.az-stage-runner
// @version      2.5.5
// @description  Auto-start AZ stage runner. Defaults to Home when needed, always boots through a fresh clear+reload cycle, restores after its own reload token, switches to Ignored tags from the saved-query filter, opens the next ticket, saves Main payload, starts Quotes, pauses in background, waits for the finisher to close the ticket before continuing, and preserves timeout-generated quote data during bootstrap clears.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-stage-runner.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-stage-runner.user.js
// ==/UserScript==

(function () {
  'use strict';

  try { window.__HB_AZ_STAGE_RUNNER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'AgencyZoom Quote Launcher + Payload Grabber';
  const VERSION = '2.5.5';

  const CFG = {
    stageName: 'New Opportunities',
    savedQueryName: 'Ignored tags',

    openTryMs: 4200,
    openTotalMs: 12000,
    openCheckAfterClickMs: 2000,
    closeWaitMs: 5000,
    detailWaitMs: 12000,
    quoteTabWaitMs: 7000,
    pageWaitMs: 1500,
    filterSettleMs: 1500,
    quotePreWaitMs: 5000,
    frontStableMs: 3000,
    waitForHideAfterQuoteMs: 10000,
    ticketClosePollMs: 1200,
    ticketCloseLogEveryMs: 8000,
    nextRunAfterCloseMs: 3000,
    frontIdleReloadMs: 5 * 60 * 1000,
    frontIdlePollMs: 1000,
    gapMs: 220,
    maxLogLines: 18,

    panelRight: 12,
    panelBottom: 12,
    zIndex: 2147483647
  };

  const KEYS = {
    PANEL_POS: 'tm_az_stage_runner_panel_pos_v19',
    MODE: 'tm_az_stage_runner_mode_v19',
    RUNNING: 'tm_az_stage_runner_running_v23',

    LAST_PAYLOAD: 'tm_az_payload_v1',
    PAYLOAD_MAP: 'tm_az_payload_map_v1',
    LAST_SAVED_ID: 'tm_az_last_saved_ticket_id_v1',
    SCAN_STATE: 'tm_az_stage_scan_state_v1',

    SHARED_JOB: 'tm_shared_az_job_v1',
    CURRENT_JOB: 'tm_pc_current_job_v1',
    AZ_CURRENT_JOB: 'tm_az_current_job_v1',
    WORKFLOW_CLEANUP_REQUEST: 'tm_az_workflow_cleanup_request_v1'
  };

  const SS_KEYS = {
    BOOTSTRAP_RELOAD_TOKEN: 'tm_az_stage_runner_bootstrap_reload_token_v1'
  };

  const SEL = {
    stageWrap: '.dd-heading-wrapper',
    stageCards: '.dd-card.referral-container[data-id]',
    customerLink: 'a.customer[rel], a.customer',

    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    initialValues: '#detailDockform input[name="initialValues"]',

    quotesTab: 'a#policyTabTitle[href="#tabQuote"][data-toggle="tab"]',
    quotePane: '#tabQuote',
    autoLink: '#tabQuote > div > div.ml-4 > a:nth-child(1)',
    homeLink: '#tabQuote > div > div.ml-4 > a:nth-child(3)',

    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    dockSideActions: '.az-dock__side-actions',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',

    savedQueryButton: '#currentPipelineFilter .savedQueryDropdown > button.dropdown-toggle',
    savedQueryLabel: '#currentPipelineFilter .savedQueryDropdown .editing_filter_name',
    savedQueryWrap: '#currentPipelineFilter .dropdown.savedQueryDropdown',
    savedQueryItems: '#currentPipelineFilter .saved-query-item, #currentPipelineFilter .dropdown-item.saved-query-item',

    closeCandidates: 'button, a, [role="button"], .close, .btn-close, .az-dock__close'
  };

  const CLEAR_EXACT_KEYS = new Set([
    'tm_az_home_auto_payload_v1',
    'tm_az_stage_runner_payload_v1',
    KEYS.LAST_PAYLOAD,
    KEYS.PAYLOAD_MAP,
    KEYS.LAST_SAVED_ID,
    KEYS.SCAN_STATE,
    KEYS.SHARED_JOB,
    KEYS.CURRENT_JOB,
    KEYS.AZ_CURRENT_JOB,
    'tm_apex_home_bot_payload_v1',
    'tm_apex_home_bot_ready_v1',
    'tm_apex_home_bot_active_row_v1',
    'tm_pc_home_quote_grab_payload_v1',
    'tm_pc_auto_quote_grab_payload_v1',
    'tm_pc_webhook_bundle_v1',
    'tm_pc_webhook_submit_sent_meta_v17',
    'tm_pc_webhook_submit_url_v17',
    'tm_pc_webhook_submit_stopped_v17',
    'tm_pc_webhook_post_success_v1',
    'tm_pc_payload_mirror_close_signal_v1',
    'tm_pc_payload_mirror_last_handled_signal_v1',
    'tm_pc_payload_mirror_close_attempted_v1',
    'tm_az_gwpc_final_payload_v1',
    'tm_az_gwpc_final_payload_ready_v1',
    'tm_pc_header_timeout_runtime_v2',
    'tm_pc_header_timeout_sent_events_v2',
    'tm_pc_flow_stage_v1',
    'tm_az_ticket_finisher_runs_v1',
    KEYS.WORKFLOW_CLEANUP_REQUEST,
    'tm_shared_cache_az_payload_v1',
    'tm_shared_cache_apex_payload_v1',
    'tm_shared_cache_apex_ready_v1',
    'tm_shared_cache_apex_active_row_v1',
    'tm_shared_cache_gwpc_home_quote_payload_v1',
    'tm_shared_cache_gwpc_auto_quote_payload_v1',
    'hb_shared_az_to_gwpc_ticket_handoff_v1',
    'hb_shared_az_to_gwpc_ticket_handoff_last_applied_v1',
    'hb_shared_az_to_gwpc_ticket_handoff_stop_v1'
  ]);

  const CLEAR_PREFIXES = [
    'aqb_',
    'tm_pc_payload_mirror_'
  ];

  const FIELD_ORDER = [
    'AZ ID',
    'AZ Lead Source',
    'AZ Producer',
    'AZ Name',
    'AZ Last',
    'AZ DOB',
    'AZ Phone',
    'AZ Email',
    'AZ Street Address',
    'AZ City',
    'AZ Country',
    'AZ State',
    'AZ Postal Code',
    'First Name',
    'Last Name',
    'Email',
    'Phone',
    'DOB',
    'Street Address',
    'City',
    'State',
    'Zip'
  ];

  const state = {
    running: loadRunning(),
    busy: false,
    destroyed: false,
    mode: loadMode(),
    processedIds: new Set(),
    logs: [],
    ui: {},
    keyHandler: null,
    persistHandler: null,
    visibilityPersistHandler: null,
    bgPauseLogged: false,
    frontIdleInterval: null,
    frontIdleActivityHandler: null,
    frontIdleFocusHandler: null,
    frontIdleBlurHandler: null,
    frontIdleFrontSinceAt: 0,
    frontIdleLastActivityAt: Date.now(),
    frontIdleLastSignature: '',
    frontIdleArmedLogged: false,
    frontIdleReloadPending: false
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    syncUi();
    renderLogs();

    if (!state.mode) {
      state.mode = 'home';
      saveMode(state.mode);
      syncUi();
      log('Default mode set: Home', 'info');
    }

    log(`${SCRIPT_NAME} V${VERSION} loaded`, 'ok');
    log(`Auto start enabled | mode=${state.mode.toUpperCase()}`, 'info');
    log(`Main must return ${FIELD_ORDER.length}/${FIELD_ORDER.length} AZ fields before Quotes`, 'info');
    log(`Auto start clears workflow data, reloads, and resumes automatically with ${CFG.savedQueryName}`, 'info');
    log('Ticket is only done when the finisher closes it', 'info');
    log('ESC stops the run', 'info');

    state.keyHandler = (e) => {
      if (e.key === 'Escape' && state.running) stopRun('ESC stop');
    };
    window.addEventListener('keydown', state.keyHandler, true);

    state.persistHandler = () => {
      persistState();
    };
    window.addEventListener('beforeunload', state.persistHandler, true);
    window.addEventListener('pagehide', state.persistHandler, true);

    state.visibilityPersistHandler = () => {
      if (document.visibilityState === 'hidden') persistState();
    };
    document.addEventListener('visibilitychange', state.visibilityPersistHandler, true);

    setupFrontIdleReloadWatchdog();

    window.__HB_AZ_STAGE_RUNNER_CLEANUP__ = cleanup;

    if (hasBootstrapReloadToken()) {
      clearBootstrapReloadToken();
      state.running = true;
      saveRunning(true);
      setStatus(`RESTORING (${state.mode.toUpperCase()})`);
      log(`Continuing after fresh reload | mode=${state.mode.toUpperCase()}`, 'ok');
      setTimeout(() => {
        if (!state.destroyed && state.running && !state.busy) {
          startRun(true);
        }
      }, 0);
      return;
    }

    state.running = false;
    saveRunning(false);
    syncUi();
    setStatus(`AUTO STARTING (${state.mode.toUpperCase()})`);
    log(`Fresh auto bootstrap | mode=${state.mode.toUpperCase()}`, 'ok');
    setTimeout(() => {
      if (!state.destroyed && !state.running && !state.busy) {
        startRun(false);
      }
    }, 0);
  }

  function cleanup() {
    state.destroyed = true;
    state.busy = false;

    try { window.removeEventListener('keydown', state.keyHandler, true); } catch {}
    try { window.removeEventListener('beforeunload', state.persistHandler, true); } catch {}
    try { window.removeEventListener('pagehide', state.persistHandler, true); } catch {}
    try { document.removeEventListener('visibilitychange', state.visibilityPersistHandler, true); } catch {}
    try { clearInterval(state.frontIdleInterval); } catch {}
    try { document.removeEventListener('click', state.frontIdleActivityHandler, true); } catch {}
    try { document.removeEventListener('keydown', state.frontIdleActivityHandler, true); } catch {}
    try { document.removeEventListener('input', state.frontIdleActivityHandler, true); } catch {}
    try { window.removeEventListener('focus', state.frontIdleFocusHandler, true); } catch {}
    try { window.removeEventListener('blur', state.frontIdleBlurHandler, true); } catch {}

    const panel = document.getElementById('hb-az-stage-runner-panel');
    if (panel) panel.remove();

    try { delete window.__HB_AZ_STAGE_RUNNER_CLEANUP__; } catch {}
  }

  function loadMode() {
    try {
      const v = localStorage.getItem(KEYS.MODE);
      return v === 'auto' || v === 'home' ? v : '';
    } catch {
      return '';
    }
  }

  function saveMode(mode) {
    try { localStorage.setItem(KEYS.MODE, mode || ''); } catch {}
  }

  function loadRunning() {
    try {
      return localStorage.getItem(KEYS.RUNNING) === '1';
    } catch {
      return false;
    }
  }

  function saveRunning(on) {
    try {
      localStorage.setItem(KEYS.RUNNING, on ? '1' : '0');
    } catch {}
  }

  function hasBootstrapReloadToken() {
    try { return !!sessionStorage.getItem(SS_KEYS.BOOTSTRAP_RELOAD_TOKEN); } catch { return false; }
  }

  function setBootstrapReloadToken() {
    try { sessionStorage.setItem(SS_KEYS.BOOTSTRAP_RELOAD_TOKEN, String(Date.now())); } catch {}
  }

  function clearBootstrapReloadToken() {
    try { sessionStorage.removeItem(SS_KEYS.BOOTSTRAP_RELOAD_TOKEN); } catch {}
  }

  function isPipelinePage() {
    return /\/referral\/pipeline(?:$|[?#/])/i.test(`${location.pathname}${location.search}${location.hash}`);
  }

  function markFrontIdleActivity() {
    state.frontIdleLastActivityAt = Date.now();
    state.frontIdleArmedLogged = false;
    state.frontIdleReloadPending = false;
  }

  function getFrontIdleSignature() {
    const info = getOpenTicketInfo();
    return [
      location.pathname,
      location.search,
      location.hash,
      isTicketDrawerOpen() ? 'open' : 'closed',
      norm(info.ticketId || '')
    ].join('|');
  }

  function setupFrontIdleReloadWatchdog() {
    const onTrustedActivity = (event) => {
      if (!event?.isTrusted) return;
      if (!isPipelinePage()) return;
      markFrontIdleActivity();
    };
    state.frontIdleActivityHandler = onTrustedActivity;
    document.addEventListener('click', onTrustedActivity, true);
    document.addEventListener('keydown', onTrustedActivity, true);
    document.addEventListener('input', onTrustedActivity, true);

    state.frontIdleFocusHandler = () => {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
    };
    state.frontIdleBlurHandler = () => {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
    };
    window.addEventListener('focus', state.frontIdleFocusHandler, true);
    window.addEventListener('blur', state.frontIdleBlurHandler, true);

    state.frontIdleLastSignature = getFrontIdleSignature();
    state.frontIdleLastActivityAt = Date.now();
    state.frontIdleInterval = setInterval(runFrontIdleReloadWatchdog, CFG.frontIdlePollMs);
  }

  function runFrontIdleReloadWatchdog() {
    if (state.destroyed) return;

    if (!isPipelinePage()) {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
      state.frontIdleLastSignature = getFrontIdleSignature();
      return;
    }

    const signature = getFrontIdleSignature();
    if (signature !== state.frontIdleLastSignature) {
      state.frontIdleLastSignature = signature;
      markFrontIdleActivity();
    }

    if (!isFrontTab()) {
      state.frontIdleFrontSinceAt = 0;
      state.frontIdleArmedLogged = false;
      state.frontIdleReloadPending = false;
      return;
    }

    if (!state.frontIdleFrontSinceAt) {
      state.frontIdleFrontSinceAt = Date.now();
      state.frontIdleArmedLogged = false;
    }

    const now = Date.now();
    const frontForMs = now - state.frontIdleFrontSinceAt;
    const idleForMs = now - state.frontIdleLastActivityAt;

    if (!state.frontIdleArmedLogged && frontForMs >= 1000) {
      state.frontIdleArmedLogged = true;
      log('Front idle reload armed: 5m unchanged on visible AZ page', 'info');
    }

    if (frontForMs < CFG.frontIdleReloadMs || idleForMs < CFG.frontIdleReloadMs) return;

    if (state.frontIdleReloadPending) return;

    state.frontIdleReloadPending = true;
    log('Front idle timeout reached: reloading AgencyZoom pipeline page', 'warn');
    persistState();
    setTimeout(() => {
      if (!state.destroyed) location.reload();
    }, 120);
  }

  function persistState() {
    saveMode(state.mode || '');
    saveRunning(!!state.running);
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function readStorageJson(storageObj, key, fallback = null) {
    try {
      const raw = storageObj?.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function readGmJson(key, fallback = null) {
    try {
      const raw = GM_getValue(key, null);
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function norm(v) {
    return String(v || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(v) {
    return norm(v).toLowerCase();
  }

  function shouldClearWorkflowKey(key) {
    if (!key) return false;
    if (CLEAR_EXACT_KEYS.has(key)) return true;
    return CLEAR_PREFIXES.some(prefix => key.startsWith(prefix));
  }

  function isTimeoutAutoPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const event = lower(payload.event || '');
    const script = lower(payload.script || '');
    const latestErrorType = lower(payload.latestError?.errorType || '');
    const errorTypes = Array.isArray(payload.errors)
      ? payload.errors.map((entry) => lower(entry?.errorType || ''))
      : [];

    return (
      event === 'gwpc_timeout_gathered' ||
      script.includes('timeout') ||
      latestErrorType === 'headertimeout' ||
      errorTypes.includes('headertimeout')
    );
  }

  function isTimeoutFinalPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (isTimeoutAutoPayload(payload.autoPayload)) return true;
    if (isTimeoutAutoPayload(payload.bundle?.auto?.data)) return true;
    if (payload.bundle?.timeout?.ready === true) return true;
    return !!(payload.timeoutPayload && Object.keys(payload.timeoutPayload).length);
  }

  function getBootstrapPreservedWorkflowKeys() {
    const preserved = new Set();

    const localAutoPayload = readStorageJson(localStorage, 'tm_pc_auto_quote_grab_payload_v1', null);
    const gmAutoPayload = readGmJson('tm_pc_auto_quote_grab_payload_v1', null);
    if (isTimeoutAutoPayload(localAutoPayload) || isTimeoutAutoPayload(gmAutoPayload)) {
      preserved.add('tm_pc_auto_quote_grab_payload_v1');
      preserved.add('tm_pc_header_timeout_runtime_v2');
      preserved.add('tm_pc_header_timeout_sent_events_v2');
    }

    const localFinalPayload = readStorageJson(localStorage, 'tm_az_gwpc_final_payload_v1', null);
    const gmFinalPayload = readGmJson('tm_az_gwpc_final_payload_v1', null);
    if (isTimeoutFinalPayload(localFinalPayload) || isTimeoutFinalPayload(gmFinalPayload)) {
      preserved.add('tm_az_gwpc_final_payload_v1');
      preserved.add('tm_az_gwpc_final_payload_ready_v1');
    }

    return preserved;
  }

  function clearStorageWorkflowKeys(storageObj, preservedKeys = new Set()) {
    if (!storageObj) return 0;
    const keys = [];
    try {
      for (let i = 0; i < storageObj.length; i++) {
        const key = storageObj.key(i);
        if (key && shouldClearWorkflowKey(key) && !preservedKeys.has(key)) keys.push(key);
      }
    } catch {}

    let cleared = 0;
    for (const key of keys) {
      try {
        storageObj.removeItem(key);
        cleared += 1;
      } catch {}
    }
    return cleared;
  }

  function clearTransientWorkflowData() {
    const preservedKeys = getBootstrapPreservedWorkflowKeys();
    let cleared = 0;
    cleared += clearStorageWorkflowKeys(localStorage, preservedKeys);
    cleared += clearStorageWorkflowKeys(sessionStorage, preservedKeys);

    for (const key of CLEAR_EXACT_KEYS) {
      if (preservedKeys.has(key)) continue;
      try {
        GM_deleteValue(key);
        cleared += 1;
      } catch {}
    }

    return {
      cleared,
      preserved: [...preservedKeys]
    };
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isFrontTab() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  async function waitUntilFrontStable(ms = CFG.frontStableMs) {
    let stableSince = 0;

    while (state.running && !state.destroyed) {
      if (isFrontTab()) {
        if (!stableSince) {
          stableSince = Date.now();
          state.bgPauseLogged = false;
        }
        if ((Date.now() - stableSince) >= ms) {
          setStatus(`RUNNING (${state.mode ? state.mode.toUpperCase() : '—'})`);
          return true;
        }
      } else {
        stableSince = 0;
        setStatus('PAUSED BACKGROUND');
        if (!state.bgPauseLogged) {
          log('Paused in background. Waiting to return to front...', 'warn');
          state.bgPauseLogged = true;
        }
      }
      await sleep(120);
    }

    return false;
  }

  async function foregroundSleep(ms) {
    const end = Date.now() + ms;
    while (state.running && !state.destroyed && Date.now() < end) {
      const ok = await waitUntilFrontStable(0);
      if (!ok) return false;
      await sleep(Math.min(120, Math.max(0, end - Date.now())));
    }
    return state.running && !state.destroyed;
  }

  async function waitForHiddenThenFrontStable() {
    const start = Date.now();

    while (state.running && !state.destroyed && (Date.now() - start) < CFG.waitForHideAfterQuoteMs) {
      if (!isFrontTab()) {
        log('Quote click sent tab/background transition detected', 'info');
        return await waitUntilFrontStable(CFG.frontStableMs);
      }
      await sleep(120);
    }

    return await waitUntilFrontStable(CFG.frontStableMs);
  }

  function strongClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    try { el.click(); } catch {}
    return true;
  }

  function showBootstrapTab(anchor) {
    if (!anchor) return false;

    try {
      const $ = window.jQuery;
      if ($ && typeof $(anchor).tab === 'function') {
        $(anchor).tab('show');
        return true;
      }
    } catch {}

    strongClick(anchor);

    try {
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#')) {
        document.querySelectorAll('a[data-toggle="tab"]').forEach(a => a.classList.remove('active'));
        anchor.classList.add('active');

        document.querySelectorAll('.tab-pane').forEach(p => {
          p.classList.remove('active', 'show');
        });

        const pane = document.querySelector(href);
        if (pane) pane.classList.add('active', 'show');
      }
    } catch {}

    return true;
  }

  function log(msg, kind = 'info') {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift({ line, kind });
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();

    if (kind === 'error') console.error(`[${SCRIPT_NAME}] ${msg}`);
    else console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.innerHTML = state.logs.map(item =>
      `<div class="hb-az-log ${item.kind}">${escapeHtml(item.line)}</div>`
    ).join('');
  }

  function setStatus(text) {
    if (state.ui.status) state.ui.status.textContent = text;
  }

  function updateLastId(id) {
    if (state.ui.lastId) state.ui.lastId.textContent = id || '—';
  }

  function buildUi() {
    if (document.getElementById('hb-az-stage-runner-panel')) return;

    const style = document.createElement('style');
    style.id = 'hb-az-stage-runner-style';
    style.textContent = `
      #hb-az-stage-runner-panel{
        position:fixed;
        right:${CFG.panelRight}px;
        bottom:${CFG.panelBottom}px;
        width:270px;
        max-width:calc(100vw - 24px);
        max-height:calc(100vh - 24px);
        background:rgba(16,20,27,.96);
        color:#eef3f7;
        border:1px solid rgba(255,255,255,.12);
        border-radius:12px;
        box-shadow:0 8px 20px rgba(0,0,0,.28);
        z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
      }
      #hb-az-stage-runner-panel *{ box-sizing:border-box; }
      #hb-az-stage-runner-head{
        padding:8px 10px;
        background:rgba(255,255,255,.06);
        cursor:move;
        user-select:none;
        display:flex;
        justify-content:space-between;
        gap:8px;
      }
      #hb-az-stage-runner-title{ font-weight:700; }
      #hb-az-stage-runner-ver{ font-size:11px; opacity:.8; }
      #hb-az-stage-runner-body{ padding:10px; }
      #hb-az-stage-runner-mini{
        display:flex;
        gap:6px;
        margin-bottom:8px;
      }
      #hb-az-stage-runner-mini button{
        flex:1;
        border:1px solid rgba(255,255,255,.12);
        color:#eef3f7;
        border-radius:8px;
        padding:7px 8px;
        cursor:pointer;
        font-weight:700;
        font-size:12px;
        background:#1f2937;
      }
      #hb-az-stage-runner-mini button:hover{ filter:brightness(1.08); }
      #hb-az-stage-runner-mini button[data-active="1"]{
        background:rgba(80,160,255,.25);
        border-color:rgba(120,180,255,.65);
      }
      #hb-az-stage-runner-start[data-running="1"]{ background:#991b1b; }
      #hb-az-stage-runner-start[data-running="0"]{ background:#166534; }
      #hb-az-stage-runner-status{
        font-weight:700;
        color:#93c5fd;
        margin-bottom:8px;
      }
      #hb-az-stage-runner-meta{
        display:grid;
        grid-template-columns:60px 1fr;
        gap:4px 8px;
        margin-bottom:8px;
      }
      #hb-az-stage-runner-meta .k{ opacity:.82; }
      #hb-az-stage-runner-logs{
        max-height:160px;
        overflow:auto;
        background:rgba(0,0,0,.18);
        border:1px solid rgba(255,255,255,.08);
        border-radius:8px;
        padding:8px;
        white-space:pre-wrap;
        word-break:break-word;
        font-family:Consolas, monospace;
        font-size:11px;
      }
      .hb-az-log{
        padding:3px 0;
        border-top:1px solid rgba(255,255,255,.06);
      }
      .hb-az-log:first-child{ border-top:0; }
      .hb-az-log.ok{ color:#86efac; }
      .hb-az-log.warn{ color:#fcd34d; }
      .hb-az-log.error{ color:#fca5a5; }
      .hb-az-log.info{ color:#dbeafe; }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'hb-az-stage-runner-panel';
    panel.innerHTML = `
      <div id="hb-az-stage-runner-head">
        <div id="hb-az-stage-runner-title">${SCRIPT_NAME}</div>
        <div id="hb-az-stage-runner-ver">V${VERSION}</div>
      </div>
      <div id="hb-az-stage-runner-body">
        <div id="hb-az-stage-runner-mini">
          <button type="button" id="hb-az-stage-runner-auto">Auto</button>
          <button type="button" id="hb-az-stage-runner-home">Home</button>
          <button type="button" id="hb-az-stage-runner-start" data-running="0">Start</button>
        </div>
        <div id="hb-az-stage-runner-status">STOPPED</div>
        <div id="hb-az-stage-runner-meta">
          <div class="k">Stage</div><div id="hb-az-stage-runner-stage">${escapeHtml(CFG.stageName)}</div>
          <div class="k">Mode</div><div id="hb-az-stage-runner-mode">—</div>
          <div class="k">Page</div><div id="hb-az-stage-runner-page">—</div>
          <div class="k">Last ID</div><div id="hb-az-stage-runner-lastid">—</div>
        </div>
        <div id="hb-az-stage-runner-logs"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.ui.root = panel;
    state.ui.head = panel.querySelector('#hb-az-stage-runner-head');
    state.ui.auto = panel.querySelector('#hb-az-stage-runner-auto');
    state.ui.home = panel.querySelector('#hb-az-stage-runner-home');
    state.ui.start = panel.querySelector('#hb-az-stage-runner-start');
    state.ui.status = panel.querySelector('#hb-az-stage-runner-status');
    state.ui.mode = panel.querySelector('#hb-az-stage-runner-mode');
    state.ui.page = panel.querySelector('#hb-az-stage-runner-page');
    state.ui.lastId = panel.querySelector('#hb-az-stage-runner-lastid');
    state.ui.logs = panel.querySelector('#hb-az-stage-runner-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.auto?.addEventListener('click', () => {
      state.mode = 'auto';
      saveMode(state.mode);
      syncUi();
      log('Mode set: Auto', 'info');
    });

    state.ui.home?.addEventListener('click', () => {
      state.mode = 'home';
      saveMode(state.mode);
      syncUi();
      log('Mode set: Home', 'info');
    });

    state.ui.start?.addEventListener('click', () => {
      if (state.running) stopRun('Stopped');
      else startRun(false);
    });
  }

  function syncUi() {
    if (!state.ui.root) return;

    state.ui.auto.dataset.active = state.mode === 'auto' ? '1' : '0';
    state.ui.home.dataset.active = state.mode === 'home' ? '1' : '0';
    state.ui.start.dataset.running = state.running ? '1' : '0';
    state.ui.start.textContent = state.running ? 'Stop' : 'Start';
    state.ui.mode.textContent = state.mode ? state.mode.toUpperCase() : '—';
  }

  function startRun(isRestore = false) {
    if (!state.mode) {
      state.running = false;
      saveRunning(false);
      syncUi();
      setStatus('Pick Auto/Home first');
      log('Pick Auto or Home first', 'warn');
      return;
    }

    state.running = true;
    saveRunning(true);
    persistState();

    if (!isRestore) {
      state.processedIds.clear();
      state.bgPauseLogged = false;
      syncUi();
      setStatus(`RELOADING (${state.mode.toUpperCase()})`);
      const reset = clearTransientWorkflowData();
      log(`Cleared ${reset.cleared} transient workflow key${reset.cleared === 1 ? '' : 's'} before fresh run`, 'ok');
      if (reset.preserved.length) {
        log(`Preserved timeout workflow data: ${reset.preserved.join(', ')}`, 'info');
      }
      log(`Reloading before run | mode=${state.mode.toUpperCase()}`, 'info');
      setBootstrapReloadToken();
      setTimeout(() => {
        if (!state.destroyed) location.reload();
      }, 120);
      return;
    }

    if (state.busy) {
      syncUi();
      return;
    }

    state.busy = false;
    state.bgPauseLogged = false;
    syncUi();
    setStatus(`RUNNING (${state.mode.toUpperCase()})`);
    log(isRestore ? `Restored | mode=${state.mode.toUpperCase()}` : `Started | mode=${state.mode.toUpperCase()}`, 'ok');

    runLoop().catch(err => {
      log(`Fatal: ${err?.message || err}`, 'error');
      stopRun('Error');
    });
  }

  function stopRun(reason = 'Stopped') {
    state.running = false;
    saveRunning(false);
    persistState();
    state.busy = false;
    syncUi();
    setStatus(reason.toUpperCase());
    log(reason, 'warn');
  }

  async function runLoop() {
    if (state.busy) return;
    state.busy = true;

    try {
      while (state.running && !state.destroyed) {
        await waitUntilFrontStable(CFG.frontStableMs);

        const stageWrap = getStageWrap();
        if (!stageWrap) {
          setStatus('Waiting stage');
          log(`Stage not found: ${CFG.stageName}`, 'warn');
          await sleep(1000);
          continue;
        }

        const filterReady = await ensureIgnoredTagsFilter();
        if (!filterReady) {
          setStatus('Ignored tags failed');
          log(`Failed to apply ${CFG.savedQueryName} filter`, 'error');
          await sleep(1000);
          continue;
        }

        const cards = getStageCards();
        const pageLabel = getStagePageLabel();
        if (state.ui.page) state.ui.page.textContent = pageLabel || '—';

        if (!cards.length) {
          const moved = await goNextPage();
          if (!moved) {
            log(`Done. No cards found with ${CFG.savedQueryName}.`, 'ok');
            stopRun('Done');
            return;
          }
          log(`Next page | ${getStagePageLabel() || '...'}`, 'info');
          await foregroundSleep(CFG.pageWaitMs);
          continue;
        }

        const card = cards.find((candidate) => {
          const ticketId = norm(candidate.getAttribute('data-id'));
          return ticketId && !state.processedIds.has(ticketId);
        });

        if (!card) {
          const moved = await goNextPage();
          if (!moved) {
            log(`Done. No unprocessed cards left in ${CFG.savedQueryName}.`, 'ok');
            stopRun('Done');
            return;
          }
          log(`Next page | ${getStagePageLabel() || '...'}`, 'info');
          await foregroundSleep(CFG.pageWaitMs);
          continue;
        }

        const ticketId = norm(card.getAttribute('data-id'));
        const cardName = norm(card.querySelector(SEL.customerLink)?.textContent);

        updateLastId(ticketId);
        highlightCard(card, 'checking');
        log(`Opening | ${ticketId} | ${cardName || 'Unknown'}`, 'info');

        const opened = await openCard(card, ticketId);
        if (!opened) {
          highlightCard(card, 'error');
          log(`OPEN FAILED | ${ticketId}`, 'error');
          stopRun('OPEN FAILED');
          return;
        }

        highlightDock('grab');

        const ready = await ensureMainAndPayloadReady({ ticketId, cardName, pageLabel });
        if (!ready) {
          highlightCard(card, 'error');
          log(`MAIN/PAYLOAD FAILED | ${ticketId}`, 'error');
          stopRun('MAIN/PAYLOAD FAILED');
          return;
        }

        savePayload(ready.payload);
        saveSharedJob(ready.payload);
        highlightCard(card, 'saved');
        writeScanState('payload-saved', ready.payload.ticketId, pageLabel);
        log(`Payload saved + shared | ${ready.payload.ticketId} | ${ready.filledCount}/${FIELD_ORDER.length}`, 'ok');

        const quoteStarted = await startQuoteFlow();
        if (!quoteStarted) {
          highlightCard(card, 'error');
          log(`QUOTES FAILED | ${ticketId}`, 'error');
          stopRun('QUOTES FAILED');
          return;
        }

        const ticketClosed = await waitForTicketClosedByFinisher(ticketId);
        if (!ticketClosed) return;

        state.processedIds.add(ticketId);
        clearDockHighlight();
        await foregroundSleep(CFG.nextRunAfterCloseMs);
      }
    } finally {
      state.busy = false;
    }
  }

  async function startQuoteFlow() {
    await waitUntilFrontStable(CFG.frontStableMs);

    log(`Waiting ${Math.ceil(CFG.quotePreWaitMs / 1000)}s before Quotes click`, 'info');
    const okWait = await foregroundSleep(CFG.quotePreWaitMs);
    if (!okWait) return false;

    const quotesOk = await ensureQuotesAreaReady();
    if (!quotesOk) return false;

    await foregroundSleep(450);

    const modeSelector = state.mode === 'auto' ? SEL.autoLink : SEL.homeLink;
    const modeLabel = state.mode === 'auto' ? 'Auto link' : 'Home link';
    const modeOk = await clickSelectorWithRetry(modeSelector, modeLabel, 6);
    if (!modeOk) return false;

    log(`${modeLabel} clicked. Waiting for background/return...`, 'info');
    await waitForHiddenThenFrontStable();

    log('Returned to front and stable for 3s', 'ok');
    return true;
  }

  async function waitForTicketClosedByFinisher(ticketId) {
    let lastLogAt = 0;

    while (state.running && !state.destroyed) {
      await waitUntilFrontStable(CFG.frontStableMs);

      const info = getOpenTicketInfo();
      if (!isTicketDrawerOpen() || !String(info.ticketId || '')) {
        log(`Ticket closed after finisher | ${ticketId}`, 'ok');
        return true;
      }

      if (String(info.ticketId || '') !== String(ticketId) && String(info.ticketId || '') !== '') {
        log(`Ticket changed while waiting for finisher close | expected ${ticketId} got ${info.ticketId}`, 'error');
        stopRun('TICKET CHANGED');
        return false;
      }

      const now = Date.now();
      if (!lastLogAt || (now - lastLogAt) >= CFG.ticketCloseWaitLogEveryMs) {
        log(`Waiting for finisher to close ${ticketId}...`, 'warn');
        lastLogAt = now;
      }

      await foregroundSleep(CFG.ticketClosePollMs);
    }

    return false;
  }

  function getCurrentSavedQueryLabel() {
    return norm(document.querySelector(SEL.savedQueryLabel)?.textContent || document.querySelector(SEL.savedQueryButton)?.textContent || '');
  }

  function isIgnoredTagsSelected() {
    return lower(getCurrentSavedQueryLabel()) === lower(CFG.savedQueryName);
  }

  function isSavedQueryDropdownOpen() {
    const wrap = document.querySelector(SEL.savedQueryWrap);
    const btn = document.querySelector(SEL.savedQueryButton);
    return !!(
      wrap?.classList.contains('show') ||
      String(btn?.getAttribute('aria-expanded') || '').toLowerCase() === 'true'
    );
  }

  function findIgnoredTagsOption() {
    return [...document.querySelectorAll(SEL.savedQueryItems)]
      .filter(visible)
      .find((el) => lower(el.textContent) === lower(CFG.savedQueryName)) || null;
  }

  async function openSavedQueryDropdown() {
    const btn = document.querySelector(SEL.savedQueryButton);
    if (!btn || !visible(btn)) {
      log('Saved query filter button not found', 'error');
      return false;
    }

    if (isSavedQueryDropdownOpen()) return true;

    strongClick(btn);
    await sleep(220);
    if (isSavedQueryDropdownOpen()) return true;

    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $(btn).dropdown === 'function') {
        $(btn).dropdown('toggle');
        await sleep(220);
        if (isSavedQueryDropdownOpen()) return true;
      }
    } catch {}

    return isSavedQueryDropdownOpen();
  }

  async function ensureIgnoredTagsFilter() {
    if (isIgnoredTagsSelected()) return true;

    const opened = await openSavedQueryDropdown();
    if (!opened) {
      log(`Could not open saved query dropdown for ${CFG.savedQueryName}`, 'error');
      return false;
    }

    const item = findIgnoredTagsOption();
    if (!item) {
      log(`Saved query option not found: ${CFG.savedQueryName}`, 'error');
      return false;
    }

    strongClick(item);
    log(`Selected saved query: ${CFG.savedQueryName}`, 'info');

    const started = Date.now();
    while ((Date.now() - started) < 6000) {
      if (!state.running || state.destroyed) return false;
      if (isIgnoredTagsSelected()) {
        await foregroundSleep(CFG.filterSettleMs);
        return true;
      }
      await sleep(120);
    }

    log(`Saved query did not switch to ${CFG.savedQueryName}`, 'error');
    return false;
  }

  async function ensureQuotesAreaReady() {
    const quotesTab = document.querySelector(SEL.quotesTab);
    if (!quotesTab || !visible(quotesTab)) {
      log('Quotes tab button not found', 'error');
      return false;
    }

    showBootstrapTab(quotesTab);
    log('Clicked: Quotes tab', 'info');

    const started = Date.now();
    while (Date.now() - started < CFG.quoteTabWaitMs) {
      if (!state.running || state.destroyed) return false;

      const pane = document.querySelector(SEL.quotePane);
      const modeLink = document.querySelector(state.mode === 'auto' ? SEL.autoLink : SEL.homeLink);

      if (pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane))) {
        if (modeLink && visible(modeLink)) {
          log('Quotes area ready', 'ok');
          return true;
        }
      }

      if ((Date.now() - started) > 1200 && (Date.now() - started) < 1800) {
        showBootstrapTab(quotesTab);
      }

      await sleep(120);
    }

    log('Quotes area did not become ready', 'error');
    return false;
  }

  async function clickSelectorWithRetry(selector, label, tries = 4) {
    for (let i = 0; i < tries; i++) {
      const el = document.querySelector(selector);
      if (el && visible(el)) {
        strongClick(el);
        log(`Clicked: ${label}`, 'info');
        return true;
      }
      await foregroundSleep(220 + (i * 80));
    }

    log(`Not found: ${label}`, 'error');
    return false;
  }

  function getStageWrap() {
    return [...document.querySelectorAll(SEL.stageWrap)].find(w => {
      const h2 = w.querySelector('.dd-header h2');
      return lower(h2?.textContent) === lower(CFG.stageName);
    }) || null;
  }

  function getStageContainer() {
    return getStageWrap()?.parentElement || null;
  }

  function getStageCards() {
    const stage = getStageContainer();
    return stage ? [...stage.querySelectorAll(SEL.stageCards)] : [];
  }

  function getStagePageLabel() {
    return norm(getStageWrap()?.querySelector('.dd-pagination span')?.textContent || '');
  }

  function getStageNextPageBtn() {
    const btn = getStageWrap()?.querySelector('.dd-pagination a.next.paging.dd-pagination-arrow');
    if (!btn || !visible(btn) || btn.classList.contains('inactive')) return null;
    return btn;
  }

  function getCardTags(card) {
    return [...card.querySelectorAll('.dd-card-bottom .az-def-badges .az-def-badge')]
      .map(el => norm(el.textContent))
      .filter(Boolean);
  }

  function cardHasTag(card, tagText) {
    return getCardTags(card).some(t => lower(t) === lower(tagText));
  }

  function highlightCard(card, kind) {
    if (!card) return;
    card.style.outline = '';
    card.style.boxShadow = '';

    if (kind === 'skip') {
      card.style.outline = '3px solid #ef4444';
      card.style.boxShadow = '0 0 0 3px rgba(239,68,68,.20)';
    } else if (kind === 'checking') {
      card.style.outline = '3px solid #facc15';
      card.style.boxShadow = '0 0 0 3px rgba(250,204,21,.22)';
    } else if (kind === 'saved') {
      card.style.outline = '3px solid #22c55e';
      card.style.boxShadow = '0 0 0 3px rgba(34,197,94,.22)';
    } else if (kind === 'error') {
      card.style.outline = '3px solid #f97316';
      card.style.boxShadow = '0 0 0 3px rgba(249,115,22,.22)';
    }
  }

  function isTicketDrawerOpen() {
    const side = document.querySelector(SEL.dockSideActions);
    return !!(side && visible(side));
  }

  async function openCard(card, ticketId) {
    const currentOpen = getOpenTicketInfo().ticketId;
    if (currentOpen && currentOpen !== ticketId) {
      await closeTicket();
      await foregroundSleep(CFG.gapMs);
    }
    if (currentOpen && currentOpen === ticketId) return true;
    if (isTicketDrawerOpen()) return true;

    const link = card.querySelector(SEL.customerLink);
    const targets = [link, card].filter(Boolean);
    const overallStart = Date.now();

    while (state.running && !state.destroyed && (Date.now() - overallStart) < CFG.openTotalMs) {
      await waitUntilFrontStable(CFG.frontStableMs);

      for (const target of targets) {
        if (!target) continue;

        strongClick(target);
        log(`Clicked ticket target, waiting 2s for drawer...`, 'info');

        const ok = await waitForOpenTicket(ticketId, CFG.openTryMs);
        if (ok) return true;
      }

      await foregroundSleep(220);
    }

    return false;
  }

  async function waitForOpenTicket(ticketId, timeoutMs) {
    const started = Date.now();
    let afterClickMark = 0;

    while (Date.now() - started < timeoutMs) {
      if (!state.running || state.destroyed) return false;

      const info = getOpenTicketInfo();

      if (String(info.ticketId || '') === String(ticketId)) {
        return true;
      }

      if (isTicketDrawerOpen()) {
        if (!afterClickMark) afterClickMark = Date.now();
        if ((Date.now() - afterClickMark) >= CFG.openCheckAfterClickMs) {
          log(`Drawer detected open from side-actions after 2s | ${ticketId}`, 'ok');
          return true;
        }
      } else {
        afterClickMark = 0;
      }

      await sleep(120);
    }

    return false;
  }

  function getOpenDockRoot() {
    return document.querySelector(SEL.dockRoot) || null;
  }

  function getOpenTicketInfo() {
    const root = getOpenDockRoot();
    if (!root) return { ticketId: '', name: '', tags: [] };

    const top = document.querySelector(SEL.dockTop) || root;
    const h3 = top.querySelector(SEL.topName) || root.querySelector(SEL.topName);

    let name = '';
    if (h3) {
      const clone = h3.cloneNode(true);
      clone.querySelector('.origin-vendor-sync')?.remove();
      name = norm(clone.textContent || '');
    }

    let ticketId = '';
    const syncNode = root.querySelector('.origin-vendor-sync');
    const syncText = norm(syncNode?.textContent || '');
    const m = syncText.match(/\bID:\s*(\d+)\b/i);
    if (m) ticketId = m[1];

    const tags = [...root.querySelectorAll(SEL.topTags)]
      .map(el => norm(el.textContent))
      .filter(Boolean);

    return { ticketId, name, tags };
  }

  function openTicketHasTag(tagText) {
    return getOpenTicketInfo().tags.some(t => lower(t) === lower(tagText));
  }

  function highlightDock(kind) {
    const root = getOpenDockRoot();
    if (!root) return;
    root.style.outline = '';
    root.style.boxShadow = '';

    if (kind === 'tagged') {
      root.style.outline = '3px solid #ef4444';
      root.style.boxShadow = '0 0 0 3px rgba(239,68,68,.20)';
    } else if (kind === 'grab') {
      root.style.outline = '3px solid #22c55e';
      root.style.boxShadow = '0 0 0 3px rgba(34,197,94,.22)';
    }
  }

  function clearDockHighlight() {
    const root = getOpenDockRoot();
    if (!root) return;
    root.style.outline = '';
    root.style.boxShadow = '';
  }

  function parseInitialValuesJson() {
    const input = document.querySelector(SEL.initialValues);
    if (!input) return null;

    const raw = input.value || input.getAttribute('value') || '';
    if (!raw) return null;

    let parsed = safeJsonParse(raw, null);
    if (parsed) return parsed;

    parsed = safeJsonParse(htmlDecode(raw), null);
    return parsed || null;
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function htmlDecode(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function getSelectedText(select) {
    if (!select) return '';
    const opt = select.options?.[select.selectedIndex];
    if (opt && norm(opt.textContent)) return norm(opt.textContent);

    const bs = select.closest('.bootstrap-select');
    const txt = bs?.querySelector('.filter-option, .filter-option-inner-inner');
    return norm(txt?.textContent || '');
  }

  function readVal(selector) {
    const el = document.querySelector(selector);
    return norm(el?.value || el?.textContent || '');
  }

  function resolveLeadSourceText(initial) {
    const direct = getSelectedText(document.querySelector('#otherBaseLeadSourceId'));
    if (direct) return direct;
    return norm(initial?.otherLeadSourceText || '');
  }

  function resolveProducerText(initial) {
    const direct = getSelectedText(document.querySelector('#assignedTo'));
    if (direct) return direct;

    const badgeTitle = norm(document.querySelector('.dd-card-avatar .badge[title]')?.getAttribute('title'));
    if (badgeTitle) return badgeTitle;

    return norm(initial?.assignedToText || '');
  }

  function readAzFieldSnapshot(fallbackTicketId = '') {
    const initial = parseInitialValuesJson() || {};
    const cr = initial?.CustomerReferral || {};
    const openInfo = getOpenTicketInfo();

    const fields = {
      'AZ ID': firstNonEmpty(initial?.id, initial?.instaId, openInfo.ticketId, fallbackTicketId),
      'AZ Lead Source': firstNonEmpty(resolveLeadSourceText(initial)),
      'AZ Producer': firstNonEmpty(resolveProducerText(initial)),
      'AZ Name': firstNonEmpty(cr.firstname, readVal('#customerreferral-firstname')),
      'AZ Last': firstNonEmpty(cr.lastname, readVal('#customerreferral-lastname')),
      'AZ DOB': firstNonEmpty(cr.birthday, readVal('input[name="CustomerReferral[birthday]"]')),
      'AZ Phone': firstNonEmpty(cr.phone, readVal('#customerreferral-phone')),
      'AZ Email': firstNonEmpty(cr.email, readVal('#customerreferral-email')),
      'AZ Street Address': firstNonEmpty(cr.address1, readVal('#customerreferral-address1')),
      'AZ City': firstNonEmpty(cr.city, readVal('#customerreferral-city')),
      'AZ Country': firstNonEmpty(cr.country, readVal('#customerreferral-country')),
      'AZ State': firstNonEmpty(cr.state, readVal('#state')),
      'AZ Postal Code': firstNonEmpty(cr.zip, readVal('#customerreferral-zip')),
      'First Name': firstNonEmpty(cr.firstname, readVal('#customerreferral-firstname')),
      'Last Name': firstNonEmpty(cr.lastname, readVal('#customerreferral-lastname')),
      'Email': firstNonEmpty(cr.email, readVal('#customerreferral-email')),
      'Phone': firstNonEmpty(cr.phone, readVal('#customerreferral-phone')),
      'DOB': firstNonEmpty(cr.birthday, readVal('input[name="CustomerReferral[birthday]"]')),
      'Street Address': firstNonEmpty(cr.address1, readVal('#customerreferral-address1')),
      'City': firstNonEmpty(cr.city, readVal('#customerreferral-city')),
      'State': firstNonEmpty(cr.state, readVal('#state')),
      'Zip': firstNonEmpty(cr.zip, readVal('#customerreferral-zip'))
    };

    let filledCount = 0;
    for (const k of FIELD_ORDER) {
      if (norm(fields[k])) filledCount += 1;
    }

    return { fields, filledCount };
  }

  async function ensureMainAndPayloadReady(ctx) {
    const formReady = () => {
      const form = document.querySelector(SEL.detailForm);
      return !!(form && visible(form));
    };
    const paneReady = () => {
      const pane = document.querySelector(SEL.mainPane);
      return !!(pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane)));
    };
    const mainTabActive = () => {
      const mainTab = document.querySelector(SEL.mainTab);
      return !!(mainTab && mainTab.classList.contains('active'));
    };

    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found', 'error');
      return null;
    }

    showBootstrapTab(mainTab);
    log('Clicked: Main tab', 'info');

    const started = Date.now();
    let lastCount = -1;

    while (Date.now() - started < CFG.detailWaitMs) {
      if (!state.running || state.destroyed) return null;

      const snapshot = readAzFieldSnapshot(ctx.ticketId);
      const activeEnough = mainTabActive() || paneReady() || formReady();

      if (snapshot.filledCount !== lastCount) {
        lastCount = snapshot.filledCount;
        log(`Main payload count: ${snapshot.filledCount}/${FIELD_ORDER.length}`, snapshot.filledCount === FIELD_ORDER.length ? 'ok' : 'warn');
      }

      if (activeEnough && snapshot.filledCount === FIELD_ORDER.length) {
        log(`Main payload ready ${FIELD_ORDER.length}/${FIELD_ORDER.length}`, 'ok');
        return {
          filledCount: snapshot.filledCount,
          payload: {
            ticketId: snapshot.fields['AZ ID'],
            az: snapshot.fields,
            meta: {
              stageName: CFG.stageName,
              mode: state.mode,
              page: ctx.pageLabel || '',
              savedAt: nowIso(),
              url: location.href,
              openTicketName: getOpenTicketInfo().name || ctx.cardName || '',
              source: {
                initialValues: !!parseInitialValuesJson(),
                detailForm: !!document.querySelector(SEL.detailForm)
              }
            }
          }
        };
      }

      if ((Date.now() - started) > 1200 && (Date.now() - started) < 1800) {
        showBootstrapTab(mainTab);
      }

      await sleep(120);
    }

    return null;
  }

  function firstNonEmpty(...values) {
    for (const v of values) {
      const s = norm(v);
      if (s) return s;
    }
    return '';
  }

  function savePayload(payload) {
    const map = readJson(KEYS.PAYLOAD_MAP, {}) || {};
    map[payload.ticketId] = payload;

    writeJson(KEYS.PAYLOAD_MAP, map);
    writeJson(KEYS.LAST_PAYLOAD, payload);
    localStorage.setItem(KEYS.LAST_SAVED_ID, payload.ticketId);
    updateLastId(payload.ticketId);
  }

  function saveSharedJob(payload) {
    const shared = {
      ticketId: payload.ticketId,
      mode: state.mode,
      az: payload.az,
      gwpcHome: null,
      gwpcAuto: null,
      meta: {
        createdAt: payload.meta.savedAt,
        lastUpdatedAt: payload.meta.savedAt,
        source: 'az_stage_runner',
        url: payload.meta.url,
        stageName: payload.meta.stageName,
        page: payload.meta.page
      }
    };

    const currentJob = {
      'AZ ID': firstNonEmpty(payload.az?.['AZ ID'], payload.ticketId),
      'Name': [payload.az?.['AZ Name'], payload.az?.['AZ Last']].map(v => norm(v)).filter(Boolean).join(' ').trim(),
      'Mailing Address': [
        norm(payload.az?.['AZ Street Address']),
        norm(payload.az?.['AZ City']),
        norm(payload.az?.['AZ State']) && norm(payload.az?.['AZ Postal Code']) ? `${norm(payload.az?.['AZ State'])} ${norm(payload.az?.['AZ Postal Code'])}` : '',
      ].filter(Boolean).join(', ').replace('undefined', '').trim(),
      'SubmissionNumber': '',
      'updatedAt': payload.meta.savedAt,
      'First Name': firstNonEmpty(payload.az?.['First Name'], payload.az?.['AZ Name']),
      'Last Name': firstNonEmpty(payload.az?.['Last Name'], payload.az?.['AZ Last']),
      'Email': firstNonEmpty(payload.az?.['Email'], payload.az?.['AZ Email']),
      'Phone': firstNonEmpty(payload.az?.['Phone'], payload.az?.['AZ Phone']),
      'DOB': firstNonEmpty(payload.az?.['DOB'], payload.az?.['AZ DOB']),
      'Street Address': firstNonEmpty(payload.az?.['Street Address'], payload.az?.['AZ Street Address']),
      'City': firstNonEmpty(payload.az?.['City'], payload.az?.['AZ City']),
      'State': firstNonEmpty(payload.az?.['State'], payload.az?.['AZ State']),
      'Zip': firstNonEmpty(payload.az?.['Zip'], payload.az?.['AZ Postal Code'])
    };

    if (!currentJob['Mailing Address']) {
      currentJob['Mailing Address'] = [
        norm(payload.az?.['AZ Street Address']),
        norm(payload.az?.['AZ City']),
        norm(payload.az?.['AZ State']),
        norm(payload.az?.['AZ Postal Code'])
      ].filter(Boolean).join(', ').replace(/, ([A-Z]{2}), (\d{5}(?:-\d{4})?)$/, ', $1 $2').trim();
    }

    // Real localStorage mirrors on AZ origin
    try { writeJson(KEYS.SHARED_JOB, shared); } catch (err) {
      log(`Shared localStorage save failed: ${err?.message || err}`, 'error');
    }

    try { writeJson(KEYS.AZ_CURRENT_JOB, currentJob); } catch (err) {
      log(`AZ current job localStorage save failed: ${err?.message || err}`, 'error');
    }

    try { writeJson(KEYS.CURRENT_JOB, currentJob); } catch (err) {
      log(`Current job localStorage save failed: ${err?.message || err}`, 'error');
    }

    // Keep GM mirrors too
    try { GM_setValue(KEYS.SHARED_JOB, shared); } catch (err) {
      log(`Shared GM save failed: ${err?.message || err}`, 'error');
    }

    try { GM_setValue(KEYS.AZ_CURRENT_JOB, currentJob); } catch (err) {
      log(`AZ current job GM save failed: ${err?.message || err}`, 'error');
    }

    try { GM_setValue(KEYS.CURRENT_JOB, currentJob); } catch (err) {
      log(`Current job GM save failed: ${err?.message || err}`, 'error');
    }

    log(`Saved shared/current job | Ticket ID ${currentJob['AZ ID'] || payload.ticketId}`, 'ok');
  }

  function writeScanState(action, ticketId, pageLabel) {
    writeJson(KEYS.SCAN_STATE, {
      action,
      ticketId,
      page: pageLabel || '',
      stageName: CFG.stageName,
      mode: state.mode,
      at: nowIso(),
      url: location.href
    });
  }

  function findCloseButton() {
    const roots = [
      document.querySelector('#serviceDetailDock'),
      document.querySelector('#notePanelContainer'),
      document.querySelector('.az-dock'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const els = [...root.querySelectorAll(SEL.closeCandidates)].filter(visible);

      for (const el of els) {
        const txt = norm([
          el.textContent,
          el.getAttribute?.('title'),
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('data-original-title')
        ].filter(Boolean).join(' '));
        const cls = String(el.className || '').toLowerCase();

        if (
          lower(txt) === 'close' ||
          lower(txt).includes('close') ||
          lower(txt) === 'x' ||
          cls.includes('close')
        ) {
          return el;
        }
      }
    }

    return null;
  }

  async function closeTicket() {
    if (!isTicketDrawerOpen()) return true;

    const before = getOpenTicketInfo().ticketId;
    const btn = findCloseButton();

    if (btn) {
      strongClick(btn);
    } else {
      fireEscape();
    }

    const started = Date.now();
    while (Date.now() - started < CFG.closeWaitMs) {
      if (!state.running || state.destroyed) return true;
      if (!isTicketDrawerOpen()) {
        log(`Closed | ${before || 'drawer'}`, 'info');
        return true;
      }
      await sleep(120);
    }

    log(`Close timed out | ${before || 'drawer'}`, 'warn');
    return false;
  }

  function fireEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
    } catch {}
  }

  async function goNextPage() {
    const btn = getStageNextPageBtn();
    if (!btn) return false;

    const beforeLabel = getStagePageLabel();
    const beforeFirstId = getStageCards()[0]?.getAttribute('data-id') || '';

    strongClick(btn);

    const started = Date.now();
    while (Date.now() - started < 12000) {
      if (!state.running || state.destroyed) return false;

      const nowLabel = getStagePageLabel();
      const nowFirstId = getStageCards()[0]?.getAttribute('data-id') || '';

      if ((nowLabel && nowLabel !== beforeLabel) || (nowFirstId && nowFirstId !== beforeFirstId)) {
        if (state.ui.page) state.ui.page.textContent = nowLabel || '—';
        return true;
      }

      await sleep(180);
    }

    return false;
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;

      const r = panel.getBoundingClientRect();
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      sl = r.left;
      st = r.top;

      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, sl + (e.clientX - sx)));
      const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, st + (e.clientY - sy)));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      savePanelPos();
    });

    window.addEventListener('resize', () => {
      clampPanel();
      savePanelPos();
    });
  }

  function restorePanelPos() {
    try {
      const raw = localStorage.getItem(KEYS.PANEL_POS);
      if (!raw || !state.ui.root) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return;

      state.ui.root.style.left = `${Math.max(0, pos.left)}px`;
      state.ui.root.style.top = `${Math.max(0, pos.top)}px`;
      state.ui.root.style.right = 'auto';
      state.ui.root.style.bottom = 'auto';
      clampPanel();
    } catch {}
  }

  function savePanelPos() {
    if (!state.ui.root) return;
    try {
      const r = state.ui.root.getBoundingClientRect();
      localStorage.setItem(KEYS.PANEL_POS, JSON.stringify({ left: r.left, top: r.top }));
    } catch {}
  }

  function clampPanel() {
    if (!state.ui.root) return;
    const r = state.ui.root.getBoundingClientRect();
    const left = Math.max(0, Math.min(window.innerWidth - r.width, r.left));
    const top = Math.max(0, Math.min(window.innerHeight - r.height, r.top));
    state.ui.root.style.left = `${left}px`;
    state.ui.root.style.top = `${top}px`;
    state.ui.root.style.right = 'auto';
    state.ui.root.style.bottom = 'auto';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
