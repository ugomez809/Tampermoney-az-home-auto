// ==UserScript==
// @name         APEX Address Repair
// @namespace    homebot.apex-address-repair
// @version      1.0.1
// @description  Captures the latest AgencyZoom address for APEX, fills the default DOB when APEX says Date of Birth is missing, and repairs wrong-state Home quote addresses by selecting the California risk address match.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-address-repair.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/apex-address-repair.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'APEX Address Repair';
  const VERSION = '1.0.1';
  const LOG_PERSIST_KEY = 'tm_apex_address_repair_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  const LOG_MAX_LINES = 140;
  const UI_ID = 'hb-apex-address-repair-panel';
  const UI_ATTR = 'data-hb-apex-address-repair';
  const GM_KEYS = {
    azSnapshot: 'tm_apex_address_repair_az_snapshot_v1'
  };
  const LS_KEYS = {
    azPayload: 'tm_az_payload_v1',
    addressState: 'tm_apex_address_repair_state_v1'
  };
  const CFG = {
    azTickMs: 1000,
    apexTickMs: 700,
    panelRight: 12,
    panelBottom: 110,
    panelWidth: 340,
    staleUiStateMs: 30000,
    azSnapshotMaxAgeMs: 12 * 60 * 60 * 1000,
    waitForSearchInputMs: 10000,
    waitForOptionsMs: 6000,
    afterRiskRadioMs: 5000,
    afterAddressPasteMs: 3000,
    afterOptionClickMs: 1500,
    maxAddressRepairAttempts: 3,
    defaultDob: '01/01/1991'
  };

  const STATE_NAME_TO_CODE = {
    ALABAMA: 'AL',
    ALASKA: 'AK',
    ARIZONA: 'AZ',
    ARKANSAS: 'AR',
    CALIFORNIA: 'CA',
    COLORADO: 'CO',
    CONNECTICUT: 'CT',
    DELAWARE: 'DE',
    FLORIDA: 'FL',
    GEORGIA: 'GA',
    HAWAII: 'HI',
    IDAHO: 'ID',
    ILLINOIS: 'IL',
    INDIANA: 'IN',
    IOWA: 'IA',
    KANSAS: 'KS',
    KENTUCKY: 'KY',
    LOUISIANA: 'LA',
    MAINE: 'ME',
    MARYLAND: 'MD',
    MASSACHUSETTS: 'MA',
    MICHIGAN: 'MI',
    MINNESOTA: 'MN',
    MISSISSIPPI: 'MS',
    MISSOURI: 'MO',
    MONTANA: 'MT',
    NEBRASKA: 'NE',
    NEVADA: 'NV',
    NEW HAMPSHIRE: 'NH',
    NEW JERSEY: 'NJ',
    NEW MEXICO: 'NM',
    NEW YORK: 'NY',
    NORTH CAROLINA: 'NC',
    NORTH DAKOTA: 'ND',
    OHIO: 'OH',
    OKLAHOMA: 'OK',
    OREGON: 'OR',
    PENNSYLVANIA: 'PA',
    RHODE ISLAND: 'RI',
    SOUTH CAROLINA: 'SC',
    SOUTH DAKOTA: 'SD',
    TENNESSEE: 'TN',
    TEXAS: 'TX',
    UTAH: 'UT',
    VERMONT: 'VT',
    VIRGINIA: 'VA',
    WASHINGTON: 'WA',
    WEST VIRGINIA: 'WV',
    WISCONSIN: 'WI',
    WYOMING: 'WY',
    DISTRICT OF COLUMBIA: 'DC'
  };

  const state = {
    lastAzSig: '',
    lastApexSig: '',
    logs: [],
    busy: false,
    lastRepairAt: 0,
    repairAttempts: Object.create(null),
    tickTimer: 0,
    routeTimer: 0,
    lastUrl: location.href,
    panel: null,
    statusEl: null,
    detailsEl: null
  };

  let lastLogPersistAt = 0;
  let lastLogClearHandledAt = '';

  boot();

  function boot() {
    if (isApexOrigin()) {
      buildPanel();
      updatePanel({
        status: 'waiting-home',
        message: 'Waiting for the Personal Lines Quote modal.'
      });
      state.tickTimer = setInterval(() => {
        runApexTick().catch(err => log(`APEX tick failed: ${err?.message || err}`));
      }, CFG.apexTickMs);
      state.routeTimer = setInterval(watchRoute, 700);
      window.addEventListener('focus', scheduleApexTick, true);
      window.addEventListener('pageshow', scheduleApexTick, true);
      writeRepairState({
        active: false,
        status: 'waiting-home',
        message: 'Waiting for the Personal Lines Quote modal.',
        selectionMode: 'residence'
      });
      runApexTick().catch(err => log(`APEX init failed: ${err?.message || err}`));
      log(`Loaded on APEX v${VERSION}`);
    } else if (isAzOrigin()) {
      state.tickTimer = setInterval(() => {
        runAzTick().catch(err => log(`AZ tick failed: ${err?.message || err}`));
      }, CFG.azTickMs);
      runAzTick().catch(err => log(`AZ init failed: ${err?.message || err}`));
      log(`Loaded on AgencyZoom v${VERSION}`);
    }

    setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
  }

  function isAzOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isApexOrigin() {
    return /farmersagent\.lightning\.force\.com$/i.test(location.hostname);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function now() {
    return Date.now();
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function norm(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function normalizeStreet(value) {
    return lower(value).replace(/[^a-z0-9]/g, '');
  }

  function normalizeZip(value) {
    return norm(value).replace(/[^0-9]/g, '').slice(0, 5);
  }

  function normalizeCompare(value) {
    return lower(value)
      .replace(/[\.,#]/g, ' ')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\btrail\b/g, 'trl')
      .replace(/\bterrace\b/g, 'ter')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeStateValue(value) {
    const text = norm(value).toUpperCase();
    if (!text) return '';
    if (text.length === 2 && Object.values(STATE_NAME_TO_CODE).includes(text)) return text;
    return STATE_NAME_TO_CODE[text] || '';
  }

  function extractStateCode(value) {
    const direct = normalizeStateValue(value);
    if (direct) return direct;

    const text = norm(value).toUpperCase();
    if (!text) return '';

    const match = text.match(/\b([A-Z]{2})\b/g) || [];
    for (const code of match) {
      if (Object.values(STATE_NAME_TO_CODE).includes(code)) return code;
    }

    for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
      if (text.includes(name)) return code;
    }

    return '';
  }

  function namesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function readJson(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function readLocalJson(key, fallback = null) {
    try {
      return readJson(localStorage.getItem(key), fallback);
    } catch {
      return fallback;
    }
  }

  function readGM(key, fallback = null) {
    try {
      return readJson(GM_getValue(key, fallback), fallback);
    } catch {
      return fallback;
    }
  }

  function writeGM(key, value) {
    try {
      GM_setValue(key, value);
    } catch {}
  }

  function watchRoute() {
    if (location.href === state.lastUrl) return;
    state.lastUrl = location.href;
    state.lastApexSig = '';
    state.repairAttempts = Object.create(null);
    scheduleApexTick();
  }

  function scheduleApexTick() {
    setTimeout(() => {
      runApexTick().catch(err => log(`Scheduled APEX tick failed: ${err?.message || err}`));
    }, 50);
  }

  function buildAzSnapshotFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const az = payload.az && typeof payload.az === 'object' ? payload.az : payload;
    const street = norm(az['Street Address'] || az['AZ Street Address'] || az.address1 || az.address || '');
    const city = norm(az['City'] || az['AZ City'] || az.city || '');
    const stateCode = normalizeStateValue(az['State'] || az['AZ State'] || az.state || '');
    const zip = norm(az['Zip'] || az['AZ Postal Code'] || az.zip || az.zipCode || '');
    const ticketId = norm(payload.ticketId || az['AZ ID'] || az.ticketId || '');
    const firstName = norm(az['First Name'] || az['AZ Name'] || az.firstName || az.first || '');
    const lastName = norm(az['Last Name'] || az['AZ Last'] || az.lastName || az.last || '');
    const name = norm([firstName, lastName].filter(Boolean).join(' '));

    if (!street || !city || !stateCode) return null;

    return {
      ticketId,
      name,
      street,
      city,
      state: stateCode,
      zip,
      fullAddress: [street, city, zip ? `${stateCode} ${zip}` : stateCode].filter(Boolean).join(', '),
      source: 'tm_az_payload_v1',
      savedAt: norm(payload.meta?.savedAt || payload.savedAt || nowIso()),
      updatedAt: nowIso()
    };
  }

  async function runAzTick() {
    const payload = readLocalJson(LS_KEYS.azPayload, null);
    const snapshot = buildAzSnapshotFromPayload(payload);
    if (!snapshot) return;

    const sig = JSON.stringify(snapshot);
    if (sig === state.lastAzSig) return;

    state.lastAzSig = sig;
    writeGM(GM_KEYS.azSnapshot, snapshot);
    log(`AZ address captured${snapshot.ticketId ? ` for ${snapshot.ticketId}` : ''}: ${snapshot.fullAddress}`);
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;
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

  function getAllRoots(startRoot = document) {
    const roots = [];
    const seen = new WeakSet();

    function walk(root) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push(root);

      let nodes = [];
      try {
        if (root instanceof Document || root instanceof ShadowRoot || root instanceof Element) {
          nodes = Array.from(root.querySelectorAll('*'));
        }
      } catch {
        nodes = [];
      }

      for (const node of nodes) {
        try {
          if (node.shadowRoot) walk(node.shadowRoot);
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
      } catch {
        found = [];
      }

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
      return el.matches('section.slds-modal, section.slds-modal.slds-fade-in-open, .slds-modal__container, article[role="dialog"], [role="dialog"]');
    });

    return modal || header;
  }

  function getQuoteName(scope) {
    const header = getQuoteHeader();
    const text = norm(header?.textContent || '');
    const match = text.match(/^Personal Lines Quote for\s+(.+)$/i);
    return norm(match?.[1] || '');
  }

  function findDobSnag(scope) {
    const candidates = deepQueryAll('section.slds-popover, .slds-popover, [role="dialog"]', scope || document);
    for (const el of candidates) {
      if (!isVisible(el) || el.id === UI_ID || el.closest?.(`#${UI_ID}`)) continue;
      const text = lower(el.textContent || '');
      if (!text.includes('we hit a snag')) continue;
      if (!text.includes('review the following fields')) continue;
      if (!text.includes('date of birth')) continue;
      return el;
    }
    return null;
  }

  function findVisibleDobInput(scope) {
    const inputs = deepQueryAll('input[name="dateOfBirth"]', scope || document);
    return inputs.find(el => isVisible(el) && !isDisabled(el)) || null;
  }

  function findStateMismatchError(scope) {
    const candidates = deepQueryAll('p, span, li', scope || document);
    for (const el of candidates) {
      if (!isVisible(el) || el.id === UI_ID || el.closest?.(`#${UI_ID}`)) continue;
      const text = lower(el.textContent || '');
      if (!text.includes('different than the state for the selected agent code')) continue;
      if (!text.includes('state of the address must match')) continue;
      return el;
    }
    return null;
  }

  function getRiskAddressRadio(scope) {
    const candidates = deepQueryAll([
      'input[type="radio"][name="riskAddress"][data-name="riskAddress"][value="riskAddress"]',
      'input[type="radio"][name="riskAddress"][data-name="riskAddress"]',
      'input[type="radio"][name="riskAddress"][value="riskAddress"]'
    ].join(','), scope || document);
    return candidates.find(el => isVisible(el) && !isDisabled(el)) || null;
  }

  function getSearchAddressInput(scope) {
    const candidates = deepQueryAll([
      'input[placeholder="Search Address"][role="combobox"]',
      'input[placeholder="Search Address"]',
      'input.slds-combobox__input[role="combobox"]'
    ].join(','), scope || document);
    return candidates.find(el => isVisible(el) && !isDisabled(el)) || null;
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

  function readElementValue(el) {
    if (!el) return '';
    try {
      if ('value' in el) return norm(el.value);
    } catch {}
    return norm(el.textContent || '');
  }

  function focusElement(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch {}
    try {
      el.focus?.({ preventScroll: true });
    } catch {
      try { el.focus?.(); } catch {}
    }
  }

  function dispatchInputLikeEvents(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true, composed: true })); } catch {}
    try { el.blur?.(); } catch {}
  }

  function writeValueDirect(el, value) {
    const nextValue = String(value == null ? '' : value);
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      if (desc?.set) {
        desc.set.call(el, nextValue);
      } else {
        el.value = nextValue;
      }
      return true;
    } catch {
      try {
        el.value = nextValue;
        return true;
      } catch {
        return false;
      }
    }
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const nextValue = norm(value);
    if (readElementValue(el) === nextValue) return false;
    const ok = writeValueDirect(el, nextValue);
    if (!ok) return false;
    dispatchInputLikeEvents(el);
    return true;
  }

  async function typeLikeHuman(el, text) {
    if (!el) return false;
    focusElement(el);
    writeValueDirect(el, '');
    dispatchInputLikeEvents(el);
    await sleep(100);

    let built = '';
    for (const ch of String(text || '')) {
      built += ch;
      writeValueDirect(el, built);
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: ch,
          code: ch
        }));
      } catch {}
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          data: ch,
          inputType: 'insertText'
        }));
      } catch {
        try { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch {}
      }
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: ch,
          code: ch
        }));
      } catch {}
      await sleep(20);
    }

    dispatchInputLikeEvents(el);
    return true;
  }

  function clickElement(el, reason = '') {
    if (!el) return false;
    focusElement(el);
    try { el.click?.(); } catch {}
    try {
      el.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      }));
    } catch {}
    if (reason) log(reason);
    return true;
  }

  function strongClick(el, reason = '') {
    if (!el) return false;
    focusElement(el);
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + Math.max(2, Math.min(rect.width / 2, Math.max(2, rect.width - 2)));
    const clientY = rect.top + Math.max(2, Math.min(rect.height / 2, Math.max(2, rect.height - 2)));

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0
    };

    try {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        clientX,
        clientY,
        button: 0
      }));
    } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', mouseInit)); } catch {}
    try {
      el.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        clientX,
        clientY,
        button: 0
      }));
    } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', mouseInit)); } catch {}
    try { el.dispatchEvent(new MouseEvent('click', mouseInit)); } catch {}
    try { el.click?.(); } catch {}
    if (reason) log(reason);
    return true;
  }

  function pressKey(el, key) {
    if (!el) return;
    focusElement(el);
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        code: key
      }));
    } catch {}
    try {
      el.dispatchEvent(new KeyboardEvent('keyup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        key,
        code: key
      }));
    } catch {}
  }

  async function waitFor(fn, timeoutMs, intervalMs) {
    const startedAt = now();
    while ((now() - startedAt) < timeoutMs) {
      const value = fn();
      if (value) return value;
      await sleep(intervalMs);
    }
    return null;
  }

  function getSearchScope(input, fallbackScope) {
    return findAncestorAcrossRoots(input, el => {
      if (!(el instanceof Element)) return false;
      return el.matches('[role="dialog"], section.slds-modal, .slds-modal__container, .slds-popover');
    }) || fallbackScope || document;
  }

  function getClickableCandidate(el) {
    return findAncestorAcrossRoots(el, node => {
      if (!(node instanceof Element)) return false;
      return node.matches('[role="option"], li, button, a, .slds-listbox__option, .pac-item, lightning-base-combobox-item');
    }) || el;
  }

  function isReasonableOptionNode(raw, clickable) {
    if (!raw || !clickable) return false;
    if (clickable !== raw) return true;
    if (!raw.matches('div, span, li, [role="option"], .slds-listbox__option, .pac-item, lightning-base-combobox-item')) return false;

    const nestedOptionCount = raw.matches('li, [role="option"], .slds-listbox__option, .pac-item, lightning-base-combobox-item')
      ? 0
      : raw.querySelectorAll?.('li, [role="option"], .slds-listbox__option, .pac-item, lightning-base-combobox-item').length || 0;

    if (nestedOptionCount > 0) return false;
    if (raw.childElementCount > 6) return false;
    return true;
  }

  function scoreAddressOption(text, expected) {
    const cleanText = norm(text);
    const textLower = lower(cleanText);
    if (!cleanText || textLower.includes('powered by google')) return -999;

    let score = 0;
    const streetKey = normalizeStreet(expected.street);
    const cityKey = lower(expected.city);
    const zipKey = normalizeZip(expected.zip);
    const stateCode = normalizeStateValue(expected.state);
    const optionState = extractStateCode(cleanText);

    if (streetKey && normalizeStreet(cleanText).includes(streetKey)) score += 8;
    if (cityKey && textLower.includes(cityKey)) score += 5;
    if (zipKey && normalizeZip(cleanText).includes(zipKey)) score += 5;
    if (stateCode && optionState === stateCode) score += 7;
    else if (optionState) score -= 4;
    if (textLower.includes(', ca') || textLower.includes(' california')) score += 2;

    return score;
  }

  function findAddressOptions(scope, expected) {
    const candidates = deepQueryAll([
      '[role="option"]',
      'li',
      'button',
      'a',
      '.slds-listbox__option',
      '.pac-item',
      'lightning-base-combobox-item',
      'div',
      'span'
    ].join(','), scope || document);

    const out = [];
    const seen = new WeakSet();

    for (const raw of candidates) {
      if (!isVisible(raw) || raw.id === UI_ID || raw.closest?.(`#${UI_ID}`)) continue;
      const clickable = getClickableCandidate(raw);
      if (!clickable || seen.has(clickable) || !isVisible(clickable) || clickable.id === UI_ID || clickable.closest?.(`#${UI_ID}`)) continue;
      if (!isReasonableOptionNode(raw, clickable)) continue;

      const text = norm(clickable.textContent || clickable.getAttribute('title') || '');
      if (!text || text.length < 8 || text.length > 220) continue;

      const score = scoreAddressOption(text, expected);
      if (score < 8) continue;

      seen.add(clickable);
      out.push({ el: clickable, text, score });
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function getAzSnapshotForApex(scope) {
    const snapshot = readGM(GM_KEYS.azSnapshot, null);
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, reason: 'Waiting for AgencyZoom address snapshot.' };
    }

    const ageMs = now() - Date.parse(norm(snapshot.updatedAt || snapshot.savedAt || ''));
    if (Number.isFinite(ageMs) && ageMs > CFG.azSnapshotMaxAgeMs) {
      return { ok: false, reason: 'AgencyZoom address snapshot is stale.' };
    }

    const quoteName = getQuoteName(scope);
    if (quoteName && snapshot.name && !namesLikelySame(quoteName, snapshot.name)) {
      return {
        ok: false,
        reason: `AgencyZoom snapshot name mismatch: ${snapshot.name}`
      };
    }

    const street = norm(snapshot.street || '');
    const city = norm(snapshot.city || '');
    const stateCode = normalizeStateValue(snapshot.state || '');
    const zip = norm(snapshot.zip || '');
    if (!street || !city || !stateCode) {
      return { ok: false, reason: 'AgencyZoom snapshot is missing address fields.' };
    }

    return {
      ok: true,
      snapshot: {
        ticketId: norm(snapshot.ticketId || ''),
        name: norm(snapshot.name || ''),
        street,
        city,
        state: stateCode,
        zip,
        fullAddress: norm(snapshot.fullAddress || [street, city, zip ? `${stateCode} ${zip}` : stateCode].filter(Boolean).join(', '))
      }
    };
  }

  function isRiskAddressReady(scope, snapshot) {
    if (findStateMismatchError(scope)) return false;

    const searchInput = getSearchAddressInput(scope);
    const value = lower(readElementValue(searchInput));
    const modalText = lower(scope?.textContent || '');

    if (value && value.includes(lower(snapshot.city)) && value.includes(lower(snapshot.state))) return true;
    if (modalText.includes(lower(snapshot.city)) && modalText.includes(lower(snapshot.state))) return true;
    return false;
  }

  async function repairMissingDob(scope) {
    const dobInput = findVisibleDobInput(scope);
    if (!dobInput) {
      log('DOB snag detected but dateOfBirth input is missing.');
      return false;
    }

    const alreadySet = readElementValue(dobInput) === CFG.defaultDob;
    if (!alreadySet) {
      setNativeValue(dobInput, CFG.defaultDob);
      log(`Filled missing DOB with ${CFG.defaultDob}.`);
    } else {
      dispatchInputLikeEvents(dobInput);
      log(`DOB already set to ${CFG.defaultDob}; re-fired input events.`);
    }

    const snag = findDobSnag(scope);
    const closeBtn = snag
      ? deepQueryAll('button[title="Close dialog"], button.slds-popover__close', snag).find(isVisible)
      : null;
    if (closeBtn) clickElement(closeBtn, 'Closed DOB snag dialog.');

    await sleep(600);
    return true;
  }

  async function repairWrongStateAddress(scope, snapshot, sig) {
    const attempts = Number(state.repairAttempts[sig] || 0);
    if (attempts >= CFG.maxAddressRepairAttempts) {
      return false;
    }

    state.repairAttempts[sig] = attempts + 1;
    state.lastRepairAt = now();

    const riskRadio = getRiskAddressRadio(scope);
    if (!riskRadio) {
      log('Wrong-state error detected but riskAddress radio is missing.');
      return false;
    }

    if (!riskRadio.checked) {
      setCheckedProperty(riskRadio, true);
      strongClick(riskRadio, `Selected riskAddress (${attempts + 1}/${CFG.maxAddressRepairAttempts})`);
    } else {
      log(`riskAddress already selected (${attempts + 1}/${CFG.maxAddressRepairAttempts}).`);
    }

    await sleep(CFG.afterRiskRadioMs);

    const searchInput = await waitFor(() => getSearchAddressInput(getQuoteModal() || scope), CFG.waitForSearchInputMs, 250);
    if (!searchInput) {
      log('Search Address input did not appear after selecting riskAddress.');
      return false;
    }

    await typeLikeHuman(searchInput, snapshot.fullAddress);
    log(`Pasted AZ address into Search Address: ${snapshot.fullAddress}`);
    await sleep(CFG.afterAddressPasteMs);

    const optionScope = getSearchScope(searchInput, getQuoteModal() || scope);
    const options = await waitFor(() => {
      const matches = findAddressOptions(optionScope, snapshot);
      return matches.length ? matches : null;
    }, CFG.waitForOptionsMs, 250);

    if (options && options.length) {
      const best = options[0];
      strongClick(best.el, `Selected California address option: ${best.text}`);
      await sleep(CFG.afterOptionClickMs);
      if (isRiskAddressReady(getQuoteModal() || scope, snapshot)) return true;
    }

    pressKey(searchInput, 'ArrowDown');
    await sleep(150);
    pressKey(searchInput, 'Enter');
    log('Address dropdown was hard to target; used ArrowDown + Enter fallback.');
    await sleep(CFG.afterOptionClickMs);
    return isRiskAddressReady(getQuoteModal() || scope, snapshot);
  }

  async function runApexTick() {
    if (state.busy) return;
    state.busy = true;

    try {
      const scope = getQuoteModal();
      if (!scope) {
        writeRepairState({
          active: false,
          status: 'waiting-home',
          message: 'Waiting for the Personal Lines Quote modal.',
          selectionMode: 'residence'
        });
        return;
      }

      const quoteName = getQuoteName(scope);
      const dobSnag = findDobSnag(scope);
      if (dobSnag) {
        writeRepairState({
          active: true,
          status: 'fixing-dob',
          message: 'Date of Birth is missing. Filling the default DOB.',
          selectionMode: 'residence',
          quoteName
        });
        await repairMissingDob(scope);
        return;
      }

      const mismatchError = findStateMismatchError(scope);
      if (mismatchError) {
        const snapshotResult = getAzSnapshotForApex(scope);
        if (!snapshotResult.ok) {
          writeRepairState({
            active: true,
            status: 'waiting-data',
            message: snapshotResult.reason,
            selectionMode: 'risk',
            quoteName
          });
          return;
        }

        const snapshot = snapshotResult.snapshot;
        const repairSig = [
          quoteName,
          snapshot.ticketId,
          snapshot.fullAddress
        ].join('|');

        writeRepairState({
          active: true,
          status: 'repairing-address',
          message: `Fixing wrong-state address with ${snapshot.fullAddress}`,
          selectionMode: 'risk',
          quoteName,
          azId: snapshot.ticketId,
          expectedAddress: snapshot.fullAddress
        });

        const repaired = await repairWrongStateAddress(scope, snapshot, repairSig);
        if (!repaired) {
          writeRepairState({
            active: true,
            status: 'needs-review',
            message: `Could not finish the address repair automatically. Expected ${snapshot.fullAddress}.`,
            selectionMode: 'risk',
            quoteName,
            azId: snapshot.ticketId,
            expectedAddress: snapshot.fullAddress
          });
          return;
        }

        writeRepairState({
          active: true,
          status: 'ready',
          message: `Risk Address is ready with ${snapshot.fullAddress}.`,
          selectionMode: 'risk',
          quoteName,
          azId: snapshot.ticketId,
          expectedAddress: snapshot.fullAddress
        });
        return;
      }

      const riskRadio = getRiskAddressRadio(scope);
      const snapshotResult = getAzSnapshotForApex(scope);
      const readySelectionMode =
        riskRadio?.checked && (!snapshotResult.ok || isRiskAddressReady(scope, snapshotResult.snapshot))
          ? 'risk'
          : 'residence';

      const expectedAddress = snapshotResult.ok ? snapshotResult.snapshot.fullAddress : '';
      writeRepairState({
        active: true,
        status: 'ready',
        message: readySelectionMode === 'risk'
          ? `Risk Address is ready${expectedAddress ? ` with ${expectedAddress}` : '.'}`
          : 'No APEX address repair is needed.',
        selectionMode: readySelectionMode,
        quoteName,
        azId: snapshotResult.ok ? snapshotResult.snapshot.ticketId : '',
        expectedAddress
      });
    } finally {
      state.busy = false;
    }
  }

  function writeRepairState(next) {
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      host: location.host,
      href: location.href,
      active: next.active === true,
      status: norm(next.status || 'waiting-home') || 'waiting-home',
      message: norm(next.message || ''),
      selectionMode: norm(next.selectionMode || 'residence') || 'residence',
      quoteName: norm(next.quoteName || ''),
      azId: norm(next.azId || ''),
      expectedAddress: norm(next.expectedAddress || ''),
      updatedAt: nowIso()
    };

    const sig = JSON.stringify(payload);
    if (sig === state.lastApexSig) {
      updatePanel(payload);
      return;
    }

    state.lastApexSig = sig;
    try {
      localStorage.setItem(LS_KEYS.addressState, JSON.stringify(payload));
    } catch {}
    updatePanel(payload);
  }

  function buildPanel() {
    try { document.getElementById(UI_ID)?.remove(); } catch {}

    const panel = document.createElement('div');
    panel.id = UI_ID;
    panel.setAttribute(UI_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: `${CFG.panelRight}px`,
      bottom: `${CFG.panelBottom}px`,
      width: `${CFG.panelWidth}px`,
      zIndex: '2147483647',
      background: 'rgba(15, 23, 42, 0.94)',
      color: '#e2e8f0',
      border: '1px solid rgba(148, 163, 184, 0.35)',
      borderRadius: '12px',
      padding: '10px 12px',
      boxShadow: '0 10px 30px rgba(15, 23, 42, 0.32)',
      font: '12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      pointerEvents: 'none'
    });

    panel.innerHTML = `
      <div ${UI_ATTR}="1" style="display:flex;justify-content:space-between;gap:8px;font-weight:700;">
        <span ${UI_ATTR}="1">${SCRIPT_NAME}</span>
        <span ${UI_ATTR}="1" style="opacity:.7;">v${VERSION}</span>
      </div>
      <div ${UI_ATTR}="1" id="hb-apex-address-repair-status" style="margin-top:6px;font-weight:700;color:#fbbf24;">WAITING</div>
      <div ${UI_ATTR}="1" id="hb-apex-address-repair-details" style="margin-top:4px;opacity:.9;">Waiting for the Personal Lines Quote modal.</div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.statusEl = panel.querySelector('#hb-apex-address-repair-status');
    state.detailsEl = panel.querySelector('#hb-apex-address-repair-details');
  }

  function updatePanel(payload) {
    if (!isApexOrigin() || !state.panel) return;

    const status = lower(payload?.status || '');
    const color =
      status === 'ready' ? '#86efac'
      : status === 'repairing-address' || status === 'fixing-dob' ? '#fbbf24'
      : status === 'needs-review' ? '#fca5a5'
      : '#cbd5e1';

    if (state.statusEl) {
      state.statusEl.textContent = norm(payload?.status || 'waiting-home').toUpperCase();
      state.statusEl.style.color = color;
    }

    if (state.detailsEl) {
      const details = [
        norm(payload?.message || ''),
        norm(payload?.selectionMode || '') ? `Mode: ${norm(payload.selectionMode)}` : '',
        norm(payload?.expectedAddress || '')
      ].filter(Boolean).join(' ');
      state.detailsEl.textContent = details || 'Waiting for the Personal Lines Quote modal.';
    }

    const updatedMs = Date.parse(norm(payload?.updatedAt || ''));
    const stale = Number.isFinite(updatedMs) && (Date.now() - updatedMs) > CFG.staleUiStateMs;
    state.panel.style.opacity = stale ? '0.72' : '1';
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    if (state.logs.length > LOG_MAX_LINES) state.logs.length = LOG_MAX_LINES;
    persistLogsThrottled();
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
  }

  function persistLogsThrottled() {
    const time = now();
    if (time - lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    lastLogPersistAt = time;
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: nowIso(),
      lines: state.logs.slice()
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
  }

  function checkLogClearRequest() {
    let req = null;
    try { req = readJson(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY), null); } catch {}
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === lastLogClearHandledAt) return;
    lastLogClearHandledAt = at;
    state.logs.length = 0;
    lastLogPersistAt = 0;
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    persistLogsThrottled();
    checkLogClearRequest();
  }
})();