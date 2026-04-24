// ==UserScript==
// @name         AgencyZoom Ticket Finisher + Tagger
// @namespace    homebot.az-ticket-finisher-tagger
// @version      1.0.3
// @description  Reads the mirrored GWPC final payload in AgencyZoom, clicks Main, fills ticket fields, clicks Update, adds a pinned note, applies the correct tag, and marks the ticket complete.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-ticket-finisher-tagger.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-ticket-finisher-tagger.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_TICKET_FINISHER_TAGGER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'AZ TO GWPC 100 AgencyZoom Ticket Finisher + Tagger';
  const VERSION = '1.0.3';
  const UI_ATTR = 'data-tm-az-finisher-ui';
  const CLEANUP_REQUEST_KEY = 'tm_az_workflow_cleanup_request_v1';

  const GM_KEYS = {
    finalPayload: 'tm_az_gwpc_final_payload_v1',
    finalReady: 'tm_az_gwpc_final_payload_ready_v1',
    fieldTargets: 'tm_az_ticket_finisher_field_targets_v1',
    tagTargets: 'tm_az_ticket_finisher_tag_targets_v1',
    runs: 'tm_az_ticket_finisher_runs_v1'
  };

  const LS_KEYS = {
    running: 'tm_az_ticket_finisher_running_v1',
    panelPos: 'tm_az_ticket_finisher_panel_pos_v1'
  };

  const FIELD_ORDER = [
    'CFP?',
    'Reconstruction Cost',
    'Year Built',
    'Square FT',
    '# of Story',
    'Water Device?',
    'Standard Pricing No Auto Discount',
    'Enhance Pricing No Auto Discount',
    'Standard Pricing Auto Discount',
    'Enhance Pricing Auto Discount'
  ];

  const TAG_ORDER = [
    { key: 'successfulTag', label: 'Successful Quote tag' },
    { key: 'failedTag', label: 'Failed Quote tag' }
  ];

  const SEL = {
    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',
    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    updateButton: 'button.btn.btn-primary.action[onclick*="leadDetailTab.doSave"], button.action[onclick*="doSave"]',
    noteOpener: 'a.btn-note.az-tooltip.tooltipstered, a.btn-note',
    noteEditor: 'div.ql-editor[contenteditable="true"], div[data-placeholder="Add note here"][contenteditable="true"], .ql-editor',
    pinTop: 'a.pin-top[data-value="0"], a.pin-top',
    saveNote: 'button#add-note, button.btn-primary#add-note',
    tagOpener: 'a.btn-tag.az-tooltip.tooltipstered, a.btn-tag',
    tagDropdown: 'button.dropdown-toggle.btn-light[role="combobox"], button[data-toggle="dropdown"][role="combobox"], button.dropdown-toggle'
  };

  const CFG = {
    tickMs: 800,
    stepPollMs: 150,
    mainReadyMs: 10000,
    actionSettleMs: 900,
    noteSettleMs: 1200,
    updateSettleMs: 1200,
    maxLogLines: 90,
    zIndex: 2147483647,
    panelWidth: 360,
    observerThrottleMs: 60
  };

  const state = {
    destroyed: false,
    running: loadRunning(),
    busy: false,
    forceRunRequested: false,
    logs: [],
    panel: null,
    ui: {},
    tickTimer: null,
    picker: null,
    hoverBox: null,
    hoveredEl: null,
    pickerMove: null,
    pickerClick: null,
    pickerKeydown: null,
    activeAzId: '',
    lastPayloadSeenKey: '',
    lastStatus: ''
  };

  init();

  function init() {
    buildUi();
    bindUi();
    restorePanelPos();
    ensureHoverBox();
    renderAll();

    log(`Loaded v${VERSION}`);
    setStatus(state.running ? 'Waiting for mirrored payload' : 'Stopped');

    state.tickTimer = setInterval(() => tick(), CFG.tickMs);
    window.addEventListener('beforeunload', persistPanelPos, true);
    window.addEventListener('pagehide', persistPanelPos, true);
    window.addEventListener('resize', keepPanelInView, true);

    tick();
    window.__AZ_TICKET_FINISHER_TAGGER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.tickTimer); } catch {}
    try { window.removeEventListener('beforeunload', persistPanelPos, true); } catch {}
    try { window.removeEventListener('pagehide', persistPanelPos, true); } catch {}
    try { window.removeEventListener('resize', keepPanelInView, true); } catch {}
    stopPicker('', false);
    try { state.hoverBox?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_TICKET_FINISHER_TAGGER_CLEANUP__; } catch {}
  }

  function loadRunning() {
    try { return localStorage.getItem(LS_KEYS.running) !== '0'; }
    catch { return true; }
  }

  function saveRunning(on) {
    try { localStorage.setItem(LS_KEYS.running, on ? '1' : '0'); } catch {}
  }

  function readJson(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function readGM(key, fallback = null) {
    try {
      const gmValue = GM_getValue(key, fallback);
      const parsed = readJson(gmValue, gmValue);
      return parsed == null ? fallback : parsed;
    } catch {
      const local = readJson(localStorage.getItem(key), fallback);
      return local == null ? fallback : local;
    }
  }

  function requestWorkflowCleanup(azId) {
    const cleanAzId = norm(azId || '');
    if (!cleanAzId) return;
    writeGM(CLEANUP_REQUEST_KEY, {
      ready: true,
      azId: cleanAzId,
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    });
    log(`Requested workflow cleanup for AZ ${cleanAzId}`);
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); }
    catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function timeNow() {
    try { return new Date().toLocaleTimeString(); }
    catch { return nowIso(); }
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
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

  function log(message) {
    const line = `[${timeNow()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    renderLogs();
    console.log(`[${SCRIPT_NAME}] ${message}`);
  }

  function setStatus(text) {
    state.lastStatus = text;
    if (state.ui.status) state.ui.status.textContent = text;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function pickFirst(...values) {
    for (const value of values) {
      const text = norm(value);
      if (text) return text;
    }
    return '';
  }

  function normalizeYes(value) {
    const text = lower(value);
    return text === 'yes' || text === 'true' || text === 'completed' || text === 'done' || text === 'y';
  }

  function strongClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: el.ownerDocument?.defaultView || window
        }));
      } catch {}
    }
    try { el.click(); return true; } catch { return false; }
  }

  function showBootstrapTab(anchor) {
    if (!anchor) return false;

    try {
      const $ = window.jQuery;
      if ($ && typeof $(anchor).tab === 'function') {
        $(anchor).tab('show');
        return true;
      }
    } catch {}

    strongClick(anchor);

    try {
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#')) {
        document.querySelectorAll('a[data-toggle="tab"]').forEach((a) => a.classList.remove('active'));
        anchor.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active', 'show'));
        const target = document.querySelector(href);
        if (target) target.classList.add('active', 'show');
      }
    } catch {}

    return true;
  }

  function waitFor(fn, timeoutMs, intervalMs = CFG.stepPollMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const loop = () => {
        if (state.destroyed) return resolve(null);
        try {
          const result = fn();
          if (result) return resolve(result);
        } catch {}
        if ((Date.now() - start) >= timeoutMs) return resolve(null);
        setTimeout(loop, intervalMs);
      };
      loop();
    });
  }

  function findVisibleElements(selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).filter(visible);
    } catch {
      return [];
    }
  }

  function findByText(tagNames, text) {
    const want = lower(text);
    const tags = Array.isArray(tagNames) ? tagNames : [tagNames];
    const nodes = Array.from(document.querySelectorAll(tags.join(','))).filter(visible);
    return nodes.find((node) => lower(node.textContent || '').includes(want)) || null;
  }

  function getOpenDockRoot() {
    return document.querySelector(SEL.dockRoot) || null;
  }

  function getOpenTicketInfo() {
    const root = getOpenDockRoot();
    if (!root) return { ticketId: '', name: '', tags: [] };

    const top = document.querySelector(SEL.dockTop) || root;
    const h3 = top.querySelector(SEL.topName) || root.querySelector(SEL.topName);

    let name = '';
    if (h3) {
      const clone = h3.cloneNode(true);
      clone.querySelector('.origin-vendor-sync')?.remove();
      name = norm(clone.textContent || '');
    }

    let ticketId = '';
    const syncNode = root.querySelector('.origin-vendor-sync');
    const syncText = norm(syncNode?.textContent || '');
    const match = syncText.match(/\bID:\s*(\d+)\b/i);
    if (match) ticketId = match[1];

    const tags = Array.from(root.querySelectorAll(SEL.topTags))
      .map((el) => norm(el.textContent))
      .filter(Boolean);

    return { ticketId, name, tags };
  }

  function readTargets(key) {
    const value = readGM(key, {});
    return isPlainObject(value) ? value : {};
  }

  function saveTargets(key, value) {
    writeGM(key, value);
  }

  function getFieldTargets() {
    return readTargets(GM_KEYS.fieldTargets);
  }

  function getTagTargets() {
    return readTargets(GM_KEYS.tagTargets);
  }

  function hasAllFieldTargets() {
    const targets = getFieldTargets();
    return FIELD_ORDER.every((label) => isPlainObject(targets[label]) && norm(targets[label].selector));
  }

  function hasAllTagTargets() {
    const targets = getTagTargets();
    return TAG_ORDER.every((item) => isPlainObject(targets[item.key]) && norm(targets[item.key].selector));
  }

  function readRuns() {
    const value = readGM(GM_KEYS.runs, {});
    return isPlainObject(value) ? value : {};
  }

  function saveRuns(runs) {
    writeGM(GM_KEYS.runs, runs);
  }

  function getFinalPayload() {
    const ready = readGM(GM_KEYS.finalReady, null);
    const payload = readGM(GM_KEYS.finalPayload, null);
    if (!isPlainObject(payload)) return null;
    const readyLike = isPlainObject(ready) ? ready : {};
    const readyOk = readyLike.ready === true;
    const azId = norm(payload.azId || readyLike.azId || '');
    const savedAt = norm(payload.savedAt || readyLike.savedAt || '');
    if (!azId) return null;
    return {
      ready: readyOk ? readyLike : {
        ready: true,
        azId,
        savedAt
      },
      payload,
      azId,
      payloadKey: `${azId}|${savedAt}`
    };
  }

  function unwrapProductPayload(raw) {
    if (!isPlainObject(raw)) return {};
    return isPlainObject(raw.data) ? raw.data : raw;
  }

  function extractWorkflowData(finalPayload) {
    const payload = finalPayload.payload;
    const home = unwrapProductPayload(payload.homePayload || payload.bundle?.home?.data || {});
    const auto = unwrapProductPayload(payload.autoPayload || payload.bundle?.auto?.data || {});
    const homeRow = isPlainObject(home.row) ? home.row : {};
    const autoRow = isPlainObject(auto.row) ? auto.row : {};

    const doneValue = pickFirst(
      homeRow['Done?'],
      payload.bundle?.home?.data?.row?.['Done?'],
      payload.bundle?.home?.ready ? 'Yes' : ''
    );

    const autoValue = pickFirst(
      auto['Auto'],
      auto.data?.auto,
      autoRow['Auto'],
      payload.bundle?.auto?.ready ? 'Yes' : ''
    );

    const homeSubmission = pickFirst(
      homeRow['Submission Number'],
      home.currentJob?.SubmissionNumber,
      payload.bundle?.home?.submissionNumber
    );

    const autoSubmission = pickFirst(
      auto['Submission Number (Auto)'],
      auto.submissionNumberAuto,
      auto.autoSubmissionNumber,
      autoRow['Submission Number (Auto)'],
      payload.bundle?.auto?.submissionNumber
    );

    const noteText = [
      `Home Submission Number: ${homeSubmission}`,
      `Auto Submission Number: ${autoSubmission}`,
      `Done?: ${doneValue}`,
      `Auto: ${autoValue}`
    ].join('\n');

    return {
      azId: finalPayload.azId,
      payloadSavedAt: norm(payload.savedAt || finalPayload.ready.savedAt || ''),
      fields: {
        'CFP?': pickFirst(homeRow['CFP?']),
        'Reconstruction Cost': pickFirst(homeRow['Reconstruction Cost']),
        'Year Built': pickFirst(homeRow['Year Built']),
        'Square FT': pickFirst(homeRow['Square FT']),
        '# of Story': pickFirst(homeRow['# of Story']),
        'Water Device?': pickFirst(homeRow['Water Device?']),
        'Standard Pricing No Auto Discount': pickFirst(homeRow['Standard Pricing No Auto Discount']),
        'Enhance Pricing No Auto Discount': pickFirst(homeRow['Enhance Pricing No Auto Discount']),
        'Standard Pricing Auto Discount': pickFirst(homeRow['Standard Pricing Auto Discount']),
        'Enhance Pricing Auto Discount': pickFirst(homeRow['Enhance Pricing Auto Discount'])
      },
      note: {
        homeSubmission,
        autoSubmission,
        doneValue,
        autoValue,
        text: noteText
      },
      chooseSuccessfulTag: normalizeYes(doneValue) && normalizeYes(autoValue)
    };
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
  }

  function getStableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((token) => /^az-|^btn-|^ql-|^dropdown|^tag|^form|^input/.test(token))
      .slice(0, 4);
  }

  function buildFingerprint(el) {
    if (!(el instanceof Element)) return {};
    return {
      tag: String(el.tagName || '').toLowerCase(),
      id: norm(el.id || ''),
      name: norm(el.getAttribute('name') || ''),
      role: norm(el.getAttribute('role') || ''),
      ariaLabel: norm(el.getAttribute('aria-label') || ''),
      classTokens: getStableClassTokens(el),
      textFingerprint: norm((el.innerText || el.textContent || '').slice(0, 160))
    };
  }

  function isUniqueSelector(selector) {
    try { return document.querySelectorAll(selector).length === 1; }
    catch { return false; }
  }

  function buildStableSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return `#${cssEscape(el.id)}`;

    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const role = norm(el.getAttribute('role') || '');
    const aria = norm(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const selector = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    let current = el;
    const parts = [];
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += `#${cssEscape(current.id)}`;
        parts.unshift(part);
        break;
      }

      const classes = getStableClassTokens(current);
      if (classes.length) part += '.' + classes.map(cssEscape).join('.');

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }

      parts.unshift(part);
      const selector = parts.join(' > ');
      if (isUniqueSelector(selector)) return selector;
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function matchFingerprint(record, el) {
    if (!(el instanceof Element)) return false;
    const saved = isPlainObject(record.fingerprint) ? record.fingerprint : {};
    const current = buildFingerprint(el);

    if (saved.id && current.id && saved.id === current.id) return true;

    let score = 0;
    let required = 0;

    if (saved.tag) { required += 1; if (saved.tag === current.tag) score += 1; }
    if (saved.name) { required += 1; if (saved.name === current.name) score += 1; }
    if (saved.role) { required += 1; if (saved.role === current.role) score += 1; }
    if (saved.ariaLabel) { required += 1; if (saved.ariaLabel === current.ariaLabel) score += 1; }
    if (Array.isArray(saved.classTokens) && saved.classTokens.length) {
      required += 1;
      const currentSet = new Set(current.classTokens || []);
      if (saved.classTokens.every((token) => currentSet.has(token))) score += 1;
    }
    if (saved.textFingerprint) {
      required += 1;
      const a = lower(saved.textFingerprint);
      const b = lower(current.textFingerprint);
      if (a && b && (a.includes(b) || b.includes(a))) score += 1;
    }

    if (required === 0) return true;
    if (required === 1) return score === 1;
    return score >= 2;
  }

  function findSavedElement(record) {
    if (!isPlainObject(record)) return null;
    const selector = norm(record.selector || '');
    if (!selector) return null;

    let nodes = [];
    try { nodes = Array.from(document.querySelectorAll(selector)); } catch {}
    const visibleNodes = nodes.filter(visible);
    for (const node of visibleNodes) {
      if (matchFingerprint(record, node)) return node;
    }
    return visibleNodes[0] || nodes[0] || null;
  }

  function resolveEditableTarget(baseEl) {
    if (!(baseEl instanceof Element)) return null;
    const selectors = [
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].join(', ');

    const candidates = [];
    const add = (el) => {
      if (el && el instanceof Element && !candidates.includes(el)) candidates.push(el);
    };

    add(baseEl);
    try { baseEl.matches(selectors) && add(baseEl); } catch {}
    try { baseEl.querySelectorAll(selectors).forEach(add); } catch {}
    const parent = baseEl.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control');
    try { parent?.querySelectorAll(selectors).forEach(add); } catch {}
    try { baseEl.parentElement?.querySelectorAll(selectors).forEach(add); } catch {}

    return candidates.find(visible) || null;
  }

  function dispatchFieldEvents(target) {
    for (const type of ['input', 'change', 'blur']) {
      try {
        const event = type === 'blur'
          ? new FocusEvent(type, { bubbles: true, composed: true })
          : new Event(type, { bubbles: true, composed: true });
        target.dispatchEvent(event);
      } catch {}
    }
  }

  function setNativeValue(target, value) {
    const proto = Object.getPrototypeOf(target);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(target, value);
    else target.value = value;
  }

  function verifyFieldValue(target, expected) {
    const want = norm(expected);

    if (target instanceof HTMLSelectElement) {
      return lower(target.value) === lower(expected) || lower(target.selectedOptions?.[0]?.textContent || '') === lower(expected) || (!want && !norm(target.value));
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return norm(target.value) === want;
    }

    if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
      return norm(target.innerText || target.textContent || '') === want;
    }

    return norm(target.textContent || '') === want;
  }

  async function setFieldValue(record, value) {
    const base = findSavedElement(record);
    if (!base) return { ok: false, reason: 'saved field target not found' };

    const target = resolveEditableTarget(base) || base;
    const nextValue = norm(value);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try { strongClick(target); } catch {}

      if (target instanceof HTMLSelectElement) {
        const options = Array.from(target.options || []);
        let match = options.find((opt) => lower(opt.textContent || '') === lower(nextValue) || lower(opt.value || '') === lower(nextValue));
        if (!match && nextValue) {
          match = options.find((opt) => lower(opt.textContent || '').includes(lower(nextValue)) || lower(nextValue).includes(lower(opt.textContent || '')));
        }
        target.value = match ? match.value : '';
        if (match) match.selected = true;
        dispatchFieldEvents(target);
      } else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        setNativeValue(target, '');
        dispatchFieldEvents(target);
        setNativeValue(target, nextValue);
        dispatchFieldEvents(target);
      } else if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
        target.textContent = nextValue;
        dispatchFieldEvents(target);
      } else {
        target.textContent = nextValue;
        dispatchFieldEvents(target);
      }

      await sleep(160);
      if (verifyFieldValue(target, nextValue)) return { ok: true };
    }

    return { ok: false, reason: 'value did not stick' };
  }

  async function ensureMainTab() {
    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found');
      return false;
    }

    showBootstrapTab(mainTab);
    log('Clicked: Main tab');

    const ready = await waitFor(() => {
      const pane = document.querySelector(SEL.mainPane);
      const form = document.querySelector(SEL.detailForm);
      const tab = document.querySelector(SEL.mainTab);
      const paneReady = !!(pane && (pane.classList.contains('active') || pane.classList.contains('show') || visible(pane)));
      const formReady = !!(form && visible(form));
      const tabReady = !!(tab && tab.classList.contains('active'));
      return paneReady || formReady || tabReady;
    }, CFG.mainReadyMs);

    if (!ready) {
      log('Main tab did not become ready');
      return false;
    }

    return true;
  }

  function findUpdateButton() {
    const bySelector = findVisibleElements(SEL.updateButton)[0];
    if (bySelector) return bySelector;
    return findByText(['button', 'a'], 'Update');
  }

  async function clickUpdateButton() {
    const button = findUpdateButton();
    if (!button) {
      log('Update button not found');
      return false;
    }
    strongClick(button);
    log('Clicked: Update');
    await sleep(CFG.updateSettleMs);
    return true;
  }

  function findNoteOpener() {
    let el = findVisibleElements(SEL.noteOpener)[0];
    if (el) return el;

    const icon = Array.from(document.querySelectorAll('i.fal.fa-sticky-note')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return null;
  }

  async function openNotePanel() {
    const opener = findNoteOpener();
    if (!opener) {
      log('Note opener not found');
      return false;
    }

    strongClick(opener);
    log('Clicked: Note opener');
    const editor = await waitFor(() => findVisibleElements(SEL.noteEditor)[0], 8000);
    if (!editor) {
      log('Note editor not found');
      return false;
    }
    return true;
  }

  async function fillNoteEditor(noteText) {
    const editor = await waitFor(() => findVisibleElements(SEL.noteEditor)[0], 4000);
    if (!editor) return false;

    const lines = noteText.split('\n');
    editor.innerHTML = lines.map((line) => `<p>${escapeHtml(line || '') || '<br>'}</p>`).join('');
    editor.classList.remove('ql-blank');
    dispatchFieldEvents(editor);
    await sleep(150);
    return norm(editor.innerText || editor.textContent || '') === norm(noteText);
  }

  function findPinToTop() {
    let el = findVisibleElements(SEL.pinTop)[0];
    if (el) return el;

    const icon = Array.from(document.querySelectorAll('i.fas.fa-thumbtack')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return findByText(['a', 'button'], 'Pin to top');
  }

  function findSaveNoteButton() {
    let el = findVisibleElements(SEL.saveNote)[0];
    if (el) return el;
    return findByText(['button', 'a'], 'Save Note');
  }

  async function addPinnedNote(noteText) {
    const opened = await openNotePanel();
    if (!opened) return false;

    const filled = await fillNoteEditor(noteText);
    if (!filled) log('Note editor value did not fully stick');
    else log('Filled note editor');

    const pin = findPinToTop();
    if (pin) {
      strongClick(pin);
      log('Clicked: Pin to top');
      await sleep(250);
    } else {
      log('Pin to top not found');
    }

    const saveBtn = findSaveNoteButton();
    if (!saveBtn) {
      log('Save Note button not found');
      return false;
    }

    strongClick(saveBtn);
    log('Clicked: Save Note');
    await sleep(CFG.noteSettleMs);
    return true;
  }

  function findTagOpener() {
    let el = findVisibleElements(SEL.tagOpener)[0];
    if (el) return el;

    const icon = Array.from(document.querySelectorAll('i.fal.fa-tag')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return null;
  }

  async function openTagPicker() {
    const opener = findTagOpener();
    if (!opener) {
      log('Tag opener not found');
      return false;
    }

    strongClick(opener);
    log('Clicked: Tag opener');
    await sleep(250);

    const dropdown = await waitFor(() => findVisibleElements(SEL.tagDropdown)[0], 5000);
    if (!dropdown) {
      log('Tag dropdown not found');
      return false;
    }

    strongClick(dropdown);
    log('Clicked: Tag dropdown');
    await sleep(300);
    return true;
  }

  function maybeTagAlreadyPresent(targetRecord) {
    const label = lower(targetRecord?.label || targetRecord?.fingerprint?.textFingerprint || '');
    if (!label) return false;
    return getOpenTicketInfo().tags.some((tag) => lower(tag).includes(label) || label.includes(lower(tag)));
  }

  async function clickSavedTagTarget(kind) {
    const targets = getTagTargets();
    const record = targets[kind];
    if (!isPlainObject(record)) {
      log(`Saved tag target missing: ${kind}`);
      return false;
    }

    if (maybeTagAlreadyPresent(record)) {
      log(`Tag already present: ${record.label || kind}`);
      return true;
    }

    const target = await waitFor(() => findSavedElement(record), 4000);
    if (!target) {
      log(`Tag target not found: ${record.label || kind}`);
      return false;
    }

    strongClick(target);
    log(`Clicked tag target: ${record.label || kind}`);
    await sleep(400);
    return true;
  }

  function findTagApplyButton() {
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible);
    return candidates.find((el) => {
      const text = lower(el.textContent || '');
      if (!text) return false;
      if (text.includes('save note')) return false;
      return text.includes('apply') || text === 'save' || text === 'done';
    }) || null;
  }

  async function maybeClickTagApplyButton() {
    const button = findTagApplyButton();
    if (!button) {
      log('No tag apply button detected, continuing');
      return true;
    }

    strongClick(button);
    log(`Clicked tag apply button: ${norm(button.textContent || '') || 'button'}`);
    await sleep(CFG.actionSettleMs);
    return true;
  }

  function computeRunRecord(runs, azId) {
    return isPlainObject(runs[azId]) ? deepClone(runs[azId]) : {};
  }

  function saveRunRecord(runs, azId, record) {
    runs[azId] = deepClone(record);
    saveRuns(runs);
  }

  async function fillTicketFields(data, runRecord, forceRun) {
    const targets = getFieldTargets();
    let changed = false;

    for (const label of FIELD_ORDER) {
      const value = norm(data.fields[label] || '');
      const result = await setFieldValue(targets[label], value);
      if (result.ok) {
        log(`Filled field: ${label}`);
        changed = true;
      } else {
        log(`Field failed: ${label} | ${result.reason}`);
      }
    }

    const updateOk = await clickUpdateButton();
    if (!updateOk) {
      log('Update step failed, continuing');
    }

    if (changed || updateOk || forceRun) {
      runRecord.fieldsUpdatedAt = nowIso();
    }
  }

  async function runWorkflow(forceRun = false) {
    const finalPayload = getFinalPayload();
    if (!finalPayload) {
      setStatus('Payload missing');
      return;
    }

    const data = extractWorkflowData(finalPayload);
    state.activeAzId = data.azId;

    if (!hasAllFieldTargets()) {
      setStatus('Field setup required');
      return;
    }
    if (!hasAllTagTargets()) {
      setStatus('Tag setup required');
      return;
    }

    const openTicket = getOpenTicketInfo();
    if (!openTicket.ticketId) {
      setStatus('Waiting for open ticket');
      return;
    }
    if (data.azId && openTicket.ticketId !== data.azId) {
      setStatus(`Waiting for ticket ${data.azId}`);
      return;
    }

    const runs = readRuns();
    const runRecord = computeRunRecord(runs, data.azId);
    if (!forceRun && runRecord.completedAt) {
      setStatus('Already completed');
      return;
    }

    state.busy = true;
    renderAll();
    setStatus(forceRun ? 'Force running' : 'Running finisher');
    log(`Running finisher for AZ ${data.azId}${forceRun ? ' (force)' : ''}`);

    try {
      const mainOk = await ensureMainTab();
      if (!mainOk) {
        setStatus('Main tab failed');
        return;
      }

      if (forceRun || !runRecord.fieldsUpdatedAt) {
        await fillTicketFields(data, runRecord, forceRun);
        saveRunRecord(runs, data.azId, runRecord);
      } else {
        log('Fields already updated for this AZ ID, skipping field fill');
      }

      if (forceRun || !runRecord.noteSavedAt) {
        const noteOk = await addPinnedNote(data.note.text);
        if (noteOk) {
          runRecord.noteSavedAt = nowIso();
          saveRunRecord(runs, data.azId, runRecord);
          log('Pinned note saved');
        } else {
          log('Pinned note step failed');
        }
      } else {
        log('Pinned note already saved for this AZ ID, skipping note step');
      }

      if (forceRun || !runRecord.tagAppliedAt) {
        const tagOpened = await openTagPicker();
        if (tagOpened) {
          const targetKey = data.chooseSuccessfulTag ? 'successfulTag' : 'failedTag';
          const tagOk = await clickSavedTagTarget(targetKey);
          if (tagOk) {
            await maybeClickTagApplyButton();
            runRecord.tagAppliedAt = nowIso();
            saveRunRecord(runs, data.azId, runRecord);
            log(`Applied tag: ${data.chooseSuccessfulTag ? 'Successful Quote' : 'Failed Quote'}`);
          } else {
            log('Tag selection failed');
          }
        }
      } else {
        log('Tag already applied for this AZ ID, skipping tag step');
      }

      if (runRecord.fieldsUpdatedAt && runRecord.noteSavedAt && runRecord.tagAppliedAt) {
        runRecord.completedAt = nowIso();
        runRecord.payloadSavedAt = data.payloadSavedAt;
        saveRunRecord(runs, data.azId, runRecord);
        requestWorkflowCleanup(data.azId);
        setStatus('Completed');
        log(`Ticket finishing complete for AZ ${data.azId}`);
      } else {
        setStatus('Partial completion');
      }
    } finally {
      state.busy = false;
      state.forceRunRequested = false;
      renderAll();
    }
  }

  function tick() {
    if (state.destroyed || state.busy || state.picker) {
      renderAll();
      return;
    }

    if (!state.running) {
      setStatus('Stopped');
      renderAll();
      return;
    }

    const finalPayload = getFinalPayload();
    if (!finalPayload) {
      setStatus('Payload missing');
      renderAll();
      return;
    }

    state.activeAzId = finalPayload.azId;

    if (!hasAllFieldTargets()) {
      setStatus('Field setup required');
      renderAll();
      return;
    }

    if (!hasAllTagTargets()) {
      setStatus('Tag setup required');
      renderAll();
      return;
    }

    const runs = readRuns();
    const record = computeRunRecord(runs, finalPayload.azId);
    if (record.completedAt && !state.forceRunRequested) {
      setStatus('Already completed');
      renderAll();
      return;
    }

    const payloadKey = finalPayload.payloadKey;
    const shouldRun = state.forceRunRequested || state.lastPayloadSeenKey !== payloadKey || !record.completedAt;
    if (shouldRun) {
      state.lastPayloadSeenKey = payloadKey;
      runWorkflow(state.forceRunRequested).catch((err) => {
        log(`Workflow failed: ${err?.message || err}`);
        setStatus('Workflow failed');
        state.busy = false;
        state.forceRunRequested = false;
        renderAll();
      });
    }

    renderAll();
  }

  function ensureHoverBox() {
    if (state.hoverBox) return;
    const box = document.createElement('div');
    box.setAttribute(UI_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex),
      pointerEvents: 'none',
      border: '2px solid rgba(248,113,113,0.95)',
      background: 'rgba(252,165,165,0.16)',
      borderRadius: '6px',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBox = box;
  }

  function isUiElement(el) {
    return !!(el instanceof Element && el.closest(`[${UI_ATTR}="1"]`));
  }

  function getSelectableTargetFromPath(path) {
    for (const item of path || []) {
      if (item instanceof Element && !isUiElement(item) && visible(item)) {
        return item;
      }
    }
    return null;
  }

  function updateHoverBox(target) {
    if (!state.hoverBox) return;
    if (!target || !(target instanceof Element)) {
      state.hoverBox.style.display = 'none';
      return;
    }

    const rect = target.getBoundingClientRect();
    state.hoverBox.style.display = 'block';
    state.hoverBox.style.left = `${rect.left}px`;
    state.hoverBox.style.top = `${rect.top}px`;
    state.hoverBox.style.width = `${rect.width}px`;
    state.hoverBox.style.height = `${rect.height}px`;
  }

  function startPicker(type) {
    if (state.busy || state.picker) return;

    state.picker = {
      type,
      items: type === 'fields' ? FIELD_ORDER.map((label) => ({ key: label, label })) : TAG_ORDER.map((item) => deepClone(item)),
      index: 0
    };

    ensureHoverBox();
    state.pickerMove = (event) => {
      const target = getSelectableTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      state.hoveredEl = target;
      updateHoverBox(target);
    };

    state.pickerClick = (event) => {
      const target = getSelectableTargetFromPath(event.composedPath ? event.composedPath() : [event.target]);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handlePickerSelection(target);
    };

    state.pickerKeydown = (event) => {
      if (event.key === 'Escape') {
        stopPicker('Picker canceled');
      }
    };

    document.addEventListener('mousemove', state.pickerMove, true);
    document.addEventListener('click', state.pickerClick, true);
    document.addEventListener('keydown', state.pickerKeydown, true);

    const current = state.picker.items[state.picker.index];
    setStatus(`Picker: click ${current.label}`);
    log(`Picker started: click ${current.label}`);
    renderAll();
  }

  function stopPicker(message, logIt = true) {
    if (!state.picker) return;

    document.removeEventListener('mousemove', state.pickerMove, true);
    document.removeEventListener('click', state.pickerClick, true);
    document.removeEventListener('keydown', state.pickerKeydown, true);
    state.pickerMove = null;
    state.pickerClick = null;
    state.pickerKeydown = null;
    state.picker = null;
    state.hoveredEl = null;
    updateHoverBox(null);

    if (logIt && message) log(message);
    setStatus(state.running ? 'Waiting for mirrored payload' : 'Stopped');
    renderAll();
  }

  function handlePickerSelection(target) {
    if (!state.picker) return;
    const item = state.picker.items[state.picker.index];
    const selector = buildStableSelector(target);
    if (!selector) {
      log('Picker failed: could not build stable selector');
      return;
    }

    const record = {
      selector,
      fingerprint: buildFingerprint(target),
      label: norm(target.innerText || target.textContent || '') || item.label,
      savedAt: nowIso()
    };

    if (state.picker.type === 'fields') {
      const targets = getFieldTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.fieldTargets, targets);
    } else {
      const targets = getTagTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.tagTargets, targets);
    }

    log(`Saved target: ${item.label}`);

    state.picker.index += 1;
    if (state.picker.index >= state.picker.items.length) {
      stopPicker(state.picker.type === 'fields' ? 'Field targets saved' : 'Tag targets saved');
      return;
    }

    const next = state.picker.items[state.picker.index];
    setStatus(`Picker: click ${next.label}`);
    log(`Next target: ${next.label}`);
  }

  function resetFieldTargets() {
    saveTargets(GM_KEYS.fieldTargets, {});
    log('Field targets reset');
    renderAll();
  }

  function resetTagTargets() {
    saveTargets(GM_KEYS.tagTargets, {});
    log('Tag targets reset');
    renderAll();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildUi() {
    const panel = document.createElement('div');
    panel.id = 'tm-az-ticket-finisher-panel';
    panel.setAttribute(UI_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15, 23, 42, 0.97)',
      color: '#e5e7eb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '16px',
      boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
      font: '12px/1.45 Segoe UI, Tahoma, Arial, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div ${UI_ATTR}="1" id="tm-az-ticket-finisher-head" style="padding:10px 12px;background:linear-gradient(90deg,#111827,#1f2937);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div ${UI_ATTR}="1">
          <div ${UI_ATTR}="1" style="font-weight:800;">${SCRIPT_NAME}</div>
          <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">MAIN + fields + note + tag finisher</div>
        </div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:12px;">
        <div ${UI_ATTR}="1" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-force" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">FORCE RUN</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-set-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0891b2;color:#fff;font-weight:800;cursor:pointer;">SET FIELD TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-reset-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET FIELD TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-set-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#f59e0b;color:#111827;font-weight:800;cursor:pointer;">SET TAG TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-ticket-finisher-reset-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET TAG TARGETS</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-az-ticket-finisher-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Waiting for mirrored payload</div>
        <div ${UI_ATTR}="1" style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div ${UI_ATTR}="1" style="opacity:.72;">AZ ID</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-azid">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Payload</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-payload">Missing</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Field targets</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-fields">Missing</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Tag targets</div><div ${UI_ATTR}="1" id="tm-az-ticket-finisher-tags">Missing</div>
        </div>
        <textarea ${UI_ATTR}="1" id="tm-az-ticket-finisher-logs" readonly style="width:100%;min-height:160px;max-height:220px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-az-ticket-finisher-head');
    state.ui.toggle = panel.querySelector('#tm-az-ticket-finisher-toggle');
    state.ui.force = panel.querySelector('#tm-az-ticket-finisher-force');
    state.ui.setFields = panel.querySelector('#tm-az-ticket-finisher-set-fields');
    state.ui.resetFields = panel.querySelector('#tm-az-ticket-finisher-reset-fields');
    state.ui.setTags = panel.querySelector('#tm-az-ticket-finisher-set-tags');
    state.ui.resetTags = panel.querySelector('#tm-az-ticket-finisher-reset-tags');
    state.ui.status = panel.querySelector('#tm-az-ticket-finisher-status');
    state.ui.azId = panel.querySelector('#tm-az-ticket-finisher-azid');
    state.ui.payload = panel.querySelector('#tm-az-ticket-finisher-payload');
    state.ui.fields = panel.querySelector('#tm-az-ticket-finisher-fields');
    state.ui.tags = panel.querySelector('#tm-az-ticket-finisher-tags');
    state.ui.logs = panel.querySelector('#tm-az-ticket-finisher-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);
      if (!state.running) {
        setStatus('Stopped');
        log('Monitoring stopped');
      } else {
        setStatus('Waiting for mirrored payload');
        log('Monitoring started');
        tick();
      }
      renderAll();
    });

    state.ui.force?.addEventListener('click', () => {
      state.forceRunRequested = true;
      log('Force run requested');
      tick();
    });

    state.ui.setFields?.addEventListener('click', () => startPicker('fields'));
    state.ui.resetFields?.addEventListener('click', resetFieldTargets);
    state.ui.setTags?.addEventListener('click', () => startPicker('tags'));
    state.ui.resetTags?.addEventListener('click', resetTagTargets);
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.value = state.logs.join('\n');
    state.ui.logs.scrollTop = 0;
  }

  function renderAll() {
    const payload = getFinalPayload();
    if (state.ui.azId) state.ui.azId.textContent = norm(state.activeAzId || payload?.azId || '-') || '-';
    if (state.ui.payload) state.ui.payload.textContent = payload ? 'Found' : 'Missing';
    if (state.ui.fields) state.ui.fields.textContent = hasAllFieldTargets() ? 'Saved' : 'Missing';
    if (state.ui.tags) state.ui.tags.textContent = hasAllTagTargets() ? 'Saved' : 'Missing';

    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }

    if (state.ui.force) {
      state.ui.force.disabled = state.busy;
      state.ui.force.style.opacity = state.busy ? '0.65' : '1';
    }

    renderLogs();
  }

  function persistPanelPos() {
    if (!state.panel) return;
    try {
      localStorage.setItem(LS_KEYS.panelPos, JSON.stringify({
        left: state.panel.style.left || '',
        top: state.panel.style.top || '',
        right: state.panel.style.right || '',
        bottom: state.panel.style.bottom || ''
      }));
    } catch {}
  }

  function restorePanelPos() {
    try {
      const saved = readJson(localStorage.getItem(LS_KEYS.panelPos), null);
      if (!isPlainObject(saved) || !state.panel) return;
      if (saved.left) state.panel.style.left = saved.left;
      if (saved.top) state.panel.style.top = saved.top;
      if (saved.right) state.panel.style.right = saved.right;
      if (saved.bottom) state.panel.style.bottom = saved.bottom;
      keepPanelInView();
    } catch {}
  }

  function keepPanelInView() {
    if (!state.panel) return;
    const rect = state.panel.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    const margin = 8;

    if (rect.right > window.innerWidth - margin) left -= (rect.right - (window.innerWidth - margin));
    if (rect.bottom > window.innerHeight - margin) top -= (rect.bottom - (window.innerHeight - margin));
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    state.panel.style.left = `${left}px`;
    state.panel.style.top = `${top}px`;
    state.panel.style.right = 'auto';
    state.panel.style.bottom = 'auto';
    persistPanelPos();
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    let drag = null;

    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
      };
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(8, event.clientX - drag.dx)}px`;
      panel.style.top = `${Math.max(8, event.clientY - drag.dy)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }, true);

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      keepPanelInView();
    }, true);
  }
})();
