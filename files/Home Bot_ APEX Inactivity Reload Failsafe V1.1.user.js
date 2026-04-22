// ==UserScript==
// @name         Home Bot: APEX Inactivity Reload Failsafe V1.1
// @namespace    homebot.apex.inactivity.reload.failsafe
// @version      1.1
// @description  Lightweight APEX failsafe. If the page shows no real activity for 60s, reloads the page. Uses a safe watcher that avoids freezing Lightning.
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  try { window.__HB_APEX_IDLE_FAILSAFE_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Home Bot: APEX Inactivity Reload Failsafe V1.1';
  const VERSION = '1.1';

  const CFG = {
    timeoutMs: 60000,
    tickMs: 1000,
    sigCheckMs: 4000,
    maxLogs: 14,
    panelRight: 12,
    panelBottom: 12,
    panelWidth: 340,
    zIndex: 2147483647
  };

  const KEYS = {
    STOP: 'tm_apex_idle_failsafe_stop_v11',
    PANEL_POS: 'tm_apex_idle_failsafe_panel_pos_v11',
    LOGS_OPEN: 'tm_apex_idle_failsafe_logs_open_v11',
    RELOAD_META: 'tm_apex_idle_failsafe_reload_meta_v11'
  };

  const UI_ID = 'hb-apex-idle-failsafe-panel-v11';

  const state = {
    running: sessionStorage.getItem(KEYS.STOP) !== '1',
    reloading: false,
    lastActivityAt: Date.now(),
    lastActivityReason: 'Started',
    pendingActivityAt: 0,
    pendingActivityReason: '',
    lastSigAt: 0,
    lastSig: '',
    lastUrl: location.href,
    lastTitle: document.title || '',
    tickTimer: null,
    observer: null,
    logs: [],
    ui: null,
    drag: null,
    cleanupFns: []
  };

  init();

  function init() {
    buildUI();
    restoreReloadMeta();

    state.lastSig = getPageSignature();
    state.lastSigAt = Date.now();

    hookEvents();
    startObserver();

    log('Inactivity timer started');
    updateUI();

    state.tickTimer = setInterval(tick, CFG.tickMs);
    tick();

    window.__HB_APEX_IDLE_FAILSAFE_CLEANUP__ = cleanup;
  }

  function cleanup() {
    try { if (state.tickTimer) clearInterval(state.tickTimer); } catch {}
    try { state.observer?.disconnect(); } catch {}

    for (const fn of state.cleanupFns.splice(0)) {
      try { fn(); } catch {}
    }

    try { state.ui?.panel?.remove(); } catch {}

    try { delete window.__HB_APEX_IDLE_FAILSAFE_CLEANUP__; } catch {}
  }

  function now() {
    return Date.now();
  }

  function ts() {
    try { return new Date().toLocaleTimeString(); }
    catch { return new Date().toISOString(); }
  }

  function norm(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;
    try {
      const cs = getComputedStyle(el);
      if (!cs) return false;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }

  function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function shorten(v, max) {
    const s = String(v || '');
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  function nodeInsideUi(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    return !!(el && el.closest && el.closest(`#${UI_ID}`));
  }

  function mutationIsUiOnly(mutation) {
    if (!mutation) return true;

    if (!nodeInsideUi(mutation.target)) return false;

    for (const n of mutation.addedNodes || []) {
      if (!nodeInsideUi(n)) return false;
    }
    for (const n of mutation.removedNodes || []) {
      if (!nodeInsideUi(n)) return false;
    }

    return true;
  }

  function setPendingActivity(reason) {
    state.pendingActivityAt = now();
    state.pendingActivityReason = reason || 'Activity';
  }

  function applyActivity(reason) {
    state.lastActivityAt = now();
    state.lastActivityReason = reason || 'Activity';
    log(`Activity detected, timer reset${reason ? ` | ${reason}` : ''}`);
    updateUI();
  }

  function restoreReloadMeta() {
    const raw = sessionStorage.getItem(KEYS.RELOAD_META);
    if (!raw) return;

    sessionStorage.removeItem(KEYS.RELOAD_META);
    const meta = safeJsonParse(raw);
    if (meta && meta.by === SCRIPT_NAME) {
      log('Page reloaded, watcher resumed');
    }
  }

  function setRunning(next) {
    state.running = !!next;

    if (state.running) {
      sessionStorage.removeItem(KEYS.STOP);
      applyActivity('Watcher resumed');
      log('Inactivity timer started');
    } else {
      sessionStorage.setItem(KEYS.STOP, '1');
      log('Watcher stopped for this page session');
    }

    updateUI();
  }

  function log(msg) {
    const line = `[${ts()}] ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > CFG.maxLogs) state.logs.length = CFG.maxLogs;

    if (state.ui?.logs) {
      state.ui.logs.textContent = state.logs.join('\n');
    }

    console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function getOpenModalText() {
    const selectors = [
      'section.slds-modal.slds-fade-in-open',
      '.slds-modal.slds-fade-in-open',
      '[role="dialog"]'
    ];

    const out = [];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      for (const el of nodes.slice(0, 2)) {
        const txt = norm(el.innerText || el.textContent || '');
        if (txt) out.push(txt.slice(0, 120));
      }
      if (out.length >= 2) break;
    }

    return out.join(' || ');
  }

  function getHeadingText() {
    const selectors = [
      'h1',
      'h2',
      '[role="heading"]',
      '.slds-page-header__title',
      '.slds-card__header-title'
    ];

    const out = [];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      for (const el of nodes.slice(0, 4)) {
        const txt = norm(el.innerText || el.textContent || '');
        if (txt) out.push(txt.slice(0, 80));
      }
      if (out.length >= 4) break;
    }

    return out.join(' | ');
  }

  function getPageSignature() {
    return [
      location.href,
      document.title || '',
      getHeadingText(),
      getOpenModalText()
    ].join(' || ');
  }

  function tick() {
    if (state.reloading) {
      updateUI();
      return;
    }

    if (!state.running) {
      updateUI();
      return;
    }

    if (document.visibilityState !== 'visible') {
      updateUI('BACKGROUND');
      return;
    }

    if (state.pendingActivityAt > state.lastActivityAt) {
      applyActivity(state.pendingActivityReason || 'DOM change');
    }

    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      applyActivity('URL change');
    }

    if ((document.title || '') !== state.lastTitle) {
      state.lastTitle = document.title || '';
      applyActivity('Title change');
    }

    const nowMs = now();
    if (nowMs - state.lastSigAt >= CFG.sigCheckMs) {
      state.lastSigAt = nowMs;
      const sig = getPageSignature();
      if (sig !== state.lastSig) {
        state.lastSig = sig;
        applyActivity('Visible content change');
      }
    }

    const idleMs = nowMs - state.lastActivityAt;
    if (idleMs >= CFG.timeoutMs) {
      reloadNow();
      return;
    }

    updateUI();
  }

  function reloadNow() {
    if (state.reloading) return;

    state.reloading = true;
    log('60s reached, reloading page');
    updateUI('RELOADING');

    try {
      sessionStorage.setItem(KEYS.RELOAD_META, JSON.stringify({
        by: SCRIPT_NAME,
        at: new Date().toISOString(),
        url: location.href
      }));
    } catch {}

    setTimeout(() => {
      location.reload();
    }, 100);
  }

  function startObserver() {
    if (state.observer) return;

    const root = document.body || document.documentElement;
    if (!root) return;

    state.observer = new MutationObserver((mutations) => {
      if (!state.running || state.reloading) return;
      if (!mutations || !mutations.length) return;

      let realChange = false;
      for (const m of mutations) {
        if (!mutationIsUiOnly(m)) {
          realChange = true;
          break;
        }
      }

      if (realChange) {
        setPendingActivity('DOM change');
      }
    });

    state.observer.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function hookEvents() {
    const onClick = () => {
      if (!state.running || state.reloading) return;
      setPendingActivity('Click');
    };

    const onInput = () => {
      if (!state.running || state.reloading) return;
      setPendingActivity('Input');
    };

    const onChange = () => {
      if (!state.running || state.reloading) return;
      setPendingActivity('Change');
    };

    const onKeyDown = () => {
      if (!state.running || state.reloading) return;
      setPendingActivity('Keydown');
    };

    const onFocus = () => {
      if (!state.running || state.reloading) return;
      setPendingActivity('Focus');
    };

    const onVisibility = () => {
      if (!state.running || state.reloading) return;
      if (document.visibilityState === 'visible') {
        applyActivity('Tab visible');
      }
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('focus', onFocus, true);
    document.addEventListener('visibilitychange', onVisibility, true);

    state.cleanupFns.push(() => document.removeEventListener('click', onClick, true));
    state.cleanupFns.push(() => document.removeEventListener('input', onInput, true));
    state.cleanupFns.push(() => document.removeEventListener('change', onChange, true));
    state.cleanupFns.push(() => document.removeEventListener('keydown', onKeyDown, true));
    state.cleanupFns.push(() => window.removeEventListener('focus', onFocus, true));
    state.cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility, true));
  }

  function buildUI() {
    if (document.getElementById(UI_ID)) return;

    const style = document.createElement('style');
    style.textContent = `
      #${UI_ID}{
        position:fixed;
        right:${CFG.panelRight}px;
        bottom:${CFG.panelBottom}px;
        width:${CFG.panelWidth}px;
        background:rgba(17,24,39,.96);
        color:#fff;
        border:1px solid rgba(255,255,255,.16);
        border-radius:12px;
        box-shadow:0 10px 28px rgba(0,0,0,.35);
        z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
      }
      #${UI_ID} *{ box-sizing:border-box; }
      #${UI_ID}-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        padding:8px 10px;
        background:rgba(255,255,255,.08);
        cursor:move;
        user-select:none;
      }
      #${UI_ID}-title{ font-weight:700; }
      #${UI_ID}-ver{ font-size:11px; opacity:.8; }
      #${UI_ID}-body{ padding:8px 10px 10px; }
      #${UI_ID}-row{
        display:flex;
        align-items:center;
        gap:8px;
        margin-bottom:8px;
      }
      #${UI_ID}-toggle,
      #${UI_ID}-logs-toggle{
        border:0;
        border-radius:8px;
        padding:6px 10px;
        cursor:pointer;
        font-weight:700;
        color:#fff;
      }
      #${UI_ID}-status{
        margin-left:auto;
        font-weight:700;
      }
      #${UI_ID}-grid{
        display:grid;
        grid-template-columns:92px 1fr;
        gap:4px 8px;
        margin-bottom:8px;
      }
      #${UI_ID}-grid .k{ opacity:.8; }
      #${UI_ID}-grid .v{ word-break:break-word; }
      #${UI_ID}-log-wrap{ display:none; }
      #${UI_ID}-logs{
        max-height:180px;
        overflow:auto;
        background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.08);
        border-radius:8px;
        padding:8px;
        white-space:pre-wrap;
        word-break:break-word;
        font-family:Consolas, monospace;
      }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = UI_ID;
    panel.innerHTML = `
      <div id="${UI_ID}-head">
        <div>
          <div id="${UI_ID}-title">${SCRIPT_NAME}</div>
          <div id="${UI_ID}-ver">V${VERSION}</div>
        </div>
      </div>
      <div id="${UI_ID}-body">
        <div id="${UI_ID}-row">
          <button id="${UI_ID}-toggle" type="button">STOP</button>
          <button id="${UI_ID}-logs-toggle" type="button">Logs</button>
          <div id="${UI_ID}-status">RUNNING</div>
        </div>

        <div id="${UI_ID}-grid">
          <div class="k">Reload in</div><div class="v" id="${UI_ID}-left">60s</div>
          <div class="k">Last activity</div><div class="v" id="${UI_ID}-reason">Started</div>
          <div class="k">URL</div><div class="v" id="${UI_ID}-url">—</div>
        </div>

        <div id="${UI_ID}-log-wrap">
          <div id="${UI_ID}-logs"></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.ui = {
      panel,
      head: panel.querySelector(`#${UI_ID}-head`),
      toggle: panel.querySelector(`#${UI_ID}-toggle`),
      logsToggle: panel.querySelector(`#${UI_ID}-logs-toggle`),
      status: panel.querySelector(`#${UI_ID}-status`),
      left: panel.querySelector(`#${UI_ID}-left`),
      reason: panel.querySelector(`#${UI_ID}-reason`),
      url: panel.querySelector(`#${UI_ID}-url`),
      logsWrap: panel.querySelector(`#${UI_ID}-log-wrap`),
      logs: panel.querySelector(`#${UI_ID}-logs`)
    };

    state.ui.toggle.addEventListener('click', () => setRunning(!state.running));
    state.ui.logsToggle.addEventListener('click', () => {
      const open = state.ui.logsWrap.style.display === 'none';
      state.ui.logsWrap.style.display = open ? 'block' : 'none';
      state.ui.logsToggle.textContent = open ? 'Hide Logs' : 'Logs';
      try { localStorage.setItem(KEYS.LOGS_OPEN, open ? '1' : '0'); } catch {}
    });

    state.ui.logsToggle.style.background = '#1565c0';

    const savedLogsOpen = localStorage.getItem(KEYS.LOGS_OPEN) === '1';
    state.ui.logsWrap.style.display = savedLogsOpen ? 'block' : 'none';
    state.ui.logsToggle.textContent = savedLogsOpen ? 'Hide Logs' : 'Logs';

    makeDraggable();

    try {
      const raw = localStorage.getItem(KEYS.PANEL_POS);
      const pos = safeJsonParse(raw);
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        applyPanelPos(pos.left, pos.top);
      }
    } catch {}

    window.addEventListener('resize', onResize, true);
    state.cleanupFns.push(() => window.removeEventListener('resize', onResize, true));

    updateUI();
  }

  function applyPanelPos(left, top) {
    if (!state.ui?.panel) return;

    const panel = state.ui.panel;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    const finalLeft = Math.min(Math.max(0, left), maxLeft);
    const finalTop = Math.min(Math.max(0, top), maxTop);

    panel.style.left = `${finalLeft}px`;
    panel.style.top = `${finalTop}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    try {
      localStorage.setItem(KEYS.PANEL_POS, JSON.stringify({ left: finalLeft, top: finalTop }));
    } catch {}
  }

  function onResize() {
    if (!state.ui?.panel) return;
    const rect = state.ui.panel.getBoundingClientRect();
    applyPanelPos(rect.left, rect.top);
  }

  function makeDraggable() {
    const head = state.ui?.head;
    if (!head) return;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;

      const rect = state.ui.panel.getBoundingClientRect();
      state.drag = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        prevUserSelect: document.body.style.userSelect || ''
      };

      state.ui.panel.style.left = `${rect.left}px`;
      state.ui.panel.style.top = `${rect.top}px`;
      state.ui.panel.style.right = 'auto';
      state.ui.panel.style.bottom = 'auto';

      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!state.drag) return;
      applyPanelPos(
        state.drag.startLeft + (e.clientX - state.drag.startX),
        state.drag.startTop + (e.clientY - state.drag.startY)
      );
    };

    const onMouseUp = () => {
      if (!state.drag) return;
      document.body.style.userSelect = state.drag.prevUserSelect || '';
      state.drag = null;
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    };

    head.addEventListener('mousedown', onMouseDown, true);
    state.cleanupFns.push(() => head.removeEventListener('mousedown', onMouseDown, true));
  }

  function updateUI(forcedStatus) {
    if (!state.ui) return;

    const idleMs = now() - state.lastActivityAt;
    const leftMs = Math.max(0, CFG.timeoutMs - idleMs);
    const leftSec = Math.ceil(leftMs / 1000);

    if (state.reloading || forcedStatus === 'RELOADING') {
      state.ui.status.textContent = 'RELOADING';
      state.ui.status.style.color = '#fca5a5';
    } else if (!state.running) {
      state.ui.status.textContent = 'STOPPED';
      state.ui.status.style.color = '#ffb0b0';
    } else if (forcedStatus === 'BACKGROUND') {
      state.ui.status.textContent = 'BACKGROUND';
      state.ui.status.style.color = '#fcd34d';
    } else {
      state.ui.status.textContent = 'RUNNING';
      state.ui.status.style.color = '#8df0a1';
    }

    state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
    state.ui.toggle.style.background = state.running ? '#c62828' : '#2e7d32';

    state.ui.left.textContent = state.running ? `${leftSec}s` : 'Paused';
    state.ui.reason.textContent = state.lastActivityReason || 'Started';
    state.ui.url.textContent = shorten(location.href, 70);
  }
})();