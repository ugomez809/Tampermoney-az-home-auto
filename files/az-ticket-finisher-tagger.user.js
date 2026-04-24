// ==UserScript==
// @name         AgencyZoom Ticket Finisher + Tagger
// @namespace    homebot.az-ticket-finisher-tagger
// @version      1.0.15
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

  const SCRIPT_NAME = 'AgencyZoom Ticket Finisher + Tagger';
  const VERSION = '1.0.15';
  const UI_ATTR = 'data-tm-az-finisher-ui';
  const CLEANUP_REQUEST_KEY = 'tm_az_workflow_cleanup_request_v1';

  const GM_KEYS = {
    finalPayload: 'tm_az_gwpc_final_payload_v1',
    finalReady: 'tm_az_gwpc_final_payload_ready_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    autoPayload: 'tm_pc_auto_quote_grab_payload_v1',
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
    { key: 'tagDropdown', label: 'Tag dropdown' },
    { key: 'successfulTag', label: 'Success tag' },
    { key: 'failedTag', label: 'Failed tag' }
  ];

  const NUMERIC_ONLY_FIELDS = new Set([
    'Reconstruction Cost',
    'Year Built',
    'Square FT',
    '# of Story',
    'Standard Pricing No Auto Discount',
    'Enhance Pricing No Auto Discount',
    'Standard Pricing Auto Discount',
    'Enhance Pricing Auto Discount'
  ]);

  const SEL = {
    dockRoot: '.az-dock, #serviceDetailDock, #notePanelContainer, .az-dock__top',
    dockTop: '.az-dock__top',
    topName: 'h3.currentCustomerName',
    topTags: '.az-dock__display-tags .az-def-badge, .az-dock__display-tags .az-def-badge.tag',
    vendorSync: '.origin-vendor-sync, [class*="vendor-sync"], [class*="origin-vendor"]',
    mainTab: 'a[href="#tabDetail"][data-toggle="tab"]',
    mainPane: '#tabDetail',
    detailForm: '#detailDockform',
    updateButton: 'button.btn.btn-primary.action[onclick*="leadDetailTab.doSave"], button.action[onclick*="doSave"]',
    noteOpener: 'a.btn-note.az-tooltip.tooltipstered, a.btn-note',
    noteEditor: 'div.ql-editor[contenteditable="true"], div[data-placeholder="Add note here"][contenteditable="true"], .ql-editor',
    pinTop: 'a.pin-top[data-value="0"], a.pin-top',
    saveNote: 'button#add-note, button.btn-primary#add-note',
    tagOpener: 'a.btn-tag.az-tooltip.tooltipstered, a.btn-tag',
    tagDropdown: 'button.dropdown-toggle.btn-light[role="combobox"], button[data-toggle="dropdown"][role="combobox"], button.dropdown-toggle',
    tagMenu: '.dropdown-menu.show, .dropdown-menu[style*="display: block"], .bootstrap-select.show .dropdown-menu, .show > .dropdown-menu'
  };

  const CFG = {
    tickMs: 800,
    stepPollMs: 150,
    mainReadyMs: 10000,
    bigActionDelayMs: 500,
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
    pickerPrimerClick: null,
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
    let localValue = fallback;
    try {
      const local = readJson(localStorage.getItem(key), fallback);
      localValue = local == null ? fallback : local;
    } catch {}

    try {
      const gmValue = GM_getValue(key, undefined);
      const parsed = readJson(gmValue, gmValue);
      return parsed == null ? localValue : parsed;
    } catch {
      return localValue;
    }
  }

  function readLocalOnly(key, fallback = null) {
    try {
      const value = readJson(localStorage.getItem(key), fallback);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function readGmOnly(key, fallback = null) {
    try {
      const value = readJson(GM_getValue(key, undefined), fallback);
      return value == null ? fallback : value;
    } catch {
      return fallback;
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

  function cleanNumericValue(value, { integerOnly = false } = {}) {
    const raw = norm(value);
    if (!raw) return '';
    let cleaned = raw.replace(/[^0-9.\-]/g, '');
    const minus = cleaned.startsWith('-') ? '-' : '';
    cleaned = minus + cleaned.replace(/-/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot >= 0) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    if (integerOnly) {
      cleaned = cleaned.split('.')[0];
    } else if (cleaned.includes('.')) {
      cleaned = cleaned.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.$/, '');
    }
    return cleaned;
  }

  function formatFieldValue(label, value) {
    const text = norm(value);
    if (!text) return '';
    if (!NUMERIC_ONLY_FIELDS.has(label)) return text;
    const integerOnly = label === 'Year Built' || label === 'Square FT' || label === '# of Story' || label === 'Reconstruction Cost';
    return cleanNumericValue(text, { integerOnly }) || text;
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

  function extractTicketIdFromText(text) {
    const clean = norm(text || '');
    if (!clean) return '';
    const match = clean.match(/\bID:\s*(\d{5,})\b/i) || clean.match(/\b(\d{5,})\b/);
    return match ? match[1] : '';
  }

  function scoreDockRoot(root) {
    if (!(root instanceof Element) || !visible(root)) return -1;
    let score = 0;
    if (root.matches('#serviceDetailDock')) score += 8;
    if (root.querySelector(SEL.detailForm)) score += 6;
    if (root.querySelector(SEL.topName)) score += 5;
    if (root.querySelector(SEL.vendorSync)) score += 5;
    if (extractTicketIdFromText(root.textContent || '')) score += 4;
    if (root.querySelector(SEL.noteOpener)) score += 2;
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
    if (!ticketId) {
      const topText = norm((document.querySelector(SEL.dockTop)?.textContent || ''));
      ticketId = extractTicketIdFromText(topText);
    }

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
    return ['successfulTag', 'failedTag'].every((key) => isPlainObject(targets[key]) && norm(targets[key].selector));
  }

  function readRuns() {
    const value = readGM(GM_KEYS.runs, {});
    return isPlainObject(value) ? value : {};
  }

  function saveRuns(runs) {
    writeGM(GM_KEYS.runs, runs);
  }

  function extractPayloadAzId(raw) {
    const data = unwrapProductPayload(raw);
    return norm(
      raw?.azId
      || raw?.['AZ ID']
      || data?.azId
      || data?.['AZ ID']
      || raw?.currentJob?.['AZ ID']
      || data?.currentJob?.['AZ ID']
      || ''
    );
  }

  function getPayloadSavedMs(raw) {
    const data = unwrapProductPayload(raw);
    const candidates = [
      raw?.savedAt,
      data?.savedAt,
      raw?.meta?.updatedAt,
      data?.meta?.updatedAt,
      raw?.currentJob?.updatedAt,
      data?.currentJob?.updatedAt
    ];
    let best = 0;
    for (const value of candidates) {
      const ms = Date.parse(norm(value || ''));
      if (Number.isFinite(ms) && ms > best) best = ms;
    }
    return best;
  }

  function countFilledKeys(value, keys) {
    if (!isPlainObject(value)) return 0;
    let count = 0;
    for (const key of keys) {
      if (norm(value[key] || '')) count += 1;
    }
    return count;
  }

  function getProductRow(raw) {
    const data = unwrapProductPayload(raw);
    if (isPlainObject(raw?.row)) return raw.row;
    if (isPlainObject(data?.row)) return data.row;
    return {};
  }

  function scoreProductPayload(product, raw) {
    if (!isPlainObject(raw)) return -1;
    const data = unwrapProductPayload(raw);
    const row = getProductRow(raw);
    let score = 0;

    if (raw.ready === true || data.ready === true) score += 20;
    if (norm(raw?.currentJob?.SubmissionNumber || data?.currentJob?.SubmissionNumber || '')) score += 4;

    if (product === 'home') {
      score += countFilledKeys(row, [
        'CFP?',
        'Reconstruction Cost',
        'Year Built',
        'Square FT',
        '# of Story',
        'Water Device?',
        'Standard Pricing No Auto Discount',
        'Enhance Pricing No Auto Discount',
        'Standard Pricing Auto Discount',
        'Enhance Pricing Auto Discount',
        'Submission Number',
        'Done?'
      ]) * 3;
    } else {
      score += countFilledKeys(row, [
        'Auto',
        'Submission Number (Auto)',
        'Total Policy Premium',
        'PrimaryInsuredName',
        'PA_All_Coverages'
      ]) * 4;
      if (Array.isArray(raw?.drivers) && raw.drivers.length) score += 4;
      if (Array.isArray(raw?.vehicles) && raw.vehicles.length) score += 4;
      if (Array.isArray(data?.drivers) && data.drivers.length) score += 4;
      if (Array.isArray(data?.vehicles) && data.vehicles.length) score += 4;
    }

    return score;
  }

  function readDirectProductPayload(key) {
    const local = readLocalOnly(key, null);
    if (isPlainObject(local) && extractPayloadAzId(local)) return local;
    const gm = readGmOnly(key, null);
    if (isPlainObject(gm) && extractPayloadAzId(gm)) return gm;
    return null;
  }

  function chooseBetterFinalPayload(localPayload, gmPayload) {
    const localOk = isPlainObject(localPayload) && norm(localPayload.azId || '');
    const gmOk = isPlainObject(gmPayload) && norm(gmPayload.azId || '');
    if (localOk && !gmOk) return localPayload;
    if (!localOk && gmOk) return gmPayload;
    if (!localOk && !gmOk) return null;

    const localMs = getPayloadSavedMs(localPayload);
    const gmMs = getPayloadSavedMs(gmPayload);
    if (localMs && gmMs && localMs !== gmMs) return localMs > gmMs ? localPayload : gmPayload;
    return localPayload;
  }

  function getFinalPayload() {
    const localPayload = readLocalOnly(GM_KEYS.finalPayload, null);
    const gmPayload = readGmOnly(GM_KEYS.finalPayload, null);
    const payload = chooseBetterFinalPayload(localPayload, gmPayload);
    if (!isPlainObject(payload)) return null;
    const localReady = readLocalOnly(GM_KEYS.finalReady, null);
    const gmReady = readGmOnly(GM_KEYS.finalReady, null);
    const ready = isPlainObject(localReady) && (localReady.ready === true || norm(localReady.azId || '')) ? localReady : gmReady;
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

  function choosePreferredProductPayload(product, expectedAzId, candidates) {
    const ranked = candidates
      .map((candidate) => {
        const raw = candidate?.raw;
        if (!isPlainObject(raw)) return null;
        const azId = extractPayloadAzId(raw);
        if (expectedAzId && azId && azId !== expectedAzId) return null;
        return {
          raw,
          source: norm(candidate?.source || `${product}`) || `${product}`,
          savedMs: getPayloadSavedMs(raw),
          score: scoreProductPayload(product, raw),
          sourceRank: Number(candidate?.sourceRank || 0)
        };
      })
      .filter(Boolean);

    if (!ranked.length) {
      return {
        raw: {},
        source: `${product}:none`,
        savedAt: '',
        score: -1
      };
    }

    ranked.sort((a, b) => {
      if (a.savedMs !== b.savedMs) return b.savedMs - a.savedMs;
      if (a.score !== b.score) return b.score - a.score;
      return b.sourceRank - a.sourceRank;
    });

    return {
      raw: ranked[0].raw,
      source: ranked[0].source,
      savedAt: ranked[0].savedMs ? new Date(ranked[0].savedMs).toISOString() : '',
      score: ranked[0].score
    };
  }

  function extractWorkflowData(finalPayload) {
    const payload = finalPayload.payload;
    const homeChoice = choosePreferredProductPayload('home', finalPayload.azId, [
      { source: 'bridged-home', raw: readDirectProductPayload(GM_KEYS.homePayload), sourceRank: 3 },
      { source: 'final-home-payload', raw: isPlainObject(payload.homePayload) ? payload.homePayload : null, sourceRank: 2 },
      { source: 'final-home-bundle', raw: payload.bundle?.home?.data, sourceRank: 1 }
    ]);
    const autoChoice = choosePreferredProductPayload('auto', finalPayload.azId, [
      { source: 'bridged-auto', raw: readDirectProductPayload(GM_KEYS.autoPayload), sourceRank: 3 },
      { source: 'final-auto-payload', raw: isPlainObject(payload.autoPayload) ? payload.autoPayload : null, sourceRank: 2 },
      { source: 'final-auto-bundle', raw: payload.bundle?.auto?.data, sourceRank: 1 }
    ]);

    const homeRaw = homeChoice.raw;
    const autoRaw = autoChoice.raw;
    const home = unwrapProductPayload(homeRaw);
    const auto = unwrapProductPayload(autoRaw);
    const homeRow = getProductRow(homeRaw);
    const autoRow = getProductRow(autoRaw);

    const doneValue = pickFirst(
      homeRaw['Done?'],
      home['Done?'],
      homeRow['Done?'],
      payload.bundle?.home?.data?.row?.['Done?'],
      payload.bundle?.home?.ready ? 'Yes' : ''
    );

    const autoBranchExists = isPlainObject(payload.bundle?.auto) || isPlainObject(autoRaw) || isPlainObject(payload.autoPayload);
    const autoValue = pickFirst(
      autoRaw['Auto'],
      auto['Auto'],
      autoRaw.auto,
      auto.auto,
      autoRaw.data?.auto,
      auto.data?.auto,
      autoRow['Auto'],
      payload.bundle?.auto?.ready ? 'Yes' : (autoBranchExists ? 'No' : '')
    );

    const homeSubmission = pickFirst(
      homeRaw['Submission Number'],
      home['Submission Number'],
      homeRow['Submission Number'],
      homeRaw.submissionNumber,
      home.submissionNumber,
      home.currentJob?.SubmissionNumber,
      payload.bundle?.home?.submissionNumber
    );

    const autoSubmission = pickFirst(
      autoRaw['Submission Number (Auto)'],
      auto['Submission Number (Auto)'],
      autoRaw.submissionNumberAuto,
      auto.submissionNumberAuto,
      autoRaw.autoSubmissionNumber,
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
      sources: {
        home: `${homeChoice.source}${homeChoice.savedAt ? ` @ ${homeChoice.savedAt}` : ''}`,
        auto: `${autoChoice.source}${autoChoice.savedAt ? ` @ ${autoChoice.savedAt}` : ''}`
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
    try { document.querySelectorAll('.editable-container input:not([type="hidden"]):not([disabled]), .editable-container textarea:not([disabled]), .editable-container select:not([disabled]), .editableform input:not([type="hidden"]):not([disabled]), .editableform textarea:not([disabled]), .editableform select:not([disabled]), .popover input:not([type="hidden"]):not([disabled]), .popover textarea:not([disabled]), .popover select:not([disabled])').forEach(add); } catch {}
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

  async function waitForEditableTarget(base) {
    const started = Date.now();
    let chosen = null;
    while ((Date.now() - started) < 2200) {
      chosen = resolveEditableTarget(base) || base;
      if (chosen instanceof HTMLInputElement || chosen instanceof HTMLTextAreaElement || chosen instanceof HTMLSelectElement || chosen.getAttribute?.('contenteditable') === 'true' || chosen.getAttribute?.('role') === 'textbox') {
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

  async function ensureMainTab() {
    const mainTab = document.querySelector(SEL.mainTab);
    if (!mainTab || !visible(mainTab)) {
      log('Main tab button not found');
      return false;
    }

    showBootstrapTab(mainTab);
    log('Clicked: Main tab');
    await sleep(CFG.bigActionDelayMs);

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
    await sleep(CFG.bigActionDelayMs);
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
      await sleep(CFG.bigActionDelayMs);
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
    await sleep(CFG.bigActionDelayMs);

    const dropdownTargetRecord = getTagTargets().tagDropdown;
    let dropdown = null;
    if (isPlainObject(dropdownTargetRecord)) {
      dropdown = await waitFor(() => findSavedElement(dropdownTargetRecord), 5000);
      if (dropdown) log(`Using saved tag dropdown target: ${dropdownTargetRecord.label || 'Tag dropdown'}`);
    }
    if (!dropdown) {
      dropdown = await waitFor(() => findVisibleElements(SEL.tagDropdown)[0], 5000);
    }
    if (!dropdown) {
      log('Tag dropdown not found');
      return false;
    }

    strongClick(dropdown);
    log('Clicked: Tag dropdown');
    const opened = await waitFor(() => {
      const expanded = String(dropdown.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
      const menu = findVisibleElements(SEL.tagMenu)[0];
      return expanded || !!menu;
    }, 3000);
    if (!opened) {
      await sleep(CFG.bigActionDelayMs);
      strongClick(dropdown);
      log('Retried: Tag dropdown');
      await waitFor(() => {
        const expanded = String(dropdown.getAttribute('aria-expanded') || '').toLowerCase() === 'true';
        const menu = findVisibleElements(SEL.tagMenu)[0];
        return expanded || !!menu;
      }, 3000);
    }
    await sleep(CFG.bigActionDelayMs);
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
    await sleep(CFG.bigActionDelayMs);
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
      const rawValue = norm(data.fields[label] || '');
      const value = formatFieldValue(label, rawValue);
      if (!value) {
        log(`Skipped blank field: ${label}`);
        await sleep(CFG.bigActionDelayMs);
        continue;
      }
      const result = await setFieldValue(targets[label], value);
      if (result.ok) {
        log(`Filled field: ${label} = ${value || '(blank)'}${rawValue && rawValue !== value ? ` (from ${rawValue})` : ''}`);
        changed = true;
      } else {
        log(`Field failed: ${label} | ${result.reason} | wanted ${value || '(blank)'}`);
      }
      await sleep(CFG.bigActionDelayMs);
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
    log(`Payload sources | Home=${data.sources.home} | Auto=${data.sources.auto}`);

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
      await sleep(CFG.bigActionDelayMs);

      if (forceRun || !runRecord.fieldsUpdatedAt) {
        await fillTicketFields(data, runRecord, forceRun);
        saveRunRecord(runs, data.azId, runRecord);
      } else {
        log('Fields already updated for this AZ ID, skipping field fill');
      }

      if (forceRun || !runRecord.noteSavedAt) {
        log(`Note data | Home Submission=${data.note.homeSubmission || '(blank)'} | Auto Submission=${data.note.autoSubmission || '(blank)'} | Done=${data.note.doneValue || '(blank)'} | Auto=${data.note.autoValue || '(blank)'}`);
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
      const current = state.picker?.items?.[state.picker.index];
      const passThrough = state.picker?.type === 'tags' && current?.key === 'tagDropdown';
      if (!passThrough) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      handlePickerSelection(target);
    };

    state.pickerKeydown = (event) => {
      if (event.key === 'Escape') {
        stopPicker('Picker canceled');
      }
    };

    document.addEventListener('mousemove', state.pickerMove, true);
    document.addEventListener('keydown', state.pickerKeydown, true);

    if (type === 'tags') {
      setTimeout(() => {
        if (!state.picker) return;
        document.addEventListener('click', state.pickerClick, true);
      }, 0);
    } else {
      document.addEventListener('click', state.pickerClick, true);
    }

    const current = state.picker.items[state.picker.index];
    if (type === 'tags') {
      setStatus(`Picker: click ${current.label}`);
      log(`Tag picker started: click ${current.label}${current.key === 'tagDropdown' ? ' (click passes through)' : ''}`);
    } else {
      setStatus(`Picker: click ${current.label}`);
      log(`Picker started: click ${current.label}`);
    }
    renderAll();
  }

  function stopPicker(message, logIt = true) {
    if (!state.picker) return;

    document.removeEventListener('mousemove', state.pickerMove, true);
    document.removeEventListener('click', state.pickerPrimerClick, true);
    document.removeEventListener('click', state.pickerClick, true);
    document.removeEventListener('keydown', state.pickerKeydown, true);
    state.pickerMove = null;
    state.pickerPrimerClick = null;
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
      if (!state.running) {
        state.running = true;
        saveRunning(true);
        log('Force run requested; monitoring started');
      } else {
        log('Force run requested');
      }
      setStatus('Force run requested');
      renderAll();
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
