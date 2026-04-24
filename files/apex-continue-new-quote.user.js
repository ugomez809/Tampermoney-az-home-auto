// ==UserScript==
// @name         APEX Home Quote Continue
// @namespace    homebot.apex-continue-new-quote
// @version      1.8.1
// @description  V1.7 selectors/flow with a rebuilt simple tick loop. Detect Personal Lines Quote modal, click the real Home control that owns custom107, select Residence Address, wait, then click Continue New Quote once only. Runs once per page load.
// @author       OpenAI
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-continue-new-quote.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-continue-new-quote.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: APEX Continue New Quote';
  const VERSION = '1.8';

  const CFG = {
    tickMs: 700,
    waitTimeoutMs: 30000,
    waitIntervalMs: 250,

    afterHomeClickMs: 2000,
    afterResidenceRadioInternalMs: 250,
    afterResidenceBeforeContinueMs: 1000,
    afterContinueClickMs: 1200,

    residenceRadioAttempts: 3,
    maxLogLines: 16,
    panelRight: 12,
    panelBottom: 12,
    panelWidth: 340,
    zIndex: 2147483647,
    posKey: 'tm_apex_continue_new_quote_panel_pos_v18',
    doneThisLoadKey: 'tm_apex_continue_new_quote_done_this_load_v18',
    sameElementCooldownMs: 4000
  };

  const state = {
    busy: false,
    doneThisLoad: false,
    tickTimer: null,
    drag: null,
    lastWaitLogAt: 0,
    lastElementClickSig: '',
    lastElementClickAt: 0
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function now() {
    return Date.now();
  }

  function norm(v) {
    return String(v || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function isDisabled(el) {
    if (!el || !(el instanceof Element)) return true;
    return !!(
      el.disabled ||
      el.getAttribute('disabled') !== null ||
      el.getAttribute('aria-disabled') === 'true'
    );
  }

  function getLabel(el) {
    if (!el || !(el instanceof Element)) return '';
    return norm([
      el.textContent,
      el.getAttribute?.('title'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('label'),
      el.getAttribute?.('name'),
      el.getAttribute?.('data-label'),
      el.getAttribute?.('value')
    ].filter(Boolean).join(' '));
  }

  function isClickable(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.matches('button, a, [role="button"], input[type="button"], input[type="submit"], label')) return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') return true;
    if (typeof el.onclick === 'function') return true;
    return false;
  }

  function getRootChildren(root) {
    try {
      if (
        root instanceof Document ||
        root instanceof ShadowRoot ||
        root instanceof Element
      ) {
        return Array.from(root.querySelectorAll('*'));
      }
    } catch {}
    return [];
  }

  function getAllRoots(startRoot = document) {
    const roots = [];
    const seen = new WeakSet();

    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push(root);

      const els = getRootChildren(root);
      for (const el of els) {
        try {
          if (el.shadowRoot) walk(el.shadowRoot);
        } catch {}
        try {
          if (el.tagName === 'IFRAME' && el.contentDocument) walk(el.contentDocument);
        } catch {}
      }
    }

    walk(startRoot);
    return roots;
  }

  function deepQueryAll(selector, startRoot = document) {
    const out = [];
    const seen = new WeakSet();

    for (const root of getAllRoots(startRoot)) {
      let found = [];
      try {
        found = root.querySelectorAll(selector);
      } catch {}
      for (const el of found) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      }
    }

    return out;
  }

  function findAncestorAcrossRoots(el, predicate) {
    let cur = el;

    while (cur) {
      if (cur instanceof Element && predicate(cur)) return cur;

      if (cur instanceof Element && cur.parentElement) {
        cur = cur.parentElement;
        continue;
      }

      const root = cur?.getRootNode?.();
      if (root instanceof ShadowRoot) {
        cur = root.host;
        continue;
      }

      break;
    }

    return null;
  }

  function getClickableHost(el) {
    let cur = el;

    while (cur) {
      if (cur instanceof Element && isClickable(cur)) return cur;

      if (cur instanceof Element && cur.parentElement) {
        cur = cur.parentElement;
        continue;
      }

      const root = cur?.getRootNode?.();
      if (root instanceof ShadowRoot) {
        cur = root.host;
        continue;
      }

      break;
    }

    return el instanceof Element ? el : null;
  }

  function getPanel() {
    return document.getElementById('hb-apex-continue-panel');
  }

  function clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  function savePanelPosition(left, top) {
    try {
      localStorage.setItem(CFG.posKey, JSON.stringify({ left, top }));
    } catch {}
  }

  function loadPanelPosition() {
    try {
      const raw = localStorage.getItem(CFG.posKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top)) {
        return parsed;
      }
    } catch {}
    return null;
  }

  function applyPanelPosition(panel, pos) {
    if (!panel || !pos) return;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    const left = clamp(pos.left, 0, maxLeft);
    const top = clamp(pos.top, 0, maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    savePanelPosition(left, top);
  }

  function ensurePanelInView() {
    const panel = getPanel();
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);

    const left = clamp(rect.left, 0, maxLeft);
    const top = clamp(rect.top, 0, maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    savePanelPosition(left, top);
  }

  function beginDrag(ev) {
    const panel = getPanel();
    if (!panel) return;

    const rect = panel.getBoundingClientRect();

    state.drag = {
      startX: ev.clientX,
      startY: ev.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      prevUserSelect: document.body.style.userSelect || ''
    };

    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onDragMove, true);
    window.addEventListener('mouseup', endDrag, true);

    ev.preventDefault();
  }

  function onDragMove(ev) {
    if (!state.drag) return;

    const panel = getPanel();
    if (!panel) return;

    const dx = ev.clientX - state.drag.startX;
    const dy = ev.clientY - state.drag.startY;

    const nextLeft = state.drag.startLeft + dx;
    const nextTop = state.drag.startTop + dy;

    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    const left = clamp(nextLeft, 0, maxLeft);
    const top = clamp(nextTop, 0, maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function endDrag() {
    if (!state.drag) return;

    const panel = getPanel();
    if (panel) {
      const rect = panel.getBoundingClientRect();
      savePanelPosition(rect.left, rect.top);
    }

    document.body.style.userSelect = state.drag.prevUserSelect || '';
    state.drag = null;

    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', endDrag, true);
  }

  function makePanel() {
    if (document.getElementById('hb-apex-continue-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'hb-apex-continue-panel';
    panel.innerHTML = `
      <div id="hb-apex-continue-drag" style="font-weight:700;margin-bottom:6px;cursor:move;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>${SCRIPT_NAME}</span>
        <span style="font-size:11px;opacity:.8;">${VERSION}</span>
      </div>

      <div style="margin-bottom:6px;">
        <span id="hb-apex-continue-status" style="font-size:12px;">Running</span>
      </div>

      <div>
        <div id="hb-apex-continue-log" style="max-height:180px;overflow:auto;font-size:11px;line-height:1.35;"></div>
      </div>
    `;

    Object.assign(panel.style, {
      position: 'fixed',
      right: `${CFG.panelRight}px`,
      bottom: `${CFG.panelBottom}px`,
      width: `${CFG.panelWidth}px`,
      background: 'rgba(20,20,20,0.94)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      padding: '10px',
      zIndex: String(CFG.zIndex),
      boxShadow: '0 8px 24px rgba(0,0,0,.35)',
      fontFamily: 'Arial, sans-serif'
    });

    document.documentElement.appendChild(panel);

    const savedPos = loadPanelPosition();
    if (savedPos) applyPanelPosition(panel, savedPos);

    const dragHandle = document.getElementById('hb-apex-continue-drag');
    dragHandle.addEventListener('mousedown', beginDrag);

    window.addEventListener('resize', ensurePanelInView);
  }

  function setStatus(text) {
    const el = document.getElementById('hb-apex-continue-status');
    if (el) el.textContent = text;
  }

  function log(msg) {
    console.log(`[${SCRIPT_NAME}] ${msg}`);
    const box = document.getElementById('hb-apex-continue-log');
    if (!box) return;

    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
    line.style.marginBottom = '3px';
    box.prepend(line);

    while (box.children.length > CFG.maxLogLines) {
      box.removeChild(box.lastChild);
    }
  }

  function logWait(msg, everyMs = 5000) {
    const t = now();
    if (t - state.lastWaitLogAt >= everyMs) {
      state.lastWaitLogAt = t;
      log(msg);
    }
  }

  function getQuoteHeader() {
    const candidates = deepQueryAll('h1, h2, h3, [id^="modal-heading"]');
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const text = norm(el.textContent);
      if (/^Personal Lines Quote for\s+/i.test(text)) return el;
    }
    return null;
  }

  function getQuoteModal() {
    const header = getQuoteHeader();
    if (!header) return null;

    const modal = findAncestorAcrossRoots(header, el => {
      if (!(el instanceof Element)) return false;
      if (el.matches('section.slds-modal.slds-fade-in-open')) return true;
      if (el.matches('section.slds-modal')) return true;
      if (el.matches('.slds-modal__container')) return true;
      if (el.matches('article[role="dialog"]')) return true;
      if (el.matches('[role="dialog"]')) return true;
      return false;
    });

    return modal || header;
  }

  function getHomeTarget() {
    const scope = getQuoteModal() || document;

    const iconCandidates = deepQueryAll('svg[data-key="custom107"], [data-key="custom107"]', scope);
    for (const icon of iconCandidates) {
      if (!isVisible(icon)) continue;
      const host = getClickableHost(icon);
      if (host && isVisible(host) && !isDisabled(host)) return host;
    }

    const clickableCandidates = deepQueryAll(
      'button, a, [role="button"], input[type="button"], input[type="submit"], [tabindex]',
      scope
    );

    for (const el of clickableCandidates) {
      if (!isVisible(el) || isDisabled(el)) continue;
      const hasCustom107 = !!el.querySelector?.('svg[data-key="custom107"], [data-key="custom107"]');
      if (hasCustom107) return el;
    }

    return null;
  }

  function getResidenceAddressRadio() {
    const scope = getQuoteModal() || document;

    const candidates = deepQueryAll([
      'input[type="radio"][name="riskAddress"][data-name="residenceAddress"][value="residenceAddress"]',
      'input[type="radio"][name="riskAddress"][data-name="residenceAddress"]',
      'input[type="radio"][data-name="residenceAddress"][value="residenceAddress"]',
      'input[type="radio"][data-name="residenceAddress"]',
      'input[type="radio"][name="riskAddress"]'
    ].join(','), scope);

    for (const el of candidates) {
      if (!isVisible(el) || isDisabled(el)) continue;

      const name = norm(el.getAttribute('name'));
      const dataName = norm(el.getAttribute('data-name'));
      const value = norm(el.getAttribute('value'));

      const isTarget =
        (name === 'riskAddress' && dataName === 'residenceAddress') ||
        dataName === 'residenceAddress' ||
        value === 'residenceAddress';

      if (isTarget) return el;
    }

    return null;
  }

  function getResidenceAddressLabel(radio) {
    const scope = getQuoteModal() || document;

    const direct = findAncestorAcrossRoots(radio, el => el.tagName === 'LABEL');
    if (direct) return direct;

    const labels = deepQueryAll('label', scope);
    for (const label of labels) {
      if (!isVisible(label)) continue;
      if (label.contains(radio)) return label;
      if (/^Residence Address$/i.test(norm(label.textContent))) return label;
      if (/\bResidence Address\b/i.test(norm(label.textContent))) return label;
    }

    return null;
  }

  function setCheckedProperty(radio, value) {
    try {
      const proto = Object.getPrototypeOf(radio);
      const desc = Object.getOwnPropertyDescriptor(proto, 'checked');
      if (desc?.set) {
        desc.set.call(radio, value);
        return;
      }
    } catch {}

    try {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
      if (desc?.set) {
        desc.set.call(radio, value);
        return;
      }
    } catch {}

    try {
      radio.checked = value;
    } catch {}
  }

  function forceSelectResidenceAddress(radio) {
    if (!radio) return false;

    const doc = radio.ownerDocument || document;
    const view = doc.defaultView || window;

    try {
      radio.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch {}

    try {
      radio.focus?.({ preventScroll: true });
    } catch {
      try { radio.focus?.(); } catch {}
    }

    if (!radio.checked) {
      setCheckedProperty(radio, true);
    }

    try {
      radio.dispatchEvent(new view.Event('input', {
        bubbles: true,
        composed: true
      }));
    } catch {}

    try {
      radio.dispatchEvent(new view.Event('change', {
        bubbles: true,
        composed: true
      }));
    } catch {}

    try {
      radio.click?.();
    } catch {}

    try {
      radio.dispatchEvent(new view.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view
      }));
    } catch {}

    if (radio.checked) return true;

    const label = getResidenceAddressLabel(radio);
    if (label) {
      try { label.click?.(); } catch {}
      try {
        label.dispatchEvent(new view.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }

    return !!radio.checked;
  }

  async function ensureResidenceAddressSelected() {
    const radio = getResidenceAddressRadio();
    if (!radio) {
      log('Residence Address radio missing.');
      return false;
    }

    if (radio.checked) {
      log('Residence Address already selected.');
      return true;
    }

    for (let attempt = 1; attempt <= CFG.residenceRadioAttempts; attempt++) {
      log(`Selecting Residence Address (${attempt}/${CFG.residenceRadioAttempts})`);

      const ok = forceSelectResidenceAddress(radio);
      await sleep(CFG.afterResidenceRadioInternalMs);

      const fresh = getResidenceAddressRadio();
      if (ok || fresh?.checked) {
        log('Residence Address selected.');
        return true;
      }
    }

    log('Residence Address radio could not be selected.');
    return false;
  }

  function getContinueButton() {
    const scope = getQuoteModal() || document;

    const clickableCandidates = deepQueryAll(
      'button, a, [role="button"], input[type="button"], input[type="submit"], [tabindex]',
      scope
    );

    for (const el of clickableCandidates) {
      if (!isVisible(el) || isDisabled(el)) continue;
      const label = getLabel(el);
      if (/^Continue New Quote$/i.test(label)) return el;
      if (/\bContinue New Quote\b/i.test(label)) return el;
    }

    return null;
  }

  function getElementClickSignature(el) {
    if (!el) return '';
    const rect = el.getBoundingClientRect();
    return [
      el.tagName || '',
      getLabel(el),
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ].join('|');
  }

  function shouldBlockDuplicateElementClick(el, reason) {
    const sig = getElementClickSignature(el);
    const t = now();

    if (sig && state.lastElementClickSig === sig && (t - state.lastElementClickAt) < CFG.sameElementCooldownMs) {
      log(`Skipped duplicate click: ${reason || getLabel(el) || el.tagName}`);
      return true;
    }

    state.lastElementClickSig = sig;
    state.lastElementClickAt = t;
    return false;
  }

  function prepareForClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch {}

    try {
      el.focus?.({ preventScroll: true });
    } catch {
      try { el.focus?.(); } catch {}
    }

    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(2, Math.min(rect.width / 2, Math.max(2, rect.width - 2)));
    const clientY = rect.top + Math.max(2, Math.min(rect.height / 2, Math.max(2, rect.height - 2)));

    return { clientX, clientY };
  }

  function hardClick(el, reason = '') {
    if (!el) return false;
    if (shouldBlockDuplicateElementClick(el, reason)) return false;

    const { clientX, clientY } = prepareForClick(el);

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0
    };

    const pointerInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientX,
      clientY,
      button: 0
    };

    try { el.dispatchEvent(new PointerEvent('pointerdown', pointerInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', mouseInit)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', pointerInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', mouseInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', mouseInit)); } catch {}

    return true;
  }

  function nativeClickOnce(el, reason = '') {
    if (!el) return false;
    if (shouldBlockDuplicateElementClick(el, reason)) return false;

    prepareForClick(el);

    try {
      el.click?.();
      return true;
    } catch (err) {
      log(`Click failed: ${reason || getLabel(el) || el.tagName} -> ${err?.message || err}`);
      return false;
    }
  }

  function markDoneThisLoad() {
    state.doneThisLoad = true;
    try {
      sessionStorage.setItem(CFG.doneThisLoadKey, '1');
    } catch {}
  }

  function wasDoneThisLoad() {
    try {
      return sessionStorage.getItem(CFG.doneThisLoadKey) === '1';
    } catch {
      return false;
    }
  }

  async function runFlow() {
    if (state.busy || state.doneThisLoad) return;

    const header = getQuoteHeader();
    if (!header) {
      logWait('Waiting for Personal Lines Quote modal...');
      return;
    }

    const quoteKey = norm(header.textContent);
    if (!quoteKey) {
      logWait('Quote header found, waiting for stable text...');
      return;
    }

    state.busy = true;
    setStatus('Working');
    log(`Quote detected: ${quoteKey}`);

    try {
      const homeTarget = getHomeTarget();
      if (!homeTarget) {
        log('Home control for custom107 missing.');
        setStatus('Running');
        return;
      }

      log(`Clicking Home control: ${getLabel(homeTarget) || homeTarget.tagName}`);
      const homeClicked = hardClick(homeTarget, 'Home control');
      if (!homeClicked) {
        log('Home click skipped/blocked.');
        setStatus('Running');
        return;
      }

      log('Waiting 2 seconds after Home click...');
      await sleep(CFG.afterHomeClickMs);

      const residenceSelected = await ensureResidenceAddressSelected();
      if (!residenceSelected) {
        setStatus('Running');
        return;
      }

      log('Waiting 1 second after Residence Address click...');
      await sleep(CFG.afterResidenceBeforeContinueMs);

      const continueBtn = getContinueButton();
      if (!continueBtn) {
        log('Continue New Quote button missing.');
        setStatus('Running');
        return;
      }

      log(`Clicking Continue New Quote: ${getLabel(continueBtn) || continueBtn.tagName}`);
      const continueClicked = nativeClickOnce(continueBtn, 'Continue New Quote');

      if (!continueClicked) {
        log(`Continue click was blocked/skipped for: ${quoteKey}`);
        setStatus('Running');
        return;
      }

      await sleep(CFG.afterContinueClickMs);
      log(`Done: ${quoteKey}`);
      markDoneThisLoad();
      setStatus('Done this load');
      try { clearInterval(state.tickTimer); } catch {}
    } catch (err) {
      log(`Error: ${err?.message || err}`);
      setStatus('Error');
    } finally {
      state.busy = false;
    }
  }

  function boot() {
    try {
      sessionStorage.removeItem(CFG.doneThisLoadKey);
    } catch {}

    state.doneThisLoad = false;

    makePanel();
    log('Script start.');
    log('Page detected: APEX.');
    log(`Version: ${VERSION}`);
    setStatus('Running');

    state.tickTimer = setInterval(() => {
      if (state.doneThisLoad) return;
      runFlow().catch(err => log(`Run error: ${err?.message || err}`));
    }, CFG.tickMs);

    runFlow().catch(err => log(`Init run error: ${err?.message || err}`));
  }

  if (wasDoneThisLoad()) {
    try { sessionStorage.removeItem(CFG.doneThisLoadKey); } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
