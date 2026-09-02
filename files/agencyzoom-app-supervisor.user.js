// ==UserScript==
// @name         AgencyZoom App Supervisor
// @namespace    homebot.az-app-supervisor
// @version      1.0.2
// @description  Watches normal AgencyZoom tabs for shell-only dead loads and reloads the current tab with a loop guard.
// @author       Local
// @match        https://app.agencyzoom.com/*
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/refs/heads/main/files/agencyzoom-app-supervisor.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/refs/heads/main/files/agencyzoom-app-supervisor.user.js
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'AgencyZoom App Supervisor';
  const VERSION = '1.0.2';
  const TEST_MODE = !!globalThis.__AZ_APP_SUPERVISOR_TEST_MODE__;
  const PIPELINE_ROOT_URL = 'https://app.agencyzoom.com/referral/pipeline';

  const CONFIG = Object.freeze({
    checkMs: 2500,
    deadShellMs: 45_000,
    maxRecoveries: 3,
    recoveryWindowMs: 5 * 60_000,
    navigateToPipelineAfter: 2,
    maxLogLines: 14,
    zIndex: 2147483646,
  });

  const KEYS = Object.freeze({
    recoveryHistory: 'tm_az_app_supervisor_recovery_history_v1',
    status: 'tm_az_app_supervisor_status_v1',
    disabled: 'tm_az_app_supervisor_disabled_v1',
    panelPos: 'tm_az_app_supervisor_panel_pos_v1',
  });

  const HEALTHY_SELECTORS = [
    '.dd-card.referral-container[data-id]',
    '.dd-heading-wrapper',
    '#serviceDetailDock',
    '#detailDockform',
    '#tabDetail',
    '#tabQuote',
    '.az-dock',
    '.az-dock__side-actions',
    '.message-list',
    '.conversation-list',
    '.inbox-list',
    '[data-testid*="message" i]',
    '[data-testid*="conversation" i]',
    'table tbody tr',
  ];

  const HEALTHY_CONTENT_SELECTORS = [
    '.page-content',
    '.content-wrapper',
    '.main-content',
    '#main-content',
    'main',
    '[role="main"]',
    '.app-content',
    '.dashboard-content',
    '.dashboard',
  ];

  const SHELL_SELECTORS = [
    '.navbar',
    '.sidebar',
    '.side-bar',
    '.az-sidebar',
    '#sidebar',
    '[class*="sidebar" i]',
    '[class*="left" i][class*="nav" i]',
  ];

  const state = {
    firstSeenUnhealthyAt: 0,
    healthySeenAt: 0,
    recoveryPending: false,
    blocked: false,
    timer: 0,
    logs: [],
    ui: null,
  };

  if (TEST_MODE) {
    globalThis.__AZ_APP_SUPERVISOR_TEST_API__ = {
      CONFIG,
      KEYS,
      isNormalAgencyZoomPage,
      isAgencyZoomHealthy,
      hasAgencyZoomShell,
      runHealthCheck,
      readRecoveryHistory,
      writeRecoveryHistory,
      getStatus,
      recoverDeadShell,
    };
  } else {
    boot();
  }

  function boot() {
    if (!isAgencyZoomOrigin()) return;
    cleanupExpiredRecoveryHistory();
    registerMenu();
    buildPanel();
    log(`${SCRIPT_NAME} v${VERSION} loaded`);
    runHealthCheck();
    state.timer = window.setInterval(runHealthCheck, CONFIG.checkMs);
  }

  function isAgencyZoomOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.host || location.hostname || ''));
  }

  function isLoginPage() {
    return /\/login(?:$|[/?#])/i.test(String(location.pathname || ''));
  }

  function isAgencyZoomMfaHelperPage() {
    if (String(location.hash || '') === '#tm-apex-mfa') return true;
    try { return sessionStorage.getItem('farmersApexLogin.v1.agencyZoomHelper') === '1'; } catch {}
    return false;
  }

  function isNormalAgencyZoomPage() {
    return isAgencyZoomOrigin() && !isLoginPage() && !isAgencyZoomMfaHelperPage();
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function readJson(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function visible(el) {
    if (!el) return false;
    try {
      const rect = el.getBoundingClientRect?.();
      if (rect && rect.width <= 0 && rect.height <= 0) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    } catch {}
    return true;
  }

  function visibleAny(selectors) {
    return selectors.some((selector) => {
      try { return Array.from(document.querySelectorAll(selector)).some(visible); } catch {}
      return false;
    });
  }

  function elementText(el) {
    return norm(el?.innerText || el?.textContent || '');
  }

  function hasUsefulAgencyZoomText(text) {
    return /(?:pipeline|lead|customer|quotes?|messages?|tasks?|calendar|reports?|dashboard|policy|referral|opportunit(?:y|ies))/i.test(text);
  }

  function visibleAnyUsefulContent(selectors) {
    return selectors.some((selector) => {
      try {
        return Array.from(document.querySelectorAll(selector))
          .some((el) => visible(el) && elementText(el).length >= 30 && hasUsefulAgencyZoomText(elementText(el)));
      } catch {}
      return false;
    });
  }

  function hasAgencyZoomShell() {
    return visibleAny(SHELL_SELECTORS);
  }

  function pageText() {
    return norm(document.body?.innerText || document.body?.textContent || '');
  }

  function hasUsefulText() {
    const text = pageText();
    if (!text) return false;
    return hasUsefulAgencyZoomText(text);
  }

  function hasKnownLoadingFailureText() {
    const text = pageText();
    return /(?:something went wrong|temporar(?:y|ily)|service interruption|failed to load|try again|please refresh)/i.test(text);
  }

  function isAgencyZoomHealthy() {
    if (!isNormalAgencyZoomPage()) return true;
    if (visibleAny(HEALTHY_SELECTORS)) return true;
    if (visibleAnyUsefulContent(HEALTHY_CONTENT_SELECTORS)) return true;
    if (hasKnownLoadingFailureText()) return false;
    return hasUsefulText() && !hasAgencyZoomShell();
  }

  function now() {
    return Date.now();
  }

  function readRecoveryHistory() {
    const value = readJson(localStorage.getItem(KEYS.recoveryHistory), []);
    if (!Array.isArray(value)) return [];
    const cutoff = now() - CONFIG.recoveryWindowMs;
    return value
      .map((item) => ({
        at: Number(item?.at || 0),
        url: norm(item?.url || ''),
        reason: norm(item?.reason || ''),
      }))
      .filter((item) => item.at >= cutoff);
  }

  function writeRecoveryHistory(history) {
    try { localStorage.setItem(KEYS.recoveryHistory, JSON.stringify(history)); } catch {}
  }

  function cleanupExpiredRecoveryHistory() {
    writeRecoveryHistory(readRecoveryHistory());
  }

  function getStatus() {
    return readJson(localStorage.getItem(KEYS.status), { state: 'unknown', message: '', updatedAt: '' });
  }

  function setStatus(status, message) {
    const value = {
      state: norm(status || 'unknown'),
      message: norm(message || ''),
      updatedAt: new Date().toISOString(),
      url: String(location.href || ''),
    };
    try { localStorage.setItem(KEYS.status, JSON.stringify(value)); } catch {}
    renderPanel(value);
  }

  function isDisabled() {
    try { return localStorage.getItem(KEYS.disabled) === '1'; } catch {}
    return false;
  }

  function setDisabled(disabled) {
    try {
      if (disabled) localStorage.setItem(KEYS.disabled, '1');
      else localStorage.removeItem(KEYS.disabled);
    } catch {}
  }

  function runHealthCheck() {
    if (!isNormalAgencyZoomPage()) {
      setStatus('ignored', 'Ignored on login/helper page');
      return false;
    }
    if (isDisabled()) {
      setStatus('paused', 'Supervisor paused');
      return false;
    }

    if (isAgencyZoomHealthy()) {
      state.firstSeenUnhealthyAt = 0;
      state.recoveryPending = false;
      state.blocked = false;
      state.healthySeenAt = now();
      setStatus('healthy', 'AgencyZoom content detected');
      return true;
    }

    if (!hasAgencyZoomShell() && document.readyState !== 'complete') {
      setStatus('loading', 'Waiting for AgencyZoom');
      return false;
    }

    if (!state.firstSeenUnhealthyAt) state.firstSeenUnhealthyAt = now();
    const unhealthyForMs = now() - state.firstSeenUnhealthyAt;
    if (unhealthyForMs < CONFIG.deadShellMs) {
      setStatus('watching', `Shell-only load for ${Math.round(unhealthyForMs / 1000)}s`);
      return false;
    }

    return recoverDeadShell('AgencyZoom shell loaded without usable content');
  }

  function recoverDeadShell(reason) {
    if (state.recoveryPending || state.blocked) return false;
    const history = readRecoveryHistory();
    if (history.length >= CONFIG.maxRecoveries) {
      state.blocked = true;
      setStatus('blocked', `Recovery blocked after ${history.length} reloads in 5 minutes`);
      log(`Blocked: ${reason}`);
      return false;
    }

    const nextHistory = [
      ...history,
      { at: now(), url: String(location.href || ''), reason: norm(reason) },
    ];
    writeRecoveryHistory(nextHistory);
    state.recoveryPending = true;
    setStatus('recovering', `${reason}; reloading current tab`);
    log(`${reason}; recovery ${nextHistory.length}/${CONFIG.maxRecoveries}`);

    window.setTimeout(() => {
      if (nextHistory.length >= CONFIG.navigateToPipelineAfter && !isPipelinePage()) {
        try {
          location.replace(PIPELINE_ROOT_URL);
          return;
        } catch {}
      }
      try { location.reload(); } catch {}
    }, 100);
    return true;
  }

  function isPipelinePage() {
    return /\/referral\/pipeline(?:$|[/?#])/i.test(`${location.pathname || ''}${location.search || ''}${location.hash || ''}`);
  }

  function log(message) {
    state.logs.push(`[${new Date().toLocaleTimeString()}] ${norm(message)}`);
    state.logs = state.logs.slice(-CONFIG.maxLogLines);
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
    renderPanel(getStatus());
  }

  function registerMenu() {
    try {
      GM_registerMenuCommand('AgencyZoom Supervisor: Pause', () => {
        setDisabled(true);
        setStatus('paused', 'Supervisor paused');
      });
      GM_registerMenuCommand('AgencyZoom Supervisor: Resume', () => {
        setDisabled(false);
        state.blocked = false;
        state.firstSeenUnhealthyAt = 0;
        setStatus('watching', 'Supervisor resumed');
        runHealthCheck();
      });
      GM_registerMenuCommand('AgencyZoom Supervisor: Clear recovery history', () => {
        writeRecoveryHistory([]);
        state.blocked = false;
        state.firstSeenUnhealthyAt = 0;
        setStatus('watching', 'Recovery history cleared');
      });
    } catch {}
  }

  function buildPanel() {
    if (document.getElementById('tm-az-app-supervisor-panel')) return;
    try {
      GM_addStyle(`
        #tm-az-app-supervisor-panel {
          position: fixed;
          right: 12px;
          bottom: 238px;
          width: 260px;
          background: #111827;
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, .35);
          border-radius: 8px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, .32);
          font: 12px/1.35 Arial, sans-serif;
          z-index: ${CONFIG.zIndex};
        }
        #tm-az-app-supervisor-panel[data-state="healthy"] { opacity: .72; }
        #tm-az-app-supervisor-panel[data-state="blocked"],
        #tm-az-app-supervisor-panel[data-state="recovering"] { opacity: 1; }
        #tm-az-app-supervisor-head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          background: #1f2937;
          border-radius: 8px 8px 0 0;
          font-weight: 800;
        }
        #tm-az-app-supervisor-status {
          padding: 8px 10px;
          color: #bfdbfe;
          font-weight: 700;
        }
        #tm-az-app-supervisor-logs {
          width: calc(100% - 20px);
          margin: 0 10px 10px;
          min-height: 66px;
          max-height: 120px;
          border: 1px solid rgba(148, 163, 184, .28);
          border-radius: 6px;
          background: #020617;
          color: #cbd5e1;
          resize: vertical;
          padding: 7px;
          box-sizing: border-box;
          white-space: pre;
        }
      `);
    } catch {}

    const panel = document.createElement('div');
    panel.id = 'tm-az-app-supervisor-panel';
    panel.innerHTML = `
      <div id="tm-az-app-supervisor-head">
        <span>AZ Supervisor</span>
        <span>v${VERSION}</span>
      </div>
      <div id="tm-az-app-supervisor-status">Watching</div>
      <textarea id="tm-az-app-supervisor-logs" readonly></textarea>
    `;
    document.body?.appendChild(panel);
    state.ui = {
      panel,
      status: panel.querySelector('#tm-az-app-supervisor-status'),
      logs: panel.querySelector('#tm-az-app-supervisor-logs'),
    };
  }

  function renderPanel(status = getStatus()) {
    if (!state.ui) return;
    state.ui.panel.dataset.state = norm(status.state || 'unknown');
    state.ui.status.textContent = norm(status.message || status.state || 'Watching');
    state.ui.logs.value = state.logs.join('\n');
  }
})();
