// ==UserScript==
// @name         GWPC Unsaved Change Discard Clicker
// @namespace    homebot.gwpc-discard-unsaved-change
// @version      1.0.1
// @description  When the GWPC "Discard Unsaved Change" action becomes visible, clicks it automatically.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-discard-unsaved-change.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-discard-unsaved-change.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_TEXT = 'Discard Unsaved Change';
  const ERROR_NEEDLE = 'Please cancel and retry your change.';
  const SCAN_MS = 300;
  const CLICK_COOLDOWN_MS = 1200;

  let lastClickAt = 0;
  let observer = null;
  let scanTimer = null;

  const isVisible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (el.closest?.('[aria-hidden="true"]')) return false;
    return true;
  };

  function* allDocs() {
    yield document;
    for (const f of document.querySelectorAll('iframe, frame')) {
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (d) yield d;
      } catch {}
    }
  }

  function norm(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function strongClick(el) {
    try {
      el.scrollIntoView?.({ block: 'center', inline: 'center' });
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.click?.();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
      return true;
    } catch {
      return false;
    }
  }

  function findDiscardAction() {
    for (const doc of allDocs()) {
      const nodes = Array.from(doc.querySelectorAll('.gw-message--action-suffix'));
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        if (norm(el.textContent) !== TARGET_TEXT) continue;

        const msgWrap =
          el.closest('.gw-message--displayable') ||
          el.closest('.gw-WebMessage') ||
          el.closest('.gw-message-and-suffix') ||
          el.parentElement;

        const wrapText = norm(msgWrap?.textContent || '');
        if (wrapText.includes(ERROR_NEEDLE) || wrapText.includes(TARGET_TEXT)) {
          return el;
        }
      }
    }
    return null;
  }

  function tick() {
    const now = Date.now();
    if (now - lastClickAt < CLICK_COOLDOWN_MS) return;

    const target = findDiscardAction();
    if (!target) return;

    if (strongClick(target)) {
      lastClickAt = now;
    }
  }

  function init() {
    scanTimer = setInterval(tick, SCAN_MS);

    observer = new MutationObserver(() => {
      tick();
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });

    document.addEventListener('visibilitychange', tick, true);
    window.addEventListener('focus', tick, true);

    tick();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
