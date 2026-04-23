// ==UserScript==
// @name         01 GWPC Start Auto Quote
// @namespace    homebot.gwpc-start-auto-quote
// @version      1.7
// @description  Waits for Current Activities, reloads once, waits 2 seconds after Current Activities is visible again, clicks Start New Submission, then clicks Select only on the Personal Auto row in New Submission.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-start-auto-quote.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-start-auto-quote.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = '01 GWPC Start Auto Quote';
  const VERSION = '1.7';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';

  const KEYS = {
    RELOADED: 'hb_gwpc_start_auto_quote_reloaded_v16'
  };

  const CFG = {
    tickMs: 500,
    dialogPatchMs: 250,
    postReloadDelayMs: 2000,
    afterStartDelayMs: 2000,
    productWaitMs: 30000,
    selectRetryMs: 1500,
    maxSelectAttempts: 4,
    panelRight: 12,
    panelBottom: 12,
    zIndex: 2147483647
  };

  const IDS = {
    currentActivitiesLabel: 'AccountFile_Summary-AccountFile_SummaryScreen-AccountFile_Summary_ActivitiesLV--label',
    productTable: 'NewSubmission-NewSubmissionScreen-ProductOffersDV-ProductSelectionLV'
  };

  const TEXT = {
    trigger: 'Current Activities',
    startNewSubmission: 'Start New Submission',
    personalAuto: 'Personal Auto'
  };

  const state = {
    armed: true,
    busy: false,
    done: false,
    phase: 'wait-trigger', // wait-trigger | started | verify-select | done
    startClickedAt: 0,
    reloadTriggerSeenAt: 0,
    selectAttemptCount: 0,
    lastSelectAttemptAt: 0,
    uiReady: false,
    lastStatus: '',
    dialogPatchTimer: null
  };

  boot();

  function boot() {
    installDialogKillSwitch();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
    } else {
      onDomReady();
    }

    log('Loaded');
    setInterval(tick, CFG.tickMs);
    tick();
  }

  function onDomReady() {
    if (state.uiReady) return;
    state.uiReady = true;
    buildUi();
    setStatus('Waiting for Current Activities');
    syncUi();
  }

  function installDialogKillSwitch() {
    patchWindowDialogs(window);

    if (state.dialogPatchTimer) clearInterval(state.dialogPatchTimer);
    state.dialogPatchTimer = setInterval(() => {
      for (const win of getAllWindows()) {
        patchWindowDialogs(win);
      }
    }, CFG.dialogPatchMs);
  }

  function patchWindowDialogs(win) {
    if (!win) return;

    try {
      if (!win.__HB_GWPC_START_AUTO_QUOTE_DIALOG_PATCHED__) {
        win.__HB_GWPC_START_AUTO_QUOTE_DIALOG_PATCHED__ = true;

        try { win.alert = function () {}; } catch {}
        try { win.confirm = function () { return true; }; } catch {}
        try { win.prompt = function (_msg, defValue = '') { return String(defValue ?? ''); }; } catch {}

        try {
          win.addEventListener('beforeunload', function (e) {
            try { e.stopImmediatePropagation(); } catch {}
            try { e.stopPropagation(); } catch {}
            try { e.preventDefault(); } catch {}
            try { e.returnValue = undefined; } catch {}
            return undefined;
          }, true);
        } catch {}
      }

      try { win.onbeforeunload = null; } catch {}
      try { if (win.document) win.document.onbeforeunload = null; } catch {}
      try { if (win.document?.body) win.document.body.onbeforeunload = null; } catch {}
      try { if (win.document?.documentElement) win.document.documentElement.onbeforeunload = null; } catch {}
    } catch {}
  }

  function tick() {
    if (!state.armed || state.busy || state.done) return;
    if (isGloballyPaused()) {
      setStatus('Paused by shared selector');
      return;
    }

    if (state.phase === 'wait-trigger') {
      const trigger = findTriggerLabel();

      if (!trigger) {
        state.reloadTriggerSeenAt = 0;
        setStatus('Waiting for Current Activities');
        return;
      }

      if (!didReloadOnce()) {
        markReloadOnce();
        setStatus('Current Activities found, reloading once');
        log('Current Activities found. Reloading once');
        setTimeout(safeReload, 80);
        return;
      }

      if (!state.reloadTriggerSeenAt) {
        state.reloadTriggerSeenAt = Date.now();
        setStatus('Reload done. Waiting 2s');
        log('Current Activities found after reload');
        return;
      }

      if ((Date.now() - state.reloadTriggerSeenAt) < CFG.postReloadDelayMs) {
        const secLeft = Math.max(1, Math.ceil((CFG.postReloadDelayMs - (Date.now() - state.reloadTriggerSeenAt)) / 1000));
        setStatus(`Reload done. Waiting ${secLeft}s`);
        return;
      }

      const startBtn = findStartNewSubmissionButton();
      if (!startBtn) {
        setStatus('Trigger found, waiting for Start New Submission');
        return;
      }

      state.busy = true;
      try {
        setStatus('Clicking Start New Submission');
        strongClick(startBtn);
        state.phase = 'started';
        state.startClickedAt = Date.now();
        log('Clicked Start New Submission');
      } finally {
        state.busy = false;
      }
      return;
    }

    if (state.phase === 'started') {
      const elapsed = Date.now() - state.startClickedAt;

      if (elapsed < CFG.afterStartDelayMs) {
        const secLeft = Math.max(1, Math.ceil((CFG.afterStartDelayMs - elapsed) / 1000));
        setStatus(`Waiting ${secLeft}s before product table`);
        return;
      }

      const overTimeout = elapsed > (CFG.afterStartDelayMs + CFG.productWaitMs);
      const table = findProductTable();

      if (!table) {
        if (overTimeout) {
          failDone('Timed out waiting for New Submission table');
        } else {
          setStatus('Waiting for New Submission table');
        }
        return;
      }

      const rowInfo = findPersonalAutoRowInfo(table);
      if (!rowInfo) {
        if (overTimeout) {
          failDone('Timed out waiting for Personal Auto row');
        } else {
          setStatus('Waiting for Personal Auto row');
        }
        return;
      }

      const selectBtn = findPersonalAutoSelectButton(table, rowInfo);
      if (!selectBtn) {
        if (overTimeout) {
          failDone('Timed out waiting for Personal Auto Select');
        } else {
          setStatus('Waiting for Personal Auto Select');
        }
        return;
      }

      state.busy = true;
      try {
        state.selectAttemptCount += 1;
        state.lastSelectAttemptAt = Date.now();
        setStatus(`Clicking Personal Auto Select (${state.selectAttemptCount}/${CFG.maxSelectAttempts})`);
        strongClick(selectBtn);
        log(`Clicked Personal Auto Select attempt ${state.selectAttemptCount}`);
        state.phase = 'verify-select';
      } finally {
        state.busy = false;
      }
      return;
    }

    if (state.phase === 'verify-select') {
      const table = findProductTable();
      if (!table) {
        successDone('Done');
        return;
      }

      const rowInfo = findPersonalAutoRowInfo(table);
      if (!rowInfo) {
        successDone('Done');
        return;
      }

      const sinceLast = Date.now() - state.lastSelectAttemptAt;
      if (sinceLast < CFG.selectRetryMs) {
        setStatus('Verifying Personal Auto Select');
        return;
      }

      if (state.selectAttemptCount >= CFG.maxSelectAttempts) {
        failDone('Select did not move after retries');
        return;
      }

      log('Select did not move page. Retrying');
      state.phase = 'started';
    }
  }

  function safeReload() {
    for (const win of getAllWindows()) {
      patchWindowDialogs(win);
    }

    try { window.onbeforeunload = null; } catch {}
    try { document.onbeforeunload = null; } catch {}
    try { if (document.body) document.body.onbeforeunload = null; } catch {}
    try { if (document.documentElement) document.documentElement.onbeforeunload = null; } catch {}

    try {
      location.reload();
      return;
    } catch {}

    try {
      history.go(0);
      return;
    } catch {}

    try {
      location.href = location.href;
    } catch (err) {
      log(`Reload failed: ${err?.message || err}`);
    }
  }

  function didReloadOnce() {
    try {
      return sessionStorage.getItem(KEYS.RELOADED) === '1';
    } catch {
      return false;
    }
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  function markReloadOnce() {
    try {
      sessionStorage.setItem(KEYS.RELOADED, '1');
    } catch {}
  }

  function successDone(msg) {
    state.done = true;
    state.phase = 'done';
    setStatus(msg);
    log(msg);
  }

  function failDone(msg) {
    state.done = true;
    state.phase = 'done';
    setStatus(msg);
    log(msg);
  }

  function buildUi() {
    if (document.getElementById('hb-gwpc-start-auto-quote-panel')) return;
    if (!document.documentElement) return;

    const style = document.createElement('style');
    style.textContent = `
      #hb-gwpc-start-auto-quote-panel{
        position:fixed;
        right:${CFG.panelRight}px;
        bottom:${CFG.panelBottom}px;
        width:280px;
        background:rgba(17,24,39,.96);
        color:#fff;
        border:1px solid rgba(255,255,255,.16);
        border-radius:10px;
        box-shadow:0 8px 24px rgba(0,0,0,.35);
        z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
      }
      #hb-gwpc-start-auto-quote-head{
        padding:8px 10px;
        background:rgba(255,255,255,.08);
        font-weight:700;
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:8px;
      }
      #hb-gwpc-start-auto-quote-body{
        padding:8px 10px 10px 10px;
      }
      #hb-gwpc-start-auto-quote-status{
        margin-bottom:8px;
        color:#93c5fd;
        font-weight:700;
        word-break:break-word;
      }
      #hb-gwpc-start-auto-quote-toggle{
        width:100%;
        border:0;
        border-radius:8px;
        padding:7px 10px;
        cursor:pointer;
        font-weight:700;
        color:#fff;
      }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'hb-gwpc-start-auto-quote-panel';
    panel.innerHTML = `
      <div id="hb-gwpc-start-auto-quote-head">
        <div>${SCRIPT_NAME}</div>
        <div>V${VERSION}</div>
      </div>
      <div id="hb-gwpc-start-auto-quote-body">
        <div id="hb-gwpc-start-auto-quote-status">Waiting</div>
        <button id="hb-gwpc-start-auto-quote-toggle" type="button">STOP</button>
      </div>
    `;
    document.documentElement.appendChild(panel);

    const btn = document.getElementById('hb-gwpc-start-auto-quote-toggle');
    btn.addEventListener('click', () => {
      state.armed = !state.armed;
      syncUi();

      if (!state.armed) {
        setStatus('Stopped for this page session');
        log('Stopped');
      } else {
        if (state.done) {
          setStatus('Already done on this load');
        } else {
          log('Resumed');
          tick();
        }
      }
    });

    syncUi();
  }

  function syncUi() {
    const btn = document.getElementById('hb-gwpc-start-auto-quote-toggle');
    if (!btn) return;

    if (state.armed) {
      btn.textContent = 'STOP';
      btn.style.background = '#c62828';
    } else {
      btn.textContent = 'START';
      btn.style.background = '#2e7d32';
    }
  }

  function setStatus(text) {
    if (state.lastStatus === text) return;
    state.lastStatus = text;

    const el = document.getElementById('hb-gwpc-start-auto-quote-status');
    if (el) el.textContent = text;
  }

  function log(msg) {
    console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function normText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const style = getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (el.closest?.('[aria-hidden="true"]')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }

  function isEnabled(el) {
    if (!el) return false;
    try {
      if (el.disabled) return false;
      if (el.getAttribute('disabled') !== null) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;
    } catch {}
    return true;
  }

  function getAllWindows(root = null, out = []) {
    const base = root || window.top;
    out.push(base);

    let frames = [];
    try { frames = Array.from(base.frames || []); } catch {}

    for (const fr of frames) {
      try {
        if (!fr || fr === base) continue;
        void fr.document;
        getAllWindows(fr, out);
      } catch {}
    }

    return out;
  }

  function getAllDocuments() {
    const docs = [];
    for (const win of getAllWindows()) {
      try {
        if (win.document) docs.push(win.document);
      } catch {}
    }
    return docs;
  }

  function queryAllDeep(selector, root = document, out = []) {
    try {
      out.push(...root.querySelectorAll(selector));
    } catch {}

    let all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch {}

    for (const el of all) {
      try {
        if (el.shadowRoot) queryAllDeep(selector, el.shadowRoot, out);
      } catch {}
    }

    return out;
  }

  function findTriggerLabel() {
    for (const doc of getAllDocuments()) {
      const byId = doc.getElementById?.(IDS.currentActivitiesLabel);
      if (byId && isVisible(byId) && normText(byId.textContent) === TEXT.trigger) {
        return byId;
      }

      const labels = queryAllDeep('.gw-label', doc);
      for (const label of labels) {
        if (!isVisible(label)) continue;
        if (normText(label.textContent) === TEXT.trigger) return label;
      }
    }

    return null;
  }

  function findStartNewSubmissionButton() {
    for (const doc of getAllDocuments()) {
      const labels = queryAllDeep('.gw-label', doc);

      for (const label of labels) {
        if (!isVisible(label)) continue;

        const aria = normText(label.getAttribute('aria-label'));
        const txt = normText(label.textContent);

        if (aria !== TEXT.startNewSubmission && txt !== TEXT.startNewSubmission) continue;

        const host = resolveClickableHost(label);
        if (host) return host;
      }
    }

    return null;
  }

  function findProductTable() {
    for (const doc of getAllDocuments()) {
      const table = doc.getElementById?.(IDS.productTable);
      if (table && isVisible(table)) return table;
    }
    return null;
  }

  function findPersonalAutoRowInfo(table) {
    const products = queryAllDeep('[id$="-SubmissionProduct"]', table);

    for (const productEl of products) {
      if (!isVisible(productEl)) continue;

      const txt = normText(productEl.textContent);
      if (txt !== TEXT.personalAuto) continue;

      const productId = String(productEl.id || '').trim();
      if (!productId.endsWith('-SubmissionProduct')) continue;

      const rowBase = productId.replace(/-SubmissionProduct$/, '');
      return {
        rowBase,
        productEl
      };
    }

    return null;
  }

  function findPersonalAutoSelectButton(table, rowInfo) {
    if (!table || !rowInfo) return null;

    const doc = table.ownerDocument;
    const rowBase = rowInfo.rowBase;
    const exactId = `${rowBase}-addSubmission`;

    const exact = doc.getElementById(exactId);
    if (exact && isVisible(exact) && isEnabled(exact)) return exact;

    const scoped = queryAllDeep('[id$="-addSubmission"]', table);
    for (const el of scoped) {
      if (!isVisible(el) || !isEnabled(el)) continue;
      if (String(el.id || '').trim() === exactId) return el;
    }

    return null;
  }

  function resolveClickableHost(startEl) {
    let cur = startEl;

    for (let i = 0; i < 12 && cur; i++) {
      if (isVisible(cur) && isEnabled(cur)) {
        try {
          if (cur.matches('div.gw-action--inner, [role="button"], [role="link"], button, a, .gw-LinkWidget')) {
            return cur;
          }
        } catch {}
      }
      cur = cur.parentElement;
    }

    return null;
  }

  function strongClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    try { el.focus(); } catch {}

    const mouseTypes = [
      'pointerover',
      'mouseover',
      'pointerenter',
      'mouseenter',
      'pointerdown',
      'mousedown',
      'pointerup',
      'mouseup',
      'click'
    ];

    for (const type of mouseTypes) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    for (const type of ['keydown', 'keyup']) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
          composed: true
        }));
      } catch {}
    }

    try { el.click(); } catch {}
    return true;
  }
})();
