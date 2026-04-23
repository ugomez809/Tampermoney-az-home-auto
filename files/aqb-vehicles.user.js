// ==UserScript==
// @name         2) AQB - Auto Data Prefill → Vehicles Only (listens to drivers flag)
// @namespace    homebot.aqb-vehicles
// @version      1.5.2
// @description  Waits for Submission (Draft) + Personal Auto + header "Auto Data Prefill" + aqb_step_drivers_done=1. Then runs only the Vehicles logic: remove rows if Model Year/Make/Model/Body Type has any empty cell, waits 3s before setting Primary Driver from the Accepted driver row, then waits another 3s before handing off to Specialty. If a Primary Driver required-field error appears later, it re-arms and runs again. Sets aqb_step_vehicles_done=1 and aqb_step_specialty_start=1 when finished.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-vehicles.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/aqb-vehicles.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'AQB Vehicles';

  /************* CONFIG *************/
  const REQUIRED_LABELS = ['Submission (Draft)', 'Personal Auto'];
  const HEADER_STARTS_WITH = 'Auto Data Prefill';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';

  const WAIT_KEY = 'aqb_step_drivers_done';
  const DONE_KEY = 'aqb_step_vehicles_done';
  const SPECIALTY_START_KEY = 'aqb_step_specialty_start';

  const REMOVE_LABEL_ARIA = 'Remove Vehicle';
  const WAIT_AFTER_CHECKBOX_MS = 1000;
  const WAIT_AFTER_REMOVE_MS = 2200;
  const WAIT_AFTER_CONFIRM_MS = 1200;
  const WAIT_BEFORE_PRIMARY_DRIVER_MS = 3000;
  const WAIT_BEFORE_SPECIALTY_TRIGGER_MS = 3000;

  const VEH_PRIMARY_DRIVER_SUFFIX = '-PrimaryDriverLV';

  const BTN_TEXT_ON = 'AQB: STOP';
  const BTN_TEXT_OFF = 'AQB: START';

  const POLL_MS = 250;
  const REARM_COOLDOWN_MS = 1500;

  const PRIMARY_DRIVER_ERROR_TEXT = 'Primary Driver : Missing required field "Primary Driver"';
  /*********************************/

  let armed = true;
  let finished = false;
  let running = false;
  let lastRearmAt = 0;

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function readCurrentAzId() {
    const job = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    return String(job?.['AZ ID'] || '').trim();
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
  }

  function matchesStage(product, step) {
    const stage = readFlowStage();
    if (String(stage.product || '').trim() !== product || String(stage.step || '').trim() !== step) return false;
    if (!String(stage.azId || '').trim()) return true;
    return String(stage.azId || '').trim() === readCurrentAzId();
  }

  function writeFlowStage(product, step) {
    const next = {
      product,
      step,
      azId: readCurrentAzId(),
      updatedAt: new Date().toISOString(),
      source: 'AQB Vehicles',
      version: '1.5.2'
    };
    try { localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2)); } catch {}
  }

  function log(message) {
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
  }

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

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect?.();
    if (!r || r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (el.closest?.('[aria-hidden="true"]')) return false;
    return true;
  };

  function clickSmart(el) {
    try {
      el.scrollIntoView?.({ block: 'center', inline: 'center' });
      el.focus?.({ preventScroll: true });
      el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.click?.();
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  function dispatchAll(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.blur?.(); } catch {}
  }

  function hasLabelExact(txt) {
    return Array.from(document.querySelectorAll('.gw-label'))
      .some(n => (n.textContent || '').trim() === txt && isVisible(n));
  }

  function gateOK() {
    return matchesStage('auto', 'vehicles') && REQUIRED_LABELS.every(hasLabelExact);
  }

  function findHeaderEl() {
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
    return titles.find(t => ((t.textContent || '').trim().startsWith(HEADER_STARTS_WITH)));
  }

  function headerOK() {
    return !!findHeaderEl();
  }

  function waitKeyReady() {
    try {
      return localStorage.getItem(WAIT_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setDoneFlags() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch {}
    try { localStorage.setItem(SPECIALTY_START_KEY, '1'); } catch {}
    writeFlowStage('auto', 'specialty');
  }

  function clearDoneFlags() {
    try { localStorage.removeItem(DONE_KEY); } catch {}
    try { localStorage.removeItem(SPECIALTY_START_KEY); } catch {}
  }

  function normalizeHeaderText(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (s.length % 2 === 0) {
      const half = s.slice(0, s.length / 2);
      if (half === s.slice(s.length / 2)) return half.trim();
    }
    return s;
  }

  function getColumnIndexByName(table, wanted) {
    if (!table) return -1;
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) return -1;

    const ths = Array.from(headerRow.querySelectorAll('th,td'));
    for (let i = 0; i < ths.length; i++) {
      const txt = normalizeHeaderText(ths[i].textContent || '');
      if (txt.includes(wanted)) return i;
    }
    return -1;
  }

  function getColumnIndexByNames(table, wantedList) {
    for (const wanted of wantedList) {
      const idx = getColumnIndexByName(table, wanted);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function getCellValue(cell) {
    if (!cell) return '';

    const input = cell.querySelector('input[type="text"], input:not([type]), textarea');
    if (input) return String(input.value || '').trim();

    const select = cell.querySelector('select');
    if (select) {
      const opt = select.selectedOptions?.[0];
      return String(opt?.textContent || select.value || '').trim();
    }

    const rangeLabel = cell.querySelector('.gw-RangeValue .gw-label');
    if (rangeLabel) return String(rangeLabel.textContent || '').trim();

    const readonly = cell.querySelector('.gw-value-readonly-wrapper');
    if (readonly) return String(readonly.textContent || '').trim();

    return String(cell.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function primaryDriverErrorVisible() {
    const nodes = Array.from(document.querySelectorAll(
      '.gw-message, .gw-alert-error, .gw-message--displayable, .gw-message-and-suffix, [id$="_msgs"] .gw-WebMessage'
    ));

    return nodes.some(el => {
      if (!isVisible(el)) return false;
      const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      return txt.includes(PRIMARY_DRIVER_ERROR_TEXT);
    });
  }

  function maybeRearmFromPrimaryDriverError() {
    if (!armed || isGloballyPaused()) return;
    if (running) return;
    if (!gateOK()) return;
    if (!headerOK()) return;
    if (!waitKeyReady()) return;
    if (!primaryDriverErrorVisible()) return;

    const now = Date.now();
    if (now - lastRearmAt < REARM_COOLDOWN_MS) return;

    lastRearmAt = now;
    finished = false;
    clearDoneFlags();
  }

  // ---------- Vehicles table ----------
  function findVehiclesTable() {
    const root = document.querySelector('[id$="PAVehiclesExtPanelSet-VehiclesLV"]');
    if (root) {
      const table = root.querySelector('table.gw-ListViewWidget--table, table.gw-table, table');
      if (table) return table;
    }

    const any = document.querySelector(
      `select[name*="PAVehiclesExtPanelSet-VehiclesLV-"][name$="${VEH_PRIMARY_DRIVER_SUFFIX}"],` +
      `input[name*="PAVehiclesExtPanelSet-VehiclesLV-"][name$="-vinNumber"]`
    );
    return any?.closest('table') || null;
  }

  function getVehicleRows(table) {
    if (!table) return [];
    const bodyRows = table.querySelectorAll('tbody tr').length
      ? table.querySelectorAll('tbody tr')
      : table.querySelectorAll('tr');

    return Array.from(bodyRows).filter(tr =>
      tr.querySelector('input[name*="PAVehiclesExtPanelSet-VehiclesLV-"],select[name*="PAVehiclesExtPanelSet-VehiclesLV-"]')
    );
  }

  function findDriversTable() {
    const any = document.querySelector(
      'select[name*="PADriversExtPanelSet-DriversLV-"][name$="-maritalStatus"],' +
      'select[name*="PADriversExtPanelSet-DriversLV-"][name$="-acceptReason"],' +
      '[id$="PADriversExtPanelSet-DriversLV"]'
    );
    const root = any?.closest?.('[id$="PADriversExtPanelSet-DriversLV"]') || any;
    return root?.closest?.('table') || any?.closest?.('table') || null;
  }

  function getDriverRows(table) {
    if (!table) return [];
    const bodyRows = table.querySelectorAll('tbody tr').length
      ? table.querySelectorAll('tbody tr')
      : table.querySelectorAll('tr');

    return Array.from(bodyRows).filter(tr =>
      tr.querySelector('select[name*="PADriversExtPanelSet-DriversLV-"],[id$="-Name"]')
    );
  }

  function readDriverNameFromRow(tr, nameIdx) {
    const tds = tr.querySelectorAll('td,th');
    const fromCell = nameIdx >= 0 ? getCellValue(tds[nameIdx]) : '';
    if (fromCell) return fromCell;

    const byId = tr.querySelector('[id$="-Name"]');
    return getCellValue(byId) || '';
  }

  function findAcceptedDriverName() {
    const table = findDriversTable();
    if (!table) return '';

    const reasonIdx = getColumnIndexByNames(table, ['Accept/Reject Reason', 'Accept Reject Reason', 'Accept / Reject Reason']);
    const nameIdx = getColumnIndexByNames(table, ['Driver Name', 'Name', 'Driver']);
    if (reasonIdx < 0) return '';

    const rows = getDriverRows(table);
    for (const tr of rows) {
      const tds = tr.querySelectorAll('td,th');
      const reason = getCellValue(tds[reasonIdx]);
      if (String(reason || '').trim() !== 'Accepted') continue;

      const name = readDriverNameFromRow(tr, nameIdx).replace(/\s+/g, ' ').trim();
      if (name) return name;
    }

    return '';
  }

  function findRemoveVehicleClickable() {
    const lab = Array.from(document.querySelectorAll(`.gw-label[aria-label="${CSS.escape(REMOVE_LABEL_ARIA)}"]`))
      .find(isVisible);

    if (!lab) return null;

    let p = lab;
    for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && isVisible(p)) return p;
    }

    return lab;
  }

  function findConfirmClickable() {
    const wants = ['OK', 'Yes', 'Remove Vehicle', 'Remove'];
    const labels = Array.from(document.querySelectorAll('.gw-label, [role="button"], button, .gw-action--inner'));

    for (const el of labels) {
      if (!isVisible(el)) continue;
      const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!wants.includes(txt)) continue;

      let p = el;
      for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
        if ((p.matches?.('.gw-action--inner, button, [role="button"]') || p === el) && isVisible(p)) {
          return p;
        }
      }
      return el;
    }

    return null;
  }

  function getBadVehicleRow(table) {
    const modelYearIdx = getColumnIndexByName(table, 'Model Year');
    const makeIdx = getColumnIndexByName(table, 'Make');
    const modelIdx = getColumnIndexByName(table, 'Model');
    const bodyTypeIdx = getColumnIndexByName(table, 'Body Type');

    if ([modelYearIdx, makeIdx, modelIdx, bodyTypeIdx].some(i => i < 0)) return null;

    const rows = getVehicleRows(table);

    for (const tr of rows) {
      const tds = tr.querySelectorAll('td,th');
      const cellsToCheck = [
        tds[modelYearIdx],
        tds[makeIdx],
        tds[modelIdx],
        tds[bodyTypeIdx]
      ];

      const hasEmpty = cellsToCheck.some(cell => getCellValue(cell) === '');
      if (hasEmpty) return tr;
    }

    return null;
  }

  async function removeVehiclesWithAnyEmptyCoreCell() {
    for (let guard = 0; guard < 30; guard++) {
      if (!armed || isGloballyPaused()) return;
      const table = findVehiclesTable();
      if (!table) return;

      const badRow = getBadVehicleRow(table);
      if (!badRow) return;

      const rowCheckbox = badRow.querySelector('input[type="checkbox"][aria-label="select row"], input[type="checkbox"]');
      if (!rowCheckbox) return;

      if (!rowCheckbox.checked) {
        clickSmart(rowCheckbox);
        await sleep(WAIT_AFTER_CHECKBOX_MS);
      }

      const removeBtn = findRemoveVehicleClickable();
      if (!removeBtn) return;

      clickSmart(removeBtn);
      await sleep(500);

      const confirmBtn = findConfirmClickable();
      if (confirmBtn) {
        clickSmart(confirmBtn);
        await sleep(WAIT_AFTER_CONFIRM_MS);
      }

      await sleep(WAIT_AFTER_REMOVE_MS);
    }
  }

  function setPrimaryDriverAll() {
    if (isGloballyPaused()) return;
    const acceptedDriverName = findAcceptedDriverName();
    if (!acceptedDriverName) {
      log('Stopped: no Accepted driver found in Drivers table.');
      return { ok: false, reason: 'no-accepted-driver' };
    }

    const table = findVehiclesTable();
    if (!table) return { ok: false, reason: 'vehicles-table-missing' };

    const rows = getVehicleRows(table);
    for (const tr of rows) {
      const sel = tr.querySelector(`select[name$="${VEH_PRIMARY_DRIVER_SUFFIX}"]`);
      if (!sel || sel.disabled) continue;

      const opts = Array.from(sel.options || []);
      const pick = opts.find(o => (o.textContent || '').replace(/\s+/g, ' ').trim() === acceptedDriverName);
      if (!pick) {
        log(`Stopped: accepted driver "${acceptedDriverName}" not found in vehicle Primary Driver dropdown.`);
        return { ok: false, reason: 'accepted-driver-dropdown-mismatch', acceptedDriverName };
      }

      const curText = (sel.selectedOptions?.[0]?.textContent || '').replace(/\s+/g, ' ').trim();
      if (curText !== acceptedDriverName) {
        sel.value = pick.value;
        dispatchAll(sel);
      }
    }

    log(`Primary Driver set from Accepted driver: ${acceptedDriverName}`);
    return { ok: true, acceptedDriverName };
  }

  // ---------- Main ----------
  async function runOnce() {
    if (!armed || finished || running || isGloballyPaused()) return;
    if (!gateOK()) return;
    if (!headerOK()) return;
    if (!waitKeyReady()) return;

    const table = findVehiclesTable();
    if (!table) return;

    running = true;

    try {
      await removeVehiclesWithAnyEmptyCoreCell();
      if (!armed || isGloballyPaused()) return;

      await sleep(WAIT_BEFORE_PRIMARY_DRIVER_MS);
      if (!armed || isGloballyPaused()) return;

      const primaryDriverResult = setPrimaryDriverAll();
      if (!primaryDriverResult?.ok) {
        finished = true;
        return;
      }

      await sleep(WAIT_BEFORE_SPECIALTY_TRIGGER_MS);
      if (!armed || isGloballyPaused()) return;

      setDoneFlags();
      finished = true;
    } finally {
      running = false;
    }
  }

  function init() {
    clearDoneFlags();
    mountToggle();

    setInterval(() => {
      if (isGloballyPaused()) return;
      maybeRearmFromPrimaryDriverError();

      runOnce().catch(() => {
        running = false;
      });
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
