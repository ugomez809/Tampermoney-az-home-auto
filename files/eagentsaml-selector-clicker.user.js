// ==UserScript==
// @name         Eagent SAML Selector Clicker
// @namespace    homebot.eagentsaml-selector-clicker
// @version      1.0.6
// @description  Clicks #okta-signin-submit on the eAgent SAML login page every 10 seconds while running.
// @match        https://eagentsaml.farmersinsurance.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/eagentsaml-selector-clicker.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/eagentsaml-selector-clicker.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__TM_EAGENTSAML_SELECTOR_CLICKER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Eagent SAML Selector Clicker';
  const VERSION = '1.0.6';
  const TARGET_SELECTOR = '#okta-signin-submit';
  const UI_ATTR = 'data-tm-eagentsaml-selector-clicker-ui';

  const LS_KEYS = {
    panelPos: 'tm_eagentsaml_selector_clicker_panel_pos_v1'
  };

  const CFG = {
    tickMs: 10000,
    panelWidth: 340,
    zIndex: 2147483647,
    maxLogLines: 16
  };

  const state = {
    destroyed: false,
    running: true,
    panel: null,
    statusEl: null,
    toggleBtn: null,
    logEl: null,
    tickTimer: null,
    logs: []
  };

  boot();

  function boot() {
    buildUi();
    restorePanelPos();
    renderAll();
    log(`Loaded v${VERSION}`);
    log(`Watching ${TARGET_SELECTOR}`);
    window.setTimeout(tick, 1000);
    state.tickTimer = window.setInterval(tick, CFG.tickMs);
    window.__TM_EAGENTSAML_SELECTOR_CLICKER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.tickTimer); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__TM_EAGENTSAML_SELECTOR_CLICKER_CLEANUP__; } catch {}
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
    renderLogs();
  }

  function setStatus(text) {
    if (state.statusEl) state.statusEl.textContent = text;
  }

  function buildUi() {
    if (state.panel && document.contains(state.panel)) return;

    const panel = document.createElement('div');
    panel.setAttribute(UI_ATTR, '1');
    panel.id = 'tm-eagentsaml-selector-clicker-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15,23,42,.96)',
      color: '#fff',
      border: '1px solid rgba(148,163,184,.45)',
      borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-head" style="padding:10px 12px;background:#0f172a;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:move;">
        <div ${UI_ATTR}="1" style="font-weight:800;">Eagent SAML Clicker</div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.75;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:10px 12px;">
        <div ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-status" style="margin-bottom:8px;color:#bbf7d0;">Starting</div>
        <div ${UI_ATTR}="1" style="margin-bottom:8px;">
          <div ${UI_ATTR}="1" style="font-size:11px;opacity:.75;margin-bottom:4px;">Target</div>
          <div ${UI_ATTR}="1" style="padding:7px 8px;border-radius:7px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.25);word-break:break-word;">${TARGET_SELECTOR}</div>
        </div>
        <div ${UI_ATTR}="1" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <button ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-toggle" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#0284c7;color:#fff;font-weight:800;cursor:pointer;"></button>
          <button ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-now" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">CLICK NOW</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-log" style="max-height:140px;overflow:auto;font-size:11px;line-height:1.35;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.statusEl = panel.querySelector('#tm-eagentsaml-selector-clicker-status');
    state.toggleBtn = panel.querySelector('#tm-eagentsaml-selector-clicker-toggle');
    state.logEl = panel.querySelector('#tm-eagentsaml-selector-clicker-log');

    state.toggleBtn?.addEventListener('click', () => {
      state.running = !state.running;
      renderAll();
      log(state.running ? 'Clicker resumed' : 'Clicker paused');
    });
    panel.querySelector('#tm-eagentsaml-selector-clicker-now')?.addEventListener('click', () => {
      clickButton('manual');
    });

    makeDraggable(panel, panel.querySelector('#tm-eagentsaml-selector-clicker-head'));
  }

  function renderAll() {
    if (!state.panel) return;
    if (state.toggleBtn) {
      state.toggleBtn.textContent = state.running ? 'PAUSE' : 'RESUME';
      state.toggleBtn.style.background = state.running ? '#0284c7' : '#b45309';
    }
    setStatus(state.running ? 'Running: retries every 10s' : 'Paused');
    renderLogs();
  }

  function renderLogs() {
    if (!state.logEl) return;
    state.logEl.innerHTML = state.logs.slice(0, 12).map((line) => (
      `<div ${UI_ATTR}="1" style="margin-bottom:3px;word-break:break-word;">${escHtml(line)}</div>`
    )).join('');
  }

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readPanelPos() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_KEYS.panelPos) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function savePanelPos(pos) {
    try { localStorage.setItem(LS_KEYS.panelPos, JSON.stringify(pos)); } catch {}
  }

  function restorePanelPos() {
    const pos = readPanelPos();
    if (!pos || !state.panel) return;
    if (typeof pos.left === 'number') {
      state.panel.style.left = `${Math.max(0, pos.left)}px`;
      state.panel.style.right = 'auto';
    }
    if (typeof pos.top === 'number') {
      state.panel.style.top = `${Math.max(0, pos.top)}px`;
      state.panel.style.bottom = 'auto';
    }
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let dragging = false;

    const onMove = (event) => {
      if (!dragging) return;
      const nextLeft = Math.max(0, baseLeft + (event.clientX - startX));
      const nextTop = Math.max(0, baseTop + (event.clientY - startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      const rect = panel.getBoundingClientRect();
      savePanelPos({ left: rect.left, top: rect.top });
    };

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest('button')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      baseLeft = rect.left;
      baseTop = rect.top;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      event.preventDefault();
    }, true);
  }

  function clickButton(source) {
    let btn = null;
    try {
      btn = document.querySelector(TARGET_SELECTOR);
      console.log('button', btn);
    } catch {}

    if (!btn) {
      setStatus('Button not found');
      log(`Button not found: ${TARGET_SELECTOR}`);
      return false;
    }

    try {
      btn.click?.();
      setStatus(source === 'manual' ? 'Manual click sent' : 'Auto click sent');
      log(`Clicked ${TARGET_SELECTOR}${source === 'manual' ? ' (manual)' : ''}`);
      return true;
    } catch (error) {
      setStatus('Click failed');
      log(`Click failed: ${error?.message || error}`);
      return false;
    }
  }

  function tick() {
    if (state.destroyed || !state.running) return;
    clickButton('auto');
  }
})();
