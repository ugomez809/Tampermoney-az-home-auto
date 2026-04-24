// ==UserScript==
// @name         GWPC Auto Specialty Quote
// @namespace    homebot.aqb-specialty-product
// @version      1.8.6
// @description  Waits for aqb_step_specialty_start=1 (then waits 3s). Gate: Submission (Draft)+Personal Auto. If Specialty Product empty → Quote. Else select rows → Remove Specialty product (bypass confirm; then wait 3s) → Quote. Uses the same stronger Quote target resolution pattern as the working quote scripts, retries if the header stays on Auto Data Prefill, and force-clicks Quote after 1 minute of inactivity while still on Auto Data Prefill even if the normal page labels drift. Sets aqb_step_specialty_done=1 when header changes.
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
  const INACTIVITY_FORCE_QUOTE_MS = 60000;

  const LV_ID_SUFFIX = 'ForemostVehiclesLV';
  const EMPTY_TEXT = 'No data to display';

  const WAIT_AFTER_CB_MS = 1000;
  const WAIT_AFTER_REMOVE_MS = 2000;

  const HEADER_STUCK_STARTS_WITH = 'Auto Data Prefill';

  const BTN_TEXT_ON  = 'AQB: STOP';
  const BTN_TEXT_OFF = 'AQB: START';

  const POLL_MS = 250;
  /*********************************/

  let armed = true;
  let finished = false;
  let running = false;
  let lastActivityAt = Date.now();

  // track "flag became 1" moment
  let sawFlagAt = 0;

  // ---------- Minimal START/STOP ----------
  function mountToggle() {
    const btn = document.createElement('button');
    btn.textContent = BTN_TEXT_ON;
    btn.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:999999;' +
      'border:0;border-radius:10px;padding:8px 12px;' +
      'background:#2f80ed;color:#fff;font:12px/1 system-ui,Segoe UI,Arial;font-weight:700;' +
      'cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);';
    btn.addEventListener('click', () => {
      armed = !armed;
      btn.textContent = armed ? BTN_TEXT_ON : BTN_TEXT_OFF;
    });
    document.body.appendChild(btn);
  }

  // ---------- Helpers ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
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
    return Array.from(document.querySelectorAll('.gw-label'))
      .some(n => (n.textContent || '').trim() === txt && isVisible(n));
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
    const direct = Array.from(document.querySelectorAll(`.gw-label[aria-label="${labelText}"]`)).filter(isVisible);
    for (const label of direct) {
      const owner = getClickableOwner(label);
      if (owner && isVisible(owner)) return owner;
    }

    const generic = Array.from(document.querySelectorAll('.gw-label, [aria-label], [role="button"], [role="tab"], .gw-action--inner, a, button, div'));
    for (const el of generic) {
      const aria = String(el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
      const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if ((aria === labelText || txt === labelText) && isVisible(el)) {
        const owner = getClickableOwner(el);
        if (owner && isVisible(owner)) return owner;
      }
    }
    return null;
  }

  function log(message) {
    try { console.log(`[AQB Specialty] ${message}`); } catch {}
  }

  function markActivity(message = '') {
    lastActivityAt = Date.now();
    if (message) log(message);
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
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
    return titles.some(t => ((t.textContent || '').trim().startsWith(HEADER_STUCK_STARTS_WITH)));
  }

  // ---------- Specialty Product LV ----------
  function findLVRoot() {
    return document.querySelector(`[id$="${LV_ID_SUFFIX}"]`);
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
    const lab = Array.from(document.querySelectorAll('.gw-label[aria-label="Remove Specialty product"]'))
      .find(isVisible);
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
    const exactInner = document.querySelector('#SubmissionWizard-Quote > div.gw-action--inner.gw-hasDivider');
    if (exactInner) out.unshift(exactInner);

    const host = document.getElementById('SubmissionWizard-Quote');
    if (host) out.unshift(host);

    out.push(...document.querySelectorAll('.gw-label[aria-label="Quote"]'));
    out.push(...document.querySelectorAll('.gw-action--inner[aria-label="Quote"], [role="button"][aria-label="Quote"], [role="menuitem"][aria-label="Quote"]'));
    out.push(...document.querySelectorAll('.gw-action--inner.gw-hasDivider'));
    out.push(...Array.from(document.querySelectorAll('div.gw-action--inner, div[role="menuitem"], div[role="tab"], div[role="button"], button, a'))
      .filter(el => {
        const aria = String(el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
        const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        return isVisible(el) && (aria === 'Quote' || txt === 'Quote' || txt.includes('Quote'));
      }));

    const nextLab = document.querySelector('.gw-label[aria-label="Next"]');
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

  function clickQuoteOnce() {
    if (quoteRecentlyClicked()) return false;

    const candidates = findQuoteCandidates();
    for (const el of candidates) {
      const target = upgradeToClickable(el);
      if (target && strongClick(target)) {
        markQuoteClicked();
        markActivity('Quote clicked');
        return true;
      }
    }
    const fallback = findClickableOwnerByLabel('Quote');
    if (fallback && strongClick(fallback)) {
      markQuoteClicked();
      markActivity('Quote clicked via label fallback');
      return true;
    }
    log(candidates.length ? `Quote target found but not clickable (${candidates.length} candidates)` : 'Quote target not found or not clickable');
    return false;
  }

  async function clickQuoteUpTo3IfStuck() {
    for (let attempt = 1; attempt <= MAX_QUOTE_ATTEMPTS; attempt++) {
      if (!armed || isGloballyPaused()) return false;
      const clicked = clickQuoteOnce();
      if (!clicked) {
        await sleep(500);
        continue;
      }
      await sleep(AFTER_QUOTE_WAIT_MS);

      if (!headerStillAutoDataPrefill()) {
        log(`Quote moved off Auto Data Prefill on attempt ${attempt}`);
        return true;
      }
      log(`Still on Auto Data Prefill after Quote attempt ${attempt}`);
    }
    return false;
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
      const ok = await clickQuoteUpTo3IfStuck();
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
    if (!armed || finished || running || isGloballyPaused()) return;

    const forced = await maybeForceQuoteFromInactivity();
    if (forced) return;

    if (!gateOK()) return;

    if (!waitKeyReady()) {
      sawFlagAt = 0;
      return;
    }

    if (!sawFlagAt) {
      sawFlagAt = Date.now();
      markActivity('Specialty start flag detected');
      return;
    }

    if (Date.now() - sawFlagAt < AFTER_FLAG_WAIT_MS) return;

    const root = findLVRoot();
    if (!root) {
      log('Specialty Product list not ready yet');
      return;
    }

    running = true;

    if (isLVEmpty(root)) {
      log('Specialty Product empty, going straight to Quote');
      const ok = await clickQuoteUpTo3IfStuck();
      if (ok) {
        setDoneFlag();
        finished = true;
      }
      running = false;
      return;
    }

    const cb = findSelectRowsCheckbox(root);
    if (cb && !cb.checked) strongClick(cb);

    await sleep(WAIT_AFTER_CB_MS);

    const removeBtn = findRemoveSpecialtyButton();
    let didRemove = false;
    if (removeBtn) didRemove = clickRemoveBypassConfirm(removeBtn);

    if (didRemove) await sleep(AFTER_REMOVE_WAIT_MS);
    await sleep(WAIT_AFTER_REMOVE_MS);

    log('Specialty rows handled, clicking Quote');
    const ok = await clickQuoteUpTo3IfStuck();
    if (ok) {
      setDoneFlag();
      finished = true;
    }

    running = false;
  }

  function init() {
    clearDoneFlag();
    mountToggle();
    setInterval(() => {
      if (isGloballyPaused()) return;
      runOnce().catch(() => { running = false; });
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
