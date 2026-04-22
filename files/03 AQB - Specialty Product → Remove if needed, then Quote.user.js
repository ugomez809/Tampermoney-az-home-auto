// ==UserScript==
// @name         03 AQB - Specialty Product → Remove if needed, then Quote
// @namespace    tm.pc.aqb.03.specialty.quote
// @version      1.5
// @description  Waits for aqb_step_specialty_start=1 (then waits 3s). Gate: Submission (Draft)+Personal Auto. If Specialty Product empty → Quote. Else select rows → Remove Specialty product (bypass confirm; then wait 3s) → Quote. After Quote click: if header "Auto Data Prefill" still visible after 3s, click Quote again (up to 3 total). Sets aqb_step_specialty_done=1 when header changes.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/03%20AQB%20-%20Specialty%20Product%20%E2%86%92%20Remove%20if%20needed%2C%20then%20Quote.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/03%20AQB%20-%20Specialty%20Product%20%E2%86%92%20Remove%20if%20needed%2C%20then%20Quote.user.js
// ==/UserScript==

(function () {
  'use strict';

  /************* CONFIG *************/
  const REQUIRED_LABELS = ['Submission (Draft)', 'Personal Auto'];

  const WAIT_KEY = 'aqb_step_specialty_start';
  const DONE_KEY = 'aqb_step_specialty_done';

  const AFTER_FLAG_WAIT_MS   = 3000; // wait 3s after flag becomes 1
  const AFTER_REMOVE_WAIT_MS = 3000; // wait 3s after clicking Remove
  const AFTER_QUOTE_WAIT_MS  = 3000; // wait 3s after clicking Quote to see if header changed
  const MAX_QUOTE_ATTEMPTS   = 3;    // total Quote clicks

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
    try { return strongClick(removeEl); }
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
    out.push(...document.querySelectorAll('.gw-label[aria-label="Quote"]'));

    const host = document.getElementById('SubmissionWizard-Quote');
    if (host) out.unshift(host);

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

    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
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
        return true;
      }
    }
    return false;
  }

  async function clickQuoteUpTo3IfStuck() {
    for (let attempt = 1; attempt <= MAX_QUOTE_ATTEMPTS; attempt++) {
      clickQuoteOnce();
      await sleep(AFTER_QUOTE_WAIT_MS);

      if (!headerStillAutoDataPrefill()) return true;
    }
    return false;
  }

  // ---------- Main ----------
  async function runOnce() {
    if (!armed || finished || running) return;
    if (!gateOK()) return;

    if (!waitKeyReady()) {
      sawFlagAt = 0;
      return;
    }

    if (!sawFlagAt) {
      sawFlagAt = Date.now();
      return;
    }

    if (Date.now() - sawFlagAt < AFTER_FLAG_WAIT_MS) return;

    const root = findLVRoot();
    if (!root) return;

    running = true;

    if (isLVEmpty(root)) {
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
      runOnce().catch(() => { running = false; });
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();