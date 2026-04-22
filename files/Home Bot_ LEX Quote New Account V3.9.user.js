// ==UserScript==
// @name         Home Bot: LEX Quote New Account V3.9
// @namespace    homebot.lex.quote.new.account
// @version      3.9
// @description  Reads the current LEX payload (flat or nested), fills LEX Quote New Account, ignores Personal Lines Quote modal, locks interaction to the real Quote New Account form only, and hard-stops until page reload after Save is clicked.
// @author       OpenAI
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: LEX Quote New Account V3.9';
  const VERSION = '3.9';

  const CFG = {
    tickMs: 1800,
    maxActionWaitMs: 30000,
    maxAddressWaitMs: 35000,
    maxSourceWaitMs: 20000,
    defaultSourceCategory: 'Migrated Data',
    defaultDob: '01/01/1990',

    clickPauseMs: 450,
    fieldPauseMs: 160,
    bulkFieldGapMs: 100,
    afterFormOpenPauseMs: 650,
    afterBulkFieldsPauseMs: 450,
    afterAddressPastePauseMs: 1300,
    afterAddressReclickPauseMs: 850,
    afterAddressPickPauseMs: 1100,
    afterSourceCategoryPickPauseMs: 900,
    afterSavePauseMs: 1700
  };

  const KEYS = {
    PAYLOAD: 'tm_lex_home_bot_sheet_reader_payload_v1',
    READY: 'tm_lex_home_bot_sheet_reader_ready_v1',
    ACTIVE_ROW: 'tm_lex_home_bot_sheet_reader_active_row_v1',
    DONE: 'tm_lex_quote_new_account_done_v1',
    STATUS: 'tm_lex_quote_new_account_status_v1',
    ENABLED: 'tm_lex_quote_new_account_enabled_v1'
  };

  const EXACT_SOURCE_BUTTON_SELECTOR = '#combobox-button-510';
  const SESSION_STOP_KEY = '__hb_lex_qna_stop_this_session__';
  const POST_SAVE_LOCK_KEY = '__hb_lex_qna_post_save_lock_this_reload__';

  const UI = {
    PANEL_ID: 'hb-lex-qna-panel-v39',
    STATUS_ID: 'hb-lex-qna-status-v39',
    TOGGLE_ID: 'hb-lex-qna-toggle-v39',
    TOAST_WRAP_ID: 'hb-lex-qna-toast-wrap-v39',
    STYLE_ID: 'hb-lex-qna-style-v39'
  };

  const STATE = {
    running: false,
    lastStep: '',
    lastError: '',
    lastCompletedFingerprint: '',
    lastIdleKey: ''
  };

  let toastWrap = null;
  let loopId = null;

  init();

  function init() {
    hydratePersistentState();
    injectUi();
    ensureToastWrap();
    updateToggleUi();
    setStatus(isEnabled() ? 'IDLE' : 'STOPPED');
    log(`Script loaded. Persistent state: ${isEnabled() ? 'ON' : 'OFF'}.`);
    startLoop();
    runOnce();
  }

  function readEnabledRaw() {
    try {
      return localStorage.getItem(KEYS.ENABLED);
    } catch {
      return null;
    }
  }

  function isEnabled() {
    const raw = readEnabledRaw();
    if (raw === null) return true;
    return raw === '1';
  }

  function isPostSaveLocked() {
    return window[POST_SAVE_LOCK_KEY] === true;
  }

  function setPostSaveLock() {
    window[POST_SAVE_LOCK_KEY] = true;
    updateToggleUi();
  }

  function setEnabled(on) {
    try {
      localStorage.setItem(KEYS.ENABLED, on ? '1' : '0');
    } catch {}
    window[SESSION_STOP_KEY] = !on;
  }

  function hydratePersistentState() {
    window[SESSION_STOP_KEY] = !isEnabled();
    window[POST_SAVE_LOCK_KEY] = false;
  }

  function injectUi() {
    if (document.getElementById(UI.PANEL_ID)) return;

    if (!document.getElementById(UI.STYLE_ID)) {
      const style = document.createElement('style');
      style.id = UI.STYLE_ID;
      style.textContent = `
        #${UI.PANEL_ID} {
          position: fixed;
          right: 12px;
          bottom: 12px;
          z-index: 2147483647;
          width: 230px;
          background: rgba(16,20,27,.96);
          color: #eef3f7;
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 10px;
          box-shadow: 0 8px 20px rgba(0,0,0,.28);
          padding: 10px;
          font: 12px/1.35 Arial,sans-serif;
        }
        #${UI.PANEL_ID} .hb-title {
          font-weight: 700;
          margin-bottom: 6px;
        }
        #${UI.PANEL_ID} .hb-row {
          display: flex;
          gap: 6px;
          margin-top: 8px;
        }
        #${UI.PANEL_ID} button {
          flex: 1;
          border: 1px solid rgba(255,255,255,.12);
          color: #eef3f7;
          border-radius: 8px;
          padding: 6px 8px;
          cursor: pointer;
          font-weight: 700;
          background: #1f2937;
        }
        #${UI.PANEL_ID} button:hover {
          filter: brightness(1.08);
        }
        #${UI.TOGGLE_ID}.hb-on {
          background: #166534;
        }
        #${UI.TOGGLE_ID}.hb-off {
          background: #991b1b;
        }
        #${UI.STATUS_ID} {
          display: inline-block;
          margin-top: 4px;
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(255,255,255,.08);
          font-weight: 700;
        }
        #${UI.TOAST_WRAP_ID} {
          position: fixed;
          right: 12px;
          bottom: 88px;
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-width: 420px;
          pointer-events: none;
          font-family: Arial,sans-serif;
        }
      `;
      document.documentElement.appendChild(style);
    }

    const panel = document.createElement('div');
    panel.id = UI.PANEL_ID;
    panel.innerHTML = `
      <div class="hb-title">${escapeHtml(SCRIPT_NAME)}</div>
      <div>Status: <span id="${UI.STATUS_ID}">IDLE</span></div>
      <div class="hb-row">
        <button type="button" id="${UI.TOGGLE_ID}">START</button>
      </div>
    `;
    document.documentElement.appendChild(panel);

    document.getElementById(UI.TOGGLE_ID)?.addEventListener('click', () => {
      if (isPostSaveLocked()) {
        setStatus('STOPPED');
        log('Save already clicked. Reload page to run again.', 'warn');
        updateToggleUi();
        return;
      }

      const next = !isEnabled();
      setEnabled(next);
      updateToggleUi();

      if (next) {
        setStatus('IDLE');
        STATE.lastIdleKey = '';
        log('Automation enabled.', 'ok');
        runOnce();
      } else {
        setStatus('STOPPED');
        log('Automation stopped.', 'warn');
      }
    });
  }

  function updateToggleUi() {
    const btn = document.getElementById(UI.TOGGLE_ID);
    if (!btn) return;

    btn.classList.remove('hb-on', 'hb-off');

    if (isPostSaveLocked()) {
      btn.textContent = 'RELOAD';
      btn.classList.add('hb-off');
      return;
    }

    if (isEnabled()) {
      btn.textContent = 'STOP';
      btn.classList.add('hb-on');
    } else {
      btn.textContent = 'START';
      btn.classList.add('hb-off');
    }
  }

  function ensureToastWrap() {
    if (toastWrap && document.contains(toastWrap)) return toastWrap;

    toastWrap = document.getElementById(UI.TOAST_WRAP_ID);
    if (toastWrap) return toastWrap;

    toastWrap = document.createElement('div');
    toastWrap.id = UI.TOAST_WRAP_ID;
    document.documentElement.appendChild(toastWrap);
    return toastWrap;
  }

  function toast(msg, kind = 'info') {
    ensureToastWrap();

    const el = document.createElement('div');
    const bg =
      kind === 'error' ? 'rgba(180,40,40,.96)' :
      kind === 'ok' ? 'rgba(25,120,70,.96)' :
      kind === 'warn' ? 'rgba(145,98,20,.96)' :
      'rgba(25,25,25,.96)';

    el.style.cssText = [
      `background:${bg}`,
      'color:#fff',
      'padding:8px 10px',
      'border-radius:8px',
      'font-size:12px',
      'line-height:1.35',
      'box-shadow:0 6px 18px rgba(0,0,0,.25)',
      'word-break:break-word',
      'opacity:1',
      'transition:opacity .3s ease'
    ].join(';');

    el.textContent = `[${SCRIPT_NAME}] ${msg}`;
    toastWrap.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => {
        try { el.remove(); } catch {}
      }, 300);
    }, 3200);
  }

  function log(msg, kind = 'info') {
    console.log(`[${SCRIPT_NAME}] ${msg}`);
    toast(msg, kind);
    try {
      localStorage.setItem(KEYS.STATUS, JSON.stringify({
        script: SCRIPT_NAME,
        version: VERSION,
        at: new Date().toISOString(),
        status: kind,
        msg,
        url: location.href,
        enabled: isEnabled()
      }));
    } catch {}
  }

  function setStatus(text) {
    const el = document.getElementById(UI.STATUS_ID);
    if (el) el.textContent = text;
  }

  function setIdleLog(key, msg, kind = 'info', status = 'WAITING') {
    setStatus(status);
    if (STATE.lastIdleKey === key) return;
    STATE.lastIdleKey = key;
    log(msg, kind);
  }

  function stoppedThisSession() {
    return window[SESSION_STOP_KEY] === true || !isEnabled() || isPostSaveLocked();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normText(v) {
    return String(v || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[‐-‒–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normLower(v) {
    return normText(v).toLowerCase();
  }

  function firstNonEmpty(...values) {
    for (const v of values) {
      const s = String(v || '').trim();
      if (s) return s;
    }
    return '';
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function safeJsonParse(s) {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (!t) return null;
    if (!(t.startsWith('{') || t.startsWith('['))) return null;
    try { return JSON.parse(t); } catch { return null; }
  }

  function getStorageRaw(key) {
    let local = null;
    let session = null;

    try { local = localStorage.getItem(key); } catch {}
    try { session = sessionStorage.getItem(key); } catch {}

    if (local != null) return local;
    if (session != null) return session;
    return null;
  }

  function getStorageParsed(key) {
    const raw = getStorageRaw(key);
    if (raw == null) return null;
    const parsed = safeJsonParse(raw);
    return parsed !== null ? parsed : raw;
  }

  function removeStorageEverywhere(key) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }

  function isReadyValue(v) {
    if (v == null) return false;
    if (typeof v === 'object') return v.ready === true || v.ready === '1' || v.ready === 1;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'ready';
  }

  function getNativeSetter(el) {
    if (el instanceof HTMLTextAreaElement) {
      return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    }
    return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  }

  function setNativeValue(el, value) {
    const setter = getNativeSetter(el);
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function safeDispatch(el, ev) {
    try {
      el.dispatchEvent(ev);
    } catch {}
  }

  function fireInput(el, valueForPaste = null) {
    try {
      const ev = new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: valueForPaste != null ? 'insertFromPaste' : 'insertText',
        data: valueForPaste
      });
      el.dispatchEvent(ev);
    } catch {
      safeDispatch(el, new Event('input', { bubbles: true, composed: true }));
    }
  }

  function fireChange(el) {
    safeDispatch(el, new Event('change', { bubbles: true, composed: true }));
  }

  function fireBlur(el) {
    safeDispatch(el, new Event('blur', { bubbles: true, composed: true }));
  }

  async function pasteNormalField(el, value) {
    const text = String(value ?? '');

    el.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(70);

    try { el.focus({ preventScroll: true }); } catch {}
    await sleep(90);

    setNativeValue(el, '');
    fireInput(el, '');
    fireChange(el);
    await sleep(60);

    setNativeValue(el, text);
    fireInput(el, text);
    await sleep(50);
    fireChange(el);
    await sleep(45);
    fireBlur(el);
    await sleep(CFG.fieldPauseMs);
  }

  async function pasteAddressField(el, value) {
    const text = String(value ?? '');

    el.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(CFG.clickPauseMs);

    try { el.focus({ preventScroll: true }); } catch {}
    await sleep(200);

    setNativeValue(el, '');
    fireInput(el, '');
    await sleep(160);

    setNativeValue(el, text);
    fireInput(el, text);

    await sleep(CFG.afterAddressPastePauseMs);
  }

  async function hardClick(el, label = 'element') {
    if (!el) throw new Error(`Missing click target: ${label}`);

    const target = el.closest('button,[role="button"],[role="option"],a,li,.slds-listbox__option,.slds-listbox__item,lightning-base-combobox-item,span,label') || el;

    target.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(120);

    try { target.focus({ preventScroll: true }); } catch {}
    await sleep(80);

    const evs = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of evs) {
      try {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
      await sleep(20);
    }

    try { target.click(); } catch {}
    log(`Clicked: ${label}`);
    await sleep(CFG.clickPauseMs);
    return true;
  }

  async function dispatchClickSequence(el, label = 'element') {
    if (!el) throw new Error(`Missing click target: ${label}`);

    el.scrollIntoView({ block: 'center', inline: 'center' });
    await sleep(110);

    try { el.focus({ preventScroll: true }); } catch {}
    await sleep(50);

    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
      await sleep(20);
    }

    try { el.click(); } catch {}
    log(`Clicked: ${label}`);
    await sleep(220);
  }

  async function pressKey(el, key) {
    if (!el) return;

    try { el.focus({ preventScroll: true }); } catch {}
    await sleep(35);

    for (const type of ['keydown', 'keyup']) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
          composed: true
        }));
      } catch {}
      await sleep(25);
    }
  }

  function collectRoots() {
    const roots = new Set();
    const seenDocs = new Set();
    const seenRoots = new Set();

    function walkRoot(root) {
      if (!root || seenRoots.has(root)) return;
      seenRoots.add(root);
      roots.add(root);

      let walker;
      try {
        walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      } catch {
        return;
      }

      while (walker.nextNode()) {
        const el = walker.currentNode;
        if (el.shadowRoot) walkRoot(el.shadowRoot);

        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
          try {
            const d = el.contentDocument;
            if (d && !seenDocs.has(d)) {
              seenDocs.add(d);
              walkRoot(d);
              if (d.documentElement) walkRoot(d.documentElement);
            }
          } catch {}
        }
      }
    }

    walkRoot(document);
    if (document.documentElement) walkRoot(document.documentElement);

    return Array.from(roots);
  }

  function queryAllDeep(selector) {
    const out = [];
    for (const root of collectRoots()) {
      try {
        out.push(...root.querySelectorAll(selector));
      } catch {}
    }
    return out;
  }

  function queryFirstVisibleDeep(selector) {
    const all = queryAllDeep(selector);
    return all.find(isVisible) || null;
  }

  function queryAllVisibleDeep(selector) {
    return queryAllDeep(selector).filter(isVisible);
  }

  function queryFirstVisibleWithin(root, selector) {
    if (!root) return null;
    try {
      const all = Array.from(root.querySelectorAll(selector));
      return all.find(isVisible) || null;
    } catch {
      return null;
    }
  }

  function queryAllVisibleWithin(root, selector) {
    if (!root) return [];
    try {
      return Array.from(root.querySelectorAll(selector)).filter(isVisible);
    } catch {
      return [];
    }
  }

  function findByTextDeep(selectors, matcher) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const fn = typeof matcher === 'function'
      ? matcher
      : (txt => normText(txt).toLowerCase() === normText(matcher).toLowerCase());

    for (const selector of list) {
      const nodes = queryAllDeep(selector);
      for (const el of nodes) {
        const txt = normText(el.innerText || el.textContent || el.value || '');
        if (isVisible(el) && fn(txt, el)) return el;
      }
    }
    return null;
  }

  function findByTextWithin(root, selectors, matcher) {
    if (!root) return null;
    const list = Array.isArray(selectors) ? selectors : [selectors];
    const fn = typeof matcher === 'function'
      ? matcher
      : (txt => normText(txt).toLowerCase() === normText(matcher).toLowerCase());

    for (const selector of list) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch {}
      for (const el of nodes) {
        const txt = normText(el.innerText || el.textContent || el.value || '');
        if (isVisible(el) && fn(txt, el)) return el;
      }
    }
    return null;
  }

  async function waitFor(fn, timeoutMs, label) {
    const start = Date.now();
    while (!stoppedThisSession() && (Date.now() - start) < timeoutMs) {
      try {
        const found = await fn();
        if (found) return found;
      } catch {}
      await sleep(250);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }

  function formatPhone(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    const digits = s.replace(/\D/g, '');
    if (digits.length === 10) return digits;
    if (digits.length === 11 && digits.startsWith('1')) return digits;
    return digits || s;
  }

  function formatDate(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
    return '';
  }

  function buildCombinedAddress(street, city, state, zip) {
    const s = String(street || '').trim();
    const c = String(city || '').trim();
    const st = String(state || '').trim();
    const z = String(zip || '').trim();

    if (s && c && st && z) return `${s}, ${c}, ${st} ${z}`;
    if (s && c && st) return `${s}, ${c}, ${st}`;
    if (s && c) return `${s}, ${c}`;
    if (s) return s;
    return '';
  }

  function buildLeadFromCurrentStorage() {
    const payloadRaw = getStorageParsed(KEYS.PAYLOAD);
    const readyRaw = getStorageParsed(KEYS.READY);
    const activeRowRaw = getStorageParsed(KEYS.ACTIVE_ROW);

    if (!payloadRaw) return null;
    if (!isReadyValue(readyRaw)) return null;

    let payload = payloadRaw;
    let flat = null;
    let lexFill = {};
    let row = {};
    let source = {};

    if (payload && typeof payload === 'object' && (payload.lexFill || payload.row || payload.source)) {
      lexFill = payload.lexFill || {};
      row = payload.row || {};
      source = payload.source || {};
    } else if (payload && typeof payload === 'object') {
      flat = payload;
    } else {
      return null;
    }

    const rowNumber = Number(
      firstNonEmpty(
        source.rowNumber,
        activeRowRaw && typeof activeRowRaw === 'object' ? activeRowRaw.rowNumber : activeRowRaw
      )
    ) || null;

    const firstName = firstNonEmpty(
      flat?.firstName,
      lexFill.firstName,
      row.first
    );

    const lastName = firstNonEmpty(
      flat?.lastName,
      lexFill.lastName,
      row.last
    );

    const street = firstNonEmpty(
      flat?.address,
      lexFill.street,
      lexFill.address,
      lexFill.searchAddress,
      row.address
    );

    const city = firstNonEmpty(
      flat?.city,
      lexFill.city,
      row.city
    );

    const state = firstNonEmpty(
      flat?.state,
      lexFill.state,
      row.state
    );

    const zip = firstNonEmpty(
      flat?.zip,
      flat?.zipCode,
      lexFill.zip,
      lexFill.zipCode,
      row.zipCode
    );

    const address = buildCombinedAddress(street, city, state, zip) || firstNonEmpty(lexFill.searchAddress);

    const dob = formatDate(firstNonEmpty(
      flat?.dateOfBirth,
      lexFill.dateOfBirth
    )) || CFG.defaultDob;

    const email = firstNonEmpty(
      flat?.email,
      lexFill.email,
      row.email
    );

    const phone = formatPhone(firstNonEmpty(
      flat?.phone,
      lexFill.phone,
      row.phoneNumber
    ));

    const sourceCategory = firstNonEmpty(
      flat?.sourceCategory,
      lexFill.sourceCategory,
      CFG.defaultSourceCategory
    );

    const fingerprint = [
      String(rowNumber || ''),
      firstName,
      lastName,
      address,
      email,
      phone
    ].join('|');

    return {
      fingerprint,
      rowNumber,
      payloadRaw,
      readyRaw,
      activeRowRaw,
      lead: {
        firstName,
        lastName,
        address,
        dob,
        email,
        phone,
        sourceCategory
      }
    };
  }

  function clearConsumedPayloadKeys() {
    removeStorageEverywhere(KEYS.PAYLOAD);
    removeStorageEverywhere(KEYS.READY);
    removeStorageEverywhere(KEYS.ACTIVE_ROW);
  }

  function getParentDeep(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode?.();
    if (root instanceof ShadowRoot) return root.host || null;
    return null;
  }

  function getAncestorsDeep(el) {
    const out = [];
    let cur = el;
    while (cur) {
      if (cur instanceof Element) out.push(cur);
      cur = getParentDeep(cur);
    }
    return out;
  }

  function isPersonalLinesQuoteContainer(el) {
    if (!el || !(el instanceof Element)) return false;

    const txt = normLower(el.innerText || el.textContent || '');
    if (txt.includes('personal lines quote for') || txt.includes('personal lines quote')) return true;

    try {
      const risk = el.querySelector('input[name="riskAddress"][data-name="riskAddress"]');
      if (risk && isVisible(risk)) return true;
    } catch {}

    return false;
  }

  function isPersonalLinesQuoteOpen() {
    const candidates = queryAllDeep('section.slds-modal, div.slds-modal__container, article[role="dialog"], .modal-container, c-start-quote-component');
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      if (isPersonalLinesQuoteContainer(el)) return true;
    }

    const globalRisk = queryFirstVisibleDeep('input[name="riskAddress"][data-name="riskAddress"]');
    if (globalRisk) return true;

    return false;
  }

  function getQuoteNewAccountFormRoot() {
    const firstInputs = queryAllVisibleDeep('input[name="FirstName"]');

    for (const first of firstInputs) {
      const chain = getAncestorsDeep(first);
      for (const root of chain) {
        if (!root || !(root instanceof Element)) continue;
        if (isPersonalLinesQuoteContainer(root)) continue;

        const last = queryFirstVisibleWithin(root, 'input[name="LastName"]');
        const addr = queryFirstVisibleWithin(root, 'input[placeholder="Search Address"], input[role="combobox"][placeholder="Search Address"]');

        if (last && addr) {
          return root;
        }
      }
    }

    return null;
  }

  function getQuoteNewAccountDialogRoot() {
    const formRoot = getQuoteNewAccountFormRoot();
    if (!formRoot) return null;

    const chain = getAncestorsDeep(formRoot);
    for (const el of chain) {
      if (!el || !(el instanceof Element)) continue;
      if (el.matches('section.slds-modal, div.slds-modal__container, article[role="dialog"], .modal-container')) {
        if (!isPersonalLinesQuoteContainer(el)) return el;
      }
    }

    return formRoot;
  }

  function formIsOpen() {
    return !!getQuoteNewAccountFormRoot();
  }

  function getQuoteButton() {
    return findByTextDeep(['button', 'span', 'div'], (txt, el) => {
      if (normText(txt) !== 'Quote New Account') return false;
      return el.tagName === 'BUTTON' || !!el.closest('button');
    });
  }

  function getAgencySwitchedModal() {
    const modals = queryAllDeep('section.slds-modal, div.slds-modal__container, article[role="dialog"], .modal-container');
    return modals.find(el => {
      if (!isVisible(el)) return false;
      if (isPersonalLinesQuoteContainer(el)) return false;
      const txt = normText(el.innerText || el.textContent || '');
      return /agency.?switched session/i.test(txt);
    }) || null;
  }

  function getContinueButtonInsideAgencyModal() {
    const modal = getAgencySwitchedModal();
    if (!modal) return null;

    const btns = modal.querySelectorAll('button');
    for (const btn of btns) {
      if (!isVisible(btn)) continue;
      if (/^continue$/i.test(normText(btn.innerText || btn.textContent || ''))) return btn;
    }
    return null;
  }

  function getFirstNameInput() {
    const root = getQuoteNewAccountFormRoot();
    return queryFirstVisibleWithin(root, 'input[name="FirstName"]');
  }

  function getLastNameInput() {
    const root = getQuoteNewAccountFormRoot();
    return queryFirstVisibleWithin(root, 'input[name="LastName"]');
  }

  function getAddressInput() {
    const root = getQuoteNewAccountFormRoot();
    return queryFirstVisibleWithin(root, 'input[placeholder="Search Address"], input[role="combobox"][placeholder="Search Address"]');
  }

  function getDobInput() {
    const root = getQuoteNewAccountFormRoot();
    return queryFirstVisibleWithin(root, 'input[name="dateOfBirth"]');
  }

  function getEmailInput() {
    const root = getQuoteNewAccountFormRoot();
    return queryFirstVisibleWithin(root, 'input[name="email"]');
  }

  function getPhoneInput() {
    const root = getQuoteNewAccountFormRoot();
    return queryFirstVisibleWithin(root, 'input[name="phone"]');
  }

  function getSourceCategoryButton() {
    const root = getQuoteNewAccountDialogRoot() || getQuoteNewAccountFormRoot();
    if (!root) return null;

    return (
      queryFirstVisibleWithin(root, EXACT_SOURCE_BUTTON_SELECTOR) ||
      queryFirstVisibleWithin(root, 'button[name="SourceCategory__c"]') ||
      queryFirstVisibleWithin(root, 'button[aria-label="Source Category (PL)"]') ||
      queryFirstVisibleWithin(root, 'button[aria-label*="Source Category"]') ||
      queryFirstVisibleWithin(root, 'button[title*="Source Category"]')
    );
  }

  function getSourceCategoryListbox(btn) {
    if (isPersonalLinesQuoteOpen()) return null;

    const controlId = btn?.getAttribute('aria-controls');
    if (controlId) {
      for (const root of collectRoots()) {
        try {
          const el = root.getElementById?.(controlId);
          if (el && isVisible(el) && !isPersonalLinesQuoteContainer(el)) return el;
        } catch {}
      }
    }

    const dialogRoot = getQuoteNewAccountDialogRoot();
    const scoped = queryAllVisibleWithin(dialogRoot, '[role="listbox"], .slds-listbox, .slds-dropdown');
    const safeScoped = scoped.find(el => !isPersonalLinesQuoteContainer(el));
    if (safeScoped) return safeScoped;

    return null;
  }

  function getSourceCategoryOptions(listbox) {
    if (!listbox) return [];

    const selectors = [
      '[role="option"]',
      'lightning-base-combobox-item',
      '.slds-listbox__item',
      '.slds-listbox__option',
      'li'
    ];

    const out = [];
    for (const sel of selectors) {
      try {
        for (const el of listbox.querySelectorAll(sel)) {
          if (!isVisible(el)) continue;
          if (isPersonalLinesQuoteContainer(el)) continue;
          const txt = normLower(el.innerText || el.textContent || el.getAttribute('title') || '');
          if (!txt) continue;
          out.push(el);
        }
      } catch {}
    }
    return out;
  }

  function getTargetSourceCategoryOption(listbox, targetValue) {
    const options = getSourceCategoryOptions(listbox);
    const want = normLower(targetValue);

    for (const el of options) {
      const txt = normLower(el.innerText || el.textContent || el.getAttribute('title') || '');
      if (txt === want) return el;
    }

    const spans = [...listbox.querySelectorAll(`span[title="${targetValue}"]`)].filter(isVisible);
    if (spans[0]) {
      return spans[0].closest(
        '[role="option"], lightning-base-combobox-item, .slds-listbox__item, .slds-listbox__option, li'
      ) || spans[0];
    }

    return null;
  }

  function isSourceCategorySelected(btn, targetValue) {
    const txt = normLower(btn?.innerText || btn?.textContent || btn?.getAttribute('data-value') || '');
    const target = normLower(targetValue);
    return txt === target || txt.includes(target);
  }

  async function openSourceCategoryDropdown(btn) {
    await dispatchClickSequence(btn, 'Source Category exact button');
    await sleep(350);

    if (!getSourceCategoryListbox(btn)) {
      await pressKey(btn, 'ArrowDown');
      await sleep(350);
    }

    return waitFor(() => getSourceCategoryListbox(btn), 8000, 'Source Category listbox');
  }

  async function selectSourceCategoryByDirectOptionClick(btn, listbox, targetValue) {
    const target = await waitFor(
      () => getTargetSourceCategoryOption(listbox, targetValue),
      5000,
      'Source Category target option'
    );

    log(`Source Category target found: ${normText(target.innerText || target.textContent || target.getAttribute('title') || '')}`);

    await dispatchClickSequence(target, `${targetValue} direct option`);
    await sleep(450);

    if (isSourceCategorySelected(btn, targetValue)) return true;

    const innerSpan = [...target.querySelectorAll(`span[title="${targetValue}"]`)].find(isVisible);
    if (innerSpan) {
      await dispatchClickSequence(innerSpan, `${targetValue} inner span`);
      await sleep(450);
      if (isSourceCategorySelected(btn, targetValue)) return true;
    }

    return false;
  }

  async function selectSourceCategoryByKeyboard(btn, listbox, targetValue) {
    const options = getSourceCategoryOptions(listbox);
    const want = normLower(targetValue);

    const idx = options.findIndex(el => {
      const txt = normLower(el.innerText || el.textContent || el.getAttribute('title') || '');
      return txt === want;
    });

    if (idx < 0) {
      throw new Error(`Could not find "${targetValue}" in Source Category options`);
    }

    log(`Source Category keyboard fallback index: ${idx}`);

    const focusEl = listbox || btn;
    try { focusEl.focus({ preventScroll: true }); } catch {}
    await sleep(100);

    await pressKey(focusEl, 'Home');
    await sleep(140);

    for (let i = 0; i <= idx; i++) {
      await pressKey(focusEl, 'ArrowDown');
      await sleep(100);
    }

    await pressKey(focusEl, 'Enter');
    await sleep(650);

    return isSourceCategorySelected(btn, targetValue);
  }

  function getSaveButton() {
    const root = getQuoteNewAccountDialogRoot() || getQuoteNewAccountFormRoot();
    if (!root) return null;

    const saveBtn = findByTextWithin(root, ['button'], txt => normText(txt).toLowerCase() === 'save');
    if (saveBtn) return saveBtn;

    const brandBtns = queryAllVisibleWithin(root, 'button.slds-button_brand');
    return brandBtns.find(btn => normText(btn.innerText || btn.textContent || '').toLowerCase() === 'save') || null;
  }

  function getAddressListboxForInput(input) {
    if (isPersonalLinesQuoteOpen()) return null;

    const controlId = input?.getAttribute('aria-controls');
    if (controlId) {
      for (const root of collectRoots()) {
        try {
          const el = root.getElementById?.(controlId);
          if (el && isVisible(el) && !isPersonalLinesQuoteContainer(el)) return el;
        } catch {}
      }
    }

    const dialogRoot = getQuoteNewAccountDialogRoot();
    const combos = queryAllVisibleWithin(dialogRoot, '[role="listbox"], .slds-listbox, .slds-dropdown, .slds-lookup__menu');
    return combos.find(el => !isPersonalLinesQuoteContainer(el)) || null;
  }

  function getFirstVisibleAddressOption(listbox) {
    if (!listbox) return null;

    const selectors = [
      '[role="option"]',
      'lightning-base-combobox-item',
      '.slds-listbox__item',
      '.slds-listbox__option',
      'li'
    ];

    for (const sel of selectors) {
      const nodes = Array.from(listbox.querySelectorAll(sel))
        .filter(isVisible)
        .filter(el => {
          if (isPersonalLinesQuoteContainer(el)) return false;
          const txt = normText(el.innerText || el.textContent || '');
          return !!txt && !/no matches|no results|recent addresses/i.test(txt);
        });

      for (const el of nodes) {
        const clickable =
          el.matches('[role="option"],lightning-base-combobox-item,.slds-listbox__item,.slds-listbox__option,li')
            ? el
            : el.closest('[role="option"],lightning-base-combobox-item,.slds-listbox__item,.slds-listbox__option,li');

        if (clickable && isVisible(clickable) && !isPersonalLinesQuoteContainer(clickable)) return clickable;
      }
    }

    return null;
  }

  function shouldIgnoreBecausePersonalLinesQuote() {
    if (!isPersonalLinesQuoteOpen()) return false;
    setIdleLog('personal_lines_quote_open', 'Personal Lines Quote is open. Ignoring it.', 'warn', 'WAITING');
    return true;
  }

  async function stepClickQuoteNewAccount() {
    STATE.lastStep = 'click_quote_new_account';

    if (formIsOpen()) {
      log('Form already open. Skipping Quote New Account click.');
      return;
    }

    const btn = await waitFor(() => getQuoteButton(), CFG.maxActionWaitMs, 'Quote New Account button');
    await hardClick(btn.closest('button') || btn, 'Quote New Account');
    await sleep(1300);
  }

  async function stepAgencyContinueIfPresent() {
    STATE.lastStep = 'agency_continue_if_present';

    const modal = getAgencySwitchedModal();
    if (!modal) {
      log('Agency-Switched modal not found. Skipping Continue.');
      return;
    }

    log('Agency-Switched modal detected.');

    const btn = await waitFor(() => getContinueButtonInsideAgencyModal(), 12000, 'Continue button');
    await hardClick(btn, 'Continue');
    await sleep(1300);
  }

  async function stepWaitForm() {
    STATE.lastStep = 'wait_form';
    await waitFor(() => getQuoteNewAccountFormRoot(), CFG.maxActionWaitMs, 'quote new account form');
    log('Quote form detected.');
    await sleep(CFG.afterFormOpenPauseMs);
  }

  async function stepPasteCoreFieldsFast(lead) {
    STATE.lastStep = 'paste_core_fields_fast';

    const jobs = [
      { selectorFn: getFirstNameInput, value: lead.firstName, label: 'First Name', required: true },
      { selectorFn: getLastNameInput, value: lead.lastName, label: 'Last Name', required: true },
      { selectorFn: getDobInput, value: lead.dob || CFG.defaultDob, label: 'DOB', required: true },
      { selectorFn: getEmailInput, value: lead.email, label: 'Email', required: false },
      { selectorFn: getPhoneInput, value: lead.phone, label: 'Phone', required: false }
    ];

    for (const job of jobs) {
      const val = String(job.value || '').trim();

      if (!val) {
        if (job.required) throw new Error(`Missing value for ${job.label}`);
        log(`Skipping ${job.label}; no value.`);
        continue;
      }

      const input = await waitFor(() => job.selectorFn(), CFG.maxActionWaitMs, job.label);
      await pasteNormalField(input, val);
      log(`Pasted ${job.label}: ${val}`);
      await sleep(CFG.bulkFieldGapMs);
    }

    await sleep(CFG.afterBulkFieldsPauseMs);
  }

  async function stepFillAddressAndPickFirst(address) {
    STATE.lastStep = 'fill_address_and_pick_first';

    const input = await waitFor(() => getAddressInput(), CFG.maxActionWaitMs, 'address input');

    await pasteAddressField(input, address);
    log(`Pasted address: ${address}`);

    await hardClick(input, 'Address box re-click');
    await sleep(CFG.afterAddressReclickPauseMs);

    const listbox = await waitFor(() => getAddressListboxForInput(input), CFG.maxAddressWaitMs, 'address dropdown');
    log('Address dropdown opened.');

    const firstOption = await waitFor(() => {
      const direct = getFirstVisibleAddressOption(listbox);
      if (direct) return direct;
      return null;
    }, CFG.maxAddressWaitMs, 'address first option');

    log(`Address first option found: ${normText(firstOption.innerText || firstOption.textContent || '')}`);
    await hardClick(firstOption, 'First address option');
    log('Address selected.');
    await sleep(CFG.afterAddressPickPauseMs);
  }

  async function stepSetSourceCategory(lead) {
    STATE.lastStep = 'set_source_category';

    const targetValue = String(lead?.sourceCategory || CFG.defaultSourceCategory).trim() || CFG.defaultSourceCategory;

    const btn = await waitFor(() => getSourceCategoryButton(), CFG.maxSourceWaitMs, 'Source Category button');
    log(`Source Category button found: ${normText(btn.innerText || btn.textContent || btn.getAttribute('data-value') || '')}`);

    if (isSourceCategorySelected(btn, targetValue)) {
      log(`Source Category already ${targetValue}.`);
      return;
    }

    const listbox1 = await openSourceCategoryDropdown(btn);
    log('Source Category dropdown opened.');

    let ok = false;

    try {
      ok = await selectSourceCategoryByDirectOptionClick(btn, listbox1, targetValue);
    } catch (e) {
      log(`Direct Source Category click path failed: ${e?.message || e}`, 'error');
    }

    if (!ok) {
      log('Trying Source Category keyboard fallback...');
      const listbox2 = getSourceCategoryListbox(btn) || await openSourceCategoryDropdown(btn);
      ok = await selectSourceCategoryByKeyboard(btn, listbox2, targetValue);
    }

    if (!ok) {
      throw new Error(`Selection did not stick for "${targetValue}"`);
    }

    log(`Source Category selected: ${targetValue}`);
    await sleep(CFG.afterSourceCategoryPickPauseMs);
  }

  async function stepClickSave() {
    STATE.lastStep = 'click_save';

    const btn = await waitFor(() => getSaveButton(), CFG.maxActionWaitMs, 'Save button');
    log(`Save button found: ${normText(btn.innerText || btn.textContent || '')}`);
    await hardClick(btn, 'Save');
    log('Save clicked. Script locked until page reload.');
    await sleep(CFG.afterSavePauseMs);
    setPostSaveLock();
  }

  function rememberCompletedPayload(ctx) {
    STATE.lastCompletedFingerprint = ctx.fingerprint;

    try {
      localStorage.setItem(KEYS.DONE, JSON.stringify({
        done: true,
        at: new Date().toISOString(),
        script: SCRIPT_NAME,
        version: VERSION,
        rowNumber: ctx.rowNumber,
        url: location.href
      }));
    } catch {}
  }

  async function runOnce() {
    if (isPostSaveLocked()) {
      updateToggleUi();
      setIdleLog('post_save_lock', 'Save already clicked. Waiting for page reload.', 'warn', 'STOPPED');
      return;
    }

    if (stoppedThisSession()) {
      updateToggleUi();
      setIdleLog('stopped', 'Stopped. Click START to enable automation.', 'warn', 'STOPPED');
      return;
    }

    if (STATE.running) return;

    if (shouldIgnoreBecausePersonalLinesQuote()) return;

    const ctx = buildLeadFromCurrentStorage();

    if (!ctx) {
      setIdleLog('waiting_payload', 'Waiting for current LEX payload...', 'info', 'WAITING');
      return;
    }

    if (ctx.fingerprint === STATE.lastCompletedFingerprint) {
      setIdleLog(`same_payload_${ctx.fingerprint}`, 'Same payload already completed. Waiting for a new one.', 'warn', 'WAITING');
      return;
    }

    if (!ctx.lead.firstName || !ctx.lead.lastName || !ctx.lead.address) {
      setIdleLog(`bad_payload_${ctx.fingerprint}`, 'Current payload found, but First Name / Last Name / Address is incomplete.', 'error', 'BAD PAYLOAD');
      return;
    }

    STATE.running = true;
    STATE.lastIdleKey = '';
    setStatus(`ROW ${ctx.rowNumber || '?'}`);

    try {
      log(`Using current LEX payload. Row ${ctx.rowNumber || '?'}`);
      log(`First Name: ${ctx.lead.firstName}`);
      log(`Last Name: ${ctx.lead.lastName}`);
      log(`Final address: ${ctx.lead.address}`);

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepClickQuoteNewAccount();

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepAgencyContinueIfPresent();

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepWaitForm();

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepPasteCoreFieldsFast(ctx.lead);

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepFillAddressAndPickFirst(ctx.lead.address);

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepSetSourceCategory(ctx.lead);

      if (shouldIgnoreBecausePersonalLinesQuote()) return;
      await stepClickSave();

      rememberCompletedPayload(ctx);
      clearConsumedPayloadKeys();

      setStatus('STOPPED');
      log('Done. Payload cleared. Waiting for page reload.', 'ok');
    } catch (err) {
      STATE.lastError = String(err?.message || err || 'Unknown error');
      setStatus('ERROR');
      log(`Run failed at ${STATE.lastStep || 'unknown_step'}: ${STATE.lastError}`, 'error');
    } finally {
      STATE.running = false;
      updateToggleUi();
    }
  }

  function startLoop() {
    try {
      if (loopId) clearInterval(loopId);
    } catch {}

    loopId = setInterval(() => {
      runOnce();
    }, CFG.tickMs);

    window.addEventListener('focus', () => {
      runOnce();
    }, true);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) runOnce();
    }, true);

    window.addEventListener('storage', (e) => {
      if (!e || !e.key) return;
      if (
        e.key === KEYS.PAYLOAD ||
        e.key === KEYS.READY ||
        e.key === KEYS.ACTIVE_ROW ||
        e.key === KEYS.ENABLED
      ) {
        runOnce();
      }
    });
  }
})();