// ==UserScript==
// @name         Eagent SAML Selector Clicker
// @namespace    homebot.eagentsaml-selector-clicker
// @version      1.0.4
// @description  Lets you pick one selector on the eAgent SAML login page and clicks it once every 10 seconds whenever it is visible.
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
  const VERSION = '1.0.4';
  const UI_ATTR = 'data-tm-eagentsaml-selector-clicker-ui';

  const LS_KEYS = {
    selector: 'tm_eagentsaml_selector_clicker_selector_v1',
    panelPos: 'tm_eagentsaml_selector_clicker_panel_pos_v1'
  };

  const CFG = {
    tickMs: 10000,
    loginFieldSettleMs: 20000,
    panelWidth: 360,
    zIndex: 2147483647,
    selectorOutlineColor: '#22c55e',
    selectorFillColor: 'rgba(34,197,94,0.16)',
    maxLogLines: 16
  };

  const state = {
    destroyed: false,
    running: true,
    selector: readSelector(),
    selectorMode: false,
    selectorListeners: [],
    hoverBox: null,
    panel: null,
    statusEl: null,
    selectorEl: null,
    toggleBtn: null,
    logEl: null,
    tickTimer: null,
    logs: [],
    lastClickAt: 0,
    lastSelectorMissLogKey: '',
    lastClickedSelectorKey: '',
    armedVisibleKey: '',
    lastArmLogKey: '',
    credentialReadyKey: '',
    credentialReadySince: 0,
    lastCredentialWaitLogKey: ''
  };

  boot();

  function boot() {
    buildUi();
    restorePanelPos();
    renderAll();
    log(`Loaded v${VERSION}`);
    if (state.selector) log(`Saved selector ready: ${state.selector}`);
    state.tickTimer = window.setInterval(tick, CFG.tickMs);
    window.__TM_EAGENTSAML_SELECTOR_CLICKER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    stopSelectorMode('', { logIt: false });
    try { clearInterval(state.tickTimer); } catch {}
    try { state.hoverBox?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__TM_EAGENTSAML_SELECTOR_CLICKER_CLEANUP__; } catch {}
  }

  function saveEnabled(on) {
    state.running = !!on;
    state.armedVisibleKey = '';
    state.lastArmLogKey = '';
    resetCredentialWait();
    renderAll();
  }

  function readSelector() {
    try {
      return norm(localStorage.getItem(LS_KEYS.selector) || '');
    } catch {
      return '';
    }
  }

  function saveSelector(selector) {
    state.selector = norm(selector || '');
    state.armedVisibleKey = '';
    state.lastArmLogKey = '';
    resetCredentialWait();
    try {
      if (state.selector) localStorage.setItem(LS_KEYS.selector, state.selector);
      else localStorage.removeItem(LS_KEYS.selector);
    } catch {}
    renderAll();
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function now() {
    return Date.now();
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

  function enabled(el) {
    if (!el || !(el instanceof Element)) return false;
    return !(el.disabled || el.getAttribute('disabled') !== null || el.getAttribute('aria-disabled') === 'true');
  }

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
        <div ${UI_ATTR}="1" style="font-weight:800;">Eagent SAML Selector Clicker</div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.75;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:10px 12px;">
        <div ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-status" style="margin-bottom:8px;color:#bbf7d0;">Starting</div>
        <div ${UI_ATTR}="1" style="margin-bottom:8px;">
          <div ${UI_ATTR}="1" style="font-size:11px;opacity:.75;margin-bottom:4px;">Saved selector</div>
          <div ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-selector" style="min-height:34px;padding:7px 8px;border-radius:7px;background:rgba(2,6,23,.55);border:1px solid rgba(148,163,184,.25);word-break:break-word;"></div>
        </div>
        <div ${UI_ATTR}="1" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <button ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-toggle" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#0284c7;color:#fff;font-weight:800;cursor:pointer;"></button>
          <button ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-pick" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#16a34a;color:#fff;font-weight:800;cursor:pointer;">PICK SELECTOR</button>
          <button ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-clear" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">CLEAR</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-eagentsaml-selector-clicker-log" style="max-height:140px;overflow:auto;font-size:11px;line-height:1.35;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.statusEl = panel.querySelector('#tm-eagentsaml-selector-clicker-status');
    state.selectorEl = panel.querySelector('#tm-eagentsaml-selector-clicker-selector');
    state.toggleBtn = panel.querySelector('#tm-eagentsaml-selector-clicker-toggle');
    state.logEl = panel.querySelector('#tm-eagentsaml-selector-clicker-log');

    state.toggleBtn?.addEventListener('click', () => {
      saveEnabled(!state.running);
      log(state.running ? 'Clicker resumed' : 'Clicker paused');
    });
    panel.querySelector('#tm-eagentsaml-selector-clicker-pick')?.addEventListener('click', () => {
      if (state.selectorMode) stopSelectorMode('Selector pick canceled');
      else startSelectorMode();
    });
    panel.querySelector('#tm-eagentsaml-selector-clicker-clear')?.addEventListener('click', () => {
      saveSelector('');
      state.lastClickedSelectorKey = '';
      state.lastSelectorMissLogKey = '';
      state.armedVisibleKey = '';
      state.lastArmLogKey = '';
      resetCredentialWait();
      log('Saved selector cleared');
    });

    makeDraggable(panel, panel.querySelector('#tm-eagentsaml-selector-clicker-head'));
  }

  function renderAll() {
    if (!state.panel) return;
    if (state.toggleBtn) {
      state.toggleBtn.textContent = state.running ? 'PAUSE' : 'RESUME';
      state.toggleBtn.style.background = state.running ? '#0284c7' : '#b45309';
    }
    if (state.selectorEl) {
      state.selectorEl.textContent = state.selector || 'No selector saved yet';
      state.selectorEl.style.color = state.selector ? '#e2e8f0' : '#94a3b8';
    }
    if (state.selectorMode) {
      setStatus('Click any page element to save its selector');
    } else if (!state.running) {
      setStatus('Paused');
    } else if (!state.selector) {
      setStatus('Pick a selector to start clicking');
    } else {
      setStatus('Armed: clicks saved selector every 10s when visible');
    }
    renderLogs();
  }

  function renderLogs() {
    if (!state.logEl) return;
    state.logEl.innerHTML = state.logs.slice(0, 12).map((line) => (
      `<div ${UI_ATTR}="1" style="margin-bottom:3px;word-break:break-word;">${escHtml(line)}</div>`
    )).join('');
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

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function stableClassTokens(el) {
    return Array.from(el?.classList || [])
      .filter((token) => /^[a-zA-Z0-9_-]{2,}$/.test(token))
      .filter((token) => !/^ng-|^active$|^show$/.test(token))
      .slice(0, 4);
  }

  function buildSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return `#${cssEscape(el.id)}`;

    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const byName = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      try { if (document.querySelectorAll(byName).length === 1) return byName; } catch {}
    }

    const role = norm(el.getAttribute('role') || '');
    const aria = norm(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const byRole = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      try { if (document.querySelectorAll(byRole).length === 1) return byRole; } catch {}
    }

    const parts = [];
    let cur = el;
    while (cur && cur instanceof Element && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${cssEscape(cur.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = stableClassTokens(cur);
      if (classes.length) part += `.${classes.map(cssEscape).join('.')}`;
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((node) => node.tagName === cur.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      cur = parent;
    }
    return parts.join(' > ');
  }

  function isUi(el) {
    return !!(el instanceof Element && el.closest(`[${UI_ATTR}="1"]`));
  }

  function selectableAt(clientX, clientY) {
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (isUi(node)) return null;
      if (!visible(node)) continue;
      if (node === document.body || node === document.documentElement) continue;
      return node;
    }
    return null;
  }

  function ensureHoverBox() {
    if (state.hoverBox && document.contains(state.hoverBox)) return state.hoverBox;
    const box = document.createElement('div');
    box.setAttribute(UI_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex - 1),
      pointerEvents: 'none',
      border: `2px solid ${CFG.selectorOutlineColor}`,
      background: CFG.selectorFillColor,
      borderRadius: '4px',
      boxSizing: 'border-box',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBox = box;
    return box;
  }

  function updateHover(el) {
    const box = ensureHoverBox();
    if (!(el instanceof Element) || !visible(el)) {
      box.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(0, rect.width)}px`,
      height: `${Math.max(0, rect.height)}px`
    });
  }

  function startSelectorMode() {
    state.selectorMode = true;
    renderAll();
    log('Selector mode started');

    const onMove = (event) => updateHover(selectableAt(event.clientX, event.clientY));
    const onClick = (event) => {
      if (!state.selectorMode) return;
      if (isUi(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = selectableAt(event.clientX, event.clientY);
      if (!target) return;
      saveSelectorFromElement(target);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      stopSelectorMode('Selector pick canceled');
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    state.selectorListeners = [
      () => document.removeEventListener('mousemove', onMove, true),
      () => document.removeEventListener('click', onClick, true),
      () => document.removeEventListener('keydown', onKey, true)
    ];
  }

  function stopSelectorMode(message = '', options = {}) {
    state.selectorMode = false;
    for (const fn of state.selectorListeners) {
      try { fn(); } catch {}
    }
    state.selectorListeners = [];
    try { if (state.hoverBox) state.hoverBox.style.display = 'none'; } catch {}
    renderAll();
    if (options.logIt !== false && message) log(message);
  }

  function saveSelectorFromElement(el) {
    stopSelectorMode('', { logIt: false });
    const selector = buildSelector(el);
    if (!selector) {
      log('Could not build selector for clicked element');
      return;
    }
    saveSelector(selector);
    state.lastClickedSelectorKey = '';
    state.lastSelectorMissLogKey = '';
    state.armedVisibleKey = '';
    state.lastArmLogKey = '';
    resetCredentialWait();
    log(`Saved selector: ${selector}`);
  }

  function getInputType(el) {
    return lower(el?.getAttribute?.('type') || el?.type || '');
  }

  function isLikelyCredentialUserInput(el) {
    if (!el || !visible(el) || !enabled(el)) return false;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    const type = getInputType(el);
    return !type || type === 'text' || type === 'email' || type === 'search' || type === 'tel';
  }

  function getCredentialUserScore(el) {
    if (!el) return Number.NEGATIVE_INFINITY;
    const meta = lower([
      el.getAttribute?.('autocomplete'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.labels?.[0]?.textContent,
      el.closest?.('label')?.textContent
    ].filter(Boolean).join(' '));
    let score = 0;
    if (/\busername\b/.test(meta)) score += 30;
    if (/\bemail\b/.test(meta)) score += 20;
    if (/\buser\b/.test(meta)) score += 10;
    if (/\blogin\b/.test(meta)) score += 8;
    if (lower(el.getAttribute?.('autocomplete') || '') === 'username') score += 25;
    if (getInputType(el) === 'email') score += 5;
    return score;
  }

  function getVisibleCredentialUserInputs(root) {
    return Array.from((root || document).querySelectorAll('input, textarea'))
      .filter((el) => isLikelyCredentialUserInput(el))
      .sort((a, b) => getCredentialUserScore(b) - getCredentialUserScore(a));
  }

  function getVisibleLoginFormContext(root = document) {
    const passwordInput = Array.from((root || document).querySelectorAll('input[type="password"]'))
      .find((el) => visible(el) && enabled(el));
    if (!passwordInput) return null;

    const form = passwordInput.closest('form') || root || document;
    const userInput = getVisibleCredentialUserInputs(form).find((el) => el !== passwordInput) || null;
    return {
      form,
      userInput,
      passwordInput
    };
  }

  function setNativeInputValue(el, value) {
    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && typeof desc.set === 'function' ? desc.set : null;
    if (!setter) return false;
    try {
      setter.call(el, value);
      return true;
    } catch {
      return false;
    }
  }

  function syncFrameworkValueTracker(el, previousValue) {
    const tracker = el?._valueTracker;
    if (!tracker || typeof tracker.setValue !== 'function') return false;
    try {
      tracker.setValue(String(previousValue ?? ''));
      return true;
    } catch {
      return false;
    }
  }

  function dispatchAuthFieldLifecycle(el) {
    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    const value = String(el.value || '');
    if (!value) return false;
    const chars = Array.from(value);

    try { el.focus({ preventScroll: true }); } catch {}
    try { el.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false })); } catch {}
    try {
      setNativeInputValue(el, '');
      syncFrameworkValueTracker(el, value);
    } catch {}
    try { el.setAttribute('value', ''); } catch {}
    try {
      if (typeof InputEvent === 'function') {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: null, inputType: 'deleteContentBackward' }));
      } else {
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }
    } catch {}

    let current = '';
    for (const ch of chars) {
      const nextValue = current + ch;
      try {
        if (typeof InputEvent === 'function') {
          el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
        }
      } catch {}
      try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ch })); } catch {}
      try { el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: ch })); } catch {}
      syncFrameworkValueTracker(el, current);
      setNativeInputValue(el, nextValue);
      try { el.setAttribute('value', nextValue); } catch {}
      try {
        if (typeof InputEvent === 'function') {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
        } else {
          el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
      } catch {}
      try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ch })); } catch {}
      current = nextValue;
    }
    try { el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch {}
    try { el.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false })); } catch {}
    try { el.blur(); } catch {}
    return true;
  }

  function prepareLoginForm(triggerEl) {
    const context = getVisibleLoginFormContext(triggerEl?.closest?.('form') || document);
    if (!context) return false;
    let prepared = false;
    for (const input of [context.userInput, context.passwordInput].filter(Boolean)) {
      if (!norm(input.value).length) continue;
      prepared = dispatchAuthFieldLifecycle(input) || prepared;
    }
    return prepared;
  }

  function resetCredentialWait() {
    state.credentialReadyKey = '';
    state.credentialReadySince = 0;
    state.lastCredentialWaitLogKey = '';
  }

  function getCredentialWaitState(target) {
    const context = getVisibleLoginFormContext(target?.closest?.('form') || document);
    if (!context?.userInput || !context?.passwordInput) return null;

    const userValue = norm(context.userInput.value || '');
    const passValue = String(context.passwordInput.value || '');
    if (!userValue || !passValue) {
      resetCredentialWait();
      return {
        waiting: true,
        reason: 'credentials-empty'
      };
    }

    const fingerprint = [
      norm(state.selector || ''),
      location.pathname,
      location.search,
      norm(context.userInput.getAttribute('id') || context.userInput.getAttribute('name') || 'user'),
      norm(context.passwordInput.getAttribute('id') || context.passwordInput.getAttribute('name') || 'password'),
      String(userValue.length),
      String(passValue.length)
    ].join('|');

    if (state.credentialReadyKey !== fingerprint) {
      state.credentialReadyKey = fingerprint;
      state.credentialReadySince = now();
      state.lastCredentialWaitLogKey = '';
    }

    const readyForMs = now() - state.credentialReadySince;
    if (readyForMs < CFG.loginFieldSettleMs) {
      return {
        waiting: true,
        reason: 'credentials-settling',
        remainingMs: CFG.loginFieldSettleMs - readyForMs,
        logKey: fingerprint
      };
    }

    return {
      waiting: false
    };
  }

  function dispatchPressSequence(el) {
    const mouseInit = {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...mouseInit, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 }));
      }
    } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { ...mouseInit, button: 0, buttons: 1 })); } catch {}
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerup', { ...mouseInit, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0 }));
      }
    } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, button: 0, buttons: 0 })); } catch {}
  }

  function clickTarget(el) {
    if (!el || !visible(el) || !enabled(el)) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    try {
      if (typeof el.click === 'function') {
        el.click();
      } else {
        HTMLElement.prototype.click.call(el);
      }
      return true;
    } catch {}
    return false;
  }

  function findTarget(selector) {
    const clean = norm(selector || '');
    if (!clean) return null;
    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(clean)); } catch {}
    return nodes.find((el) => visible(el) && enabled(el)) || null;
  }

  function tick() {
    if (state.destroyed || state.selectorMode || !state.running) return;
    const selector = norm(state.selector || '');
    if (!selector) return;

    const target = findTarget(selector);
    if (!target) {
      const missKey = `miss|${selector}|${location.pathname}`;
      state.armedVisibleKey = '';
      state.lastArmLogKey = '';
      resetCredentialWait();
      if (state.lastSelectorMissLogKey !== missKey) {
        state.lastSelectorMissLogKey = missKey;
        setStatus('Saved selector not visible right now');
        log(`Selector not found: ${selector}`);
      }
      return;
    }

    state.lastSelectorMissLogKey = '';
    const visibleKey = `${selector}|${location.pathname}|${location.search}`;
    if (state.armedVisibleKey !== visibleKey) {
      state.armedVisibleKey = visibleKey;
      if (state.lastArmLogKey !== visibleKey) {
        state.lastArmLogKey = visibleKey;
        setStatus('Selector armed; waiting next 10s pass before click');
        log(`Selector armed: ${selector}`);
      }
      return;
    }

    if (!clickTarget(target)) {
      setStatus('Selector found but click failed');
      log(`Click failed: ${selector}`);
      return;
    }

    state.lastClickAt = Date.now();
    state.lastClickedSelectorKey = selector;
    state.lastCredentialWaitLogKey = '';
    setStatus('Clicked saved selector');
    log(`Clicked selector: ${selector}`);
  }
})();
