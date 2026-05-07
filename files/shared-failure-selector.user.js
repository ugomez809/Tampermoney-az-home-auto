// ==UserScript==
// @name         Cross-Origin Shared Failure Selector
// @namespace    homebot.shared-failure-selector
// @version      1.0.0
// @description  Shared selector recorder/monitor for LEX and GWPC failure messages. Saves rules to the same shared sheet as GWPC Header Timeout Monitor and publishes specific failed-path note reasons on LEX.
// @author       OpenAI
// @match        https://farmersagent.lightning.force.com/*
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/shared-failure-selector.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/shared-failure-selector.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;
  try { window.__TM_SHARED_FAILURE_SELECTOR_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Cross-Origin Shared Failure Selector';
  const VERSION = '1.0.0';
  const UI_ATTR = 'data-tm-shared-failure-selector-ui';

  const RULES_KEY = 'tm_pc_header_timeout_selector_rules_v1';
  const SHARED_RULES_CLIENT_ID_KEY = 'tm_shared_failure_selector_client_id_v1';
  const SENT_KEY = 'tm_shared_failure_selector_sent_v1';
  const LOG_KEY = 'tm_shared_failure_selector_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const MISSING_PAYLOAD_TRIGGER_KEY = 'tm_az_missing_payload_fallback_trigger_v1';
  const CURRENT_JOB_KEYS = [
    'tm_az_current_job_v1',
    'tm_shared_az_job_v1',
    'tm_pc_current_job_v1'
  ];
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const FORCE_SEND_KEY = 'tm_pc_force_send_now_v1';

  const CFG = {
    scanMs: 700,
    syncMs: 60 * 60 * 1000,
    requestTimeoutMs: 20000,
    maxLogLines: 120,
    maxSent: 250,
    panelWidth: 340,
    zIndex: 2147483647,
    selectorOutlineColor: '#38bdf8',
    selectorFillColor: 'rgba(56,189,248,0.14)',
    sharedRulesEndpoint: 'https://script.google.com/macros/s/AKfycbxBYCjRnS9aRQoWqlE_fiTOnUGIVyrgU1mabIVCk4YtYThbRd4nSKIDf4gqnRXm-m3TGw/exec',
    sharedRulesKey: 'gwpc-timeout-rules-24apr2026-jkira-91x7p'
  };

  const state = {
    destroyed: false,
    rules: [],
    selectorMode: false,
    selectorListeners: [],
    hoverBox: null,
    panel: null,
    statusEl: null,
    logEl: null,
    scanTimer: null,
    syncTimer: null,
    logs: [],
    lastLogClearAt: '',
    lastSyncAt: 0,
    syncBusy: false,
    lastMatchLogKey: ''
  };

  boot();

  function boot() {
    buildPanel();
    readLocalRules();
    log(`Loaded v${VERSION}`);
    setStatus(hostLabel());
    syncSharedRules('boot').catch((err) => log(`Shared sync failed: ${err?.message || err}`));

    state.scanTimer = setInterval(scanRules, CFG.scanMs);
    state.syncTimer = setInterval(() => {
      syncSharedRules('interval').catch((err) => log(`Shared sync failed: ${err?.message || err}`));
    }, CFG.syncMs);

    window.addEventListener('storage', onStorage, true);
    window.__TM_SHARED_FAILURE_SELECTOR_CLEANUP__ = cleanup;
    scanRules();
  }

  function cleanup() {
    if (state.destroyed) return;
    state.destroyed = true;
    try { clearInterval(state.scanTimer); } catch {}
    try { clearInterval(state.syncTimer); } catch {}
    try { window.removeEventListener('storage', onStorage, true); } catch {}
    stopSelectorMode('Selector stopped', { logIt: false });
    try { state.hoverBox?.remove(); } catch {}
    try { state.panel?.remove(); } catch {}
    try { delete window.__TM_SHARED_FAILURE_SELECTOR_CLEANUP__; } catch {}
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      if (raw == null || raw === '') return fallback;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return fallback;
    }
  }

  function readLocalJson(key, fallback = null) {
    try { return safeJsonParse(localStorage.getItem(key), fallback); }
    catch { return fallback; }
  }

  function readGMJson(key, fallback = null) {
    try { return safeJsonParse(GM_getValue(key, fallback), fallback); }
    catch { return fallback; }
  }

  function writeBoth(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    try { GM_setValue(key, value); } catch {}
  }

  function hostKind() {
    const host = location.hostname.toLowerCase();
    if (host.includes('lightning.force.com')) return 'lex';
    if (host.includes('policycenter')) return 'gwpc';
    return 'other';
  }

  function hostLabel() {
    const kind = hostKind();
    if (kind === 'lex') return 'Watching LEX';
    if (kind === 'gwpc') return 'Watching GWPC';
    return 'Watching';
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

  function escHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function truncate(value, max) {
    const text = norm(value);
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify({
        script: SCRIPT_NAME,
        version: VERSION,
        origin: location.origin,
        updatedAt: nowIso(),
        lines: state.logs
      }));
    } catch {}
    try { GM_setValue(LOG_KEY, { script: SCRIPT_NAME, version: VERSION, origin: location.origin, updatedAt: nowIso(), lines: state.logs }); } catch {}
    console.log(`[${SCRIPT_NAME}] ${message}`);
    renderLogs();
  }

  function setStatus(text) {
    if (state.statusEl) state.statusEl.textContent = text;
  }

  function onStorage(event) {
    if (event?.key !== LOG_CLEAR_SIGNAL_KEY) return;
    const req = safeJsonParse(event.newValue, null);
    const at = norm(req?.requestedAt || '');
    if (!at || at === state.lastLogClearAt) return;
    state.lastLogClearAt = at;
    state.logs = [];
    renderLogs();
  }

  function buildPanel() {
    if (state.panel && document.contains(state.panel)) return true;
    if (!document.documentElement) return false;

    const panel = document.createElement('div');
    panel.id = 'tm-shared-failure-selector-panel';
    panel.setAttribute(UI_ATTR, '1');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: `${CFG.panelWidth}px`,
      zIndex: String(CFG.zIndex),
      background: 'rgba(15,23,42,.96)',
      color: '#fff',
      border: '1px solid rgba(148,163,184,.45)',
      borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0,0,0,.35)',
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      overflow: 'hidden'
    });

    panel.innerHTML = `
      <div ${UI_ATTR}="1" style="padding:10px 12px;background:#0f172a;display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div ${UI_ATTR}="1" style="font-weight:800;">Shared Failure Selector</div>
        <div ${UI_ATTR}="1" style="font-size:11px;opacity:.75;">v${VERSION}</div>
      </div>
      <div ${UI_ATTR}="1" style="padding:10px 12px;">
        <div ${UI_ATTR}="1" id="tm-shared-failure-selector-status" style="margin-bottom:8px;color:#bae6fd;">Starting</div>
        <div ${UI_ATTR}="1" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <button ${UI_ATTR}="1" id="tm-shared-failure-selector-save" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#0284c7;color:#fff;font-weight:800;cursor:pointer;">SAVE SELECTOR</button>
          <button ${UI_ATTR}="1" id="tm-shared-failure-selector-sync" type="button" style="border:0;border-radius:7px;padding:7px 8px;background:#475569;color:#fff;font-weight:800;cursor:pointer;">SYNC</button>
        </div>
        <div ${UI_ATTR}="1" id="tm-shared-failure-selector-log" style="max-height:150px;overflow:auto;font-size:11px;line-height:1.35;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    state.panel = panel;
    state.statusEl = panel.querySelector('#tm-shared-failure-selector-status');
    state.logEl = panel.querySelector('#tm-shared-failure-selector-log');

    panel.querySelector('#tm-shared-failure-selector-save')?.addEventListener('click', () => {
      if (state.selectorMode) stopSelectorMode('Selector canceled');
      else startSelectorMode();
    });

    panel.querySelector('#tm-shared-failure-selector-sync')?.addEventListener('click', () => {
      syncSharedRules('manual').catch((err) => log(`Shared sync failed: ${err?.message || err}`));
    });

    return true;
  }

  function renderLogs() {
    if (!state.logEl) return;
    state.logEl.innerHTML = state.logs.slice(0, 12).map((line) => (
      `<div ${UI_ATTR}="1" style="margin-bottom:3px;word-break:break-word;">${escHtml(line)}</div>`
    )).join('');
  }

  function getClientId() {
    try {
      const current = norm(localStorage.getItem(SHARED_RULES_CLIENT_ID_KEY) || '');
      if (current) return current;
      const created = `shared_selector_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
      localStorage.setItem(SHARED_RULES_CLIENT_ID_KEY, created);
      return created;
    } catch {
      return `shared_selector_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  function buildSharedRulesUrl(params = {}) {
    const url = new URL(CFG.sharedRulesEndpoint);
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === '') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function requestSharedRules(method, url, payload = null) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method,
          url,
          headers: payload ? { 'Content-Type': 'application/json' } : {},
          data: payload ? JSON.stringify(payload) : undefined,
          timeout: CFG.requestTimeoutMs,
          onload: (response) => {
            const status = Number(response?.status || 0);
            if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status || 'request failed'}`));
            const parsed = safeJsonParse(response?.responseText || '', null);
            if (!isPlainObject(parsed)) return reject(new Error('Invalid JSON response'));
            if (parsed.ok === false) return reject(new Error(norm(parsed.error || 'Remote request failed') || 'Remote request failed'));
            resolve(parsed);
          },
          onerror: () => reject(new Error('Network error')),
          ontimeout: () => reject(new Error('Request timeout'))
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  function normalizeRule(raw) {
    if (!isPlainObject(raw)) return null;
    const enabled = raw.enabled === false ? false : String(raw.enabled ?? 'true').toLowerCase() !== 'false';
    const selector = norm(raw.selector || raw.cssSelector || '');
    const savedErrorText = norm(raw.savedErrorText || raw.errorText || raw.customMessage || raw.resultValue || raw.textSample || raw.errorName || '');
    const fingerprintRaw = isPlainObject(raw.fingerprint) ? raw.fingerprint : {};
    const fingerprint = {
      tag: norm(fingerprintRaw.tag || ''),
      id: norm(fingerprintRaw.id || ''),
      name: norm(fingerprintRaw.name || ''),
      role: norm(fingerprintRaw.role || ''),
      ariaLabel: norm(fingerprintRaw.ariaLabel || ''),
      classTokens: Array.isArray(fingerprintRaw.classTokens) ? fingerprintRaw.classTokens.map(norm).filter(Boolean).slice(0, 4) : [],
      textFingerprint: truncate(fingerprintRaw.textFingerprint || raw.textFingerprint || raw.textSample || '', 160)
    };

    const ruleId = norm(raw.ruleId || raw.id || buildRuleId(selector, fingerprint.textFingerprint));
    if (!ruleId || !selector || !savedErrorText) return null;

    return {
      ruleId,
      enabled,
      selector,
      label: norm(raw.label || raw.errorName || savedErrorText || 'Saved selector error'),
      savedErrorText,
      fingerprint,
      createdAt: norm(raw.createdAt || nowIso()),
      updatedAt: norm(raw.updatedAt || raw.createdAt || nowIso()),
      sourceScript: norm(raw.sourceScript || ''),
      sourceVersion: norm(raw.sourceVersion || ''),
      updatedBy: norm(raw.updatedBy || ''),
      clientId: norm(raw.clientId || '')
    };
  }

  function buildRuleId(selector, text) {
    const basis = `${selector}|${text}`;
    let hash = 0;
    for (let i = 0; i < basis.length; i += 1) {
      hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
    }
    return `rule_h${Math.abs(hash)}`;
  }

  function readLocalRules() {
    const parsed = readLocalJson(RULES_KEY, []);
    state.rules = Array.isArray(parsed) ? parsed.map(normalizeRule).filter(Boolean) : [];
    setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
    return state.rules;
  }

  function writeLocalRules(rules) {
    state.rules = (Array.isArray(rules) ? rules : []).map(normalizeRule).filter(Boolean);
    try { localStorage.setItem(RULES_KEY, JSON.stringify(state.rules, null, 2)); } catch {}
    setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
  }

  async function syncSharedRules(reason = '') {
    if (state.syncBusy) return;
    state.syncBusy = true;
    setStatus('Syncing shared rules...');
    try {
      const response = await requestSharedRules('GET', buildSharedRulesUrl({
        action: 'listRules',
        key: CFG.sharedRulesKey,
        includeDisabled: 'true'
      }));
      const rules = Array.isArray(response.rules) ? response.rules.map(normalizeRule).filter(Boolean) : [];
      writeLocalRules(rules.filter((rule) => rule.enabled !== false));
      state.lastSyncAt = Date.now();
      log(`Shared rules sync complete | ${state.rules.length} rule(s)${reason ? ` | ${reason}` : ''}`);
    } finally {
      state.syncBusy = false;
      setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
    }
  }

  async function upsertSharedRule(rule) {
    const clientId = getClientId();
    const normalized = normalizeRule({
      ...rule,
      enabled: true,
      sourceScript: SCRIPT_NAME,
      sourceVersion: VERSION,
      updatedBy: clientId,
      clientId
    });
    if (!normalized) throw new Error('Invalid selector rule');

    await requestSharedRules('POST', CFG.sharedRulesEndpoint, {
      action: 'upsertRule',
      key: CFG.sharedRulesKey,
      rule: {
        ruleId: normalized.ruleId,
        enabled: true,
        label: normalized.label,
        savedErrorText: normalized.savedErrorText,
        selector: normalized.selector,
        fingerprint: normalized.fingerprint,
        createdAt: normalized.createdAt,
        sourceScript: SCRIPT_NAME,
        sourceVersion: VERSION,
        updatedBy: clientId,
        clientId
      }
    });

    const next = state.rules.filter((item) => item.ruleId !== normalized.ruleId);
    next.push(normalized);
    writeLocalRules(next);
    log(`Saved shared selector rule | ${normalized.ruleId} | ${normalized.savedErrorText}`);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
  }

  function stableClassTokens(el) {
    return Array.from(el.classList || [])
      .filter((token) => /^[a-zA-Z0-9_-]{2,}$/.test(token))
      .filter((token) => !/^ng-|^slds-is-|^active$|^show$/.test(token))
      .slice(0, 4);
  }

  function buildSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return `#${cssEscape(el.id)}`;

    const name = norm(el.getAttribute('name') || '');
    if (name) {
      const byName = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      try { if (document.querySelectorAll(byName).length === 1) return byName; } catch {}
    }

    const role = norm(el.getAttribute('role') || '');
    const aria = norm(el.getAttribute('aria-label') || '');
    if (role && aria) {
      const byRole = `${el.tagName.toLowerCase()}[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      try { if (document.querySelectorAll(byRole).length === 1) return byRole; } catch {}
    }

    const parts = [];
    let cur = el;
    while (cur && cur instanceof Element && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${cssEscape(cur.id)}`;
        parts.unshift(part);
        break;
      }
      const classes = stableClassTokens(cur);
      if (classes.length) part += `.${classes.map(cssEscape).join('.')}`;
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((node) => node.tagName === cur.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const selector = parts.join(' > ');
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      cur = parent;
    }
    return parts.join(' > ');
  }

  function buildFingerprint(el) {
    return {
      tag: String(el?.tagName || '').toLowerCase(),
      id: norm(el?.id || ''),
      name: norm(el?.getAttribute?.('name') || ''),
      role: norm(el?.getAttribute?.('role') || ''),
      ariaLabel: norm(el?.getAttribute?.('aria-label') || ''),
      classTokens: stableClassTokens(el),
      textFingerprint: truncate(el?.innerText || el?.textContent || '', 160)
    };
  }

  function isUi(el) {
    return !!(el instanceof Element && el.closest(`[${UI_ATTR}="1"]`));
  }

  function selectableAt(clientX, clientY) {
    const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (isUi(node)) return null;
      if (!visible(node)) continue;
      if (node === document.body || node === document.documentElement) continue;
      return node;
    }
    return null;
  }

  function ensureHoverBox() {
    if (state.hoverBox && document.contains(state.hoverBox)) return state.hoverBox;
    const box = document.createElement('div');
    box.setAttribute(UI_ATTR, '1');
    Object.assign(box.style, {
      position: 'fixed',
      zIndex: String(CFG.zIndex - 1),
      pointerEvents: 'none',
      border: `2px solid ${CFG.selectorOutlineColor}`,
      background: CFG.selectorFillColor,
      borderRadius: '4px',
      boxSizing: 'border-box',
      display: 'none'
    });
    document.documentElement.appendChild(box);
    state.hoverBox = box;
    return box;
  }

  function updateHover(el) {
    const box = ensureHoverBox();
    if (!(el instanceof Element) || !visible(el)) {
      box.style.display = 'none';
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block',
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(0, rect.width)}px`,
      height: `${Math.max(0, rect.height)}px`
    });
  }

  function startSelectorMode() {
    state.selectorMode = true;
    setStatus('Click an error element...');
    log('Selector mode started');

    const onMove = (event) => updateHover(selectableAt(event.clientX, event.clientY));
    const onClick = (event) => {
      if (!state.selectorMode) return;
      if (isUi(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const target = selectableAt(event.clientX, event.clientY);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      saveRuleFromElement(target).catch((err) => log(`Save selector failed: ${err?.message || err}`));
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      stopSelectorMode('Selector canceled');
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    state.selectorListeners = [
      () => document.removeEventListener('mousemove', onMove, true),
      () => document.removeEventListener('click', onClick, true),
      () => document.removeEventListener('keydown', onKey, true)
    ];
  }

  function stopSelectorMode(message = '', options = {}) {
    state.selectorMode = false;
    for (const fn of state.selectorListeners) {
      try { fn(); } catch {}
    }
    state.selectorListeners = [];
    try { state.hoverBox && (state.hoverBox.style.display = 'none'); } catch {}
    if (options.logIt !== false && message) log(message);
    setStatus(`${hostLabel()} | ${state.rules.length} rule(s)`);
  }

  async function saveRuleFromElement(el) {
    stopSelectorMode('', { logIt: false });
    const selector = buildSelector(el);
    const fingerprint = buildFingerprint(el);
    if (!selector) {
      log('Could not build selector for clicked element');
      return;
    }

    const defaultReason = norm(el.innerText || el.textContent || '');
    const reason = norm(window.prompt('What should be written in the failed note when this selector is visible?', defaultReason));
    if (!reason) {
      log('Selector save canceled: no note message');
      return;
    }

    const label = norm(window.prompt('Short label for this shared selector rule?', reason)) || reason;
    const rule = {
      ruleId: buildRuleId(selector, fingerprint.textFingerprint || reason),
      enabled: true,
      label,
      savedErrorText: reason,
      selector,
      fingerprint,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    await upsertSharedRule(rule);
  }

  function getAllRoots(root = document) {
    const out = [];
    const seen = new WeakSet();
    function walk(candidate) {
      if (!candidate || seen.has(candidate)) return;
      seen.add(candidate);
      out.push(candidate);
      let nodes = [];
      try { nodes = Array.from(candidate.querySelectorAll('*')); } catch {}
      for (const node of nodes) {
        try { if (node.shadowRoot) walk(node.shadowRoot); } catch {}
        try { if (node.tagName === 'IFRAME' && node.contentDocument) walk(node.contentDocument); } catch {}
      }
    }
    walk(root);
    return out;
  }

  function queryAllDeep(selector) {
    const found = [];
    const seen = new WeakSet();
    for (const root of getAllRoots()) {
      let nodes = [];
      try { nodes = Array.from(root.querySelectorAll(selector)); } catch {}
      for (const node of nodes) {
        if (!(node instanceof Element) || seen.has(node)) continue;
        seen.add(node);
        found.push(node);
      }
    }
    return found;
  }

  function fingerprintMatches(rule, el) {
    const saved = isPlainObject(rule?.fingerprint) ? rule.fingerprint : {};
    const current = buildFingerprint(el);
    if (saved.id && current.id && saved.id === current.id) return true;

    let required = 0;
    let score = 0;
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

  function findRuleMatch(rule) {
    const selector = norm(rule?.selector || '');
    if (!selector) return null;
    const nodes = queryAllDeep(selector);
    for (const node of nodes) {
      if (!visible(node)) continue;
      if (!fingerprintMatches(rule, node)) continue;
      return node;
    }
    return null;
  }

  function readSentMap() {
    const value = readLocalJson(SENT_KEY, {});
    return isPlainObject(value) ? value : {};
  }

  function writeSentMap(map) {
    const entries = Object.entries(isPlainObject(map) ? map : {})
      .sort((a, b) => String(b[1] || '').localeCompare(String(a[1] || '')))
      .slice(0, CFG.maxSent);
    try { localStorage.setItem(SENT_KEY, JSON.stringify(Object.fromEntries(entries), null, 2)); } catch {}
  }

  function hasSent(key) {
    return !!readSentMap()[key];
  }

  function markSent(key) {
    const map = readSentMap();
    map[key] = nowIso();
    writeSentMap(map);
  }

  function extractAzId(value) {
    if (!isPlainObject(value)) return '';
    return norm(
      value.azId ||
      value.ticketId ||
      value['AZ ID'] ||
      value.currentJob?.['AZ ID'] ||
      value.az?.['AZ ID'] ||
      value.data?.currentJob?.['AZ ID'] ||
      value.data?.['AZ ID'] ||
      ''
    );
  }

  function readCurrentAzId() {
    for (const key of CURRENT_JOB_KEYS) {
      const azId = extractAzId(readGMJson(key, null));
      if (azId) return azId;
    }
    for (const key of CURRENT_JOB_KEYS) {
      const azId = extractAzId(readLocalJson(key, null));
      if (azId) return azId;
    }
    return '';
  }

  function publishMissingPayloadTrigger(azId, reason, rule) {
    const cleanAzId = norm(azId || '');
    const message = norm(reason || '');
    if (!cleanAzId || !message) return false;
    const trigger = {
      ready: true,
      ticketId: cleanAzId,
      azId: cleanAzId,
      reason: message,
      selectorRuleId: norm(rule?.ruleId || ''),
      requestedAt: nowIso(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    writeBoth(MISSING_PAYLOAD_TRIGGER_KEY, trigger);
    log(`Triggered failed path from LEX selector | ${cleanAzId} | ${message}`);
    return true;
  }

  function tryCloseCurrentTab() {
    try { window.close(); } catch {}
    if (window.closed) return;
    try { window.open('', '_self'); } catch {}
    try { window.close(); } catch {}
  }

  function gwpcTimeoutMonitorOwnsRules() {
    return typeof window.__TM_GWPC_HEADER_TIMEOUT_CLEANUP__ === 'function';
  }

  function readCurrentJob() {
    for (const key of CURRENT_JOB_KEYS) {
      const value = readGMJson(key, null);
      if (isPlainObject(value) && extractAzId(value)) return value;
    }
    for (const key of CURRENT_JOB_KEYS) {
      const value = readLocalJson(key, null);
      if (isPlainObject(value) && extractAzId(value)) return value;
    }
    return {};
  }

  function saveGwpcSelectorEvent(rule, matchedEl) {
    if (gwpcTimeoutMonitorOwnsRules()) {
      const logKey = `gwpc-owned|${rule.ruleId}`;
      if (state.lastMatchLogKey !== logKey) {
        state.lastMatchLogKey = logKey;
        log(`GWPC selector matched but GWPC Header Timeout Monitor owns bundle posting | ${rule.ruleId}`);
      }
      return false;
    }

    const job = readCurrentJob();
    const azId = extractAzId(job);
    if (!azId) {
      log(`GWPC selector matched but no AZ ID was available | ${rule.ruleId}`);
      return false;
    }

    const message = norm(rule.savedErrorText || '');
    const eventId = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const event = {
      eventId,
      id: eventId,
      dedupeKey: ['selector', azId, 'home', rule.ruleId].join('|'),
      actionKey: 'home_saved_selector_error',
      triggerType: 'selector',
      product: 'home',
      productLabel: 'Homeowners',
      errorType: 'SavedSelectorMatch',
      errorName: norm(rule.label || 'Saved selector error'),
      errorMessage: message,
      errorText: message,
      resultField: 'Done?',
      resultValue: message,
      selectorRuleId: norm(rule.ruleId || ''),
      selector: norm(rule.selector || ''),
      detectedAt: nowIso(),
      source: SCRIPT_NAME,
      sourceVersion: VERSION,
      capturedElementHtml: truncate(matchedEl?.outerHTML || '', 4000),
      capturedText: truncate(matchedEl?.innerText || matchedEl?.textContent || '', 600),
      page: { url: location.href, title: document.title },
      identity: {
        'AZ ID': azId,
        'Name': norm(job.Name || ''),
        'Mailing Address': norm(job['Mailing Address'] || ''),
        'SubmissionNumber': norm(job.SubmissionNumber || '')
      }
    };

    const bundle = readLocalJson(BUNDLE_KEY, {}) || {};
    const next = isPlainObject(bundle) ? bundle : {};
    next['AZ ID'] = azId;
    next.timeout = isPlainObject(next.timeout) ? next.timeout : {};
    next.timeout.ready = true;
    next.timeout.events = Array.isArray(next.timeout.events) ? next.timeout.events : [];
    if (!next.timeout.events.some((item) => norm(item?.dedupeKey || '') === event.dedupeKey)) {
      next.timeout.events.push(event);
    }
    next.timeout.lastEvent = event;
    next.timeout.events = next.timeout.events.slice(-50);
    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = nowIso();
    next.meta.lastWriter = SCRIPT_NAME;
    try { localStorage.setItem(BUNDLE_KEY, JSON.stringify(next, null, 2)); } catch {}
    try {
      localStorage.setItem(FORCE_SEND_KEY, JSON.stringify({
        azId,
        product: 'home',
        eventId,
        triggerType: 'selector',
        reason: `selector:${eventId}`,
        requestedAt: nowIso(),
        source: SCRIPT_NAME,
        version: VERSION
      }, null, 2));
    } catch {}
    log(`Saved GWPC selector event to bundle | ${rule.ruleId} | ${message}`);
    return true;
  }

  function scanRules() {
    if (state.destroyed || state.selectorMode || state.syncBusy) return;
    if (!state.rules.length) return;

    const kind = hostKind();
    if (kind !== 'lex' && kind !== 'gwpc') return;

    for (const rule of state.rules) {
      if (!rule || rule.enabled === false) continue;
      const matched = findRuleMatch(rule);
      if (!matched) continue;

      const azId = readCurrentAzId();
      const sentKey = `${kind}|${azId || 'no-az'}|${rule.ruleId}`;
      if (hasSent(sentKey)) continue;

      if (kind === 'lex') {
        if (azId && publishMissingPayloadTrigger(azId, rule.savedErrorText, rule)) {
          markSent(sentKey);
        } else {
          log(`LEX selector matched but no AZ ID was available | ${rule.ruleId}`);
        }
        tryCloseCurrentTab();
        return;
      }

      if (kind === 'gwpc') {
        if (saveGwpcSelectorEvent(rule, matched)) markSent(sentKey);
        return;
      }
    }
  }
})();
