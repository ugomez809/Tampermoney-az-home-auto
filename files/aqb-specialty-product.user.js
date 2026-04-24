// ==UserScript==
// @name         GWPC Auto Specialty Quote
// @namespace    homebot.aqb-specialty-product
// @version      1.8.9
// @description  Waits for aqb_step_specialty_start=1 (then waits 3s). Gate: Submission (Draft)+Personal Auto. If Specialty Product empty → Quote. Else select rows → Remove Specialty product (bypass confirm; then wait 3s) → Quote. Uses the same Quote target resolution pattern as the working Home quote extractor across accessible Guidewire docs, retries if the header stays on Auto Data Prefill, force-clicks Quote after 1 minute of inactivity even if the normal page labels drift, keeps retrying Quote every 5 seconds for 1 minute before giving up, and now shows a live debug panel with detailed logs. Sets aqb_step_specialty_done=1 when header changes.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-specialty-product.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-specialty-product.user.js
// ==/UserScript==

(function () {
  'use strict';

  /************* CONFIG *************/
  const REQUIRED_LABELS = ['Submission (Draft)', 'Personal Auto'];
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';

  const WAIT_KEY = 'aqb_step_specialty_start';
  const DONE_KEY = 'aqb_step_specialty_done';

  const AFTER_FLAG_WAIT_MS   = 3000; // wait 3s after flag becomes 1
  const AFTER_REMOVE_WAIT_MS = 3000; // wait 3s after clicking Remove
  const AFTER_QUOTE_WAIT_MS  = 3000; // wait 3s after clicking Quote to see if header changed
  const MAX_QUOTE_ATTEMPTS   = 3;    // total Quote clicks
  const BETWEEN_QUOTE_ATTEMPTS_MS = 500;
  const QUOTE_ACTION_READY_TIMEOUT_MS = 12000;
  const INACTIVITY_FORCE_QUOTE_MS = 60000;
  const QUOTE_RETRY_EVERY_MS = 5000;
  const QUOTE_RETRY_WINDOW_MS = 60000;

  const LV_ID_SUFFIX = 'ForemostVehiclesLV';
  const EMPTY_TEXT = 'No data to display';

  const WAIT_AFTER_CB_MS = 1000;
  const WAIT_AFTER_REMOVE_MS = 2000;

  const HEADER_STUCK_STARTS_WITH = 'Auto Data Prefill';
  const UI_ATTR = 'data-tm-aqb-specialty-ui';
  const MAX_LOG_LINES = 140;

  const BTN_TEXT_ON  = 'AQB: STOP';
  const BTN_TEXT_OFF = 'AQB: START';

  const POLL_MS = 250;
  /*********************************/

  let armed = true;
  let finished = false;
  let running = false;
  let lastActivityAt = Date.now();
  let lastWaitKey = '';
  let logs = [];
  let ui = {};

  // track "flag became 1" moment
  let sawFlagAt = 0;

  // ---------- UI ----------
  function mountPanel() {
    const existing = document.getElementById('tm-aqb-specialty-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'tm-aqb-specialty-panel';
    panel.setAttribute(UI_ATTR, '1');
    panel.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:360px;' +
      'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;' +
      'box-shadow:0 14px 40px rgba(0,0,0,.35);font:12px/1.4 system-ui,Segoe UI,Arial;';

    panel.innerHTML = `
      <div ${UI_ATTR}="1" style="padding:10px 12px;border-bottom:1px solid #334155;background:linear-gradient(90deg,#0f172a,#1e293b);border-radius:12px 12px 0 0;">
        <div ${UI_ATTR}="1" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div ${UI_ATTR}="1">
            <div ${UI_ATTR}="1" style="font-weight:800;">GWPC Auto Specialty Quote</div>
            <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">Live specialty Quote debug</div>
          </div>
          <div ${UI_ATTR}="1" style="display:flex;gap:8px;">
            <button ${UI_ATTR}="1" id="tm-aqb-specialty-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">${BTN_TEXT_ON}</button>
            <button ${UI_ATTR}="1" id="tm-aqb-specialty-copy" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">COPY LOGS</button>
          </div>
        </div>
      </div>
      <div ${UI_ATTR}="1" style="padding:10px 12px;">
        <div ${UI_ATTR}="1" style="margin-bottom:8px;padding:7px 9px;border-radius:10px;background:#111827;border:1px solid #1f2937;">
          <strong ${UI_ATTR}="1">Status:</strong>
          <span ${UI_ATTR}="1" id="tm-aqb-specialty-status" style="margin-left:6px;">Starting...</span>
        </div>
        <textarea ${UI_ATTR}="1" id="tm-aqb-specialty-logs" readonly style="width:100%;min-height:210px;max-height:260px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:10px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.body.appendChild(panel);
    ui.panel = panel;
    ui.toggle = panel.querySelector('#tm-aqb-specialty-toggle');
    ui.copy = panel.querySelector('#tm-aqb-specialty-copy');
    ui.status = panel.querySelector('#tm-aqb-specialty-status');
    ui.logs = panel.querySelector('#tm-aqb-specialty-logs');

    ui.toggle?.addEventListener('click', () => {
      armed = !armed;
      ui.toggle.textContent = armed ? BTN_TEXT_ON : BTN_TEXT_OFF;
      ui.toggle.style.background = armed ? '#2563eb' : '#475569';
      log(armed ? 'Script armed from panel' : 'Script stopped from panel');
      if (!armed) {
        setStatus('Stopped');
      }
    });

    ui.copy?.addEventListener('click', async () => {
      const text = logs.join('\n');
      try {
        await navigator.clipboard.writeText(text);
        log('Logs copied to clipboard');
      } catch (err) {
        log(`Copy logs failed: ${err?.message || err}`);
      }
    });

    renderLogs();
  }

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return new Date().toISOString(); }
  }

  function renderLogs() {
    if (!ui.logs) return;
    ui.logs.value = logs.join('\n');
    ui.logs.scrollTop = 0;
  }

  function setStatus(text) {
    if (ui.status) ui.status.textContent = text;
  }

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    logs.unshift(line);
    logs = logs.slice(0, MAX_LOG_LINES);
    renderLogs();
    try { console.log(`[AQB Specialty] ${message}`); } catch {}
  }

  function logWait(key, message, statusText = message) {
    setStatus(statusText);
    if (lastWaitKey === key) return;
    lastWaitKey = key;
    log(message);
  }

  function clearWaitLog() {
    lastWaitKey = '';
  }

  async function waitFor(fn, timeoutMs, stepMs = 250) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      try {
        if (fn()) return true;
      } catch {}
      await sleep(stepMs);
    }
    try {
      return !!fn();
    } catch {
      return false;
    }
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  function getAccessibleDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        for (let i = 0; i < win.frames.length; i += 1) {
          walk(win.frames[i]);
        }
      } catch {}
    }

    walk(window);
    return docs;
  }

  function findInDocs(resolver) {
    for (const doc of getAccessibleDocs()) {
      try {
        const found = resolver(doc);
        if (found === true) return true;
        if (found) return found;
      } catch {}
    }
    return null;
  }

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width === 0 || r.height === 0) return false;
    const win = el.ownerDocument?.defaultView || window;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (el.closest?.('[aria-hidden="true"]')) return false;
    return true;
  };

  function strongClick(el) {
    try {
      el.scrollIntoView?.({ block: 'center', inline: 'center' });
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown',   { bubbles: true }));
      el.click?.();
      el.dispatchEvent(new MouseEvent('mouseup',     { bubbles: true }));
      el.dispatchEvent(new MouseEvent('pointerup',   { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function hasLabelExact(txt) {
    for (const doc of getAccessibleDocs()) {
      try {
        const found = Array.from(doc.querySelectorAll('.gw-label'))
          .some(n => (n.textContent || '').trim() === txt && isVisible(n));
        if (found) return true;
      } catch {}
    }
    return false;
  }

  function gateOK() {
    return REQUIRED_LABELS.every(hasLabelExact);
  }

  function getMissingGateLabels() {
    return REQUIRED_LABELS.filter(label => !hasLabelExact(label));
  }

  function isProbablyClickable(el) {
    if (!el || !isVisible(el)) return false;
    return (
      el.matches?.('button, a, input[type="button"], input[type="submit"], [role="button"], [role="tab"], [role="menuitem"]') ||
      el.classList?.contains('gw-action--inner') ||
      el.classList?.contains('gw-TabWidget') ||
      el.classList?.contains('gw-ButtonWidget') ||
      el.hasAttribute?.('onclick') ||
      el.getAttribute?.('tabindex') === '0'
    );
  }

  function getClickableOwner(el) {
    if (!el) return null;
    let cur = el;
    let depth = 0;
    while (cur && depth < 10) {
      if (isProbablyClickable(cur)) return cur;
      cur = cur.parentElement;
      depth++;
    }
    return el;
  }

  function findClickableOwnerByLabel(labelText) {
    for (const doc of getAccessibleDocs()) {
      const direct = Array.from(doc.querySelectorAll(`.gw-label[aria-label="${labelText}"]`)).filter(isVisible);
      for (const label of direct) {
        const owner = getClickableOwner(label);
        if (owner && isVisible(owner)) return owner;
      }

      const generic = Array.from(doc.querySelectorAll('.gw-label, [aria-label], [role="button"], [role="tab"], .gw-action--inner, a, button, div'));
      for (const el of generic) {
        const aria = String(el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
        const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if ((aria === labelText || txt === labelText) && isVisible(el)) {
          const owner = getClickableOwner(el);
          if (owner && isVisible(owner)) return owner;
        }
      }
    }
    return null;
  }

  function markActivity(message = '') {
    lastActivityAt = Date.now();
    if (message) log(message);
  }

  function describeElement(el) {
    if (!el || !(el instanceof Element)) return '(none)';
    const tag = String(el.tagName || '').toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes = Array.from(el.classList || []).slice(0, 4).join('.');
    const classText = classes ? `.${classes}` : '';
    const aria = String(el.getAttribute?.('aria-label') || '').trim();
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return [tag + id + classText, aria ? `aria="${aria}"` : '', text ? `text="${text}"` : ''].filter(Boolean).join(' | ');
  }

  function waitKeyReady() {
    try { return localStorage.getItem(WAIT_KEY) === '1'; } catch { return false; }
  }

  function setDoneFlag() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch {}
  }

  function clearDoneFlag() {
    try { localStorage.removeItem(DONE_KEY); } catch {}
  }

  function headerStillAutoDataPrefill() {
    for (const doc of getAccessibleDocs()) {
      try {
        const titles = Array.from(doc.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
        if (titles.some(t => ((t.textContent || '').trim().startsWith(HEADER_STUCK_STARTS_WITH)))) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  // ---------- Specialty Product LV ----------
  function findLVRoot() {
    return findInDocs((doc) => doc.querySelector(`[id$="${LV_ID_SUFFIX}"]`));
  }

  function isLVEmpty(root) {
    if (!root) return false;
    const cell = Array.from(root.querySelectorAll('.gw-ListView--empty-info-cell'))
      .find(n => isVisible(n) && (n.textContent || '').trim() === EMPTY_TEXT);
    return !!cell;
  }

  function findSelectRowsCheckbox(root) {
    if (!root) return null;
    return (
      root.querySelector('input[type="checkbox"][aria-label="select rows"]') ||
      root.querySelector(`input[type="checkbox"][name$="${LV_ID_SUFFIX}-_Checkbox"]`) ||
      root.querySelector(`input[type="checkbox"][name*="${LV_ID_SUFFIX}"][name$="-_Checkbox"]`)
    );
  }

  function findRemoveSpecialtyButton() {
    const lab = findInDocs((doc) => Array.from(doc.querySelectorAll('.gw-label[aria-label="Remove Specialty product"]')).find(isVisible));
    if (!lab) return null;

    let p = lab;
    for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisible(p)) return p;
    }
    return lab;
  }

  // ---- Bypass browser confirm() ----
  function clickRemoveBypassConfirm(removeEl) {
    if (!removeEl) return false;
    log(`Trying Remove Specialty product target: ${describeElement(removeEl)}`);

    try {
      let p = removeEl;
      for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
        if (p.hasAttribute?.('data-gw-confirm')) p.removeAttribute('data-gw-confirm');
      }
    } catch {}

    const origConfirm = window.confirm;
    try { window.confirm = () => true; } catch {}
    try {
      const clicked = strongClick(removeEl);
      if (clicked) markActivity('Clicked Remove Specialty product');
      return clicked;
    }
    finally { try { window.confirm = origConfirm; } catch {} }
  }

  // ---------- Quote click ----------
  let lastQuoteClick = 0;

  function quoteRecentlyClicked() {
    return Date.now() - lastQuoteClick < 1500;
  }

  function markQuoteClicked() {
    lastQuoteClick = Date.now();
  }

  function findQuoteCandidates() {
    const out = [];
    const exactInner = findInDocs((doc) => doc.querySelector('#SubmissionWizard-Quote > div.gw-action--inner.gw-hasDivider'));
    if (exactInner) out.unshift(exactInner);

    const host = findInDocs((doc) => doc.getElementById('SubmissionWizard-Quote'));
    if (host) out.unshift(host);

    for (const doc of getAccessibleDocs()) {
      try {
        out.push(...Array.from(doc.querySelectorAll('.gw-label[aria-label="Quote"]')));
      } catch {}
    }

    const nextLab = findInDocs((doc) => doc.querySelector('.gw-label[aria-label="Next"]'));
    if (nextLab) {
      let p = nextLab;
      for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
        const q = p.querySelector?.('.gw-label[aria-label="Quote"]');
        if (q) {
          out.unshift(q);
          break;
        }
      }
    }

    return Array.from(new Set(out));
  }

  function upgradeToClickable(el) {
    if (!el) return null;

    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisible(el)) {
      return el;
    }

    if (el.querySelector) {
      const inner = Array.from(el.querySelectorAll('.gw-action--inner')).find(node =>
        node.getAttribute('aria-disabled') !== 'true' && isVisible(node)
      );
      if (inner && isVisible(inner)) return inner;
    }

    let p = el;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisible(p)) return p;
    }

    return isVisible(el) ? el : null;
  }

  function getClickableQuoteTarget() {
    const candidates = findQuoteCandidates();
    for (const el of candidates) {
      const target = upgradeToClickable(el);
      if (target) return target;
    }
    const fallback = findClickableOwnerByLabel('Quote');
    return fallback && isVisible(fallback) ? fallback : null;
  }

  function clickQuoteOnce() {
    if (quoteRecentlyClicked()) return false;

    const target = getClickableQuoteTarget();
    log(`Quote target selected: ${describeElement(target)}`);
    if (target && strongClick(target)) {
      markQuoteClicked();
      markActivity('Quote clicked');
      return true;
    }
    const candidates = findQuoteCandidates();
    log(candidates.length ? 'Quote target found but not clickable yet' : 'Quote target not found');
    return false;
  }

  async function clickQuoteUntilHeaderMoves(maxAttempts = MAX_QUOTE_ATTEMPTS, readyTimeoutMs = QUOTE_ACTION_READY_TIMEOUT_MS) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!armed || isGloballyPaused()) return false;
      log(`Quote attempt ${attempt}/${maxAttempts}: waiting for clickable Quote target`);
      const ready = await waitFor(
        () => !!getClickableQuoteTarget(),
        readyTimeoutMs
      );
      if (!ready) {
        log(`Quote action never became clickable on attempt ${attempt}`);
        if (attempt < maxAttempts) await sleep(BETWEEN_QUOTE_ATTEMPTS_MS);
        continue;
      }
      const clicked = clickQuoteOnce();
      if (!clicked) {
        if (attempt < maxAttempts) await sleep(BETWEEN_QUOTE_ATTEMPTS_MS);
        continue;
      }
      await sleep(AFTER_QUOTE_WAIT_MS);

      if (!headerStillAutoDataPrefill()) {
        log(`Quote moved off Auto Data Prefill on attempt ${attempt}`);
        return true;
      }
      log(`Still on Auto Data Prefill after Quote attempt ${attempt}`);
      if (attempt < maxAttempts) await sleep(BETWEEN_QUOTE_ATTEMPTS_MS);
    }
    return false;
  }

  async function retryQuoteEveryFiveSecondsForOneMinute() {
    const totalTicks = Math.max(1, Math.floor(QUOTE_RETRY_WINDOW_MS / QUOTE_RETRY_EVERY_MS));
    for (let tick = 1; tick <= totalTicks; tick++) {
      if (!armed || isGloballyPaused()) return false;
      if (!headerStillAutoDataPrefill()) return true;

      const tickStartedAt = Date.now();
      log(`Quote retry tick ${tick}/${totalTicks}`);
      const moved = await clickQuoteUntilHeaderMoves(1, 1500);
      if (moved) return true;

      const elapsed = Date.now() - tickStartedAt;
      const remaining = QUOTE_RETRY_EVERY_MS - elapsed;
      if (tick < totalTicks && remaining > 0) {
        await sleep(remaining);
      }
    }
    return !headerStillAutoDataPrefill();
  }

  async function clickQuoteWithRetryWindow() {
    const moved = await clickQuoteUntilHeaderMoves();
    if (moved) return true;

    if (!headerStillAutoDataPrefill()) return true;

    log('Initial Quote attempts failed. Retrying every 5 seconds for 1 minute.');
    return retryQuoteEveryFiveSecondsForOneMinute();
  }

  async function maybeForceQuoteFromInactivity() {
    if (!armed || finished || running || isGloballyPaused()) return false;
    if (!headerStillAutoDataPrefill()) return false;
    if ((Date.now() - lastActivityAt) < INACTIVITY_FORCE_QUOTE_MS) return false;

    running = true;
    const missing = getMissingGateLabels();
    const suffix = missing.length ? ` (bypassing gate: missing ${missing.join(', ')})` : '';
    markActivity(`1 minute inactivity on Auto Data Prefill. Forcing Quote.${suffix}`);
    try {
      const ok = await clickQuoteWithRetryWindow();
      if (ok) {
        setDoneFlag();
        finished = true;
      }
    } finally {
      running = false;
    }
    return true;
  }

  // ---------- Main ----------
  async function runOnce() {
    if (!armed) {
      logWait('stopped', 'Script stopped. Waiting for START.', 'Stopped');
      return;
    }
    if (finished) {
      logWait('finished', 'Script already finished for this page load.', 'Finished');
      return;
    }
    if (running) {
      logWait('running', 'Already working. Waiting for current step to finish.', 'Working');
      return;
    }
    if (isGloballyPaused()) {
      logWait('paused', 'Paused by shared global pause.', 'Paused');
      return;
    }

    const forced = await maybeForceQuoteFromInactivity();
    if (forced) return;

    const missingGate = getMissingGateLabels();
    if (missingGate.length) {
      logWait(`gate:${missingGate.join('|')}`, `Waiting for specialty gate: missing ${missingGate.join(', ')}`, 'Waiting for page gate');
      return;
    }

    clearWaitLog();

    if (!waitKeyReady()) {
      logWait('wait-flag', 'Waiting for aqb_step_specialty_start=1', 'Waiting for specialty trigger');
      sawFlagAt = 0;
      return;
    }

    if (!sawFlagAt) {
      sawFlagAt = Date.now();
      markActivity('Specialty start flag detected');
      setStatus('Waiting 3s after trigger');
      return;
    }

    const waitRemaining = AFTER_FLAG_WAIT_MS - (Date.now() - sawFlagAt);
    if (waitRemaining > 0) {
      logWait(`after-flag:${Math.ceil(waitRemaining / 1000)}`, `Waiting ${Math.max(0, Math.ceil(waitRemaining / 1000))}s after specialty trigger`, 'Waiting after trigger');
      return;
    }

    clearWaitLog();

    const root = findLVRoot();
    if (!root) {
      logWait('wait-root', 'Specialty Product list not ready yet', 'Waiting for specialty list');
      return;
    }

    running = true;
    setStatus('Running specialty flow');
    log(`Run started | headerStuck=${headerStillAutoDataPrefill() ? 'yes' : 'no'} | root=${describeElement(root)}`);

    if (isLVEmpty(root)) {
      log('Specialty Product empty, going straight to Quote');
      const ok = await clickQuoteWithRetryWindow();
      if (ok) {
        setDoneFlag();
        finished = true;
      }
      running = false;
      return;
    }

    const cb = findSelectRowsCheckbox(root);
    if (cb && !cb.checked) {
      log(`Selecting specialty rows checkbox: ${describeElement(cb)}`);
      strongClick(cb);
    } else if (cb) {
      log('Specialty rows checkbox already selected');
    } else {
      log('Specialty rows checkbox not found');
    }

    await sleep(WAIT_AFTER_CB_MS);

    const removeBtn = findRemoveSpecialtyButton();
    let didRemove = false;
    if (removeBtn) didRemove = clickRemoveBypassConfirm(removeBtn);
    else log('Remove Specialty product button not found');

    if (didRemove) await sleep(AFTER_REMOVE_WAIT_MS);
    await sleep(WAIT_AFTER_REMOVE_MS);

    log('Specialty rows handled, clicking Quote');
    const ok = await clickQuoteWithRetryWindow();
    if (ok) {
      setDoneFlag();
      finished = true;
      log('Specialty flow finished successfully');
      setStatus('Finished');
    }

    running = false;
    if (!finished) {
      log('Specialty flow ended without moving off Auto Data Prefill');
      setStatus('Still stuck on Auto Data Prefill');
    }
  }

  function init() {
    clearDoneFlag();
    mountPanel();
    log('Script started');
    setStatus('Watching specialty flow');
    setInterval(() => {
      runOnce().catch((err) => {
        running = false;
        log(`Run failed: ${err?.message || err}`);
        setStatus('Run failed');
      });
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
