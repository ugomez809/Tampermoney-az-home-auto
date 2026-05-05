// ==UserScript==
// @name         GWPC Payload Mirror + Non-AZ Tab Closer
// @namespace    homebot.payload-mirror-non-az-tab-closer
// @version      1.1.5
// @description  Mirrors HOME payloads, supervises dedicated APEX/GWPC anchor tabs, detects auth/login states, and best-effort closes transient non-AZ tabs after successful handoff.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://*.okta.com/*
// @match        https://eagentsaml.farmersinsurance.com/*
// @match        https://app.agencyzoom.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/payload-mirror-non-az-tab-closer.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/payload-mirror-non-az-tab-closer.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'GWPC Payload Mirror + Non-AZ Tab Closer';
  const VERSION = '1.1.5';
  const LEGACY_TIMEOUT_SCRIPT_NAME = 'GWPC Header Timeout Monitor';
  const APEX_WAKE_QUERY_KEY = 'tm_apex_wake';
  const APEX_WAKE_ID_QUERY_KEY = 'tm_apex_wake_id';
  const ANCHOR_QUERY_KEY = 'hb_anchor';
  const ANCHOR_ROLE_QUERY_KEY = 'hb_anchor_role';
  const ANCHOR_TOKEN_QUERY_KEY = 'hb_anchor_token';
  const WATCH_ALERT_MESSAGE = 'Bot is not botting. Check it.';

  // Log-export integration — runs on 4 origins; pick one key per origin.
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
    apexWakeState: 'tm_payload_mirror_apex_wake_state_v1',
    anchorState: 'tm_shared_anchor_state_v1',
    authHold: 'tm_shared_auth_hold_v1',
    tabOpenRequest: 'tm_shared_tab_open_request_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    missingPayloadTrigger: 'tm_az_missing_payload_fallback_trigger_v1',
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
    closeAttempted: 'tm_pc_payload_mirror_close_attempted_v1',
    anchorRole: 'tm_anchor_role_v1',
    anchorToken: 'tm_anchor_token_v1',
    authLastSubmitKey: 'tm_payload_mirror_auth_submit_key_v1'
  };

  const GWPC_KEYS = [
    'tm_pc_webhook_bundle_v1',
    'tm_pc_current_job_v1',
    'tm_pc_home_quote_grab_payload_v1',
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
    anchorLeaseHeartbeatMs: 5000,
    anchorLeaseTtlMs: 20000,
    anchorStaleMs: 15000,
    anchorOpenPendingMs: 30000,
    anchorOpenCooldownMs: 120000,
    autoAnchorLaunchEnabled: false,
    authHoldTtlMs: 20000,
    authRecoveryTimeoutMs: 90000,
    authEmptyCredentialsMs: 10000,
    authBlockedAlertRepeatMs: 15000,
    anchorProbeMs: 4 * 60 * 1000,
    anchorRefreshMs: 8 * 60 * 1000,
    openRequestTtlMs: 30000,
    ignoreCloseLeaseTtlMs: 8000,
    ignoreCloseLeaseHeartbeatMs: 1500,
    maxLogLines: 70,
    zIndex: 2147483647,
    panelWidth: 330,
    closeRetryMs: 1200,
    maxCloseAttempts: 6,
    lexFrontMaxOpenMs: 60000
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
    closeSignalKey: '',
    logsIntervalTimer: null,
    tabId: `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    apexWakeEnabled: loadApexWakeEnabled(),
    apexWakeMonitorStartedAt: Date.now(),
    apexWakeTab: null,
    apexWakeCloseAt: 0,
    apexWakeSelfCloseAt: 0,
    apexWakeSelfCloseId: '',
    apexWakeStatus: '',
    lastTabHeartbeatAt: 0,
    lastApexWakeLogKey: '',
    lastIgnoreCloseLeaseHeartbeatAt: 0,
    lastIgnoreCloseSignalKey: '',
    lastWebhookFatalHoldLogKey: '',
    samePageSignature: '',
    samePageSinceAt: 0,
    samePageCloseAttempted: false,
    samePageLoggedArmed: false,
    lexSnagHandledKey: '',
    lexFrontActiveSinceAt: 0,
    lexFrontArmedLogged: false,
    lexFrontHandledKey: '',
    lastSessionContext: null,
    lastAnchorHeartbeatAt: 0,
    lastAnchorProbeAt: 0,
    lastAnchorRefreshAt: 0,
    lastAuthAlertAt: 0,
    lastAuthGateLogKey: '',
    lastBridgedOpenRequestKey: '',
    authBannerEl: null
  };

  init();

  function init() {
    adoptAnchorMarkerFromUrl();
    buildUi();
    bindUi();
    restorePanelPos();
    renderAll();

    log(`Loaded v${VERSION}`);
    log(`Host: ${location.hostname}`);
    writeTabHeartbeat(true);
    if (isAzHost()) log(`Session supervisor ${state.apexWakeEnabled ? 'ON' : 'OFF'}`);
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
    try { clearIgnoreCloseLeaseIfOwned(); } catch {}
    try { if (isAzHost()) clearAnchorLease('coordinator'); } catch {}
    try { clearAnchorLease(getAnchorRole()); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { clearInterval(state.logsIntervalTimer); } catch {}
    try { window.removeEventListener('beforeunload', handlePageUnload, true); } catch {}
    try { window.removeEventListener('pagehide', handlePageUnload, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    try { window.removeEventListener('storage', handleLogClearStorageEvent, true); } catch {}
    try { state.panel?.remove(); } catch {}
    try { state.authBannerEl?.remove(); } catch {}
    try { delete window.__AZ_TO_GWPC_PAYLOAD_MIRROR_CLEANUP__; } catch {}
  }

  function loadRunning() {
    // Close handling should re-arm after refresh. Stop is only for this page session.
    try { localStorage.removeItem(LS_KEYS.running); } catch {}
    return true;
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.removeItem(LS_KEYS.running);
      else localStorage.setItem(LS_KEYS.running, '0');
    } catch {}
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

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function hashString(value) {
    let hash = 0;
    const text = String(value == null ? '' : value);
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function isFrontActiveTab() {
    return document.visibilityState === 'visible' && document.hasFocus();
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

  function isOktaHost() {
    return /\.okta\.com$/i.test(location.hostname);
  }

  function isEagentSamlHost() {
    return /^eagentsaml\.farmersinsurance\.com$/i.test(location.hostname);
  }

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function getAnchorRole() {
    const role = norm(readSession(SS_KEYS.anchorRole));
    if (role) return role;

    try {
      const roleFromUrl = norm(new URL(location.href).searchParams.get(ANCHOR_ROLE_QUERY_KEY));
      if (roleFromUrl) return roleFromUrl;
    } catch {}

    return '';
  }

  function getAnchorToken() {
    const token = norm(readSession(SS_KEYS.anchorToken));
    if (token) return token;

    try {
      return norm(new URL(location.href).searchParams.get(ANCHOR_TOKEN_QUERY_KEY));
    } catch {
      return '';
    }
  }

  function isAnchorTab() {
    return !!getAnchorRole();
  }

  function adoptAnchorMarkerFromUrl() {
    let url;
    try {
      url = new URL(location.href);
    } catch {
      return;
    }

    if (url.searchParams.get(ANCHOR_QUERY_KEY) !== '1') return;

    const role = norm(url.searchParams.get(ANCHOR_ROLE_QUERY_KEY));
    const token = norm(url.searchParams.get(ANCHOR_TOKEN_QUERY_KEY));
    if (!role) return;

    writeSession(SS_KEYS.anchorRole, role);
    if (token) writeSession(SS_KEYS.anchorToken, token);

    url.searchParams.delete(ANCHOR_QUERY_KEY);
    url.searchParams.delete(ANCHOR_ROLE_QUERY_KEY);
    url.searchParams.delete(ANCHOR_TOKEN_QUERY_KEY);

    try {
      history.replaceState(history.state, document.title, url.toString());
    } catch {}
  }

  function readAnchorState() {
    const value = readGM(GM_KEYS.anchorState, null);
    return isPlainObject(value) ? value : {};
  }

  function writeAnchorState(next) {
    writeGM(GM_KEYS.anchorState, isPlainObject(next) ? next : {});
  }

  function readAuthHold() {
    const value = readGM(GM_KEYS.authHold, null);
    return isPlainObject(value) ? value : null;
  }

  function writeAuthHold(next) {
    writeGM(GM_KEYS.authHold, isPlainObject(next) ? next : null);
  }

  function readSharedTabOpenRequest() {
    const value = readGM(GM_KEYS.tabOpenRequest, null);
    return isPlainObject(value) ? value : null;
  }

  function writeSharedTabOpenRequest(next) {
    writeGM(GM_KEYS.tabOpenRequest, isPlainObject(next) ? next : null);
  }

  function bridgeSharedKeyToLocal(key, value) {
    const current = readLocalJson(key);
    const currentText = current == null ? '' : JSON.stringify(current);
    const nextText = value == null ? '' : JSON.stringify(value);
    if (currentText === nextText) return false;
    writeLocalJson(key, value);
    return true;
  }

  function bridgeSupervisorStateToLocal() {
    bridgeSharedKeyToLocal(GM_KEYS.anchorState, readAnchorState());
    bridgeSharedKeyToLocal(GM_KEYS.authHold, readAuthHold());
    bridgeSharedKeyToLocal(GM_KEYS.tabOpenRequest, readSharedTabOpenRequest());
  }

  function getAnchorPendingMap(registry = null) {
    const source = isPlainObject(registry) ? registry : readAnchorState();
    return isPlainObject(source.pendingOpen) ? source.pendingOpen : {};
  }

  function getAnchorPendingEntry(role, registry = null) {
    if (!role) return null;
    const pending = getAnchorPendingMap(registry);
    return isPlainObject(pending[role]) ? pending[role] : null;
  }

  function isAnchorPendingActive(role, registry = null) {
    const entry = getAnchorPendingEntry(role, registry);
    if (!entry) return false;
    const requestedAtMs = parseTimeMs(entry.requestedAt || entry.updatedAt || '');
    if (!requestedAtMs) return false;
    return (Date.now() - requestedAtMs) <= CFG.anchorOpenPendingMs;
  }

  function setAnchorPendingOpen(role, patch = {}) {
    if (!role) return null;
    const registry = readAnchorState();
    const pending = getAnchorPendingMap(registry);
    const prior = isPlainObject(pending[role]) ? pending[role] : {};
    const next = {
      ...prior,
      role,
      requestedByTabId: state.tabId,
      requestedAt: norm(prior.requestedAt || '') || nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + CFG.anchorOpenPendingMs).toISOString(),
      ...patch
    };
    writeAnchorState({
      ...registry,
      pendingOpen: {
        ...pending,
        [role]: next
      }
    });
    return next;
  }

  function clearAnchorPendingOpen(role) {
    if (!role) return false;
    const registry = readAnchorState();
    const pending = getAnchorPendingMap(registry);
    if (!isPlainObject(pending[role])) return false;
    const nextPending = { ...pending };
    delete nextPending[role];
    const nextRegistry = { ...registry };
    if (Object.keys(nextPending).length) {
      nextRegistry.pendingOpen = nextPending;
    } else {
      delete nextRegistry.pendingOpen;
    }
    writeAnchorState(nextRegistry);
    return true;
  }

  function getAnchorOpenAttemptMap(registry = null) {
    const source = isPlainObject(registry) ? registry : readAnchorState();
    return isPlainObject(source.openAttempts) ? source.openAttempts : {};
  }

  function getAnchorOpenAttemptEntry(role, registry = null) {
    if (!role) return null;
    const attempts = getAnchorOpenAttemptMap(registry);
    return isPlainObject(attempts[role]) ? attempts[role] : null;
  }

  function isAnchorOpenCooldownActive(role, registry = null) {
    const entry = getAnchorOpenAttemptEntry(role, registry);
    if (!entry) return false;
    const attemptedAtMs = parseTimeMs(entry.attemptedAt || entry.updatedAt || '');
    if (!attemptedAtMs) return false;
    return (Date.now() - attemptedAtMs) <= CFG.anchorOpenCooldownMs;
  }

  function setAnchorOpenAttempt(role, patch = {}) {
    if (!role) return null;
    const registry = readAnchorState();
    const attempts = getAnchorOpenAttemptMap(registry);
    const prior = isPlainObject(attempts[role]) ? attempts[role] : {};
    const next = {
      ...prior,
      role,
      attemptedByTabId: state.tabId,
      attemptedAt: norm(prior.attemptedAt || '') || nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + CFG.anchorOpenCooldownMs).toISOString(),
      ...patch
    };
    writeAnchorState({
      ...registry,
      openAttempts: {
        ...attempts,
        [role]: next
      }
    });
    return next;
  }

  function clearAnchorOpenAttempt(role) {
    if (!role) return false;
    const registry = readAnchorState();
    const attempts = getAnchorOpenAttemptMap(registry);
    if (!isPlainObject(attempts[role])) return false;
    const nextAttempts = { ...attempts };
    delete nextAttempts[role];
    const nextRegistry = { ...registry };
    if (Object.keys(nextAttempts).length) {
      nextRegistry.openAttempts = nextAttempts;
    } else {
      delete nextRegistry.openAttempts;
    }
    writeAnchorState(nextRegistry);
    return true;
  }

  function compareTabIds(left, right) {
    return String(left || '').localeCompare(String(right || ''));
  }

  function isLeaseActive(entry, ttlMs = CFG.anchorLeaseTtlMs) {
    if (!isPlainObject(entry)) return false;
    const updatedAtMs = parseTimeMs(entry.updatedAt || entry.claimedAt || '');
    if (!updatedAtMs) return false;
    return (Date.now() - updatedAtMs) <= ttlMs;
  }

  function claimAnchorLease(role, patch = {}) {
    if (!role) return null;
    const registry = readAnchorState();
    const current = isPlainObject(registry[role]) ? registry[role] : null;
    const currentTabId = norm(current?.tabId || '');

    if (isLeaseActive(current) && currentTabId && currentTabId !== state.tabId) {
      return current;
    }

    const now = nowIso();
    const next = {
      ...(current || {}),
      ...patch,
      role,
      tabId: state.tabId,
      host: location.hostname,
      url: location.href,
      claimedAt: norm(current?.claimedAt || '') || now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + CFG.anchorLeaseTtlMs).toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };

    const nextRegistry = {
      ...registry,
      [role]: next
    };
    writeAnchorState(nextRegistry);

    let confirmed = readAnchorState()?.[role];
    if (isPlainObject(confirmed) && norm(confirmed.tabId || '') === state.tabId) {
      return confirmed;
    }

    const confirmedTabId = norm(confirmed?.tabId || '');
    if (confirmedTabId && compareTabIds(state.tabId, confirmedTabId) < 0) {
      const retryRegistry = readAnchorState();
      const retryCurrent = isPlainObject(retryRegistry[role]) ? retryRegistry[role] : null;
      if (!isLeaseActive(retryCurrent) || compareTabIds(state.tabId, norm(retryCurrent?.tabId || '')) < 0) {
        const retryNow = nowIso();
        const retryNext = {
          ...(retryCurrent || next),
          ...patch,
          role,
          tabId: state.tabId,
          host: location.hostname,
          url: location.href,
          claimedAt: norm(next.claimedAt || '') || retryNow,
          updatedAt: retryNow,
          expiresAt: new Date(Date.now() + CFG.anchorLeaseTtlMs).toISOString(),
          source: SCRIPT_NAME,
          version: VERSION
        };
        writeAnchorState({
          ...retryRegistry,
          [role]: retryNext
        });
        confirmed = readAnchorState()?.[role];
        if (isPlainObject(confirmed) && norm(confirmed.tabId || '') === state.tabId) {
          return confirmed;
        }
      }
    }

    return isPlainObject(confirmed) ? confirmed : next;
  }

  function clearAnchorLease(role) {
    if (!role) return false;
    const registry = readAnchorState();
    const current = isPlainObject(registry[role]) ? registry[role] : null;
    if (!current || norm(current.tabId || '') !== state.tabId) return false;
    delete registry[role];
    writeAnchorState(registry);
    return true;
  }

  function readPreferredGwpcHost() {
    const registry = readAnchorState();
    const preferred = norm(registry.preferredGwpcHost || '');
    if (preferred) return preferred;
    const gwpcEntry = registry.gwpc;
    if (norm(gwpcEntry?.host || '')) return norm(gwpcEntry.host);
    return 'policycenter.farmersinsurance.com';
  }

  function rememberPreferredGwpcHost(hostname) {
    const host = norm(hostname || '');
    if (!host) return;
    const registry = readAnchorState();
    if (norm(registry.preferredGwpcHost || '') === host) return;
    writeAnchorState({
      ...registry,
      preferredGwpcHost: host,
      preferredGwpcHostUpdatedAt: nowIso()
    });
  }

  function getActiveAuthHold() {
    const hold = readAuthHold();
    const holdState = lower(hold?.state || '');
    if (holdState !== 'recovering' && holdState !== 'blocked') return null;
    if (!isLeaseActive(hold, CFG.authHoldTtlMs)) return null;
    return hold;
  }

  function isProtectedTab() {
    if (isAnchorTab()) return true;
    const hold = getActiveAuthHold();
    return !!hold && norm(hold.ownerTabId || '') === state.tabId;
  }

  function buildAnchorUrl(role, hostOverride = '') {
    if (role === 'apex') {
      const baseUrl = chooseApexWakeUrl();
      const url = new URL(baseUrl, location.href);
      url.searchParams.set(ANCHOR_QUERY_KEY, '1');
      url.searchParams.set(ANCHOR_ROLE_QUERY_KEY, 'apex');
      url.searchParams.set(ANCHOR_TOKEN_QUERY_KEY, `apex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
      return url.toString();
    }

    if (role === 'gwpc') {
      const host = norm(hostOverride || readPreferredGwpcHost()) || 'policycenter.farmersinsurance.com';
      const url = new URL(`https://${host}/pc/PolicyCenter.do`);
      url.searchParams.set(ANCHOR_QUERY_KEY, '1');
      url.searchParams.set(ANCHOR_ROLE_QUERY_KEY, 'gwpc');
      url.searchParams.set(ANCHOR_TOKEN_QUERY_KEY, `gwpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
      return url.toString();
    }

    return '';
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

  function writeLocalJson(key, value) {
    try {
      if (value == null || value === '') {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch {}
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; }
    catch { return ''; }
  }

  function clearSession(key) {
    try { sessionStorage.removeItem(key); } catch {}
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
    if (state.destroyed) return;
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const raw = Array.isArray(state.logs) ? state.logs : [];
    const lines = raw.map(entry => (typeof entry === 'string' ? entry : (entry?.line || '')));
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    if (state.destroyed) return;
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) { try { req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {} }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logs.length = 0;
    _lastLogPersistAt = 0;
    try { renderLogs(); } catch {}
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    if (state.destroyed) return;
    persistLogsThrottled();
    checkLogClearRequest();
  }

  function setStatus(text) {
    if (state.ui.status) state.ui.status.textContent = text;
  }

  function handlePageUnload() {
    clearIgnoreCloseLeaseIfOwned();
    clearAnchorLease(getAnchorRole());
    persistPanelPos();
  }

  function parseTimeMs(value) {
    const ms = Date.parse(norm(value || ''));
    return Number.isFinite(ms) ? ms : 0;
  }

  function formatAge(ms) {
    const safe = Math.max(0, Number(ms || 0));
    if (safe < 1000) return '0s';
    const seconds = Math.floor(safe / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
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
      isLegacyTimeoutOwnedProductPayload(localPayload) ? null : localPayload,
      isLegacyTimeoutOwnedProductPayload(gmPayload) ? null : gmPayload,
      (value) => extractProductAzId(value),
      (value) => getProductSavedMs(value)
    );
  }

  function readDownloadableMirrorSnapshot() {
    const finalPayload = readPreferredMirroredFinalPayload();
    const finalReady = readGM(GM_KEYS.finalReady, null);
    const homePayload = readPreferredMirroredProductPayload(GM_KEYS.homePayload);

    const azId = norm(
      finalPayload?.azId
      || finalReady?.azId
      || extractProductAzId(homePayload)
      || ''
    );

    if (!azId && !isPlainObject(finalPayload) && !isPlainObject(homePayload)) {
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
      homePayload: isPlainObject(homePayload) ? deepClone(homePayload) : {}
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

  function getVisibleGuidewireHeader() {
    const selectors = [
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '.gw-Wizard--Title',
      '[role="heading"][aria-level="1"]'
    ];
    for (const selector of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!visible(node)) continue;
          const text = norm(node.textContent || '');
          if (text) return text;
        }
      } catch {}
    }
    return '';
  }

  function readCurrentAzIdForCloseFallback() {
    const keys = [
      'tm_pc_current_job_v1',
      'tm_pc_webhook_bundle_v1',
      'tm_pc_home_quote_grab_payload_v1'
    ];
    for (const key of keys) {
      const value = readLocalJson(key);
      const data = isPlainObject(value?.data) ? value.data : value;
      const azId = norm(
        value?.['AZ ID']
        || value?.azId
        || value?.currentJob?.['AZ ID']
        || data?.['AZ ID']
        || data?.azId
        || data?.currentJob?.['AZ ID']
        || ''
      );
      if (azId) return azId;
    }
    return norm(state.activeSignal?.azId || readMirroredPayloadMeta()?.azId || '');
  }

  function extractAzIdFromJobValue(value) {
    if (!isPlainObject(value)) return '';
    const data = isPlainObject(value.data) ? value.data : value;
    return norm(
      value?.['AZ ID']
      || value?.azId
      || value?.ticketId
      || value?.currentJob?.['AZ ID']
      || value?.currentJob?.azId
      || value?.currentJob?.ticketId
      || value?.az?.['AZ ID']
      || value?.az?.azId
      || value?.az?.ticketId
      || data?.['AZ ID']
      || data?.azId
      || data?.ticketId
      || data?.currentJob?.['AZ ID']
      || data?.currentJob?.azId
      || data?.currentJob?.ticketId
      || ''
    );
  }

  function readCurrentAzIdForLexFailure() {
    const keys = [
      GM_KEYS.azCurrentJob,
      GM_KEYS.sharedJob,
      GM_KEYS.currentJob
    ];

    for (const key of keys) {
      const azId = extractAzIdFromJobValue(readGM(key, null));
      if (azId) return azId;
    }

    for (const key of keys) {
      const azId = extractAzIdFromJobValue(readLocalJson(key));
      if (azId) return azId;
    }

    return '';
  }

  function findLexSnagMessage() {
    if (!isLexHost()) return null;
    const selectors = [
      'h1[title]',
      'h2[title]',
      'h3[title]',
      '.slds-card__header-title[title]',
      '.slds-truncate[title]',
      'h1',
      'h2',
      'h3'
    ];

    for (const selector of selectors) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(selector)); } catch {}
      for (const node of nodes) {
        if (!visible(node)) continue;
        const text = norm(node.getAttribute('title') || node.textContent || '');
        if (/^we hit a snag\.?$/i.test(text) || /we hit a snag\./i.test(text)) return node;
      }
    }
    return null;
  }

  function publishMissingPayloadTrigger(ticketId, reason = 'APEX/LEX HIT A SNAG') {
    const cleanTicketId = norm(ticketId || '');
    if (!cleanTicketId) return false;

    const trigger = {
      ready: true,
      ticketId: cleanTicketId,
      azId: cleanTicketId,
      reason: norm(reason || 'APEX/LEX HIT A SNAG') || 'APEX/LEX HIT A SNAG',
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };

    try { localStorage.setItem(GM_KEYS.missingPayloadTrigger, JSON.stringify(trigger)); } catch {}
    writeGM(GM_KEYS.missingPayloadTrigger, trigger);
    log(`Triggered missing payload fallback from LEX snag | ${cleanTicketId} | ${trigger.reason}`);
    return true;
  }

  function closeLexTabWithReason(options = {}) {
    if (isProtectedTab()) {
      setStatus('Protected APEX tab');
      return;
    }
    const azId = norm(options.azId || '');
    const attemptLabel = norm(options.attemptLabel || 'LEX close requested') || 'LEX close requested';
    const statusText = norm(options.statusText || 'Closing LEX tab') || 'Closing LEX tab';
    const blockedLabel = norm(options.blockedLabel || 'Close blocked by browser after LEX close request') || 'Close blocked by browser after LEX close request';

    state.closeAttempted = true;
    writeSession(SS_KEYS.closeAttempted, '1');
    state.closeAttempts += 1;

    log(`${attemptLabel}${azId ? ` | AZ ${azId}` : ''} (${state.closeAttempts}/${CFG.maxCloseAttempts})`);
    setStatus(statusText);
    tryCloseCurrentTab();

    setTimeout(() => {
      if (state.destroyed || window.closed) return;
      if (state.closeAttempts < CFG.maxCloseAttempts) {
        closeLexTabWithReason(options);
        return;
      }
      log(blockedLabel);
      setStatus('Close blocked');
    }, CFG.closeRetryMs);
  }

  function closeLexTabAfterSnag(azId = '') {
    closeLexTabWithReason({
      azId,
      attemptLabel: 'LEX snag detected. Closing tab',
      statusText: 'LEX snag -> failed path',
      blockedLabel: 'Close blocked by browser after LEX snag'
    });
  }

  function checkLexSnagFailure() {
    if (isProtectedTab()) return false;
    const snag = findLexSnagMessage();
    if (!snag) return false;

    const azId = readCurrentAzIdForLexFailure();
    const snagText = norm(snag.getAttribute('title') || snag.textContent || 'We hit a snag.');
    const handledKey = `${azId || '(missing)'}|${snagText}`;
    if (state.lexSnagHandledKey === handledKey) return false;
    state.lexSnagHandledKey = handledKey;

    if (azId) {
      publishMissingPayloadTrigger(azId, 'APEX/LEX HIT A SNAG');
    } else {
      log('LEX snag detected, but no current AZ ID was available; closing tab without fallback trigger');
    }

    closeLexTabAfterSnag(azId);
    return true;
  }

  function checkLexFrontTabFailsafe() {
    if (!isLexHost()) return false;
    if (isProtectedTab()) return false;
    if (state.closeAttempted) return false;

    if (!isFrontActiveTab()) {
      state.lexFrontActiveSinceAt = 0;
      state.lexFrontArmedLogged = false;
      return false;
    }

    if (!state.lexFrontActiveSinceAt) {
      state.lexFrontActiveSinceAt = Date.now();
      if (!state.lexFrontArmedLogged) {
        state.lexFrontArmedLogged = true;
        log(`LEX front-tab failsafe armed for ${Math.round(CFG.lexFrontMaxOpenMs / 1000)}s`);
      }
      return false;
    }

    const ageMs = Date.now() - state.lexFrontActiveSinceAt;
    if (ageMs < CFG.lexFrontMaxOpenMs) return false;

    const azId = readCurrentAzIdForLexFailure();
    const handledKey = `${azId || '(missing)'}|lex-front-open`;
    if (state.lexFrontHandledKey === handledKey) return false;
    state.lexFrontHandledKey = handledKey;

    log(`LEX stayed open in front for ${Math.round(ageMs / 1000)}s; closing tab${azId ? ` | AZ ${azId}` : ''}`);
    closeLexTabWithReason({
      azId,
      attemptLabel: 'LEX 1-minute front-tab failsafe reached. Closing tab',
      statusText: 'LEX front-tab failsafe',
      blockedLabel: 'Close blocked by browser after LEX 1-minute front-tab failsafe'
    });
    return true;
  }

  function getHeartbeatKind() {
    if (isAzHost()) return 'az';
    if (isLexHost()) return 'lex';
    if (isGwpcHost()) return 'gwpc';
    return '';
  }

  function readTabHeartbeats() {
    const gmValue = readGM(GM_KEYS.tabHeartbeats, null);
    if (isPlainObject(gmValue)) return gmValue;
    return {};
  }

  function saveTabHeartbeats(next) {
    writeGM(GM_KEYS.tabHeartbeats, isPlainObject(next) ? next : {});
  }

  function writeTabHeartbeat(force = false) {
    const kind = getHeartbeatKind();
    if (!kind) return;
    const now = Date.now();
    if (!force && (now - Number(state.lastTabHeartbeatAt || 0)) < CFG.tabHeartbeatMs) return;
    state.lastTabHeartbeatAt = now;
    const sessionContext = state.lastSessionContext || getCurrentSessionContext();

    const heartbeats = readTabHeartbeats();
    heartbeats[kind] = {
      kind,
      tabId: state.tabId,
      host: location.hostname,
      url: location.href,
      title: document.title,
      sessionState: norm(sessionContext?.sessionState || 'healthy') || 'healthy',
      pageKind: norm(sessionContext?.pageKind || '') || kind,
      authMarker: norm(sessionContext?.authMarker || ''),
      anchorRole: norm(sessionContext?.role || ''),
      anchorToken: getAnchorToken(),
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    saveTabHeartbeats(heartbeats);
  }

  function getLastHeartbeatMsForKind(kind, heartbeats = null) {
    const value = isPlainObject(heartbeats) ? heartbeats : readTabHeartbeats();
    return parseTimeMs(value?.[kind]?.updatedAt);
  }

  function getVisibleLoginFormContext() {
    const passwordInput = Array.from(document.querySelectorAll('input[type="password"]'))
      .find((el) => visible(el));
    if (!passwordInput) return null;

    const form = passwordInput.closest('form') || document;
    const userInput = Array.from(form.querySelectorAll('input[type="text"], input[type="email"], input[name], input[id]'))
      .find((el) => visible(el) && el !== passwordInput) || null;
    const submitButton = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))
      .find((el) => visible(el) && !el.disabled);

    return {
      form,
      userInput,
      passwordInput,
      submitButton
    };
  }

  function getElementLabel(el) {
    if (!el || !(el instanceof Element)) return '';
    return norm([
      el.textContent,
      el.getAttribute?.('title'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('value'),
      el.getAttribute?.('name')
    ].filter(Boolean).join(' '));
  }

  function isTrustedDeviceAgreeLabel(label) {
    const text = lower(label);
    if (!text) return false;
    if (text === 'i agree') return true;
    if (/\bagree\b/.test(text) && /\b(i|yes|trust|device|remember|recognize)\b/.test(text)) return true;
    if (/\b(trust|remember|recognize)\b/.test(text) && /\b(device|browser|me)\b/.test(text)) return true;
    return false;
  }

  function findTrustedDeviceAgreeButton() {
    const buttons = Array.from(document.querySelectorAll('#okta-signin-submit, button, input[type="submit"], input[type="button"], [role="button"]'));
    return buttons.find((el) => visible(el) && isTrustedDeviceAgreeLabel(getElementLabel(el))) || null;
  }

  function inferExternalAuthRole() {
    const currentRole = getAnchorRole();
    if (currentRole) return currentRole;

    const lowerHref = lower(location.href || '');
    if (
      /salesforce|lightning\.force\.com|farmersagent\.(?:my\.salesforce|lightning\.force)\.com/.test(lowerHref)
      || (isEagentSamlHost() && /farmersinsurance\.okta\.com\/app\/salesforce/.test(lowerHref))
    ) {
      return 'apex';
    }
    if (/policycenter|guidewire|loginpage\.do|j_security_check/.test(lowerHref)) {
      return 'gwpc';
    }

    const registry = readAnchorState();
    const apexPending = isAnchorPendingActive('apex', registry);
    const gwpcPending = isAnchorPendingActive('gwpc', registry);
    if (apexPending && !gwpcPending) return 'apex';
    if (gwpcPending && !apexPending) return 'gwpc';

    const hold = getActiveAuthHold();
    const holdSystem = norm(hold?.system || '');
    if (holdSystem === 'apex' || holdSystem === 'gwpc') return holdSystem;

    return '';
  }

  function getCurrentSessionContext() {
    const role = getAnchorRole() || inferExternalAuthRole();
    const title = norm(document.title || '');
    const href = String(location.href || '');
    const lowerHref = href.toLowerCase();
    const lowerTitle = title.toLowerCase();
    const bodyText = lower(norm(document.body?.innerText || '').slice(0, 2000));
    const loginForm = getVisibleLoginFormContext();
    const agreeButton = findTrustedDeviceAgreeButton();
    const agreeVisible = !!agreeButton;

    if (isLexHost() || ((isOktaHost() || isEagentSamlHost()) && role === 'apex')) {
      const hasLightningChrome = !!document.querySelector('one-app, .slds-context-bar, [data-aura-class*="oneApp"]');
      const hasChallengeText = /verify|multifactor|security code|challenge/.test(bodyText);
      let sessionState = hasLightningChrome ? 'healthy' : 'recovering';
      let pageKind = hasLightningChrome ? 'lightning' : 'loading';
      let authMarker = '';

      if (agreeVisible) {
        sessionState = 'recovering';
        pageKind = 'trusted-device';
        authMarker = 'i-agree';
      } else if (loginForm) {
        sessionState = 'login_required';
        pageKind = 'credential-form';
        authMarker = 'credential-form';
      } else if (/\/login|sign[\s-]?in|okta|saml|frontdoor/i.test(lowerHref) || /sign in|okta/i.test(lowerTitle)) {
        sessionState = 'login_required';
        pageKind = 'login';
        authMarker = 'login-route';
      } else if (hasChallengeText) {
        sessionState = 'blocked';
        pageKind = 'challenge';
        authMarker = 'unexpected-challenge';
      }

      return {
        kind: 'lex',
        role,
        sessionState,
        pageKind,
        authMarker,
        loginForm,
        agreeButton: agreeVisible ? agreeButton : null
      };
    }

    if (isGwpcHost() || ((isOktaHost() || isEagentSamlHost()) && role === 'gwpc')) {
      const hasGuidewireChrome = !!(getVisibleGuidewireHeader() || document.querySelector('.gw-TabBar, .gw-Wizard--Title, .gw-TitleBar--title'));
      const hasChallengeText = /verify|multifactor|security code|challenge/.test(bodyText);
      let sessionState = hasGuidewireChrome ? 'healthy' : 'recovering';
      let pageKind = hasGuidewireChrome ? 'guidewire' : 'loading';
      let authMarker = '';

      if (loginForm) {
        sessionState = 'login_required';
        pageKind = 'credential-form';
        authMarker = 'credential-form';
      } else if (/loginpage\.do|\/login|j_security_check|sign[\s-]?in/.test(lowerHref) || /sign in|login/.test(lowerTitle)) {
        sessionState = 'login_required';
        pageKind = 'login';
        authMarker = 'login-route';
      } else if (hasChallengeText) {
        sessionState = 'blocked';
        pageKind = 'challenge';
        authMarker = 'unexpected-challenge';
      }

      return {
        kind: 'gwpc',
        role,
        sessionState,
        pageKind,
        authMarker,
        loginForm,
        agreeButton: null
      };
    }

    if (isAzHost()) {
      return {
        kind: 'az',
        role,
        sessionState: 'healthy',
        pageKind: 'agencyzoom',
        authMarker: '',
        loginForm: null,
        agreeButton: null
      };
    }

    return {
      kind: '',
      role,
      sessionState: 'healthy',
      pageKind: '',
      authMarker: '',
      loginForm: null,
      agreeButton: null
    };
  }

  function buildSessionContextKey(context) {
    return [
      norm(context?.kind || ''),
      norm(context?.pageKind || ''),
      norm(context?.authMarker || ''),
      norm(location.pathname || ''),
      norm(location.search || '')
    ].join('|');
  }

  function maybeAutoSubmitCurrentLogin(context) {
    if (!context || (context.kind !== 'lex' && context.kind !== 'gwpc')) return context;
    const loginForm = context.loginForm;
    const agreeButton = context.agreeButton;

    if (agreeButton && visible(agreeButton)) {
      const actionKey = `agree|${buildSessionContextKey(context)}`;
      if (readSession(SS_KEYS.authLastSubmitKey) !== actionKey) {
        try { agreeButton.click?.(); } catch {}
        try { agreeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window })); } catch {}
        writeSession(SS_KEYS.authLastSubmitKey, actionKey);
        context.sessionState = 'recovering';
        context.authMarker = 'i-agree-submit';
      }
      return context;
    }

    if (!loginForm?.submitButton) return context;

    const userValue = norm(loginForm.userInput?.value || '');
    const passwordValue = norm(loginForm.passwordInput?.value || '');
    if ((!userValue && loginForm.userInput) || !passwordValue) return context;

    const actionKey = `login|${buildSessionContextKey(context)}|${userValue.length}|${passwordValue.length}`;
    if (readSession(SS_KEYS.authLastSubmitKey) === actionKey) return context;

    try { loginForm.submitButton.click?.(); } catch {}
    try {
      loginForm.submitButton.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    } catch {}
    writeSession(SS_KEYS.authLastSubmitKey, actionKey);
    context.sessionState = 'recovering';
    context.authMarker = 'autofill-submit';
    return context;
  }

  function updateAuthHoldFromContext(context) {
    if (!context?.role || (context.role !== 'apex' && context.role !== 'gwpc')) return;

    const current = readAuthHold();
    const sameOwner = norm(current?.ownerTabId || '') === state.tabId;
    const sameSystem = norm(current?.system || '') === context.role;
    const baseClaimedAt = sameOwner || sameSystem ? norm(current?.claimedAt || '') : '';
    const claimedAt = baseClaimedAt || nowIso();
    const claimedAtMs = parseTimeMs(claimedAt);
    const hasAutofill = !!(
      norm(context.loginForm?.passwordInput?.value || '')
      && (!context.loginForm?.userInput || norm(context.loginForm.userInput.value || ''))
    );
    const emptyCredentialsTooLong = !!context.loginForm && !hasAutofill && claimedAtMs && (Date.now() - claimedAtMs) >= CFG.authEmptyCredentialsMs;

    let holdState = context.sessionState === 'blocked' ? 'blocked' : 'recovering';
    let reason = norm(context.authMarker || context.pageKind || context.sessionState || 'auth-recovery');

    if (emptyCredentialsTooLong) {
      holdState = 'blocked';
      reason = 'credentials not autofilled';
    }

    if (claimedAtMs && (Date.now() - claimedAtMs) >= CFG.authRecoveryTimeoutMs) {
      holdState = 'blocked';
      reason = 'auth recovery timed out';
    }

    writeAuthHold({
      system: context.role,
      state: holdState,
      ownerTabId: state.tabId,
      claimedAt,
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + CFG.authHoldTtlMs).toISOString(),
      reason,
      host: location.hostname,
      url: location.href,
      title: document.title,
      attempt: Number(current?.attempt || 0) + (sameOwner ? 0 : 1),
      requestId: norm(current?.requestId || '') || `auth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    });
  }

  function upsertCoordinatorAuthHold(system, reason, preferredState = 'recovering') {
    const current = readAuthHold();
    const sameSystem = norm(current?.system || '') === norm(system || '');
    const claimedAt = sameSystem ? norm(current?.claimedAt || '') : '';
    const baseClaimedAt = claimedAt || nowIso();
    const claimedAtMs = parseTimeMs(baseClaimedAt);

    let holdState = preferredState === 'blocked' ? 'blocked' : 'recovering';
    let holdReason = norm(reason || `${system} auth recovery`) || `${system} auth recovery`;
    if (holdState !== 'blocked' && claimedAtMs && (Date.now() - claimedAtMs) >= CFG.authRecoveryTimeoutMs) {
      holdState = 'blocked';
      holdReason = `${String(system || 'anchor').toUpperCase()} anchor recovery timed out`;
    }

    const next = {
      system,
      state: holdState,
      ownerTabId: state.tabId,
      claimedAt: baseClaimedAt,
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + CFG.authHoldTtlMs).toISOString(),
      reason: holdReason,
      host: location.hostname,
      url: location.href,
      title: document.title,
      attempt: sameSystem ? Math.max(1, Number(current?.attempt || 1)) : (Math.max(0, Number(current?.attempt || 0)) + 1),
      requestId: sameSystem ? norm(current?.requestId || '') || `auth_${Date.now().toString(36)}` : `auth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    };
    writeAuthHold(next);
    return next;
  }

  function clearAuthHoldForRole(role) {
    const current = readAuthHold();
    if (!current) return;
    if (norm(current.system || '') !== norm(role || '')) return;
    writeAuthHold(null);
  }

  function clearStaleAuthHoldIfNeeded() {
    const hold = readAuthHold();
    if (!hold) return false;
    const holdState = lower(hold.state || '');
    if (holdState !== 'recovering' && holdState !== 'blocked') return false;
    if (isLeaseActive(hold, CFG.authHoldTtlMs)) return false;
    writeAuthHold(null);
    log(`Cleared stale auth hold for ${norm(hold.system || 'unknown').toUpperCase() || 'UNKNOWN'}`);
    return true;
  }

  function ensureAuthBanner(text, blocked = false) {
    const message = norm(text || '');
    if (!message) {
      try { state.authBannerEl?.remove(); } catch {}
      state.authBannerEl = null;
      return;
    }

    let banner = state.authBannerEl;
    if (!banner || !banner.isConnected) {
      banner = document.createElement('div');
      Object.assign(banner.style, {
        position: 'fixed',
        top: '12px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: String(CFG.zIndex),
        maxWidth: 'min(92vw, 640px)',
        padding: '12px 16px',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,.28)',
        font: '700 13px/1.4 Arial, sans-serif',
        color: '#fff',
        textAlign: 'center'
      });
      document.documentElement.appendChild(banner);
      state.authBannerEl = banner;
    }

    banner.style.background = blocked ? '#991b1b' : '#92400e';
    banner.textContent = message;
  }

  function getWatchAlertWebhookUrl() {
    try {
      const localValue = localStorage.getItem('tm_pc_header_timeout_watch_alert_webhook_url_v1') || '';
      return norm(readGM('tm_pc_header_timeout_watch_alert_webhook_url_v1', '') || localValue || '');
    } catch {
      return norm(readGM('tm_pc_header_timeout_watch_alert_webhook_url_v1', '') || '');
    }
  }

  function sendAuthBlockedAlert(reason) {
    if ((Date.now() - Number(state.lastAuthAlertAt || 0)) < CFG.authBlockedAlertRepeatMs) return;
    state.lastAuthAlertAt = Date.now();

    const endpoint = getWatchAlertWebhookUrl();
    if (!endpoint || typeof GM_xmlhttpRequest !== 'function') return;

    try {
      GM_xmlhttpRequest({
        method: 'POST',
        url: endpoint,
        headers: {
          'Content-Type': 'application/json'
        },
        data: JSON.stringify({
          message: WATCH_ALERT_MESSAGE,
          event: 'home_auth_blocked',
          source: SCRIPT_NAME,
          version: VERSION,
          host: location.hostname,
          reason: norm(reason || 'auth blocked'),
          url: location.href,
          detectedAt: nowIso()
        }),
        timeout: 20000
      });
    } catch {}
  }

  function syncCurrentTabSessionState() {
    adoptAnchorMarkerFromUrl();
    let context = getCurrentSessionContext();
    context = maybeAutoSubmitCurrentLogin(context);
    state.lastSessionContext = context;

    if (context.kind === 'gwpc' && context.sessionState === 'healthy') {
      rememberPreferredGwpcHost(location.hostname);
    }

    if (context.role === 'apex' || context.role === 'gwpc') {
      const existingLease = readAnchorState()?.[context.role];
      claimAnchorLease(context.role, {
        anchorToken: getAnchorToken(),
        sessionState: context.sessionState,
        pageKind: context.pageKind,
        authMarker: context.authMarker,
        lastHealthyAt: context.sessionState === 'healthy' ? nowIso() : norm(existingLease?.lastHealthyAt || ''),
        lastLoginRequiredAt: context.sessionState !== 'healthy' ? nowIso() : norm(existingLease?.lastLoginRequiredAt || '')
      });
      clearAnchorPendingOpen(context.role);
      clearAnchorOpenAttempt(context.role);

      if (context.sessionState === 'healthy') {
        clearAuthHoldForRole(context.role);
        ensureAuthBanner('', false);
      } else {
        updateAuthHoldFromContext(context);
        ensureAuthBanner(`${context.role.toUpperCase()} ${context.sessionState.replace(/_/g, ' ')}: ${context.authMarker || context.pageKind || 'login required'}`, context.sessionState === 'blocked');
        if (context.sessionState === 'blocked') {
          sendAuthBlockedAlert(context.authMarker || context.pageKind || 'auth blocked');
        }
      }
    }

    if (!isAnchorTab()) {
      ensureAuthBanner('', false);
    }
  }

  function readApexWakeState() {
    const value = readGM(GM_KEYS.apexWakeState, null);
    return isPlainObject(value) ? value : {};
  }

  function saveApexWakeState(next) {
    writeGM(GM_KEYS.apexWakeState, isPlainObject(next) ? next : {});
  }

  function ensureCoordinatorLease() {
    if (!isAzHost()) return null;
    return claimAnchorLease('coordinator', {
      sessionState: 'healthy',
      pageKind: 'agencyzoom',
      authMarker: '',
      lastHealthyAt: nowIso()
    });
  }

  function isCoordinatorOwner() {
    const registry = readAnchorState();
    return isLeaseActive(registry.coordinator) && norm(registry.coordinator?.tabId || '') === state.tabId;
  }

  function syncLocalOpenRequestToShared() {
    const localRequest = readLocalJson(GM_KEYS.tabOpenRequest);
    if (!isPlainObject(localRequest) || !norm(localRequest.requestId || '')) return;
    const requestKey = `${norm(localRequest.requestId || '')}|${norm(localRequest.status || '')}|${norm(localRequest.requestedAt || '')}`;
    if (state.lastBridgedOpenRequestKey === requestKey) return;

    const current = readSharedTabOpenRequest();
    const currentRequestedMs = parseTimeMs(current?.requestedAt || '');
    const nextRequestedMs = parseTimeMs(localRequest?.requestedAt || '');
    if (!current || nextRequestedMs >= currentRequestedMs || norm(current.requestId || '') === norm(localRequest.requestId || '')) {
      writeSharedTabOpenRequest(localRequest);
      state.lastBridgedOpenRequestKey = requestKey;
    }
  }

  function setSharedOpenRequestStatus(request, status, patch = {}) {
    if (!isPlainObject(request) || !norm(request.requestId || '')) return null;
    const next = {
      ...request,
      ...patch,
      status,
      updatedAt: nowIso()
    };
    writeSharedTabOpenRequest(next);
    bridgeSharedKeyToLocal(GM_KEYS.tabOpenRequest, next);
    return next;
  }

  function fulfillSharedTabOpenRequest() {
    if (!isCoordinatorOwner()) return;
    const request = readSharedTabOpenRequest();
    if (!isPlainObject(request) || !norm(request.requestId || '')) return;

    const requestedAtMs = parseTimeMs(request.requestedAt || '');
    if (requestedAtMs && (Date.now() - requestedAtMs) > CFG.openRequestTtlMs) {
      setSharedOpenRequestStatus(request, 'expired', {
        error: 'open request expired'
      });
      upsertCoordinatorAuthHold(norm(request.target || 'gwpc') || 'gwpc', 'tab open request expired', 'blocked');
      return;
    }

    const status = norm(request.status || '');
    if (status === 'opened' || status === 'failed' || status === 'expired') return;
    if (status === 'claimed' && norm(request.claimedByTabId || '') !== state.tabId) return;

    const claimed = setSharedOpenRequestStatus(request, 'claimed', {
      claimedByTabId: state.tabId,
      claimedAt: nowIso()
    });

    if (!claimed) return;
    if (typeof GM_openInTab !== 'function') {
      setSharedOpenRequestStatus(claimed, 'failed', {
        error: 'GM_openInTab unavailable'
      });
      upsertCoordinatorAuthHold(norm(claimed.target || 'gwpc') || 'gwpc', 'GM_openInTab unavailable', 'blocked');
      return;
    }

    try {
      GM_openInTab(claimed.url, {
        active: true,
        insert: true,
        setParent: true
      });
      setSharedOpenRequestStatus(claimed, 'opened', {
        openedAt: nowIso(),
        openedByTabId: state.tabId
      });
      log(`Supervisor opened ${claimed.target || 'tab'} request ${claimed.requestId}`);
    } catch (err) {
      setSharedOpenRequestStatus(claimed, 'failed', {
        error: norm(err?.message || err || 'open failed')
      });
      upsertCoordinatorAuthHold(norm(claimed.target || 'gwpc') || 'gwpc', `tab open failed: ${norm(err?.message || err || 'open failed')}`, 'blocked');
      log(`Supervisor failed tab-open request ${claimed.requestId}: ${err?.message || err}`);
    }
  }

  function shouldOpenAnchor(role) {
    const registry = readAnchorState();
    const entry = isPlainObject(registry[role]) ? registry[role] : null;
    if (isAnchorPendingActive(role, registry)) return false;
    if (isAnchorOpenCooldownActive(role, registry)) return false;
    return !isLeaseActive(entry, CFG.anchorStaleMs);
  }

  function openAnchorTab(role, reason = '', hostOverride = '') {
    if (typeof GM_openInTab !== 'function') return false;
    const url = buildAnchorUrl(role, hostOverride);
    if (!url) return false;

    let token = '';
    try {
      token = norm(new URL(url).searchParams.get(ANCHOR_TOKEN_QUERY_KEY));
    } catch {}

    setAnchorOpenAttempt(role, {
      status: 'attempting',
      host: norm(hostOverride || location.hostname),
      url,
      anchorToken: token,
      reason: norm(reason || '')
    });
    setAnchorPendingOpen(role, {
      status: 'opening',
      host: norm(hostOverride || location.hostname),
      url,
      anchorToken: token,
      reason: norm(reason || '')
    });

    try {
      GM_openInTab(url, {
        active: false,
        insert: true,
        setParent: true
      });
      setAnchorPendingOpen(role, {
        status: 'opened',
        host: norm(hostOverride || location.hostname),
        url,
        anchorToken: token,
        reason: norm(reason || '')
      });
      setAnchorOpenAttempt(role, {
        status: 'opened',
        host: norm(hostOverride || location.hostname),
        url,
        anchorToken: token,
        reason: norm(reason || '')
      });
      log(`Opened ${role.toUpperCase()} anchor${reason ? ` | ${reason}` : ''}`);
      return true;
    } catch (err) {
      setAnchorPendingOpen(role, {
        status: 'failed',
        host: norm(hostOverride || location.hostname),
        url,
        anchorToken: token,
        reason: norm(err?.message || err || 'open failed')
      });
      setAnchorOpenAttempt(role, {
        status: 'failed',
        host: norm(hostOverride || location.hostname),
        url,
        anchorToken: token,
        reason: norm(err?.message || err || 'open failed')
      });
      log(`Failed to open ${role.toUpperCase()} anchor: ${err?.message || err}`);
      return false;
    }
  }

  function ensureAnchorTabsFromCoordinator() {
    if (!isCoordinatorOwner()) return;
    if (!state.apexWakeEnabled) {
      state.apexWakeStatus = 'Off';
      return;
    }

    if (!CFG.autoAnchorLaunchEnabled) {
      state.apexWakeStatus = 'Auto anchor launch disabled';
      return;
    }

    const activeHold = getActiveAuthHold();
    const activeHoldSystem = norm(activeHold?.system || '');
    const activeHoldState = lower(activeHold?.state || '');
    const gwpcHost = readPreferredGwpcHost();
    let statusParts = [];
    const apexPending = isAnchorPendingActive('apex');
    const gwpcPending = isAnchorPendingActive('gwpc');
    const apexCooldown = isAnchorOpenCooldownActive('apex');
    const gwpcCooldown = isAnchorOpenCooldownActive('gwpc');
    const apexBlockedByRecovery = activeHoldState === 'recovering' && activeHoldSystem === 'apex';
    const gwpcBlockedByRecovery = activeHoldState === 'recovering' && activeHoldSystem === 'gwpc';

    if (shouldOpenAnchor('apex')) {
      const hold = upsertCoordinatorAuthHold('apex', 'apex anchor missing', 'recovering');
      const opened = hold.state !== 'blocked' ? openAnchorTab('apex', 'stale or missing') : false;
      if (!opened && hold.state !== 'blocked') {
        upsertCoordinatorAuthHold('apex', 'apex anchor open failed', 'blocked');
        statusParts.push('APEX anchor blocked');
      } else {
        statusParts.push(`APEX anchor ${hold.state}`);
      }
      state.apexWakeStatus = statusParts.join(' | ');
      return;
    }

    if (apexPending || apexCooldown || apexBlockedByRecovery) {
      statusParts.push(apexBlockedByRecovery ? 'APEX anchor recovering' : 'APEX anchor waiting');
      statusParts.push('GWPC anchor paused while APEX settles');
      state.apexWakeStatus = statusParts.join(' | ');
      return;
    }

    statusParts.push('APEX anchor healthy');

    if (shouldOpenAnchor('gwpc')) {
      const hold = upsertCoordinatorAuthHold('gwpc', 'gwpc anchor missing', 'recovering');
      const opened = hold.state !== 'blocked' ? openAnchorTab('gwpc', 'stale or missing', gwpcHost) : false;
      if (!opened && hold.state !== 'blocked') {
        upsertCoordinatorAuthHold('gwpc', 'gwpc anchor open failed', 'blocked');
        statusParts.push(`GWPC anchor ${gwpcHost} blocked`);
      } else {
        statusParts.push(`GWPC anchor ${gwpcHost} ${hold.state}`);
      }
      state.apexWakeStatus = statusParts.join(' | ');
      return;
    }

    if (gwpcPending || gwpcCooldown || gwpcBlockedByRecovery) {
      statusParts.push(`GWPC anchor ${gwpcHost} waiting`);
      state.apexWakeStatus = statusParts.join(' | ');
      return;
    }

    statusParts.push(`GWPC anchor ${gwpcHost}`);
    state.apexWakeStatus = statusParts.join(' | ');
  }

  async function probeAnchorSession(context) {
    try {
      if (context.role === 'apex') {
        await fetch('/services/data/', {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow'
        });
      } else if (context.role === 'gwpc') {
        await fetch('/pc/PolicyCenter.do?hb_anchor_probe=1', {
          credentials: 'include',
          cache: 'no-store',
          redirect: 'follow'
        });
      }
    } catch {}
  }

  function maybeMaintainCurrentAnchor(context) {
    if (!context?.role || context.sessionState !== 'healthy') return;

    if (!state.lastAnchorProbeAt) state.lastAnchorProbeAt = Date.now();
    if (!state.lastAnchorRefreshAt) state.lastAnchorRefreshAt = Date.now();

    if ((Date.now() - Number(state.lastAnchorProbeAt || 0)) >= CFG.anchorProbeMs) {
      state.lastAnchorProbeAt = Date.now();
      probeAnchorSession(context).catch(() => {});
    }

    if ((Date.now() - Number(state.lastAnchorRefreshAt || 0)) >= CFG.anchorRefreshMs) {
      state.lastAnchorRefreshAt = Date.now();
      log(`${context.role.toUpperCase()} anchor idle refresh`);
      try { location.reload(); } catch {}
    }
  }

  function chooseApexWakeUrl() {
    const urls = Array.isArray(CFG.apexWakeUrls) ? CFG.apexWakeUrls.filter(Boolean) : [];
    if (!urls.length) return 'https://farmersagent.lightning.force.com/';
    return urls[Math.floor(Math.random() * urls.length)];
  }

  function isWakeStateActive(wakeState) {
    if (!isPlainObject(wakeState) || wakeState.wakeActive !== true) return false;
    const closeAtMs = parseTimeMs(wakeState.wakeCloseAt);
    if (!closeAtMs) return false;
    return Date.now() < (closeAtMs + CFG.apexWakeOpenMs);
  }

  function closeOwnedApexWakeTabIfReady() {
    // Dedicated anchors stay open until they are replaced or the user closes them.
  }

  function openApexWakeTab() {
    return openAnchorTab('apex', 'manual supervisor open');
  }

  function checkApexWakeMonitor() {
    if (isAzHost()) {
      clearStaleAuthHoldIfNeeded();
      ensureCoordinatorLease();
      fulfillSharedTabOpenRequest();
      ensureAnchorTabsFromCoordinator();
      bridgeSupervisorStateToLocal();
      return;
    }

    const context = state.lastSessionContext || getCurrentSessionContext();
    if (isAnchorTab()) {
      maybeMaintainCurrentAnchor(context);
      state.apexWakeStatus = `${context.role.toUpperCase()} anchor ${context.sessionState}`;
      return;
    }

    if (context.kind === 'lex' || context.kind === 'gwpc') {
      state.apexWakeStatus = `${context.kind.toUpperCase()} ${context.sessionState}`;
      return;
    }

    state.apexWakeStatus = isAzHost() ? 'Supervisor active' : 'Watching';
  }

  function readWebhookFatalHold() {
    const gmValue = readGM(GM_KEYS.webhookFatalHold, null);
    if (isPlainObject(gmValue) && gmValue.active === true) return gmValue;
    const localValue = readLocalJson(GM_KEYS.webhookFatalHold);
    if (isPlainObject(localValue) && localValue.active === true) return localValue;
    return null;
  }

  function getActiveWebhookFatalHold() {
    if (!isGwpcHost()) return null;
    const hold = readWebhookFatalHold();
    if (!hold) return null;

    const holdAzId = norm(hold.azId || '');
    const currentAzId = readCurrentAzIdForCloseFallback();
    if (holdAzId && currentAzId && holdAzId !== currentAzId) return null;

    return hold;
  }

  function shouldHoldOpenForWebhookFatalError() {
    const hold = getActiveWebhookFatalHold();
    if (!hold) {
      state.lastWebhookFatalHoldLogKey = '';
      return false;
    }

    const logKey = `${norm(hold.azId || '')}|${norm(hold.createdAt || '')}|${norm(hold.error || '')}`;
    if (state.lastWebhookFatalHoldLogKey !== logKey) {
      state.lastWebhookFatalHoldLogKey = logKey;
      log(`Webhook fatal error hold active; close disabled | AZ ${norm(hold.azId || '(blank)')} | submission ${norm(hold.submissionNumber || '(blank)')} | error="${norm(hold.error || 'HTTP 404')}"`);
    }
    setStatus('Webhook error hold - not closing');
    return true;
  }

  function getSamePageSignature() {
    return [
      location.origin,
      location.pathname,
      location.search,
      location.hash,
      getVisibleGuidewireHeader() || document.title || ''
    ].map(norm).join('|');
  }

  function resetSamePageWatch(signature = '') {
    state.samePageSignature = signature;
    state.samePageSinceAt = signature ? Date.now() : 0;
    state.samePageCloseAttempted = false;
    state.samePageLoggedArmed = false;
  }

  function checkGwpcSamePageCloseWatchdog() {
    if (!isGwpcHost()) return;
    const context = state.lastSessionContext || getCurrentSessionContext();
    if (context.sessionState !== 'healthy') {
      resetSamePageWatch('');
      if (context.sessionState === 'blocked') {
        state.apexWakeStatus = `GWPC blocked: ${context.authMarker || context.pageKind || 'login required'}`;
      }
      return;
    }
    if (shouldHoldOpenForWebhookFatalError()) return;
    if (getActiveIgnoreCloseLease()) return;
    if (state.countdownEndsAt || state.closeAttempted || state.samePageCloseAttempted) return;

    const signature = getSamePageSignature();
    if (!signature) {
      resetSamePageWatch('');
      return;
    }

    if (state.samePageSignature !== signature) {
      resetSamePageWatch(signature);
      return;
    }

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
      signalKey: `same-page|${hashString(signature)}|${state.samePageSinceAt}`,
      source: SCRIPT_NAME,
      version: VERSION,
      reason: 'same-page-watchdog'
    };

    state.samePageCloseAttempted = true;
    state.activeSignal = signal;
    state.activeSignalKey = buildSignalKey(signal);
    log(`GWPC same-page watchdog reached 5m; closing tab | header="${getVisibleGuidewireHeader() || '(unknown)'}" | AZ ${signal.azId}`);
    attemptClose(signal);
  }

  function readIgnoreCloseLease() {
    const value = readGM(GM_KEYS.ignoreCloseLease, null);
    return isPlainObject(value) ? value : null;
  }

  function getActiveIgnoreCloseLease() {
    const lease = readIgnoreCloseLease();
    if (!isPlainObject(lease)) return null;
    const ownerTabId = norm(lease.ownerTabId || '');
    const updatedAt = norm(lease.updatedAt || lease.claimedAt || '');
    if (!ownerTabId || !updatedAt) return null;
    const updatedMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedMs)) return null;
    if ((Date.now() - updatedMs) > CFG.ignoreCloseLeaseTtlMs) return null;
    return lease;
  }

  function isIgnoreCloseLeaseOwnedByThisTab(lease = null) {
    const current = isPlainObject(lease) ? lease : getActiveIgnoreCloseLease();
    return !!current && norm(current.ownerTabId || '') === state.tabId;
  }

  function claimIgnoreCloseLease() {
    const lease = {
      ownerTabId: state.tabId,
      ownerHost: location.hostname,
      ownerUrl: location.href,
      claimedAt: nowIso(),
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeGM(GM_KEYS.ignoreCloseLease, lease);
    state.lastIgnoreCloseLeaseHeartbeatAt = Date.now();
    return lease;
  }

  function refreshIgnoreCloseLeaseHeartbeat() {
    const current = getActiveIgnoreCloseLease();
    if (!current || norm(current.ownerTabId || '') !== state.tabId) return false;
    if ((Date.now() - Number(state.lastIgnoreCloseLeaseHeartbeatAt || 0)) < CFG.ignoreCloseLeaseHeartbeatMs) return true;
    const next = {
      ...current,
      ownerHost: location.hostname,
      ownerUrl: location.href,
      updatedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeGM(GM_KEYS.ignoreCloseLease, next);
    state.lastIgnoreCloseLeaseHeartbeatAt = Date.now();
    return true;
  }

  function clearIgnoreCloseLeaseIfOwned() {
    const current = readIgnoreCloseLease();
    if (!current) return false;
    if (norm(current.ownerTabId || '') !== state.tabId) return false;
    writeGM(GM_KEYS.ignoreCloseLease, null);
    return true;
  }

  function setIgnoreCloseEnabledForThisPage(enabled) {
    if (enabled) {
      const previous = getActiveIgnoreCloseLease();
      const lease = claimIgnoreCloseLease();
      if (previous && norm(previous.ownerTabId || '') && norm(previous.ownerTabId || '') !== state.tabId) {
        log(`Ignore close ON for this page load | took over from ${norm(previous.ownerHost || 'another tab') || 'another tab'}`);
      } else {
        log('Ignore close ON for this page load');
      }
      setStatus('Ignoring shared close until refresh');
      renderAll();
      return lease;
    }

    const cleared = clearIgnoreCloseLeaseIfOwned();
    if (cleared) {
      log('Ignore close OFF for this page load');
    } else {
      log('Ignore close OFF skipped: this page is not the owner');
    }
    setStatus(state.running ? 'Watching for webhook success' : 'Stopped');
    renderAll();
    return null;
  }

  function logIgnoreCloseActive(signal) {
    const signalKey = buildSignalKey(signal);
    if (!signalKey || state.lastIgnoreCloseSignalKey === signalKey) return;
    state.lastIgnoreCloseSignalKey = signalKey;
    const lease = getActiveIgnoreCloseLease();
    const ownerHost = norm(lease?.ownerHost || '') || '(unknown)';
    const ownerUrl = norm(lease?.ownerUrl || '') || '(unknown)';
    log(`Ignoring close signal until owner page refresh | signalKey=${signalKey} | ownerHost=${ownerHost} | ownerUrl=${ownerUrl}`);
  }

  function shouldIgnoreCloseForActiveLease(signal = null) {
    const lease = getActiveIgnoreCloseLease();
    if (!lease) {
      state.lastIgnoreCloseSignalKey = '';
      return false;
    }
    logIgnoreCloseActive(signal);
    setStatus('Ignoring shared close until refresh');
    return true;
  }

  function readLexCloseConsumedSignal() {
    const value = readGM(GM_KEYS.lexCloseConsumed, null);
    return isPlainObject(value) ? value : null;
  }

  function readLexCloseClaimForSignal(signal) {
    const signalKey = buildSignalKey(signal);
    if (!signalKey) return null;
    const value = readLexCloseConsumedSignal();
    return buildSignalKey(value) === signalKey ? value : null;
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

  function isLexCloseConsumedForSignal(signal) {
    return !!readLexCloseClaimForSignal(signal);
  }

  function isLexCloseConsumedByOtherTab(signal) {
    const claim = readLexCloseClaimForSignal(signal);
    return !!claim && norm(claim.claimedBy || '') !== state.tabId;
  }

  function claimLexCloseSignal(signal) {
    if (!isLexHost()) return true;
    const signalKey = buildSignalKey(signal);
    if (!signalKey) return false;
    const existing = readLexCloseClaimForSignal(signal);
    if (existing) return norm(existing.claimedBy || '') === state.tabId;

    writeGM(GM_KEYS.lexCloseConsumed, {
      signalKey,
      azId: norm(signal?.azId || ''),
      postedAt: norm(signal?.postedAt || signal?.signalPostedAt || ''),
      claimedAt: nowIso(),
      claimedBy: state.tabId,
      source: SCRIPT_NAME,
      version: VERSION
    });

    const latest = readLexCloseConsumedSignal();
    return buildSignalKey(latest) === signalKey && norm(latest?.claimedBy || '') === state.tabId;
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

  function isLegacyTimeoutOwnedProductPayload(raw) {
    if (!isPlainObject(raw)) return false;
    const data = unwrapProductPayload(raw);
    const latestError = isPlainObject(raw?.latestError)
      ? raw.latestError
      : (isPlainObject(data?.latestError) ? data.latestError : {});

    if (norm(raw?.script || data?.script || '') === LEGACY_TIMEOUT_SCRIPT_NAME) return true;
    if (norm(raw?.event || data?.event || '') === 'gwpc_timeout_gathered') return true;
    return norm(latestError?.source || '') === LEGACY_TIMEOUT_SCRIPT_NAME;
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
    const existing = readGM(key, null);
    if (isLegacyTimeoutOwnedProductPayload(localPayload)) {
      try { localStorage.removeItem(key); } catch {}
      if (isLegacyTimeoutOwnedProductPayload(existing)) writeGM(key, null);
      log(`Purged legacy timeout-owned ${product === 'home' ? 'Home' : 'Auto'} payload`);
      return true;
    }

    if (!isPlainObject(localPayload) || !extractProductAzId(localPayload)) {
      if (isLegacyTimeoutOwnedProductPayload(existing)) {
        writeGM(key, null);
        log(`Cleared mirrored legacy timeout-owned ${product === 'home' ? 'Home' : 'Auto'} payload`);
        return true;
      }
      return false;
    }

    if (isLegacyTimeoutOwnedProductPayload(existing)) {
      writeGM(key, null);
    }

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
    const homePayloadRaw = isPlainObject(payload.homePayload) ? payload.homePayload : {};
    const homePayload = isLegacyTimeoutOwnedProductPayload(homePayloadRaw) ? {} : homePayloadRaw;
    const homeData = isPlainObject(bundle.home?.data) ? bundle.home.data : homePayload;
    const homeRow = isPlainObject(homeData?.row) ? homeData.row : {};
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

    let score = 0;
    if (norm(payload.currentJob?.['SubmissionNumber'] || '')) score += 5;
    if (bundle.home?.ready === true || homePayload.ready === true) score += 20;
    score += countFilledKeys(homeRow, scoreKeysHome) * 3;
    if (Array.isArray(bundle.timeout?.events) && bundle.timeout.events.length) score += 2;
    return score;
  }

  function collectGwpcPayloads(signal) {
    const rawKeysFound = [];
    const currentJob = readLocalKey('tm_pc_current_job_v1', rawKeysFound) || {};
    const bundle = readLocalKey('tm_pc_webhook_bundle_v1', rawKeysFound) || {};
    const homePayloadRaw = readLocalKey('tm_pc_home_quote_grab_payload_v1', rawKeysFound) || {};
    const homePayload = isLegacyTimeoutOwnedProductPayload(homePayloadRaw) ? {} : homePayloadRaw;
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
      azId: norm(signal?.azId || currentJob?.['AZ ID'] || bundle?.['AZ ID'] || homePayload?.['AZ ID'] || ''),
      savedAt: nowIso(),
      signalPostedAt: norm(signal?.postedAt || ''),
      signalKey: buildSignalKey(signal),
      source: 'GWPC',
      currentJob: isPlainObject(currentJob) ? currentJob : {},
      bundle: isPlainObject(bundle) ? bundle : {},
      homePayload: isPlainObject(homePayload) ? homePayload : {},
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
    return syncMirroredProductPayload('home', GM_KEYS.homePayload);
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
    for (const key of [GM_KEYS.homePayload]) {
      const localPayload = readLocalJson(key);
      const payload = readGM(key, null);
      if (isLegacyTimeoutOwnedProductPayload(payload)) {
        try { localStorage.removeItem(key); } catch {}
        writeGM(key, null);
        bridged = true;
        continue;
      }
      if ((!isPlainObject(payload) || !extractProductAzId(payload)) && isLegacyTimeoutOwnedProductPayload(localPayload)) {
        try { localStorage.removeItem(key); } catch {}
        bridged = true;
        continue;
      }
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
    if (isProtectedTab()) {
      log('Close skipped: protected tab');
      return;
    }
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
    const effectiveSignal = isPlainObject(signal) ? signal : (state.activeSignal || readCloseSignal());
    if (isProtectedTab()) {
      setStatus('Protected tab');
      return;
    }
    if (!state.activeSignal && !isFreshCloseSignal(effectiveSignal)) return;
    if (shouldHoldOpenForWebhookFatalError()) return;
    if (shouldIgnoreCloseForActiveLease(effectiveSignal)) return;

    const signalKey = buildSignalKey(effectiveSignal);
    if (isLexHost()) {
      if (!signalKey) return;
      if (!claimLexCloseSignal(effectiveSignal)) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(signalKey);
        log('LEX close already consumed for this signal');
        setStatus('LEX close already consumed');
        return;
      }
    }

    state.closeAttempted = true;
    writeSession(SS_KEYS.closeAttempted, '1');
    if (signalKey) markSignalHandled(signalKey);

    state.closeAttempts += 1;

    if (state.closeAttempts === 1) {
      const postedMs = Date.parse(norm(effectiveSignal?.postedAt || ''));
      const signalAgeSec = Number.isFinite(postedMs) ? Math.round((Date.now() - postedMs) / 1000) : -1;
      const successSig = readSuccessSignal();
      const successPostedMs = Date.parse(norm(successSig?.postedAt || ''));
      const successAgeSec = Number.isFinite(successPostedMs) ? Math.round((Date.now() - successPostedMs) / 1000) : -1;
      const closeSig = readCloseSignal();
      const closePostedMs = Date.parse(norm(closeSig?.postedAt || ''));
      const closeAgeSec = Number.isFinite(closePostedMs) ? Math.round((Date.now() - closePostedMs) / 1000) : -1;
      log(`[CLOSE-TAB-DIAG] payload-mirror FIRING close | signalKey=${signalKey || '(none)'} | azId=${norm(effectiveSignal?.azId || '(none)')} | signalPostedAt=${norm(effectiveSignal?.postedAt || '(none)')} | signalAgeSec=${signalAgeSec} | successAgeSec=${successAgeSec} | closeSignalAgeSec=${closeAgeSec} | hadCountdown=${Boolean(state.countdownEndsAt)} | host=${location.hostname} | url=${location.href}`);
      _lastLogPersistAt = 0;
      persistLogsThrottled();
    }

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
    syncCurrentTabSessionState();
    syncLocalOpenRequestToShared();
    bridgeSupervisorStateToLocal();
    writeTabHeartbeat();
    closeOwnedApexWakeTabIfReady();
    refreshIgnoreCloseLeaseHeartbeat();
    if (checkLexSnagFailure()) {
      renderAll();
      return;
    }
    if (checkLexFrontTabFailsafe()) {
      renderAll();
      return;
    }
    checkApexWakeMonitor();
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
      if (isLexHost() && isLexCloseConsumedByOtherTab(closeSignal)) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(signalKey);
        setStatus('LEX close already consumed');
        renderAll();
        return;
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
      if (isLexHost() && isLexCloseConsumedByOtherTab(state.activeSignal || signal)) {
        state.closeAttempted = true;
        writeSession(SS_KEYS.closeAttempted, '1');
        markSignalHandled(buildSignalKey(state.activeSignal || signal));
        setStatus('LEX close already consumed');
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

    if (state.ui.download) {
      const canDownload = !!readDownloadableMirrorSnapshot();
      state.ui.download.disabled = !canDownload;
      state.ui.download.style.opacity = canDownload ? '1' : '.55';
      state.ui.download.style.cursor = canDownload ? 'pointer' : 'not-allowed';
    }

    if (state.ui.ignoreClose) {
      const lease = getActiveIgnoreCloseLease();
      const active = !!lease;
      const owned = isIgnoreCloseLeaseOwnedByThisTab(lease);
      state.ui.ignoreClose.textContent = owned
        ? 'IGNORE CLOSE ON'
        : (active ? 'IGNORE CLOSE ACTIVE' : 'IGNORE CLOSE OFF');
      state.ui.ignoreClose.style.background = owned ? '#b45309' : (active ? '#7c2d12' : '#475569');
      state.ui.ignoreClose.style.opacity = active && !owned ? '.92' : '1';
    }

    if (state.ui.apexWake) {
      state.ui.apexWake.textContent = state.apexWakeEnabled ? 'SESSION SUPERVISOR ON' : 'SESSION SUPERVISOR OFF';
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
          <button id="tm-payload-mirror-download" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#1d4ed8;color:#fff;font-weight:800;cursor:pointer;">DOWNLOAD MIRROR</button>
          <button id="tm-payload-mirror-ignore-close" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">IGNORE CLOSE OFF</button>
        <button id="tm-payload-mirror-apex-wake" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0f766e;color:#fff;font-weight:800;cursor:pointer;">SESSION SUPERVISOR ON</button>
        </div>
        <div id="tm-payload-mirror-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Watching for webhook success</div>
        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div style="opacity:.72;">AZ ID</div><div id="tm-payload-mirror-azid">-</div>
          <div style="opacity:.72;">Payload mirrored</div><div id="tm-payload-mirror-mirrored">No</div>
          <div style="opacity:.72;">Close countdown</div><div id="tm-payload-mirror-countdown">-</div>
        <div style="opacity:.72;">Session supervisor</div><div id="tm-payload-mirror-apex-wake-status">Watching</div>
        </div>
        <textarea id="tm-payload-mirror-logs" readonly style="width:100%;min-height:140px;max-height:190px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-payload-mirror-head');
    state.ui.toggle = panel.querySelector('#tm-payload-mirror-toggle');
    state.ui.download = panel.querySelector('#tm-payload-mirror-download');
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

    state.ui.ignoreClose?.addEventListener('click', () => {
      const lease = getActiveIgnoreCloseLease();
      const owned = isIgnoreCloseLeaseOwnedByThisTab(lease);
      setIgnoreCloseEnabledForThisPage(!owned);
      tick('manual-ignore-close');
    });

    state.ui.apexWake?.addEventListener('click', () => {
      if (!isAzHost()) {
        log('Session supervisor toggle is only active on AgencyZoom');
        return;
      }
      state.apexWakeEnabled = !state.apexWakeEnabled;
      saveApexWakeEnabled(state.apexWakeEnabled);
      if (!state.apexWakeEnabled) {
        state.apexWakeStatus = 'Off';
        writeAuthHold(null);
        log('Session supervisor OFF');
      } else {
        state.apexWakeMonitorStartedAt = Date.now();
        state.apexWakeStatus = 'Watching';
        log('Session supervisor ON');
        checkApexWakeMonitor();
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
