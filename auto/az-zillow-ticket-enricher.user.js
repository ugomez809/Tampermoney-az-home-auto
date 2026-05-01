// ==UserScript==
// @name         13 AUTO AgencyZoom Zillow Ticket Enricher
// @namespace    autoflow.az-zillow-ticket-enricher
// @version      1.0.0
// @description  AUTO-only Zillow enricher. Opens the Ingored v2 AgencyZoom pipeline ticket, searches Zillow for the Main address, fills selected Zillow fields back into the ticket, and replaces BQ/BQF with dotted tag targets.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://www.zillow.com/*
// @match        https://zillow.com/*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/az-zillow-ticket-enricher.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/az-zillow-ticket-enricher.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__AZ_ZILLOW_TICKET_ENRICHER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = '13 AUTO AgencyZoom Zillow Ticket Enricher';
  const VERSION = '1.0.0';
  const UI_ATTR = 'data-tm-az-zillow-ticket-enricher-ui';

  const GM_KEYS = {
    job: 'tm_az_zillow_ticket_enricher_job_v1',
    fieldTargets: 'tm_az_zillow_ticket_enricher_field_targets_v1',
    tagTargets: 'tm_az_zillow_ticket_enricher_tag_targets_v1'
  };

  const LS_KEYS = {
    running: 'tm_az_zillow_ticket_enricher_running_v1',
    panelPos: 'tm_az_zillow_ticket_enricher_panel_pos_v1'
  };

  const SS_KEYS = {
    bootstrapReload: 'tm_az_zillow_ticket_enricher_bootstrap_reload_v1'
  };

  const FIELD_ORDER = [
    'Zillow URL',
    'Bedrooms',
    'Bathrooms',
    'Home Type'
  ];

  const TAG_ORDER = [
    { key: 'bqDotTag', label: 'BQ replacement tag (BQ.)' },
    { key: 'bqfDotTag', label: 'BQF replacement tag (BQF.)' }
  ];

  const LEGACY_TAG_RULES = [
    { sourceLabel: 'BQ', targetKey: 'bqDotTag' },
    { sourceLabel: 'BQF', targetKey: 'bqfDotTag' }
  ];

  const CFG = {
    savedQueryName: 'Ingored v2',
    savedQueryDataId: '79210',
    savedQueryUrlNeedle: 'tags=310769,310770',
    tickMs: 900,
    stepPollMs: 150,
    mainReadyMs: 10000,
    filterSettleMs: 1500,
    actionSettleMs: 900,
    updateSettleMs: 1200,
    closeWaitMs: 5000,
    zillowWaitMs: 45000,
    maxLogLines: 80,
    panelWidth: 390,
    zIndex: 2147483647
  };

  const SEL = {
    stageCards: '.dd-card.referral-container[data-id]',
    customerLink: 'a.customer[rel], a.customer',

    savedQueryButton: '#currentPipelineFilter .savedQueryDropdown > button.dropdown-toggle',
    savedQueryLabel: '#currentPipelineFilter .savedQueryDropdown .editing_filter_name',
    savedQueryWrap: '#currentPipelineFilter .dropdown.savedQueryDropdown',
    savedQueryItems: '#currentPipelineFilter .saved-query-item, #currentPipelineFilter .dropdown-item.saved-query-item',

    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    dockSideActions: '.az-dock__side-actions',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',
    vendorSync: '.origin-vendor-sync, [class*="vendor-sync"], [class*="origin-vendor"]',

    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    initialValues: '#detailDockform input[name="initialValues"]',
    updateButton: 'button.btn.btn-primary.action[onclick*="leadDetailTab.doSave"], button.action[onclick*="doSave"]',

    tagOpener: 'a.btn-tag.az-tooltip.tooltipstered, a.btn-tag',
    tagForm: '#add-tag-form',
    tagDropdown: '#add-tag-form > div > div > div.az-form-group.az-tags-select.mb-2 > div > button, button.btn.dropdown-toggle.btn-light[data-toggle="dropdown"][role="combobox"], button.dropdown-toggle.btn-light[role="combobox"], button.dropdown-toggle[role="combobox"]',

    closeCandidates: 'button, a, [role="button"], .close, .btn-close, .az-dock__close'
  };

  const state = {
    destroyed: false,
    running: loadRunning(),
    busy: false,
    logs: [],
    panel: null,
    ui: {},
    picker: null,
    pickerMove: null,
    pickerClick: null,
    pickerKeydown: null,
    hoverBox: null,
    hoveredEl: null,
    tickTimer: null,
    activeTicketId: '',
    currentAddress: '',
    zillowSummary: '',
    lastStatus: ''
  };

  init();

  function init() {
    const resumedAfterReload = consumeBootstrapReloadToken();

    if (isAzOrigin()) {
      buildUi();
      bindUi();
      restorePanelPos();
      ensureHoverBox();
      renderAll();
    }

    log(`Loaded v${VERSION} on ${location.hostname}`);
    if (resumedAfterReload) {
      log('Resumed after bootstrap reload');
    }

    if (isAzOrigin()) {
      setStatus(state.running ? 'Ready' : 'Stopped');
      state.tickTimer = setInterval(tick, CFG.tickMs);
      tick();
    } else if (isZillowOrigin()) {
      state.tickTimer = setInterval(zillowTick, CFG.tickMs);
      zillowTick();
    }

    window.__AZ_ZILLOW_TICKET_ENRICHER_CLEANUP__ = cleanup;
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.tickTimer); } catch {}
    stopPicker('', false);
    try { state.hoverBox?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__AZ_ZILLOW_TICKET_ENRICHER_CLEANUP__; } catch {}
  }

  function isAzOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isZillowOrigin() {
    return /(^|\.)zillow\.com$/i.test(location.hostname);
  }

  function isPipelinePage() {
    return /\/referral\/pipeline/i.test(location.pathname + location.search);
  }

  function loadRunning() {
    try { return localStorage.getItem(LS_KEYS.running) === '1'; } catch { return false; }
  }

  function saveRunning(on) {
    try {
      if (on) localStorage.setItem(LS_KEYS.running, '1');
      else localStorage.removeItem(LS_KEYS.running);
    } catch {}
  }

  function readGM(key, fallback = null) {
    try {
      const value = GM_getValue(key, fallback);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeGM(key, value) {
    try { GM_setValue(key, value); } catch {}
  }

  function deleteGM(key) {
    try { GM_deleteValue(key); } catch {}
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

  function getJob() {
    const value = readGM(GM_KEYS.job, null);
    return isPlainObject(value) ? value : null;
  }

  function saveJob(job) {
    if (!isPlainObject(job)) return;
    writeGM(GM_KEYS.job, deepClone(job));
  }

  function clearJob() {
    deleteGM(GM_KEYS.job);
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

  function cleanTagText(value) {
    return norm(value)
      .replace(/\s+/g, ' ')
      .replace(/[|,;]+$/g, '')
      .trim();
  }

  function lowerTagText(value) {
    return cleanTagText(value).toLowerCase();
  }

  function firstNonEmpty(...values) {
    for (const value of values) {
      const text = norm(value);
      if (text) return text;
    }
    return '';
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function log(message) {
    const line = `[${timeNow()}] ${norm(message)}`;
    state.logs.push(line);
    if (state.logs.length > CFG.maxLogLines) {
      state.logs.splice(0, state.logs.length - CFG.maxLogLines);
    }
    renderLogs();
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
  }

  function setStatus(text) {
    state.lastStatus = norm(text || '');
    if (state.ui.status) state.ui.status.textContent = state.lastStatus || '-';
  }

  function renderLogs() {
    if (!state.ui.logs) return;
    state.ui.logs.value = state.logs.join('\n');
    state.ui.logs.scrollTop = state.ui.logs.scrollHeight;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
  }

  function getStableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((token) => /^az-|^btn-|^ql-|^dropdown|^tag|^form|^input|^editable/i.test(token))
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

    const insideTagForm = !!el.closest(SEL.tagForm);
    const role = norm(el.getAttribute('role') || '');
    const classList = Array.from(el.classList || []);
    const isDropdownOption = insideTagForm && (
      role === 'option' ||
      classList.includes('dropdown-item') ||
      !!el.closest('.dropdown-menu')
    );

    if (isDropdownOption) {
      const tag = el.tagName.toLowerCase();
      const classSelector = classList.includes('dropdown-item') ? '.dropdown-item' : '';
      return `${SEL.tagForm} ${tag}${classSelector}${role ? `[role="${cssEscape(role)}"]` : ''}`;
    }

    if (el.id) return `#${cssEscape(el.id)}`;

    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const selector = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

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
    const saved = isPlainObject(record?.fingerprint) ? record.fingerprint : {};
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
      '[role="textbox"]',
      '.editable-container input:not([type="hidden"]):not([disabled])',
      '.editable-container textarea:not([disabled])',
      '.editable-container select:not([disabled])',
      '.editableform input:not([type="hidden"]):not([disabled])',
      '.editableform textarea:not([disabled])',
      '.editableform select:not([disabled])',
      '.popover input:not([type="hidden"]):not([disabled])',
      '.popover textarea:not([disabled])',
      '.popover select:not([disabled])'
    ].join(', ');

    const candidates = [];
    const add = (el) => {
      if (el && el instanceof Element && !candidates.includes(el)) candidates.push(el);
    };

    const group = baseEl.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control');
    const bootstrapSelect = baseEl.closest('.bootstrap-select') || group?.querySelector?.('.bootstrap-select');

    try { baseEl.matches(selectors) && add(baseEl); } catch {}
    try { baseEl.querySelectorAll(selectors).forEach(add); } catch {}
    try { group?.querySelectorAll(selectors).forEach(add); } catch {}
    try { baseEl.parentElement?.querySelectorAll(selectors).forEach(add); } catch {}
    try { bootstrapSelect?.parentElement?.querySelectorAll('select:not([disabled])').forEach(add); } catch {}
    try {
      const active = document.activeElement;
      if (active instanceof Element && (active === baseEl || baseEl.contains(active) || active.closest('.form-group, .form-row, .row, .col, td, tr, label, .input-group, .bootstrap-select, .form-control') === group)) {
        add(active);
      }
    } catch {}

    const score = (el) => {
      if (!(el instanceof Element)) return -1;
      let points = 0;
      if (el instanceof HTMLSelectElement) points += 8;
      else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) points += 7;
      else if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') points += 6;
      else points += 1;
      if (visible(el)) points += 3;
      if (el === document.activeElement) points += 5;
      if (el !== baseEl) points += 2;
      if (bootstrapSelect && (bootstrapSelect.contains(el) || el.closest('.bootstrap-select') === bootstrapSelect)) points += 2;
      if (el.closest('.editable-container, .editableform, .popover')) points += 4;
      return points;
    };

    return candidates.sort((a, b) => score(b) - score(a))[0] || baseEl;
  }

  function dispatchFieldEvents(target) {
    for (const type of ['focus', 'input', 'change', 'blur']) {
      try {
        const event = type === 'blur' || type === 'focus'
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
      return lower(target.value) === lower(expected)
        || lower(target.selectedOptions?.[0]?.textContent || '') === lower(expected)
        || (!want && !norm(target.value));
    }

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return norm(target.value) === want;
    }

    if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
      return norm(target.innerText || target.textContent || '') === want;
    }

    return norm(target.textContent || '') === want;
  }

  async function waitForEditableTarget(base) {
    const started = Date.now();
    let chosen = null;
    while ((Date.now() - started) < 2200) {
      chosen = resolveEditableTarget(base) || base;
      if (
        chosen instanceof HTMLInputElement ||
        chosen instanceof HTMLTextAreaElement ||
        chosen instanceof HTMLSelectElement ||
        chosen.getAttribute?.('contenteditable') === 'true' ||
        chosen.getAttribute?.('role') === 'textbox'
      ) {
        return chosen;
      }
      await sleep(120);
    }
    return chosen || base;
  }

  async function setFieldValue(record, value) {
    const base = findSavedElement(record);
    if (!base) return { ok: false, reason: 'saved field target not found' };

    const nextValue = norm(value);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try { strongClick(base); } catch {}
      await sleep(180);
      const target = await waitForEditableTarget(base);
      const editableTarget = target instanceof HTMLSelectElement
        || target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target.getAttribute?.('contenteditable') === 'true'
        || target.getAttribute?.('role') === 'textbox';

      if (!editableTarget) {
        await sleep(220);
        continue;
      }

      if (target instanceof HTMLSelectElement) {
        const options = Array.from(target.options || []);
        let match = options.find((opt) => lower(opt.textContent || '') === lower(nextValue) || lower(opt.value || '') === lower(nextValue));
        if (!match && nextValue) {
          match = options.find((opt) => lower(opt.textContent || '').includes(lower(nextValue)) || lower(nextValue).includes(lower(opt.textContent || '')));
        }
        target.value = match ? match.value : '';
        if (match) match.selected = true;
        try { target.setAttribute('value', target.value); } catch {}
        dispatchFieldEvents(target);
      } else if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        try { target.focus({ preventScroll: true }); } catch {}
        setNativeValue(target, '');
        try { target.setAttribute('value', ''); } catch {}
        dispatchFieldEvents(target);
        setNativeValue(target, nextValue);
        try { target.setAttribute('value', nextValue); } catch {}
        dispatchFieldEvents(target);
      } else if (target.getAttribute('contenteditable') === 'true' || target.getAttribute('role') === 'textbox') {
        target.innerHTML = nextValue ? `<p>${escapeHtml(nextValue)}</p>` : '<p><br></p>';
        dispatchFieldEvents(target);
      }

      await sleep(220);
      if (verifyFieldValue(target, nextValue)) return { ok: true };
    }

    return { ok: false, reason: 'editable target not found or value did not stick' };
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
      const started = Date.now();
      const loop = () => {
        if (state.destroyed) return resolve(null);
        try {
          const result = fn();
          if (result) return resolve(result);
        } catch {}
        if ((Date.now() - started) >= timeoutMs) return resolve(null);
        setTimeout(loop, intervalMs);
      };
      loop();
    });
  }

  function findVisibleElements(selector) {
    try { return Array.from(document.querySelectorAll(selector)).filter(visible); }
    catch { return []; }
  }

  function scoreDockRoot(root) {
    if (!(root instanceof Element) || !visible(root)) return -1;
    let score = 0;
    if (root.matches('#serviceDetailDock')) score += 8;
    if (root.querySelector(SEL.detailForm)) score += 6;
    if (root.querySelector(SEL.topName)) score += 5;
    if (root.querySelector(SEL.vendorSync)) score += 5;
    if (extractTicketIdFromText(root.textContent || '')) score += 4;
    if (root.querySelector(SEL.tagOpener)) score += 2;
    if (root.querySelector(SEL.mainTab)) score += 2;
    if (root.matches('#notePanelContainer')) score -= 4;
    if (root.matches('.az-dock__top')) score -= 2;
    return score;
  }

  function getOpenDockRoot() {
    const seen = new Set();
    const candidates = [];
    for (const root of Array.from(document.querySelectorAll(SEL.dockRoot))) {
      if (!(root instanceof Element) || seen.has(root)) continue;
      seen.add(root);
      candidates.push(root);
    }
    if (!candidates.length) return null;

    let best = null;
    let bestScore = -1;
    for (const root of candidates) {
      const score = scoreDockRoot(root);
      if (score > bestScore) {
        best = root;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  function extractTicketIdFromText(text) {
    const clean = norm(text || '');
    if (!clean) return '';
    const match = clean.match(/\bID:\s*(\d{5,})\b/i) || clean.match(/\b(\d{5,})\b/);
    return match ? match[1] : '';
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
    const syncNode = root.querySelector(SEL.vendorSync);
    ticketId = extractTicketIdFromText(syncNode?.textContent || '');
    if (!ticketId) ticketId = extractTicketIdFromText(root.textContent || '');

    const tags = Array.from(root.querySelectorAll(SEL.topTags))
      .map((el) => norm(el.textContent))
      .filter(Boolean);

    return { ticketId, name, tags };
  }

  function isTicketDrawerOpen() {
    const side = document.querySelector(SEL.dockSideActions);
    return !!(side && visible(side));
  }

  function getCurrentSavedQueryLabel() {
    return norm(document.querySelector(SEL.savedQueryLabel)?.textContent || document.querySelector(SEL.savedQueryButton)?.textContent || '');
  }

  function isIgnoredV2Selected() {
    return lower(getCurrentSavedQueryLabel()) === lower(CFG.savedQueryName);
  }

  function isSavedQueryDropdownOpen() {
    const wrap = document.querySelector(SEL.savedQueryWrap);
    const btn = document.querySelector(SEL.savedQueryButton);
    return !!(
      wrap?.classList.contains('show') ||
      String(btn?.getAttribute('aria-expanded') || '').toLowerCase() === 'true'
    );
  }

  function findIgnoredV2Option() {
    return Array.from(document.querySelectorAll(SEL.savedQueryItems))
      .filter(visible)
      .find((el) => {
        const text = lower(el.textContent || '');
        const dataId = norm(el.getAttribute('data-id') || '');
        const url = lower(el.getAttribute('url') || '');
        return text === lower(CFG.savedQueryName)
          || dataId === CFG.savedQueryDataId
          || url.includes(lower(CFG.savedQueryUrlNeedle));
      }) || null;
  }

  async function openSavedQueryDropdown() {
    const btn = document.querySelector(SEL.savedQueryButton);
    if (!btn || !visible(btn)) {
      log('Saved query filter button not found');
      return false;
    }

    if (isSavedQueryDropdownOpen()) return true;

    strongClick(btn);
    await sleep(220);
    if (isSavedQueryDropdownOpen()) return true;

    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $(btn).dropdown === 'function') {
        $(btn).dropdown('toggle');
        await sleep(220);
        if (isSavedQueryDropdownOpen()) return true;
      }
    } catch {}

    return isSavedQueryDropdownOpen();
  }

  async function ensureIgnoredV2Filter() {
    if (isIgnoredV2Selected()) return true;

    const opened = await openSavedQueryDropdown();
    if (!opened) {
      log(`Could not open saved query dropdown for ${CFG.savedQueryName}`);
      return false;
    }

    const item = findIgnoredV2Option();
    if (!item) {
      log(`Saved query option not found: ${CFG.savedQueryName}`);
      return false;
    }

    strongClick(item);
    log(`Selected saved query: ${CFG.savedQueryName}`);

    const started = Date.now();
    while ((Date.now() - started) < 6000) {
      if (state.destroyed) return false;
      if (isIgnoredV2Selected()) {
        await sleep(CFG.filterSettleMs);
        return true;
      }
      await sleep(120);
    }

    log(`Saved query did not switch to ${CFG.savedQueryName}`);
    return false;
  }

  function getVisibleStageCards() {
    return Array.from(document.querySelectorAll(SEL.stageCards)).filter(visible);
  }

  async function waitForOpenTicket(ticketId, timeoutMs = 4200) {
    const started = Date.now();
    let drawerSeenAt = 0;

    while ((Date.now() - started) < timeoutMs) {
      if (state.destroyed) return false;
      const info = getOpenTicketInfo();
      if (String(info.ticketId || '') === String(ticketId || '')) return true;

      if (isTicketDrawerOpen()) {
        if (!drawerSeenAt) drawerSeenAt = Date.now();
        if ((Date.now() - drawerSeenAt) >= 2000) return true;
      } else {
        drawerSeenAt = 0;
      }

      await sleep(120);
    }

    return false;
  }

  async function openCard(card, ticketId) {
    const currentOpen = getOpenTicketInfo().ticketId;
    if (currentOpen && currentOpen === ticketId && isTicketDrawerOpen()) return true;

    const link = card.querySelector(SEL.customerLink);
    const targets = [link, card].filter(Boolean);

    for (const target of targets) {
      strongClick(target);
      log(`Opening ticket ${ticketId || '(unknown)'}`);
      const ok = await waitForOpenTicket(ticketId);
      if (ok) return true;
    }

    return false;
  }

  function parseInitialValuesJson() {
    const input = document.querySelector(SEL.initialValues);
    if (!input) return null;

    const raw = input.value || input.getAttribute('value') || '';
    if (!raw) return null;

    let parsed = safeJsonParse(raw, null);
    if (parsed) return parsed;

    parsed = safeJsonParse(htmlDecode(raw), null);
    return parsed || null;
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function htmlDecode(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function readVal(selector) {
    const el = document.querySelector(selector);
    return norm(el?.value || el?.textContent || '');
  }

  function readAzAddressInfo(fallbackTicketId = '') {
    const initial = parseInitialValuesJson() || {};
    const cr = initial?.CustomerReferral || {};
    const openInfo = getOpenTicketInfo();

    const street = firstNonEmpty(cr.address1, readVal('#customerreferral-address1'));
    const city = firstNonEmpty(cr.city, readVal('#customerreferral-city'));
    const stateValue = firstNonEmpty(cr.state, readVal('#state'));
    const postal = firstNonEmpty(cr.zip, readVal('#customerreferral-zip'));
    const ticketId = firstNonEmpty(initial?.id, initial?.instaId, openInfo.ticketId, fallbackTicketId);

    const cityStateZip = [city, [stateValue, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const address = [street, cityStateZip].filter(Boolean).join(', ').replace(/, ,/g, ',').trim();

    return {
      ticketId,
      street,
      city,
      state: stateValue,
      postal,
      address
    };
  }

  async function ensureMainTab() {
    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found');
      return false;
    }

    showBootstrapTab(mainTab);
    log('Clicked: Main tab');
    await sleep(500);

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
    return Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .filter(visible)
      .find((el) => lower(el.textContent || '') === 'update' || lower(el.textContent || '').includes('update')) || null;
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

  function findCloseButton() {
    const roots = [
      document.querySelector('#serviceDetailDock'),
      document.querySelector('#notePanelContainer'),
      document.querySelector('.az-dock'),
      document
    ].filter(Boolean);

    for (const root of roots) {
      const els = Array.from(root.querySelectorAll(SEL.closeCandidates)).filter(visible);
      for (const el of els) {
        const txt = norm([
          el.textContent,
          el.getAttribute?.('title'),
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('data-original-title')
        ].filter(Boolean).join(' '));
        const cls = String(el.className || '').toLowerCase();
        if (lower(txt) === 'close' || lower(txt).includes('close') || lower(txt) === 'x' || cls.includes('close')) {
          return el;
        }
      }
    }

    return null;
  }

  function fireEscape() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
      document.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true
      }));
    } catch {}
  }

  async function closeTicketDrawer() {
    if (!isTicketDrawerOpen()) return true;

    const before = getOpenTicketInfo().ticketId;
    const btn = findCloseButton();
    if (btn) strongClick(btn);
    else fireEscape();

    const started = Date.now();
    while ((Date.now() - started) < CFG.closeWaitMs) {
      if (state.destroyed) return true;
      if (!isTicketDrawerOpen()) {
        log(`Closed ticket drawer for ${before || 'current ticket'}`);
        return true;
      }
      await sleep(120);
    }

    log(`Close timed out for ${before || 'current ticket'}`);
    return false;
  }

  function hasAllFieldTargets() {
    const targets = getFieldTargets();
    return FIELD_ORDER.every((label) => isPlainObject(targets[label]) && norm(targets[label].selector));
  }

  function hasAllTagTargets() {
    const targets = getTagTargets();
    return TAG_ORDER.every((item) => isPlainObject(targets[item.key]) && (norm(targets[item.key].value) || cleanTagText(targets[item.key].label)));
  }

  function getFieldTargetStatusText() {
    const targets = getFieldTargets();
    const count = FIELD_ORDER.filter((label) => isPlainObject(targets[label]) && norm(targets[label].selector)).length;
    return `${count}/${FIELD_ORDER.length} saved`;
  }

  function getTagTargetStatusText() {
    const targets = getTagTargets();
    const count = TAG_ORDER.filter((item) => isPlainObject(targets[item.key]) && (norm(targets[item.key].value) || cleanTagText(targets[item.key].label))).length;
    return `${count}/${TAG_ORDER.length} saved`;
  }

  function normalizeRoomValue(value) {
    const text = norm(value);
    if (!text) return '';
    if (/studio/i.test(text)) return 'Studio';
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : text;
  }

  function normalizeHomeType(value) {
    const text = norm(value);
    if (!text) return '';
    const condensed = lower(text).replace(/[^a-z]/g, '');
    const map = {
      singlefamily: 'SingleFamily',
      multifamily: 'MultiFamily',
      townhouse: 'Townhouse',
      townhome: 'Townhome',
      condo: 'Condo',
      condominium: 'Condominium',
      apartment: 'Apartment',
      duplex: 'Duplex',
      triplex: 'Triplex',
      manufactured: 'Manufactured',
      mobilehome: 'MobileHome',
      coop: 'CoOp',
      cooperative: 'CoOp'
    };
    return map[condensed] || text.replace(/\s+/g, '');
  }

  function summarizeResult(result) {
    if (!isPlainObject(result)) return '-';
    const parts = [
      norm(result.bedrooms) ? `${norm(result.bedrooms)} bd` : '',
      norm(result.bathrooms) ? `${norm(result.bathrooms)} ba` : '',
      norm(result.homeType)
    ].filter(Boolean);
    return parts.join(' | ') || norm(result.zillowUrl || '') || '-';
  }

  function buildZillowSearchUrl(address) {
    return `https://www.zillow.com/homes/${encodeURIComponent(address)}`;
  }

  function isZillowListingPage() {
    return /\/homedetails\/|_zpid\//i.test(location.pathname + location.search);
  }

  function jobMatchesTicket(job, ticketId) {
    return norm(job?.ticketId || '') && norm(job?.ticketId || '') === norm(ticketId || '');
  }

  function createJob(ticketId, addressInfo) {
    const job = {
      ticketId: norm(ticketId || addressInfo?.ticketId || ''),
      address: norm(addressInfo?.address || ''),
      street: norm(addressInfo?.street || ''),
      city: norm(addressInfo?.city || ''),
      state: norm(addressInfo?.state || ''),
      postal: norm(addressInfo?.postal || ''),
      searchUrl: buildZillowSearchUrl(addressInfo?.address || ''),
      status: 'pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      result: null,
      error: ''
    };
    saveJob(job);
    return job;
  }

  function launchZillowSearch(job) {
    if (!isPlainObject(job) || !norm(job.searchUrl || '')) return false;
    job.status = 'searching';
    job.updatedAt = nowIso();
    job.searchOpenedAt = nowIso();
    saveJob(job);

    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(job.searchUrl, { active: true, insert: true, setParent: true });
        return true;
      }
    } catch {}

    try {
      const opened = window.open(job.searchUrl, '_blank');
      return !!opened;
    } catch {
      return false;
    }
  }

  function extractLabelValueFromBody(label) {
    const text = document.body?.innerText || '';
    if (!text) return '';
    const match = text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'));
    return match ? norm(match[1]) : '';
  }

  function extractHomeTypeFromBody() {
    const bodyText = document.body?.innerText || '';
    if (!bodyText) return '';
    const match = bodyText.match(/\b(SingleFamily|Single Family|MultiFamily|Multi Family|Townhouse|Townhome|Condo|Condominium|Apartment|Duplex|Triplex|Manufactured|Mobile Home|Co-Op|CoOp)\b/i);
    return match ? norm(match[1]) : '';
  }

  function extractRegexValue(text, patterns) {
    const source = String(text || '');
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match && norm(match[1])) return norm(match[1]);
    }
    return '';
  }

  function readZillowScriptHints() {
    const joined = Array.from(document.scripts || [])
      .map((script) => script.textContent || '')
      .join('\n');

    return {
      bedrooms: extractRegexValue(joined, [
        /"bedrooms?"\s*:\s*"?([0-9.]+)"?/i,
        /"beds?"\s*:\s*"?([0-9.]+)"?/i
      ]),
      bathrooms: extractRegexValue(joined, [
        /"bathrooms?"\s*:\s*"?([0-9.]+)"?/i,
        /"baths?"\s*:\s*"?([0-9.]+)"?/i
      ]),
      homeType: extractRegexValue(joined, [
        /"homeType"\s*:\s*"([^"]+)"/i,
        /"home_type"\s*:\s*"([^"]+)"/i,
        /"propertyType(?:Dimension)?"\s*:\s*"([^"]+)"/i
      ])
    };
  }

  function findLikelyZillowListingLink(job) {
    const streetNumber = firstNonEmpty(norm(job?.address || '').match(/^\d+/)?.[0]);
    const streetTokens = norm(job?.street || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !['street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr', 'lane', 'ln', 'court', 'ct', 'boulevard', 'blvd', 'circle', 'cir', 'place', 'pl', 'way', 'trail', 'trl', 'highway', 'hwy'].includes(token))
      .slice(0, 4);
    const cityToken = norm(job?.city || '').toLowerCase();
    const postalToken = norm(job?.postal || '').toLowerCase();
    const anchors = Array.from(document.querySelectorAll('a[href*="/homedetails/"], a[href*="_zpid/"], a[data-test="property-card-link"]'))
      .filter((el) => el instanceof HTMLAnchorElement && norm(el.href));

    let best = null;
    let bestScore = -1;
    for (const anchor of anchors) {
      const haystack = lower([anchor.href, anchor.textContent, anchor.getAttribute('aria-label')].filter(Boolean).join(' '));
      let score = 0;
      if (haystack.includes('/homedetails/')) score += 8;
      if (haystack.includes('_zpid')) score += 4;
      if (streetNumber && haystack.includes(lower(streetNumber))) score += 6;
      if (postalToken && haystack.includes(postalToken)) score += 6;
      if (cityToken && haystack.includes(cityToken)) score += 3;
      for (const token of streetTokens) {
        if (haystack.includes(token)) score += 2;
      }
      if (visible(anchor)) score += 2;
      if (score > bestScore) {
        best = anchor;
        bestScore = score;
      }
    }

    return bestScore >= 8 ? best : null;
  }

  function scrapeZillowResult() {
    const hints = readZillowScriptHints();
    const bedrooms = normalizeRoomValue(firstNonEmpty(
      extractLabelValueFromBody('Bedrooms'),
      hints.bedrooms
    ));
    const bathrooms = normalizeRoomValue(firstNonEmpty(
      extractLabelValueFromBody('Bathrooms'),
      hints.bathrooms
    ));
    const homeType = normalizeHomeType(firstNonEmpty(
      extractHomeTypeFromBody(),
      hints.homeType
    ));

    return {
      zillowUrl: location.href,
      bedrooms,
      bathrooms,
      homeType
    };
  }

  async function zillowTick() {
    if (state.destroyed || !isZillowOrigin()) return;

    const job = getJob();
    if (!isPlainObject(job)) return;
    if (!['pending', 'searching'].includes(norm(job.status || ''))) return;

    if (!isZillowListingPage()) {
      if (!norm(job.listingNavigatedAt || '')) {
        const listing = findLikelyZillowListingLink(job);
        if (listing?.href) {
          job.listingNavigatedAt = nowIso();
          job.updatedAt = nowIso();
          saveJob(job);
          try { location.assign(listing.href); } catch {}
          return;
        }
      }
      return;
    }

    const scraped = scrapeZillowResult();
    if (!norm(scraped.bedrooms) && !norm(scraped.bathrooms) && !norm(scraped.homeType)) {
      return;
    }

    job.status = 'result-ready';
    job.updatedAt = nowIso();
    job.resultReadyAt = nowIso();
    job.result = scraped;
    saveJob(job);

    try { console.log(`[${SCRIPT_NAME}] Zillow scrape ready for ${job.ticketId}: ${summarizeResult(scraped)}`); } catch {}
    setTimeout(() => {
      try { window.close(); } catch {}
    }, 250);
  }

  function getOpenTicketTagLabels() {
    return Array.from(new Set(
      (getOpenTicketInfo().tags || [])
        .map((tag) => cleanTagText(tag))
        .filter(Boolean)
    ));
  }

  function findTagOpener() {
    const direct = findVisibleElements(SEL.tagOpener)[0];
    if (direct) return direct;

    const icon = Array.from(document.querySelectorAll('i.fal.fa-tag')).find(visible);
    if (icon) return icon.closest('a,button,[role="button"]');

    return null;
  }

  function findTagDropdown() {
    const form = findVisibleElements(SEL.tagForm)[0];
    if (form) {
      const exactCandidates = [
        '#add-tag-form > div > div > div.az-form-group.az-tags-select.mb-2 > div > button',
        'div.az-form-group.az-tags-select.mb-2 > div > button',
        '.az-form-group.az-tags-select button.dropdown-toggle.btn-light',
        'button.dropdown-toggle.btn-light[data-toggle="dropdown"][role="combobox"]',
        'button.dropdown-toggle.btn-light[role="combobox"]',
        'button[role="combobox"]',
        'button.dropdown-toggle'
      ];

      for (const selector of exactCandidates) {
        try {
          const el = selector.startsWith('#add-tag-form')
            ? document.querySelector(selector)
            : form.querySelector(selector);
          if (visible(el)) return el;
        } catch {}
      }
    }
    return null;
  }

  function findTagSelect(form) {
    if (!(form instanceof Element)) return null;
    const selects = Array.from(form.querySelectorAll('select'));
    if (!selects.length) return null;
    selects.sort((a, b) => ((b.options?.length || 0) - (a.options?.length || 0)));
    return selects[0] || null;
  }

  function getTagOptionLabel(option) {
    if (!(option instanceof HTMLOptionElement)) return '';
    return cleanTagText(option.textContent || option.label || '');
  }

  function valueForExactTagLabel(selectEl, label) {
    if (!(selectEl instanceof HTMLSelectElement)) return '';
    const wanted = lowerTagText(label);
    if (!wanted) return '';
    for (const option of Array.from(selectEl.options || [])) {
      if (option.disabled) continue;
      if (lowerTagText(getTagOptionLabel(option)) === wanted) {
        return norm(option.value || '');
      }
    }
    return '';
  }

  function optionLabelForValue(selectEl, value) {
    if (!(selectEl instanceof HTMLSelectElement)) return '';
    const wanted = norm(value);
    if (!wanted) return '';
    for (const option of Array.from(selectEl.options || [])) {
      if (norm(option.value || '') === wanted) return getTagOptionLabel(option);
    }
    return '';
  }

  function selectHasOptionValue(selectEl, value) {
    return !!optionLabelForValue(selectEl, value);
  }

  function getSelectedTagValues(selectEl) {
    if (!(selectEl instanceof HTMLSelectElement)) return [];
    const values = [];
    for (const option of Array.from(selectEl.options || [])) {
      if (!option.selected) continue;
      const value = norm(option.value || '');
      if (value) values.push(value);
    }
    return values;
  }

  function refreshTagSelectpicker(selectEl) {
    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $.fn?.selectpicker === 'function') {
        $(selectEl).selectpicker('refresh');
      }
    } catch {}
  }

  function resolveTagValuesByLabels(selectEl, labels) {
    const values = [];
    const missingLabels = [];
    const seen = new Set();
    for (const label of Array.isArray(labels) ? labels : []) {
      const cleanLabel = cleanTagText(label);
      if (!cleanLabel) continue;
      const value = valueForExactTagLabel(selectEl, cleanLabel);
      if (!value) {
        missingLabels.push(cleanLabel);
        continue;
      }
      if (seen.has(value)) continue;
      seen.add(value);
      values.push(value);
    }
    return { values, missingLabels };
  }

  function setSelectedTagValues(selectEl, values) {
    if (!(selectEl instanceof HTMLSelectElement)) return false;
    const wanted = Array.from(new Set((values || []).map((value) => norm(value)).filter(Boolean)));
    const wantedSet = new Set(wanted);
    const current = getSelectedTagValues(selectEl);
    const currentSet = new Set(current);
    const changed = currentSet.size !== wantedSet.size || wanted.some((value) => !currentSet.has(value));

    for (const option of Array.from(selectEl.options || [])) {
      const value = norm(option.value || '');
      if (!value) continue;
      option.selected = wantedSet.has(value);
    }

    try {
      const $ = window.jQuery || window.$;
      if ($ && typeof $.fn?.selectpicker === 'function') {
        $(selectEl).selectpicker('val', wanted);
      }
    } catch {}

    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    refreshTagSelectpicker(selectEl);
    return changed;
  }

  function getTagMenuItems(root = null) {
    const scope = root instanceof Element ? root : document;
    return Array.from(scope.querySelectorAll('.dropdown-item, a[id^="bs-select-"], li[role="option"], a[role="option"], [role="option"]'))
      .filter((el) => visible(el) && cleanTagText(el.textContent || ''));
  }

  function getTagPickerItemFromTarget(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('.dropdown-item, a[id^="bs-select-"], li[role="option"], a[role="option"], [role="option"]');
  }

  function buildTagTargetRecord(target) {
    const optionEl = getTagPickerItemFromTarget(target);
    if (!optionEl) return null;

    const labelNode = optionEl.querySelector('span.text, .text');
    const clickedLabel = cleanTagText(labelNode?.textContent || optionEl.textContent || '');
    if (!clickedLabel) return null;

    const form = optionEl.closest(SEL.tagForm) || findVisibleElements(SEL.tagForm)[0] || document.querySelector(SEL.tagForm);
    const selectEl = findTagSelect(form);
    if (!(selectEl instanceof HTMLSelectElement)) return null;

    const value = valueForExactTagLabel(selectEl, clickedLabel);
    if (!value) return null;

    return {
      label: clickedLabel,
      value,
      selector: buildStableSelector(optionEl),
      fingerprint: buildFingerprint(optionEl),
      savedAt: nowIso()
    };
  }

  function getTagDropdownMenu(dropdown) {
    if (!(dropdown instanceof Element)) return null;

    const owns = norm(dropdown.getAttribute('aria-owns') || dropdown.getAttribute('aria-controls') || '');
    if (owns) {
      const owned = document.getElementById(owns);
      if (owned) {
        const menu = owned.closest('.dropdown-menu');
        if (menu) return menu;
        return owned;
      }
    }

    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group, .az-tags-select');
    if (wrapper) {
      const menu = wrapper.querySelector('.dropdown-menu, .inner[role="listbox"], [role="listbox"]');
      if (menu) return menu;
    }

    return findVisibleElements('#add-tag-form .dropdown-menu, .bootstrap-select .dropdown-menu, .dropdown-menu').find(Boolean) || null;
  }

  function isTagDropdownOpen(dropdown) {
    if (!(dropdown instanceof Element)) return false;

    const expanded = String(dropdown.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
    if (expanded) return true;

    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group');
    if (wrapper?.classList.contains('show')) return true;

    const menu = getTagDropdownMenu(dropdown);
    if (menu && visible(menu)) return true;

    return false;
  }

  function dispatchKeySequence(el, key) {
    if (!(el instanceof Element)) return;
    const view = el.ownerDocument?.defaultView || window;
    for (const type of ['keydown', 'keyup']) {
      try {
        el.dispatchEvent(new KeyboardEvent(type, {
          key,
          code: key === ' ' ? 'Space' : key,
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }
  }

  function dispatchMouseBurst(el) {
    if (!(el instanceof Element)) return;
    const view = el.ownerDocument?.defaultView || window;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'click']) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view
        }));
      } catch {}
    }
  }

  function getUnderlyingTagSelect(dropdown) {
    if (!(dropdown instanceof Element)) return null;
    const wrapper = dropdown.closest('.bootstrap-select, .dropdown, .btn-group, .az-tags-select');
    if (!wrapper) return null;
    return wrapper.querySelector('select')
      || (wrapper.previousElementSibling instanceof HTMLSelectElement ? wrapper.previousElementSibling : null);
  }

  async function tryOpenTagDropdown(dropdown) {
    if (!(dropdown instanceof Element)) return false;
    if (isTagDropdownOpen(dropdown)) return true;

    const waitAfterAttempt = async () => {
      await sleep(450);
      return isTagDropdownOpen(dropdown);
    };

    try {
      dropdown.click();
      if (await waitAfterAttempt()) return true;
    } catch {}

    dispatchMouseBurst(dropdown);
    if (await waitAfterAttempt()) return true;

    try {
      const $ = window.jQuery || window.$;
      if ($) {
        const jqDropdown = $(dropdown);
        if (typeof jqDropdown.dropdown === 'function') {
          jqDropdown.dropdown('toggle');
          if (await waitAfterAttempt()) return true;
        }

        const selectEl = getUnderlyingTagSelect(dropdown);
        const jqSelect = selectEl ? $(selectEl) : null;
        if (jqSelect?.length && typeof jqSelect.selectpicker === 'function') {
          jqSelect.selectpicker('toggle');
          if (await waitAfterAttempt()) return true;
        }
      }
    } catch {}

    try {
      dropdown.focus({ preventScroll: true });
      dispatchKeySequence(dropdown, 'ArrowDown');
      if (await waitAfterAttempt()) return true;
    } catch {}

    return false;
  }

  async function openTagPanel() {
    const existingForm = findVisibleElements(SEL.tagForm)[0];
    if (existingForm) return existingForm;

    const opener = findTagOpener();
    if (!opener) {
      log('Tag opener not found');
      return null;
    }

    strongClick(opener);
    log('Clicked: Tag opener');
    await sleep(500);

    const tagForm = await waitFor(() => findVisibleElements(SEL.tagForm)[0], 3000);
    if (!tagForm) {
      log('Tag form not visible after opening tag panel');
      return null;
    }

    return tagForm;
  }

  function resolveStoredTagValue(selectEl, kind, record) {
    if (!(selectEl instanceof HTMLSelectElement) || !isPlainObject(record)) {
      return { value: '', label: cleanTagText(record?.label || '') };
    }

    const label = cleanTagText(record.label || '');
    if (label) {
      const resolvedValue = valueForExactTagLabel(selectEl, label);
      if (resolvedValue) {
        const targets = getTagTargets();
        targets[kind] = {
          ...record,
          label,
          value: resolvedValue,
          savedAt: record.savedAt || nowIso()
        };
        saveTargets(GM_KEYS.tagTargets, targets);
        return { value: resolvedValue, label };
      }
    }

    const directValue = norm(record.value || '');
    if (directValue && selectHasOptionValue(selectEl, directValue)) {
      return {
        value: directValue,
        label: cleanTagText(record.label || optionLabelForValue(selectEl, directValue))
      };
    }

    return { value: '', label };
  }

  function findTagApplyButton() {
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"]')).filter(visible);
    return candidates.find((el) => {
      const text = lower(el.textContent || '');
      if (!text) return false;
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

  async function applyLegacyTagReplacement() {
    const openTagLabels = getOpenTicketTagLabels();
    const legacyMatches = LEGACY_TAG_RULES.filter((item) =>
      openTagLabels.some((label) => lowerTagText(label) === lowerTagText(item.sourceLabel))
    );

    if (!legacyMatches.length) {
      log('No BQ/BQF replacement needed on this ticket');
      return true;
    }

    const tagForm = await openTagPanel();
    if (!(tagForm instanceof Element)) return false;

    const dropdown = findTagDropdown();
    if (!(dropdown instanceof Element)) {
      log('Tag dropdown not found');
      return false;
    }

    const dropdownOpen = await tryOpenTagDropdown(dropdown);
    if (!dropdownOpen) {
      log('Tag dropdown did not open');
      return false;
    }

    const selectEl = findTagSelect(tagForm);
    if (!(selectEl instanceof HTMLSelectElement)) {
      log('Tag select not found in tag form');
      return false;
    }

    const targets = getTagTargets();
    const replacements = [];
    for (const match of legacyMatches) {
      const record = targets[match.targetKey];
      if (!isPlainObject(record)) {
        log(`Missing saved tag target: ${match.targetKey}`);
        return false;
      }
      const resolved = resolveStoredTagValue(selectEl, match.targetKey, record);
      if (!resolved.value) {
        log(`Stored tag value missing for ${record.label || match.targetKey}`);
        return false;
      }
      replacements.push({ ...match, record, resolved });
    }

    const sourceSet = new Set(replacements.map((item) => lowerTagText(item.sourceLabel)));
    const targetSet = new Set(replacements.map((item) => lowerTagText(item.resolved.label || item.record.label || '')));
    const preserveInfo = resolveTagValuesByLabels(
      selectEl,
      openTagLabels.filter((label) => {
        const normalized = lowerTagText(label);
        if (!normalized) return false;
        if (sourceSet.has(normalized)) return false;
        if (targetSet.has(normalized)) return false;
        return true;
      })
    );

    if (preserveInfo.missingLabels.length) {
      log(`Could not map current ticket tags in selector: ${preserveInfo.missingLabels.join(', ')}`);
    }

    const nextValues = [
      ...preserveInfo.values,
      ...replacements.map((item) => item.resolved.value)
    ];
    setSelectedTagValues(selectEl, nextValues);
    await maybeClickTagApplyButton();

    const summary = replacements.map((item) => `${item.sourceLabel}->${item.resolved.label || item.record.label || item.targetKey}`).join(', ');
    log(`Applied tag replacement: ${summary}`);
    return true;
  }

  async function applyZillowResultToTicket(job) {
    const targets = getFieldTargets();
    const fields = {
      'Zillow URL': firstNonEmpty(job?.result?.zillowUrl, job?.searchUrl),
      'Bedrooms': normalizeRoomValue(job?.result?.bedrooms),
      'Bathrooms': normalizeRoomValue(job?.result?.bathrooms),
      'Home Type': normalizeHomeType(job?.result?.homeType)
    };

    let changed = false;
    for (const label of FIELD_ORDER) {
      const value = norm(fields[label]);
      if (!value) {
        log(`Skipped blank Zillow field: ${label}`);
        continue;
      }
      const result = await setFieldValue(targets[label], value);
      if (result.ok) {
        changed = true;
        log(`Filled field: ${label} = ${value}`);
      } else {
        log(`Field failed: ${label} | ${result.reason}`);
      }
      await sleep(250);
    }

    if (changed) {
      await clickUpdateButton();
    } else {
      log('No Zillow field values were applied');
    }

    const tagsOk = await applyLegacyTagReplacement();
    if (!tagsOk) {
      setStatus('Tag replacement failed');
      return false;
    }

    state.zillowSummary = summarizeResult(job?.result);
    return true;
  }

  async function runAzWorkflow() {
    if (!hasAllFieldTargets()) {
      setStatus('Field target setup required');
      return;
    }

    if (!hasAllTagTargets()) {
      setStatus('Tag target setup required');
      return;
    }

    let openTicket = getOpenTicketInfo();
    state.activeTicketId = norm(openTicket.ticketId || '');

    if (!state.activeTicketId) {
      if (!isPipelinePage()) {
        setStatus('Open AgencyZoom pipeline or a ticket');
        return;
      }

      const filterReady = await ensureIgnoredV2Filter();
      if (!filterReady) {
        setStatus('Ingored v2 filter failed');
        return;
      }

      const card = getVisibleStageCards()[0] || null;
      if (!card) {
        setStatus('No visible tickets in Ingored v2');
        return;
      }

      const ticketId = norm(card.getAttribute('data-id') || '');
      const opened = await openCard(card, ticketId);
      if (!opened) {
        setStatus('Ticket open failed');
        return;
      }

      openTicket = getOpenTicketInfo();
      state.activeTicketId = norm(openTicket.ticketId || ticketId);
    }

    if (!state.activeTicketId) {
      setStatus('Waiting for open ticket');
      return;
    }

    const mainOk = await ensureMainTab();
    if (!mainOk) {
      setStatus('Main tab failed');
      return;
    }

    const addressInfo = readAzAddressInfo(state.activeTicketId);
    state.currentAddress = norm(addressInfo.address || '');
    if (!state.currentAddress) {
      setStatus('Address not found on Main');
      log(`Could not read address for AZ ${state.activeTicketId}`);
      return;
    }

    let job = getJob();
    if (!jobMatchesTicket(job, state.activeTicketId) || ['failed', 'completed'].includes(norm(job?.status || ''))) {
      job = createJob(state.activeTicketId, addressInfo);
      const opened = launchZillowSearch(job);
      if (!opened) {
        job.status = 'failed';
        job.updatedAt = nowIso();
        job.error = 'Could not open Zillow tab';
        saveJob(job);
        setStatus('Could not open Zillow tab');
        log('Could not open Zillow search tab');
        return;
      }

      setStatus(`Waiting for Zillow for ${state.activeTicketId}`);
      log(`Opened Zillow search: ${job.searchUrl}`);
      return;
    }

    if (norm(job.address) !== state.currentAddress) {
      job = createJob(state.activeTicketId, addressInfo);
      const reopened = launchZillowSearch(job);
      if (reopened) {
        setStatus(`Address changed; reopened Zillow for ${state.activeTicketId}`);
        log(`Address changed; reopened Zillow search: ${job.searchUrl}`);
      } else {
        setStatus('Could not reopen Zillow tab');
      }
      return;
    }

    state.zillowSummary = summarizeResult(job?.result);

    if (norm(job.status) === 'result-ready' && isPlainObject(job.result)) {
      const applied = await applyZillowResultToTicket(job);
      if (!applied) return;

      job.status = 'completed';
      job.completedAt = nowIso();
      job.updatedAt = nowIso();
      saveJob(job);

      await closeTicketDrawer();
      state.running = false;
      saveRunning(false);
      setStatus(`Completed ticket ${state.activeTicketId}`);
      log(`Completed ticket ${state.activeTicketId}`);
      return;
    }

    if (norm(job.status) === 'failed') {
      setStatus(`Job failed: ${norm(job.error || 'Unknown error') || 'Unknown error'}`);
      return;
    }

    const ageMs = Math.max(0, Date.now() - Date.parse(norm(job.createdAt || nowIso())));
    if (ageMs > CFG.zillowWaitMs) {
      job.status = 'failed';
      job.updatedAt = nowIso();
      job.error = 'Zillow scrape timed out';
      saveJob(job);
      setStatus('Zillow scrape timed out');
      log(`Zillow scrape timed out for AZ ${state.activeTicketId}`);
      return;
    }

    const remaining = Math.max(1, Math.ceil((CFG.zillowWaitMs - ageMs) / 1000));
    setStatus(`Waiting for Zillow (${remaining}s)`);
  }

  async function tick() {
    if (state.destroyed || !isAzOrigin()) return;
    if (state.picker) {
      renderAll();
      return;
    }
    if (!state.running) {
      setStatus('Stopped');
      renderAll();
      return;
    }
    if (state.busy) return;

    state.busy = true;
    renderAll();

    try {
      await runAzWorkflow();
    } catch (error) {
      const message = norm(error?.message || error || 'Unknown error') || 'Unknown error';
      setStatus('Run failed');
      log(`Run failed: ${message}`);
    } finally {
      state.busy = false;
      renderAll();
    }
  }

  function consumeBootstrapReloadToken() {
    try {
      const value = sessionStorage.getItem(SS_KEYS.bootstrapReload);
      if (!value) return false;
      sessionStorage.removeItem(SS_KEYS.bootstrapReload);
      return true;
    } catch {
      return false;
    }
  }

  function requestBootstrapReload(reason = '') {
    try {
      sessionStorage.setItem(SS_KEYS.bootstrapReload, JSON.stringify({
        reason: norm(reason || ''),
        requestedAt: nowIso()
      }));
    } catch {}
    location.reload();
  }

  function ensureHoverBox() {
    if (state.hoverBox || !isAzOrigin()) return;
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
    if (!isAzOrigin() || state.busy || state.picker) return;

    state.picker = {
      type,
      items: type === 'fields'
        ? FIELD_ORDER.map((label) => ({ key: label, label }))
        : TAG_ORDER.map((item) => deepClone(item)),
      index: 0,
      primerPending: type === 'tags'
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
      if (state.picker?.type === 'tags' && state.picker?.primerPending) {
        state.picker.primerPending = false;
        const current = state.picker.items[state.picker.index];
        setStatus(`Picker: click ${current.label}`);
        log(`First click ignored by design. Now click ${current.label}`);
        renderAll();
        return;
      }
      if (state.picker?.type !== 'tags') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      handlePickerSelection(target);
    };

    state.pickerKeydown = (event) => {
      if (event.key === 'Escape') stopPicker('Picker canceled');
    };

    document.addEventListener('mousemove', state.pickerMove, true);
    document.addEventListener('keydown', state.pickerKeydown, true);
    document.addEventListener('click', state.pickerClick, true);

    const current = state.picker.items[state.picker.index];
    if (type === 'tags') {
      setStatus(`Picker: click ${current.label}`);
      log(`Tag picker started: first click ignored. Use it to open tags, then click ${current.label}`);
    } else {
      setStatus(`Picker: click ${current.label}`);
      log(`Field picker started: click ${current.label}`);
    }
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
    setStatus(state.running ? 'Ready' : 'Stopped');
    renderAll();
  }

  function handlePickerSelection(target) {
    if (!state.picker) return;
    const item = state.picker.items[state.picker.index];

    if (state.picker.type === 'fields') {
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

      const targets = getFieldTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.fieldTargets, targets);
    } else {
      const record = buildTagTargetRecord(target);
      if (!record) {
        log('Picker failed: click the real tag option in the open dropdown');
        return;
      }

      const targets = getTagTargets();
      targets[item.key] = record;
      saveTargets(GM_KEYS.tagTargets, targets);
    }

    const currentTargets = state.picker.type === 'tags' ? getTagTargets() : null;
    const extra = state.picker.type === 'tags' ? ` = ${currentTargets?.[item.key]?.label || ''}` : '';
    log(`Saved target: ${item.label}${extra}`);

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
    panel.id = 'tm-az-zillow-ticket-enricher-panel';
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
      <div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-head" style="padding:10px 12px;background:linear-gradient(90deg,#1f2937,#111827);display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:move;">
        <div ${UI_ATTR}="1">
          <div ${UI_ATTR}="1" style="font-weight:800;">${SCRIPT_NAME}</div>
          <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">Pipeline -> Zillow -> Main fields -> dotted tags</div>
        </div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.72;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:12px;">
        <div ${UI_ATTR}="1" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-toggle" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#15803d;color:#fff;font-weight:800;cursor:pointer;">START</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-clear-job" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">CLEAR JOB</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-set-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#0891b2;color:#fff;font-weight:800;cursor:pointer;">SET FIELD TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-reset-fields" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET FIELDS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-set-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#f59e0b;color:#111827;font-weight:800;cursor:pointer;">SET TAG TARGETS</button>
          <button ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-reset-tags" type="button" style="border:0;border-radius:10px;padding:8px 10px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">RESET TAGS</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-status" style="font-weight:800;color:#86efac;margin-bottom:10px;">Ready</div>
        <div ${UI_ATTR}="1" style="display:grid;grid-template-columns:110px 1fr;gap:6px 8px;margin-bottom:10px;">
          <div ${UI_ATTR}="1" style="opacity:.72;">AZ ID</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-ticket">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Address</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-address">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Zillow</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-zillow">-</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Fields</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-fields">0/4 saved</div>
          <div ${UI_ATTR}="1" style="opacity:.72;">Tags</div><div ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-tags">0/2 saved</div>
        </div>
        <textarea ${UI_ATTR}="1" id="tm-az-zillow-ticket-enricher-logs" readonly style="width:100%;min-height:170px;max-height:240px;resize:vertical;background:#020617;border:1px solid #243041;border-radius:12px;color:#cbd5e1;padding:10px;white-space:pre;overflow:auto;"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.ui.head = panel.querySelector('#tm-az-zillow-ticket-enricher-head');
    state.ui.toggle = panel.querySelector('#tm-az-zillow-ticket-enricher-toggle');
    state.ui.clearJob = panel.querySelector('#tm-az-zillow-ticket-enricher-clear-job');
    state.ui.setFields = panel.querySelector('#tm-az-zillow-ticket-enricher-set-fields');
    state.ui.resetFields = panel.querySelector('#tm-az-zillow-ticket-enricher-reset-fields');
    state.ui.setTags = panel.querySelector('#tm-az-zillow-ticket-enricher-set-tags');
    state.ui.resetTags = panel.querySelector('#tm-az-zillow-ticket-enricher-reset-tags');
    state.ui.status = panel.querySelector('#tm-az-zillow-ticket-enricher-status');
    state.ui.ticket = panel.querySelector('#tm-az-zillow-ticket-enricher-ticket');
    state.ui.address = panel.querySelector('#tm-az-zillow-ticket-enricher-address');
    state.ui.zillow = panel.querySelector('#tm-az-zillow-ticket-enricher-zillow');
    state.ui.fields = panel.querySelector('#tm-az-zillow-ticket-enricher-fields');
    state.ui.tags = panel.querySelector('#tm-az-zillow-ticket-enricher-tags');
    state.ui.logs = panel.querySelector('#tm-az-zillow-ticket-enricher-logs');

    makeDraggable(panel, state.ui.head);
  }

  function bindUi() {
    state.ui.toggle?.addEventListener('click', () => {
      state.running = !state.running;
      saveRunning(state.running);

      if (!state.running) {
        setStatus('Stopped');
        log('Automation stopped');
        renderAll();
        return;
      }

      log('Automation started');
      if (isPipelinePage() && !getOpenTicketInfo().ticketId && hasAllFieldTargets() && hasAllTagTargets()) {
        log('Reloading pipeline before scan');
        requestBootstrapReload('manual-start');
        return;
      }

      setStatus('Ready');
      renderAll();
      tick();
    });

    state.ui.clearJob?.addEventListener('click', () => {
      clearJob();
      state.zillowSummary = '';
      log('Stored Zillow job cleared');
      renderAll();
    });

    state.ui.setFields?.addEventListener('click', () => startPicker('fields'));
    state.ui.resetFields?.addEventListener('click', resetFieldTargets);
    state.ui.setTags?.addEventListener('click', () => startPicker('tags'));
    state.ui.resetTags?.addEventListener('click', resetTagTargets);
  }

  function renderAll() {
    const job = getJob();
    if (state.ui.ticket) state.ui.ticket.textContent = norm(state.activeTicketId || job?.ticketId || '-') || '-';
    if (state.ui.address) state.ui.address.textContent = norm(state.currentAddress || job?.address || '-') || '-';
    if (state.ui.zillow) {
      const text = firstNonEmpty(
        state.zillowSummary,
        summarizeResult(job?.result),
        norm(job?.status || '')
      ) || '-';
      state.ui.zillow.textContent = text;
    }
    if (state.ui.fields) state.ui.fields.textContent = getFieldTargetStatusText();
    if (state.ui.tags) state.ui.tags.textContent = getTagTargetStatusText();

    if (state.ui.toggle) {
      state.ui.toggle.textContent = state.running ? 'STOP' : 'START';
      state.ui.toggle.style.background = state.running ? '#b91c1c' : '#15803d';
    }

    if (state.ui.clearJob) {
      state.ui.clearJob.disabled = state.busy;
      state.ui.clearJob.style.opacity = state.busy ? '0.65' : '1';
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
      const saved = safeJsonParse(localStorage.getItem(LS_KEYS.panelPos), null);
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
