// ==UserScript==
// @name         2) AQB - Auto Data Prefill → Vehicles Only (listens to drivers flag)
// @namespace    tm.pc.aqb.2.autodataprefill.vehicles
// @version      1.3
// @description  Waits for Submission (Draft) + Personal Auto + header "Auto Data Prefill" + aqb_step_drivers_done=1. Then runs only the Vehicles logic: remove rows if Model Year/Make/Model/Body Type has any empty cell, then set Primary Driver to first non-<none>. If a Primary Driver required-field error appears later, it re-arms and runs again. Sets aqb_step_vehicles_done=1 and aqb_step_specialty_start=1 when finished.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/2%29%20AQB%20-%20Auto%20Data%20Prefill%20%E2%86%92%20Vehicles%20Only%20%28listens%20to%20drivers%20flag%29.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/2%29%20AQB%20-%20Auto%20Data%20Prefill%20%E2%86%92%20Vehicles%20Only%20%28listens%20to%20drivers%20flag%29.user.js
// ==/UserScript==

(function () {
  'use strict';

  /************* CONFIG *************/
  const REQUIRED_LABELS = ['Submission (Draft)', 'Personal Auto'];
  const HEADER_STARTS_WITH = 'Auto Data Prefill';

  const WAIT_KEY = 'aqb_step_drivers_done';
  const DONE_KEY = 'aqb_step_vehicles_done';
  const SPECIALTY_START_KEY = 'aqb_step_specialty_start';

  const REMOVE_LABEL_ARIA = 'Remove Vehicle';
  const WAIT_AFTER_CHECKBOX_MS = 1000;
  const WAIT_AFTER_REMOVE_MS = 2200;
  const WAIT_AFTER_CONFIRM_MS = 1200;

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
    return REQUIRED_LABELS.every(hasLabelExact);
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
    if (!armed) return;
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
    const table = findVehiclesTable();
    if (!table) return;

    const rows = getVehicleRows(table);
    for (const tr of rows) {
      const sel = tr.querySelector(`select[name$="${VEH_PRIMARY_DRIVER_SUFFIX}"]`);
      if (!sel || sel.disabled) continue;

      const curText = (sel.selectedOptions?.[0]?.textContent || '').trim();
      if (curText && curText !== '<none>') continue;

      const opts = Array.from(sel.options || []);
      const pick = opts.find(o => {
        const t = (o.textContent || '').trim();
        return t !== '' && t !== '<none>';
      });

      if (!pick) continue;

      sel.value = pick.value;
      dispatchAll(sel);
    }
  }

  // ---------- Main ----------
  async function runOnce() {
    if (!armed || finished || running) return;
    if (!gateOK()) return;
    if (!headerOK()) return;
    if (!waitKeyReady()) return;

    const table = findVehiclesTable();
    if (!table) return;

    running = true;

    try {
      await removeVehiclesWithAnyEmptyCoreCell();
      setPrimaryDriverAll();
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