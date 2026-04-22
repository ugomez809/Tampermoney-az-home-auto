// ==UserScript==
// @name         Home Bot: Guidewire Header Timeout V1.11
// @namespace    home.bot.guidewire.header.timeout
// @version      1.11
// @description  Home/Auto header timeout + Auto no-vehicles poster. Prefers original sheet row identity + active row hints, posts to Google Sheets, blocks beforeunload leave prompts, then closes the tab. Never uses about:blank. If Dwelling shows 360 Value, posts No 360 Value. If main posting fails 3 times, sends FAIL to AA through a separate safefail endpoint and closes.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Guidewire%20Header%20Timeout%20V1.11.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Guidewire%20Header%20Timeout%20V1.11.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: Guidewire Header Timeout V1.11';
  const VERSION = '1.11';

  const CFG = {
    tickMs: 1000,
    timeoutMs: 60000,
    noVehiclesStableMs: 3000,
    postTimeoutMs: 30000,
    closeDelayMs: 1200,
    retryAfterFailMs: 10000,
    maxLogLines: 14,
    closeRetryMs: [0, 120, 300, 700],
    closeBlockedOverlayAfterMs: 1400,
    maxPostFailCount: 3
  };

  const API_URL = 'https://script.google.com/macros/s/AKfycbzZ-hRY1zw7-dnQfcUqtrrqbXfs6dzcW1Y3VhuBEYz58CSdfeNrcW6ZkBwB5Kq0e0MA/exec';
  const SAFEFAIL_API_URL = 'https://script.google.com/macros/s/AKfycbxoth6h1IIOiLz3zE6GvNZCDFrO24FfxiaFYLrPrb4Xg3cmYHQXficxqhlINB9Ir9OI/exec';

  const KEYS = {
    postedMap: 'tm_pc_header_timeout_posted_v16',
    identityCache: 'tm_pc_header_timeout_identity_cache_v1',
    panelPos: 'tm_pc_header_timeout_panel_pos_v111',
    lexPayload: 'tm_lex_home_bot_sheet_reader_payload_v1',
    lexActiveRow: 'tm_lex_home_bot_sheet_reader_active_row_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    autoPayload: 'tm_pc_auto_quote_grab_payload_v1'
  };

  const AUTO_VEHICLES_LV_ID = 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PriorCarrier_ExtScreen-PAVehiclesExtPanelSet-VehiclesLV';
  const AUTO_VEHICLES_EMPTY_TEXT = 'No data to display';
  const IV360_CONTAINER_ID = 'iv360-valuationContainer';

  const state = {
    enabled: true,
    inFlight: false,
    lastAttemptAt: 0,
    lastSubmission: '',
    lastHeader: '',
    lastHeaderAt: 0,
    lastProduct: '',
    autoNoVehiclesSince: 0,
    firedLocal: Object.create(null),
    logs: [],
    panel: null,
    els: {},
    tickTimer: null,
    closeStarted: false,
    closeOverlayShown: false,
    postFailCount: 0,
    aaFallbackTried: false
  };

  installLeaveGuard();

  function installLeaveGuard() {
    const nativeWinAdd = window.addEventListener.bind(window);
    const nativeWinRemove = window.removeEventListener.bind(window);
    const nativeDocAdd = document.addEventListener.bind(document);

    function isBeforeUnloadType(type) {
      return String(type || '').toLowerCase() === 'beforeunload';
    }

    function scrubBeforeUnloadEvent(e) {
      try { e.stopImmediatePropagation(); } catch {}
      try { e.stopPropagation(); } catch {}
      try { e.preventDefault(); } catch {}
      try { delete e.returnValue; } catch {}
      try { e.returnValue = undefined; } catch {}
      try {
        Object.defineProperty(e, 'returnValue', {
          configurable: true,
          enumerable: true,
          get() { return undefined; },
          set() { return true; }
        });
      } catch {}
      return undefined;
    }

    try {
      nativeWinAdd('beforeunload', scrubBeforeUnloadEvent, true);
      nativeWinAdd('beforeunload', scrubBeforeUnloadEvent, false);
      nativeDocAdd('beforeunload', scrubBeforeUnloadEvent, true);
    } catch {}

    try {
      window.addEventListener = function (type, listener, options) {
        if (isBeforeUnloadType(type)) return;
        return nativeWinAdd(type, listener, options);
      };
    } catch {}

    try {
      window.removeEventListener = function (type, listener, options) {
        if (isBeforeUnloadType(type)) return;
        return nativeWinRemove(type, listener, options);
      };
    } catch {}

    try {
      const origProtoAdd = Window.prototype.addEventListener;
      Object.defineProperty(Window.prototype, 'addEventListener', {
        configurable: true,
        writable: true,
        value: function (type, listener, options) {
          if (isBeforeUnloadType(type)) return;
          return origProtoAdd.call(this, type, listener, options);
        }
      });
    } catch {}

    try {
      Object.defineProperty(window, 'onbeforeunload', {
        configurable: true,
        enumerable: true,
        get() { return null; },
        set() { return true; }
      });
    } catch {}

    try {
      const desc = Object.getOwnPropertyDescriptor(Window.prototype, 'onbeforeunload');
      if (!desc || desc.configurable) {
        Object.defineProperty(Window.prototype, 'onbeforeunload', {
          configurable: true,
          enumerable: true,
          get() { return null; },
          set() { return true; }
        });
      }
    } catch {}

    try {
      const descDoc = Object.getOwnPropertyDescriptor(Document.prototype, 'onbeforeunload');
      if (!descDoc || descDoc.configurable) {
        Object.defineProperty(Document.prototype, 'onbeforeunload', {
          configurable: true,
          enumerable: true,
          get() { return null; },
          set() { return true; }
        });
      }
    } catch {}
  }

  function $(sel, root = document) {
    try { return root.querySelector(sel); } catch { return null; }
  }

  function $$(sel, root = document) {
    try { return Array.from(root.querySelectorAll(sel)); } catch { return []; }
  }

  function txt(v) {
    return (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
  }

  function low(v) {
    return txt(v).toLowerCase();
  }

  function isVisible(el) {
    try {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (!r || r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    } catch {
      return false;
    }
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function todayEt() {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
  }

  function pick(obj, keys) {
    if (!obj) return '';
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const v = obj[key];
      if (v == null) continue;
      if (typeof v === 'string' && !v.trim()) continue;
      return v;
    }
    return '';
  }

  function smartMerge(dst, src) {
    if (!isPlainObject(src)) return dst;

    Object.entries(src).forEach(([k, v]) => {
      if (v == null) return;

      if (typeof v === 'string') {
        const sv = v.trim();
        if (!sv) return;
        if (!(k in dst) || dst[k] == null || String(dst[k]).trim() === '') dst[k] = sv;
        return;
      }

      if (Array.isArray(v)) {
        if (!(k in dst) || !Array.isArray(dst[k]) || !dst[k].length) dst[k] = v;
        return;
      }

      if (isPlainObject(v)) {
        if (!(k in dst) || !isPlainObject(dst[k])) dst[k] = v;
        return;
      }

      if (!(k in dst) || dst[k] == null || dst[k] === '') dst[k] = v;
    });

    return dst;
  }

  function log(msg, type = 'info') {
    const stamp = new Date().toLocaleTimeString();
    state.logs.unshift(`[${stamp}] ${msg}`);
    if (state.logs.length > CFG.maxLogLines) state.logs.length = CFG.maxLogLines;
    renderLogs();
    if (type === 'error') console.error(`${SCRIPT_NAME}: ${msg}`);
    else console.log(`${SCRIPT_NAME}: ${msg}`);
  }

  function renderLogs() {
    if (state.els.logs) state.els.logs.textContent = state.logs.join('\n');
  }

  function renderStatus() {
    if (!state.els.status || !state.els.toggle) return;

    const running = state.enabled && !state.inFlight;

    state.els.status.textContent =
      state.inFlight ? 'POSTING...' :
      running ? 'RUNNING' : 'STOPPED';

    state.els.status.style.color =
      state.inFlight ? '#facc15' :
      running ? '#86efac' : '#fca5a5';

    state.els.toggle.textContent = running ? 'STOP' : 'START';
    state.els.toggle.style.background = running ? '#16a34a' : '#6b7280';
  }

  function setUiValues(submission, header, ageMs) {
    if (state.els.submission) state.els.submission.textContent = submission || '—';
    if (state.els.header) state.els.header.textContent = header || '—';
    if (state.els.age) state.els.age.textContent = header ? `${Math.max(0, Math.floor(ageMs / 1000))}s / 60s` : '—';
  }

  function savePanelPos() {
    if (!state.panel) return;
    try {
      localStorage.setItem(KEYS.panelPos, JSON.stringify({
        left: state.panel.style.left || '',
        top: state.panel.style.top || '',
        right: state.panel.style.right || '',
        bottom: state.panel.style.bottom || ''
      }));
    } catch {}
  }

  function loadPanelPos(panel) {
    try {
      const raw = localStorage.getItem(KEYS.panelPos);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (!pos || typeof pos !== 'object') return;
      if (pos.left) panel.style.left = pos.left;
      if (pos.top) panel.style.top = pos.top;
      if (pos.right) panel.style.right = pos.right;
      if (pos.bottom) panel.style.bottom = pos.bottom;
    } catch {}
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;

      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = `${Math.max(4, startLeft + (e.clientX - startX))}px`;
      panel.style.top = `${Math.max(4, startTop + (e.clientY - startY))}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      savePanelPos();
    });
  }

  function buildUi() {
    if (!document.documentElement) return false;
    if ($('#tm-pc-header-timeout-panel')) return true;

    const panel = document.createElement('div');
    panel.id = 'tm-pc-header-timeout-panel';

    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: '360px',
      zIndex: 2147483647,
      background: 'rgba(17,24,39,0.96)',
      color: '#f9fafb',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '12px',
      boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
      font: '12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div id="tm-pc-header-timeout-handle" style="padding:8px 10px;background:rgba(255,255,255,0.06);cursor:move;display:flex;align-items:center;justify-content:space-between;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.75;">v${VERSION}</div>
      </div>
      <div style="padding:10px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <button id="tm-pc-header-timeout-toggle" style="border:0;border-radius:8px;padding:6px 10px;cursor:pointer;background:#16a34a;color:#fff;font-weight:700;">STOP</button>
          <div id="tm-pc-header-timeout-status" style="font-weight:700;color:#86efac;">RUNNING</div>
        </div>

        <div style="display:grid;grid-template-columns:88px 1fr;gap:4px 8px;margin-bottom:8px;">
          <div style="opacity:.8;">Submission</div>
          <div id="tm-pc-header-timeout-submission">—</div>

          <div style="opacity:.8;">Header</div>
          <div id="tm-pc-header-timeout-header" style="word-break:break-word;">—</div>

          <div style="opacity:.8;">No change</div>
          <div id="tm-pc-header-timeout-age">—</div>
        </div>

        <div id="tm-pc-header-timeout-logs" style="max-height:180px;overflow:auto;background:rgba(0,0,0,0.22);border-radius:8px;padding:8px;white-space:pre-wrap;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    loadPanelPos(panel);
    makeDraggable(panel, $('#tm-pc-header-timeout-handle', panel));

    state.panel = panel;
    state.els.toggle = $('#tm-pc-header-timeout-toggle', panel);
    state.els.status = $('#tm-pc-header-timeout-status', panel);
    state.els.submission = $('#tm-pc-header-timeout-submission', panel);
    state.els.header = $('#tm-pc-header-timeout-header', panel);
    state.els.age = $('#tm-pc-header-timeout-age', panel);
    state.els.logs = $('#tm-pc-header-timeout-logs', panel);

    state.els.toggle.addEventListener('click', () => {
      state.enabled = !state.enabled;
      renderStatus();
      log(state.enabled ? 'Manual START.' : 'Manual STOP for this page session.');
    });

    renderStatus();
    renderLogs();
    return true;
  }

  function getDocs() {
    const docs = [];
    try { docs.push(document); } catch {}

    const frames = $$('iframe, frame', document);
    for (const fr of frames) {
      try {
        if (fr.contentDocument) docs.push(fr.contentDocument);
      } catch {}
    }

    return docs;
  }

  function hasLabelExactAnyDoc(labelText) {
    const want = txt(labelText);
    if (!want) return false;

    for (const doc of getDocs()) {
      const hit = $$('.gw-label', doc).some(el => isVisible(el) && txt(el.textContent) === want);
      if (hit) return true;
    }
    return false;
  }

  function firstVisibleTextBySelectors(docs, selectors) {
    for (const doc of docs) {
      for (const sel of selectors) {
        const el = $(sel, doc);
        if (!el || !isVisible(el)) continue;
        const t = txt(el.textContent);
        if (t) return t;
      }
    }
    return '';
  }

  function getSubmissionNumber() {
    const docs = getDocs();

    const titleText = firstVisibleTextBySelectors(docs, [
      '.gw-Wizard--Title',
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '[role="heading"][aria-level="1"]'
    ]);

    const m = titleText.match(/Submission\s+(\d{6,})/i);
    return m ? m[1] : '';
  }

  function getGuidewireHeader() {
    const docs = getDocs();

    return firstVisibleTextBySelectors(docs, [
      '.gw-TitleBar--title[role="heading"]',
      '.gw-TitleBar--title',
      '.gw-WizardScreen-title',
      '.gw-Wizard--Title',
      '[role="heading"][aria-level="1"]'
    ]);
  }

  function hasVisibleIv360ValuationContainer() {
    for (const doc of getDocs()) {
      const el = doc.getElementById(IV360_CONTAINER_ID) || $(`#${CSS.escape(IV360_CONTAINER_ID)}`, doc);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  function looksLikeAddress(value) {
    const s = txt(value);
    return /\d{1,6}\s+.+,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/.test(s);
  }

  function getAccountNameFromPage() {
    const docs = getDocs();

    for (const doc of docs) {
      const exact = $('div#SubmissionWizard-JobWizardInfoBar-AccountName > div.gw-label.gw-infoValue:nth-of-type(2)', doc);
      const exactText = txt(exact && exact.textContent);
      if (exactText) return exactText;

      const wrap = $('#SubmissionWizard-JobWizardInfoBar-AccountName', doc);
      if (wrap) {
        const vals = $$('.gw-label.gw-infoValue, .gw-infoValue', wrap)
          .map(el => txt(el.textContent))
          .filter(Boolean);

        if (vals[1]) return vals[1];
        if (vals[0]) return vals[0];
      }
    }

    return '';
  }

  function getMailingAddressFromPage() {
    const docs = getDocs();

    const exactSelectors = [
      'div#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput > div.gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput .gw-vw--value.gw-align-h--left:nth-of-type(1)',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-label.gw-infoValue'
    ];

    for (const doc of docs) {
      for (const sel of exactSelectors) {
        const el = $(sel, doc);
        const t = txt(el && el.textContent);
        if (t && looksLikeAddress(t)) return t;
      }
    }

    for (const doc of docs) {
      const vals = [
        ...$$('.gw-infoValue', doc),
        ...$$('.gw-label.gw-infoValue', doc),
        ...$$('.gw-vw--value', doc)
      ];

      for (const el of vals) {
        if (!isVisible(el)) continue;
        const t = txt(el.textContent);
        if (t && looksLikeAddress(t)) return t;
      }
    }

    return '';
  }

  function getIdentityCache() {
    try {
      const raw = sessionStorage.getItem(KEYS.identityCache);
      const parsed = raw ? JSON.parse(raw) : {};
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function setIdentityCache(cache) {
    try { sessionStorage.setItem(KEYS.identityCache, JSON.stringify(cache || {})); } catch {}
  }

  function updateIdentityCache(submission) {
    const sub = txt(submission);
    if (!sub) return;

    const name = txt(getAccountNameFromPage());
    const address = txt(getMailingAddressFromPage());

    if (!name || !address || !looksLikeAddress(address)) return;

    const cache = getIdentityCache();
    cache[sub] = {
      Name: name,
      'Mailing Address': address,
      SubmissionNumber: sub,
      seenAt: nowIso()
    };
    setIdentityCache(cache);
  }

  function getCachedIdentity(submission) {
    const sub = txt(submission);
    if (!sub) return null;
    const cache = getIdentityCache();
    return isPlainObject(cache[sub]) ? cache[sub] : null;
  }

  function readJsonAnyStore(key) {
    try {
      const fromLocal = localStorage.getItem(key);
      if (fromLocal) {
        const parsed = safeJsonParse(fromLocal);
        if (parsed != null) return parsed;
      }
    } catch {}

    try {
      const fromSession = sessionStorage.getItem(key);
      if (fromSession) {
        const parsed = safeJsonParse(fromSession);
        if (parsed != null) return parsed;
      }
    } catch {}

    return null;
  }

  function getStoredRowData(payload) {
    if (!payload || !isPlainObject(payload)) return {};
    if (isPlainObject(payload.sheetRow)) return payload.sheetRow;
    if (isPlainObject(payload.payload) && isPlainObject(payload.payload.sheetRow)) return payload.payload.sheetRow;
    return payload;
  }

  function getStoredSubmission(payload) {
    const row = getStoredRowData(payload);
    return txt(
      pick(row, [
        'Submission Number',
        'Submission Number (Auto)',
        'SubmissionNumber',
        'submissionNumber',
        'submission'
      ]) ||
      pick(payload, [
        'Submission Number',
        'Submission Number (Auto)',
        'SubmissionNumber',
        'submissionNumber',
        'submission'
      ])
    );
  }

  function parseNameSimple(name) {
    const parts = txt(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return {
      first: parts[0],
      last: parts[parts.length - 1]
    };
  }

  function parseMailingAddressSimple(address) {
    const s = txt(address);
    const m = s.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
    if (!m) {
      return { address: '', city: '', state: '', zipCode: '' };
    }
    return {
      address: txt(m[1]),
      city: txt(m[2]),
      state: txt(m[3]).toUpperCase(),
      zipCode: txt(m[4])
    };
  }

  function normalizeCompare(v) {
    return txt(v)
      .toLowerCase()
      .replace(/[\.,#]/g, '')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bsouth\b/g, 's')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function namesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function addressesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function lexRowToSheetHeaders(row) {
    if (!row || !isPlainObject(row)) return {};

    return {
      'Address': txt(pick(row, ['Address', 'address'])),
      'City': txt(pick(row, ['City', 'city'])),
      'State': txt(pick(row, ['State', 'state'])).toUpperCase(),
      'Zip Code': txt(pick(row, ['Zip Code', 'zipCode', 'zip'])),
      'First': txt(pick(row, ['First', 'first', 'firstName'])),
      'Last': txt(pick(row, ['Last', 'last', 'lastName'])),
      'First 2': txt(pick(row, ['First 2', 'first2'])),
      'Last 2': txt(pick(row, ['Last 2', 'last2'])),
      'Email': txt(pick(row, ['Email', 'email'])),
      'Phone Number': txt(pick(row, ['Phone Number', 'phoneNumber', 'phone'])),
      'DND': txt(pick(row, ['DND', 'dnd'])),
      'DataZapp_DoNotCall': txt(pick(row, ['DataZapp_DoNotCall', 'datazappDoNotCall'])),
      'DataZapp_Phone': txt(pick(row, ['DataZapp_Phone', 'datazappPhone']))
    };
  }

  function combineSplitAddress(row) {
    const addr = txt(pick(row, ['Address', 'address']));
    const city = txt(pick(row, ['City', 'city']));
    const state = txt(pick(row, ['State', 'state']));
    const zip = txt(pick(row, ['Zip Code', 'zipCode', 'zip']));
    if (!addr || !city || !state || !zip) return '';
    return `${addr}, ${city}, ${state} ${zip}`;
  }

  function readMatchingStoredPayload(currentSubmission) {
    const sub = txt(currentSubmission);
    const directKeys = [KEYS.homePayload, KEYS.autoPayload];

    for (const key of directKeys) {
      const parsed = readJsonAnyStore(key);
      if (!parsed) continue;
      const foundSub = getStoredSubmission(parsed);
      if (sub && foundSub && foundSub === sub) return parsed;
    }

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !/^tm_pc_/i.test(key)) continue;
        if (!/payload/i.test(key)) continue;

        const raw = localStorage.getItem(key);
        if (!raw || raw.length < 2) continue;

        const parsed = safeJsonParse(raw);
        if (!parsed || !isPlainObject(parsed)) continue;

        const foundSub = getStoredSubmission(parsed);
        if (sub && foundSub && foundSub === sub) return parsed;
      }
    } catch {}

    return null;
  }

  function getBestLexIdentity(pageName, pageAddress) {
    const lexPayload = readJsonAnyStore(KEYS.lexPayload);
    const lexActiveRow = readJsonAnyStore(KEYS.lexActiveRow);

    if (!lexPayload || !isPlainObject(lexPayload)) {
      return { rowData: {}, rowNumber: '', matched: false };
    }

    const row = getStoredRowData(lexPayload);
    const mapped = lexRowToSheetHeaders(row);
    const combinedName = `${txt(mapped['First'])} ${txt(mapped['Last'])}`.trim();
    const combinedAddress = combineSplitAddress(mapped);
    const rowNumber = txt(
      pick(lexPayload?.source || {}, ['rowNumber', 'row']) ||
      pick(lexActiveRow || {}, ['rowNumber', 'row'])
    );

    const nameOkay = pageName ? namesLikelySame(pageName, combinedName) : false;
    const addressOkay = pageAddress ? addressesLikelySame(pageAddress, combinedAddress) : false;

    return {
      rowData: mapped,
      rowNumber,
      matched: !!(nameOkay || addressOkay)
    };
  }

  function getPostedMap() {
    try {
      const raw = localStorage.getItem(KEYS.postedMap);
      const parsed = raw ? JSON.parse(raw) : {};
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function setPostedMap(map) {
    try { localStorage.setItem(KEYS.postedMap, JSON.stringify(map || {})); } catch {}
  }

  function makePostId(submission, name, address, actionKey) {
    const sub = txt(submission);
    const nm = low(name);
    const addr = low(address);
    const act = txt(actionKey);
    return [sub || `${nm}__${addr}`, act].join('__');
  }

  function alreadyPosted(submission, name, address, actionKey) {
    const map = getPostedMap();
    return !!map[makePostId(submission, name, address, actionKey)];
  }

  function markPosted(submission, name, address, actionKey) {
    const map = getPostedMap();
    map[makePostId(submission, name, address, actionKey)] = {
      at: nowIso(),
      submission: submission || '',
      name: name || '',
      address: address || '',
      actionKey: actionKey || ''
    };
    setPostedMap(map);
  }

  function detectProduct() {
    const isAuto = hasLabelExactAnyDoc('Personal Auto');
    const isHome = hasLabelExactAnyDoc('Homeowners');

    if (isAuto) return 'auto';
    if (isHome) return 'home';
    return '';
  }

  function findAutoVehiclesRoot() {
    for (const doc of getDocs()) {
      const root = doc.getElementById(AUTO_VEHICLES_LV_ID) || $(`#${CSS.escape(AUTO_VEHICLES_LV_ID)}`, doc);
      if (root && isVisible(root)) return root;
    }
    return null;
  }

  function isAutoVehiclesEmpty() {
    const root = findAutoVehiclesRoot();
    if (!root) return false;

    const emptyCell = $$('.gw-ListView--empty-info-cell', root)
      .find(el => isVisible(el) && txt(el.textContent) === AUTO_VEHICLES_EMPTY_TEXT);

    if (emptyCell) return true;

    const bodyRows = $$('tbody tr', root).filter(isVisible);
    if (!bodyRows.length) {
      const anyText = txt(root.textContent);
      if (anyText.includes(AUTO_VEHICLES_EMPTY_TEXT)) return true;
    }

    return false;
  }

  function buildPostBody(actionKey, headerText) {
    const currentSubmission = txt(getSubmissionNumber());
    if (!currentSubmission) throw new Error('No current Submission Number on page');

    const pageName = txt(getAccountNameFromPage());
    const pageAddress = txt(getMailingAddressFromPage());

    const cachedIdentity = getCachedIdentity(currentSubmission) || {};
    const storedPayload = readMatchingStoredPayload(currentSubmission);
    const storedSubmission = getStoredSubmission(storedPayload);
    const storedMatchesCurrent = !!storedSubmission && storedSubmission === currentSubmission;
    const storedRow = storedMatchesCurrent ? getStoredRowData(storedPayload) : {};

    const lexIdentity = getBestLexIdentity(pageName || txt(cachedIdentity['Name']), pageAddress || txt(cachedIdentity['Mailing Address']));
    const lexRowData = lexIdentity.matched ? lexIdentity.rowData : {};
    const lexRowNumber = lexIdentity.matched ? lexIdentity.rowNumber : '';

    const safeName =
      pageName ||
      txt(cachedIdentity['Name']) ||
      txt(pick(storedRow, ['Name', 'PrimaryInsuredName'])) ||
      `${txt(lexRowData['First'])} ${txt(lexRowData['Last'])}`.trim();

    const safeAddress =
      pageAddress ||
      txt(cachedIdentity['Mailing Address']) ||
      txt(pick(storedRow, ['Mailing Address', 'Address'])) ||
      combineSplitAddress(lexRowData);

    if (!safeName) throw new Error('Could not safely determine Name for current submission');
    if (!safeAddress || !looksLikeAddress(safeAddress)) {
      throw new Error('Could not safely determine full Mailing Address for current submission');
    }

    const pageNameParts = parseNameSimple(safeName);
    const pageAddrParts = parseMailingAddressSimple(safeAddress);

    const rowData = {};

    if (lexIdentity.matched && isPlainObject(lexRowData)) {
      smartMerge(rowData, lexRowData);
    }

    if (storedMatchesCurrent && isPlainObject(storedRow)) {
      smartMerge(rowData, storedRow);
    }

    rowData['Name'] = safeName;
    rowData['Mailing Address'] = safeAddress;
    rowData['Submission Number'] = currentSubmission;
    rowData['Date Processed?'] = todayEt();
    rowData['Timeout Header'] = txt(headerText);
    rowData['Timeout At'] = nowIso();

    if (!txt(rowData['First'])) rowData['First'] = pageNameParts.first;
    if (!txt(rowData['Last'])) rowData['Last'] = pageNameParts.last;
    if (!txt(rowData['Address'])) rowData['Address'] = pageAddrParts.address;
    if (!txt(rowData['City'])) rowData['City'] = pageAddrParts.city;
    if (!txt(rowData['State'])) rowData['State'] = pageAddrParts.state;
    if (!txt(rowData['Zip Code'])) rowData['Zip Code'] = pageAddrParts.zipCode;

    const activeRowInfo = readJsonAnyStore(KEYS.lexActiveRow) || {};
    const rowNumberHint = txt(
      lexRowNumber ||
      pick(storedPayload?.source || {}, ['rowNumber', 'row']) ||
      pick(activeRowInfo, ['rowNumber', 'row'])
    );

    let targetField = '';
    let targetValue = '';
    let resultText = '';

    if (actionKey === 'home_timeout') {
      const isDwelling = low(headerText) === 'dwelling';
      const hasIv360 = hasVisibleIv360ValuationContainer();

      targetField = 'Done?';

      if (isDwelling && hasIv360) {
        targetValue = 'No 360 Value';
        resultText = 'No 360 Value';
      } else {
        targetValue = 'FAIL TIMEOUT';
        resultText = 'Header did not change for 60 seconds';
      }

      rowData['Done?'] = targetValue;
      rowData['Result'] = resultText;
    } else if (actionKey === 'auto_timeout') {
      targetField = 'Auto';
      targetValue = 'FAIL TIMEOUT';
      resultText = 'Header did not change for 60 seconds';
      rowData['Auto'] = targetValue;
      rowData['AUTO'] = targetValue;
      rowData['Result'] = resultText;
    } else if (actionKey === 'auto_no_vehicles') {
      targetField = 'Auto';
      targetValue = 'NO AUTO/SKIPEED';
      resultText = 'Auto vehicles table has no vehicles';
      rowData['Auto'] = targetValue;
      rowData['AUTO'] = targetValue;
      rowData['Result'] = resultText;
    } else {
      throw new Error(`Unknown actionKey: ${actionKey}`);
    }

    return {
      payload: {
        sheetRow: rowData,
        source: rowNumberHint ? { rowNumber: Number(rowNumberHint) || rowNumberHint } : {}
      },
      sheetRow: rowData,
      rowNumber: rowNumberHint ? (Number(rowNumberHint) || rowNumberHint) : '',
      __rowNumber: rowNumberHint ? (Number(rowNumberHint) || rowNumberHint) : '',
      sender: {
        script: SCRIPT_NAME,
        version: VERSION,
        sentAt: nowIso(),
        pageUrl: location.href,
        pageTitle: document.title
      },
      meta: {
        actionKey,
        targetField,
        targetValue,
        currentSubmission,
        safeName,
        safeAddress,
        rowNumberHint,
        sourceName: pageName ? 'page' : (cachedIdentity['Name'] ? 'cache' : (lexIdentity.matched ? 'lex' : 'stored payload')),
        sourceAddress: pageAddress ? 'page' : (cachedIdentity['Mailing Address'] ? 'cache' : (lexIdentity.matched ? 'lex' : 'stored payload')),
        storedMatchesCurrent,
        lexMatched: lexIdentity.matched
      }
    };
  }

  function gmPostJson(url, data) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: 'POST',
          url,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify(data),
          timeout: CFG.postTimeoutMs,
          onload: (res) => {
            let parsed = null;
            try { parsed = JSON.parse(res.responseText); } catch {}
            if (res.status < 200 || res.status >= 400) {
              reject(new Error(`HTTP ${res.status}`));
              return;
            }
            resolve({
              status: res.status,
              body: parsed,
              text: res.responseText
            });
          },
          ontimeout: () => reject(new Error('Request timeout')),
          onerror: () => reject(new Error('Network error'))
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function postPayload(body) {
    return gmPostJson(API_URL, body);
  }

  function postSafefailAA(headerText, actionKey) {
    const currentSubmission = txt(getSubmissionNumber());
    const pageName = txt(getAccountNameFromPage());
    const pageAddress = txt(getMailingAddressFromPage());

    const body = {
      value: 'FAIL',
      reason: 'Main post failed 3 times',
      actionKey: actionKey || '',
      header: txt(headerText),
      submissionNumber: currentSubmission,
      name: pageName,
      mailingAddress: pageAddress,
      sender: {
        script: SCRIPT_NAME,
        version: VERSION,
        sentAt: nowIso(),
        pageUrl: location.href,
        pageTitle: document.title
      }
    };

    return gmPostJson(SAFEFAIL_API_URL, body);
  }

  function stopRuntimeForBlockedClose() {
    state.enabled = false;
    state.inFlight = false;
    renderStatus();
    try {
      if (state.tickTimer) {
        clearInterval(state.tickTimer);
        state.tickTimer = null;
      }
    } catch {}
  }

  function showCloseBlockedOverlay() {
    if (state.closeOverlayShown) return;
    state.closeOverlayShown = true;

    stopRuntimeForBlockedClose();

    let overlay = document.getElementById('tm-pc-header-timeout-close-blocked');
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'tm-pc-header-timeout-close-blocked';
    overlay.innerHTML = `
      <div style="max-width:560px;padding:24px 28px;border:1px solid #334155;border-radius:14px;background:#111827;box-shadow:0 16px 40px rgba(0,0,0,.35);">
        <div style="font-size:18px;font-weight:700;margin-bottom:10px;">${SCRIPT_NAME}</div>
        <div style="margin-bottom:8px;">Post finished, but browser blocked tab close.</div>
        <div style="opacity:.85;">This tab was intentionally stopped and preserved. Close it manually.</div>
      </div>
    `;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(15,23,42,0.92)',
      color: '#e5e7eb',
      font: '14px/1.45 Segoe UI,Arial,sans-serif'
    });

    try { document.documentElement.appendChild(overlay); } catch {}

    log('Close blocked by browser. Tab preserved on original URL.');
  }

  function tryCloseOnce() {
    try { window.onbeforeunload = null; } catch {}
    try { window.top.onbeforeunload = null; } catch {}
    try { window.top.opener = null; } catch {}

    try { window.dispatchEvent(new Event('beforeunload', { cancelable: true })); } catch {}
    try { window.top.dispatchEvent(new Event('beforeunload', { cancelable: true })); } catch {}

    try { window.top.open('', '_self'); } catch {}
    try { window.top.close(); } catch {}
  }

  function hardCloseTop(afterMs = 0) {
    if (state.closeStarted) return;
    state.closeStarted = true;

    const start = () => {
      log('Attempting to close tab...');

      for (const ms of CFG.closeRetryMs) {
        setTimeout(() => {
          if (document.visibilityState === 'hidden' || window.top.closed) return;
          tryCloseOnce();
        }, ms);
      }

      setTimeout(() => {
        if (document.visibilityState === 'hidden' || window.top.closed) return;
        showCloseBlockedOverlay();
      }, CFG.closeBlockedOverlayAfterMs);
    };

    if (afterMs > 0) setTimeout(start, afterMs);
    else start();
  }

  async function sendAaFailFallback(actionKey, headerText) {
    if (state.aaFallbackTried) {
      log('AA safefail already tried. Closing tab.');
      state.firedLocal[actionKey] = true;
      hardCloseTop(CFG.closeDelayMs);
      return;
    }

    state.aaFallbackTried = true;
    state.inFlight = true;
    renderStatus();

    try {
      log('Trying AA safefail endpoint...');
      const res = await postSafefailAA(headerText, actionKey);

      if (res.body && res.body.ok === false) {
        throw new Error(res.body.error || 'Safefail returned ok:false');
      }

      state.firedLocal[actionKey] = true;
      state.postFailCount = 0;

      const rowInfo = res.body && res.body.rowNumber ? ` row ${res.body.rowNumber}` : '';
      log(`AA safefail success${rowInfo}. Closing tab...`);
      hardCloseTop(CFG.closeDelayMs);
    } catch (err) {
      state.inFlight = false;
      renderStatus();
      state.firedLocal[actionKey] = true;
      log(`AA safefail failed: ${err && err.message ? err.message : String(err)}`, 'error');
      log('Closing tab after safefail failure.');
      hardCloseTop(CFG.closeDelayMs);
    }
  }

  function handlePostFailure(actionKey, headerText, err) {
    state.inFlight = false;
    state.postFailCount += 1;
    renderStatus();

    log(`Post blocked/failed: ${err && err.message ? err.message : String(err)}`, 'error');
    log(`Post fail count: ${state.postFailCount}/${CFG.maxPostFailCount}`);

    if (state.postFailCount >= CFG.maxPostFailCount) {
      sendAaFailFallback(actionKey, headerText);
    }
  }

  async function fireAction(actionKey, headerText) {
    if (state.inFlight) return;
    if (Date.now() - state.lastAttemptAt < CFG.retryAfterFailMs) return;
    if (state.firedLocal[actionKey]) return;

    state.inFlight = true;
    state.lastAttemptAt = Date.now();
    renderStatus();

    try {
      const body = buildPostBody(actionKey, headerText);
      const rowData = body.payload.sheetRow;
      const meta = body.meta;

      const submission = txt(rowData['Submission Number']);
      const name = txt(rowData['Name']);
      const address = txt(rowData['Mailing Address']);

      if (alreadyPosted(submission, name, address, actionKey)) {
        log(`Already posted ${actionKey}. Closing tab.`);
        state.firedLocal[actionKey] = true;
        state.postFailCount = 0;
        hardCloseTop(CFG.closeDelayMs);
        return;
      }

      log(`Action hit: ${actionKey}`);
      log(`Posting: ${name} | ${address}`);
      if (meta.rowNumberHint) log(`Row hint: ${meta.rowNumberHint}`);
      log(`Name source: ${meta.sourceName} | Address source: ${meta.sourceAddress}`);

      const res = await postPayload(body);

      if (res.body && res.body.ok === false) {
        throw new Error(res.body.error || 'Receiver returned ok:false');
      }

      markPosted(submission, name, address, actionKey);
      state.firedLocal[actionKey] = true;
      state.postFailCount = 0;
      state.aaFallbackTried = false;

      const rowInfo = res.body && res.body.rowNumber ? ` row ${res.body.rowNumber}` : '';
      const matchInfo = res.body && res.body.matchedBy ? ` (${res.body.matchedBy})` : '';
      log(`Post success${rowInfo}${matchInfo}. Closing tab...`);
      hardCloseTop(CFG.closeDelayMs);
    } catch (err) {
      handlePostFailure(actionKey, headerText, err);
    }
  }

  function resetSubmissionState(submission, product, header) {
    state.lastSubmission = submission || '';
    state.lastProduct = product || '';
    state.lastHeader = header || '';
    state.lastHeaderAt = header ? Date.now() : 0;
    state.autoNoVehiclesSince = 0;
    state.firedLocal = Object.create(null);
    state.closeStarted = false;
    state.closeOverlayShown = false;
    state.postFailCount = 0;
    state.aaFallbackTried = false;
  }

  function tick() {
    if (!state.enabled || state.inFlight) return;

    const submission = txt(getSubmissionNumber());

    if (!submission) {
      resetSubmissionState('', '', '');
      setUiValues('', '', 0);
      return;
    }

    updateIdentityCache(submission);

    const product = detectProduct();
    const header = txt(getGuidewireHeader());

    if (submission !== state.lastSubmission) {
      resetSubmissionState(submission, product, header);
      setUiValues(submission, header, 0);
      if (header) log(`Header change: ${header}`);
      return;
    }

    if (product !== state.lastProduct) {
      state.lastProduct = product;
      state.lastHeader = header;
      state.lastHeaderAt = header ? Date.now() : 0;
      state.autoNoVehiclesSince = 0;
      state.firedLocal = Object.create(null);
      state.closeStarted = false;
      state.closeOverlayShown = false;
      state.postFailCount = 0;
      state.aaFallbackTried = false;
      setUiValues(submission, header, 0);
      if (header) log(`Header change: ${header}`);
      return;
    }

    if (!header) {
      setUiValues(submission, '', 0);
      return;
    }

    if (header !== state.lastHeader) {
      state.lastHeader = header;
      state.lastHeaderAt = Date.now();
      state.autoNoVehiclesSince = 0;
      state.firedLocal.home_timeout = false;
      state.firedLocal.auto_timeout = false;
      state.closeStarted = false;
      state.closeOverlayShown = false;
      state.postFailCount = 0;
      state.aaFallbackTried = false;
      setUiValues(submission, header, 0);
      log(`Header change: ${header}`);
      return;
    }

    const ageMs = Date.now() - state.lastHeaderAt;
    setUiValues(submission, header, ageMs);

    if (product === 'auto') {
      if (isAutoVehiclesEmpty()) {
        if (!state.autoNoVehiclesSince) {
          state.autoNoVehiclesSince = Date.now();
          log('Auto vehicles empty detected. Waiting for stability...');
        } else if ((Date.now() - state.autoNoVehiclesSince) >= CFG.noVehiclesStableMs && !state.firedLocal.auto_no_vehicles) {
          fireAction('auto_no_vehicles', header);
          return;
        }
      } else {
        state.autoNoVehiclesSince = 0;
      }
    } else {
      state.autoNoVehiclesSince = 0;
    }

    if (ageMs < CFG.timeoutMs) return;

    if (product === 'home' && !state.firedLocal.home_timeout) {
      fireAction('home_timeout', header);
      return;
    }

    if (product === 'auto' && !state.firedLocal.auto_timeout) {
      fireAction('auto_timeout', header);
    }
  }

  function boot() {
    if (!buildUi()) {
      setTimeout(boot, 50);
      return;
    }

    if (state.tickTimer) clearInterval(state.tickTimer);
    state.tickTimer = setInterval(tick, CFG.tickMs);

    log('Script started.');
    log('Auto-armed on fresh load/reload.');
    log('Leave-site blocker armed.');
    log('Prefers original sheet row + active row hints first.');
    log('Close fallback no longer uses about:blank.');
    log('Dwelling + 360 Value timeout posts: No 360 Value.');
    log(`After ${CFG.maxPostFailCount} failed main post attempts, sends FAIL through safefail endpoint and closes.`);
    renderStatus();
    tick();
  }

  boot();
})();
