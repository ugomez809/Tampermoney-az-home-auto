// ==UserScript==
// @name         AZ TO GWPC Shared Ticket Handoff V1.0
// @namespace    home.bot.az.to.gwpc.shared.ticket.handoff
// @version      1.0
// @description  Shared AZ -> GWPC Ticket ID handoff using one Tampermonkey script. AZ saves Ticket ID into shared GM storage; GWPC matches Name + Mailing Address and writes tm_pc_current_job_v1. LEX ignored.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'AZ TO GWPC Shared Ticket Handoff';
  const VERSION = '1.0';

  const GM_KEYS = {
    HANDOFF: 'hb_shared_az_to_gwpc_ticket_handoff_v1'
  };

  const LS_KEYS = {
    PANEL_POS: 'hb_shared_az_to_gwpc_ticket_handoff_panel_pos_v1',
    LAST_APPLIED: 'hb_shared_az_to_gwpc_ticket_handoff_last_applied_v1'
  };

  const SS_KEYS = {
    STOP: 'hb_shared_az_to_gwpc_ticket_handoff_stop_v1'
  };

  const CFG = {
    tickMs: 1000,
    handoffMaxAgeMs: 6 * 60 * 60 * 1000,
    maxLogs: 18,
    zIndex: 2147483647,
    panelRight: 12,
    panelBottom: 12
  };

  const state = {
    running: sessionStorage.getItem(SS_KEYS.STOP) !== '1',
    busy: false,
    logs: [],
    ui: null,
    lastIdleKey: '',
    lastAzSig: ''
  };

  init();

  function init() {
    buildUI();
    log(`Loaded ${SCRIPT_NAME} V${VERSION}`);
    log(isAzOrigin() ? 'Mode: AZ capture' : isGwpcOrigin() ? 'Mode: GWPC apply' : 'Mode: idle');
    setStatus(state.running ? 'Running' : 'Stopped');
    setInterval(tick, CFG.tickMs);
    tick();
  }

  function tick() {
    if (!state.running || state.busy) return;

    state.busy = true;

    Promise.resolve()
      .then(() => {
        if (isAzOrigin()) return runAzCapture();
        if (isGwpcOrigin()) return runGwpcApply();
        setIdle('unsupported', 'Unsupported origin');
      })
      .catch((err) => {
        log(`Failed: ${err?.message || err}`);
        setStatus('Failed');
      })
      .finally(() => {
        state.busy = false;
      });
  }

  function isAzOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isGwpcOrigin() {
    return /(^|\.)policycenter(?:-2|-3)?\.farmersinsurance\.com$/i.test(location.hostname);
  }

  function runAzCapture() {
    const payload = safeJsonParse(localStorage.getItem('tm_az_payload_v1'), null);
    if (!payload || typeof payload !== 'object') {
      setIdle('az-wait', 'AZ waiting for tm_az_payload_v1');
      return;
    }

    const ticketId = clean(
      payload.ticketId ||
      payload['AZ ID'] ||
      payload.az?.['AZ ID'] ||
      payload.az?.ticketId ||
      ''
    );

    const first = clean(payload.az?.['AZ Name'] || payload.az?.firstName || payload.az?.first || '');
    const last = clean(payload.az?.['AZ Last'] || payload.az?.lastName || payload.az?.last || '');
    const name = clean([first, last].filter(Boolean).join(' '));

    const mailingAddress = buildAzMailingAddress(payload.az || {});
    const savedAt = clean(payload.meta?.savedAt || payload.savedAt || new Date().toISOString());

    if (!ticketId || !name || !mailingAddress) {
      setIdle('az-incomplete', 'AZ payload found but missing Ticket ID / Name / Address');
      return;
    }

    const handoff = {
      ticketId,
      name,
      mailingAddress,
      savedAt,
      source: {
        origin: location.origin,
        href: location.href
      }
    };

    const sig = JSON.stringify(handoff);
    if (sig === state.lastAzSig) {
      setIdle('az-saved-same', `AZ ready: ${ticketId}`);
      return;
    }

    const existing = gmGetJson(GM_KEYS.HANDOFF, null);
    const existingSig = existing ? JSON.stringify(existing) : '';

    if (sig !== existingSig) {
      GM_setValue(GM_KEYS.HANDOFF, handoff);
      log(`AZ handoff saved | Ticket ID ${ticketId}`);
      log(`AZ Name: ${name}`);
      log(`AZ Address: ${mailingAddress}`);
    }

    state.lastAzSig = sig;
    setStatus(`AZ saved ${ticketId}`);
  }

  function runGwpcApply() {
    const handoff = gmGetJson(GM_KEYS.HANDOFF, null);
    if (!handoff || typeof handoff !== 'object') {
      setIdle('gw-no-handoff', 'GWPC waiting for AZ handoff');
      return;
    }

    const ageMs = Date.now() - toMs(handoff.savedAt);
    if (!Number.isFinite(ageMs) || ageMs > CFG.handoffMaxAgeMs) {
      setIdle('gw-stale-handoff', 'GWPC waiting for fresh AZ handoff');
      return;
    }

    const homePayload = safeJsonParse(localStorage.getItem('tm_pc_home_quote_grab_payload_v1'), null);
    if (!homePayload || typeof homePayload !== 'object' || !homePayload.sheetRow) {
      setIdle('gw-no-home', 'GWPC waiting for tm_pc_home_quote_grab_payload_v1');
      return;
    }

    const row = homePayload.sheetRow || {};
    const gwName = clean(row['Name'] || row.name || '');
    const gwAddress = clean(row['Mailing Address'] || row.mailingAddress || '');
    const submissionNumber = clean(row['Submission Number'] || row.submissionNumber || '');

    if (!gwName || !gwAddress) {
      setIdle('gw-home-incomplete', 'GWPC payload missing Name / Mailing Address');
      return;
    }

    const nameMatch = namesLikelySame(handoff.name, gwName);
    const addressMatch = addressesLikelySame(handoff.mailingAddress, gwAddress);

    if (!nameMatch || !addressMatch) {
      setIdle(
        'gw-mismatch',
        `GWPC mismatch | AZ=${handoff.name} | GWPC=${gwName}`
      );
      return;
    }

    const applySig = [
      clean(handoff.ticketId),
      normalizeCompare(gwName),
      normalizeCompare(gwAddress),
      clean(submissionNumber)
    ].join(' | ');

    const lastApplied = localStorage.getItem(LS_KEYS.LAST_APPLIED) || '';
    const currentJob = safeJsonParse(localStorage.getItem('tm_pc_current_job_v1'), {}) || {};

    const currentAzId = clean(currentJob['AZ ID'] || currentJob.azId || '');
    const currentName = clean(currentJob['Name'] || currentJob.name || '');
    const currentAddress = clean(currentJob['Mailing Address'] || currentJob.mailingAddress || '');

    if (lastApplied === applySig &&
        currentAzId === clean(handoff.ticketId) &&
        namesLikelySame(currentName || gwName, gwName) &&
        addressesLikelySame(currentAddress || gwAddress, gwAddress)) {
      setIdle('gw-already-applied', `GWPC linked ${handoff.ticketId}`);
      return;
    }

    if (currentAzId &&
        currentAzId !== clean(handoff.ticketId) &&
        !namesLikelySame(currentName, gwName)) {
      log(`Blocked overwrite | existing AZ ID ${currentAzId} != ${handoff.ticketId}`);
      setStatus('Blocked overwrite');
      return;
    }

    const nextJob = {
      'AZ ID': clean(handoff.ticketId),
      'Name': gwName,
      'Mailing Address': gwAddress,
      'SubmissionNumber': submissionNumber,
      'updatedAt': new Date().toISOString()
    };

    localStorage.setItem('tm_pc_current_job_v1', JSON.stringify(nextJob, null, 2));
    localStorage.setItem(LS_KEYS.LAST_APPLIED, applySig);

    log(`GWPC current job written | AZ ID ${nextJob['AZ ID']}`);
    log(`GWPC Name: ${nextJob['Name']}`);
    log(`GWPC Address: ${nextJob['Mailing Address']}`);
    log(`GWPC Submission: ${nextJob['SubmissionNumber'] || '(blank)'}`);
    setStatus(`GWPC linked ${nextJob['AZ ID']}`);
  }

  function buildAzMailingAddress(az) {
    const street = clean(az['AZ Street Address'] || az.address || '');
    const city = clean(az['AZ City'] || az.city || '');
    const stateValue = clean(az['AZ State'] || az.state || '');
    const zip = clean(az['AZ Postal Code'] || az.zip || az.zipCode || '');

    if (street && city && stateValue && zip) return `${street}, ${city}, ${stateValue} ${zip}`;
    if (street && city && stateValue) return `${street}, ${city}, ${stateValue}`;
    return clean([street, city, stateValue, zip].filter(Boolean).join(', '));
  }

  function gmGetJson(key, fallback) {
    try {
      const value = GM_getValue(key, null);
      if (value == null) return fallback;
      if (typeof value === 'object') return value;
      if (typeof value === 'string') return safeJsonParse(value, fallback);
      return fallback;
    } catch {
      return fallback;
    }
  }

  function toMs(value) {
    const n = Date.parse(String(value || ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCompare(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[\.,#]/g, ' ')
      .replace(/\bunit\b/g, ' ')
      .replace(/\bapartment\b/g, ' ')
      .replace(/\bsuite\b/g, ' ')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bhighway\b/g, 'hwy')
      .replace(/\btrail\b/g, 'trl')
      .replace(/\bterrace\b/g, 'ter')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
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

    if (!aa || !bb) return false;
    if (aa === bb) return true;
    if (aa.includes(bb) || bb.includes(aa)) return true;

    const aaNoComma = aa.replace(/,/g, ' ');
    const bbNoComma = bb.replace(/,/g, ' ');
    if (aaNoComma === bbNoComma) return true;

    return false;
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function setIdle(key, text) {
    if (state.lastIdleKey === key) return;
    state.lastIdleKey = key;
    setStatus(text);
    log(text);
  }

  function setStatus(text) {
    if (state.ui?.status) state.ui.status.textContent = text;
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > CFG.maxLogs) state.logs.length = CFG.maxLogs;
    console.log(`[${SCRIPT_NAME}] ${msg}`);
    renderLogs();
  }

  function renderLogs() {
    if (!state.ui?.logs) return;
    state.ui.logs.innerHTML = state.logs.map(x => `<div style="margin-bottom:4px;">${escapeHtml(x)}</div>`).join('');
  }

  function buildUI() {
    const old = document.getElementById('hb-shared-az-gwpc-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'hb-shared-az-gwpc-panel';
    panel.style.cssText = [
      'position:fixed',
      `right:${CFG.panelRight}px`,
      `bottom:${CFG.panelBottom}px`,
      'width:360px',
      'background:rgba(17,24,39,.96)',
      'color:#f9fafb',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:12px',
      'box-shadow:0 10px 28px rgba(0,0,0,.35)',
      'font:12px/1.35 Arial,sans-serif',
      `z-index:${CFG.zIndex}`,
      'overflow:hidden'
    ].join(';');

    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <div id="hb-shared-az-gwpc-head" style="padding:8px 10px;background:rgba(255,255,255,.06);cursor:move;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.75;">V${VERSION}</div>
      </div>
      <div style="padding:10px;">
        <div id="hb-shared-az-gwpc-status" style="font-weight:700;color:#93c5fd;margin-bottom:8px;">Ready</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <button id="hb-shared-az-gwpc-toggle" type="button" style="border:0;border-radius:8px;padding:8px 10px;background:${state.running ? '#b91c1c' : '#166534'};color:#fff;font-weight:700;cursor:pointer;">${state.running ? 'STOP' : 'START'}</button>
          <button id="hb-shared-az-gwpc-copy" type="button" style="border:0;border-radius:8px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">COPY LOGS</button>
        </div>
        <div style="font-size:11px;opacity:.82;margin-bottom:8px;">AZ captures Ticket ID. GWPC writes tm_pc_current_job_v1. LEX ignored.</div>
        <div id="hb-shared-az-gwpc-logs" style="max-height:180px;overflow:auto;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-shared-az-gwpc-head');
    const toggleBtn = panel.querySelector('#hb-shared-az-gwpc-toggle');
    const copyBtn = panel.querySelector('#hb-shared-az-gwpc-copy');

    toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      if (state.running) {
        sessionStorage.removeItem(SS_KEYS.STOP);
        log('Resumed');
      } else {
        sessionStorage.setItem(SS_KEYS.STOP, '1');
        log('Stopped for this page session');
      }
      toggleBtn.textContent = state.running ? 'STOP' : 'START';
      toggleBtn.style.background = state.running ? '#b91c1c' : '#166534';
      setStatus(state.running ? 'Running' : 'Stopped');
      state.lastIdleKey = '';
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText([...state.logs].reverse().join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    makeDraggable(panel, head);

    state.ui = {
      panel,
      status: panel.querySelector('#hb-shared-az-gwpc-status'),
      logs: panel.querySelector('#hb-shared-az-gwpc-logs')
    };

    renderLogs();
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEYS.PANEL_POS) || 'null');
    } catch {
      return null;
    }
  }

  function savePanelPos(panel) {
    try {
      localStorage.setItem(LS_KEYS.PANEL_POS, JSON.stringify({
        left: panel.style.left || '',
        top: panel.style.top || ''
      }));
    } catch {}
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;

      const r = panel.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      sl = r.left;
      st = r.top;

      panel.style.left = `${r.left}px`;
      panel.style.top = `${r.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, sl + (e.clientX - sx)));
      const top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, st + (e.clientY - sy)));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      savePanelPos(panel);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();