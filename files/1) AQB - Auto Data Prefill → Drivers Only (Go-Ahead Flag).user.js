// ==UserScript==
// @name         1) AQB - Auto Data Prefill → Drivers Only (Go-Ahead Flag)
// @namespace    tm.pc.aqb.1.autodataprefill.drivers
// @version      1.7
// @description  Gate: Submission (Draft) + Personal Auto + header "Auto Data Prefill". Drivers only: set dropdowns, Gender->Non-Binary (if selectable), DOB random 26-50 if empty/invalid/under 26, Age Lic min 16 and random 16-22 if too high. Sets localStorage aqb_step_drivers_done=1 when finished.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/1%29%20AQB%20-%20Auto%20Data%20Prefill%20%E2%86%92%20Drivers%20Only%20%28Go-Ahead%20Flag%29.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/1%29%20AQB%20-%20Auto%20Data%20Prefill%20%E2%86%92%20Drivers%20Only%20%28Go-Ahead%20Flag%29.user.js
// ==/UserScript==

(function () {
  'use strict';

  const REQUIRED_LABELS = ['Submission (Draft)', 'Personal Auto'];
  const HEADER_STARTS_WITH = 'Auto Data Prefill';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';

  const DONE_KEY = 'aqb_step_drivers_done';
  const LEGACY_DONE_KEY = 'aqb_step_autodataprefill_done';

  const DRV_ACCEPT_REASON_TEXT = 'Excluded Driver';
  const DRV_REL_TO_PNI_TEXT    = 'Resident Relative';
  const DRV_MARITAL_TEXT       = 'Single / Separated';
  const DRV_GENDER_WANT_TEXT   = 'Non-Binary';

  const DRV_MIN_AGE_YEARS      = 26;
  const DRV_MAX_AGE_YEARS      = 50;
  const DRV_MIN_AGE_LIC        = 16;
  const DRV_MAX_AGE_LIC_RANDOM_MIN = 16;
  const DRV_MAX_AGE_LIC_RANDOM_MAX = 22;

  const BTN_TEXT_ON  = 'AQB: STOP';
  const BTN_TEXT_OFF = 'AQB: START';

  let armed = true;
  let done  = false;
  let mo    = null;

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
      if (armed) tick();
    });

    document.body.appendChild(btn);
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

  function dispatchAll(el) {
    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.blur?.(); } catch {}
  }

  function hasLabelExact(txt) {
    return Array.from(document.querySelectorAll('.gw-label'))
      .some(n => (n.textContent || '').trim() === txt && isVisible(n));
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
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

  function normalizeHeaderText(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    if (s.length % 2 === 0) {
      const half = s.slice(0, s.length / 2);
      if (half === s.slice(s.length / 2)) return half.trim();
    }
    return s;
  }

  function setSelectByText(sel, desiredText) {
    if (!sel || sel.disabled) return false;

    const want = (desiredText || '').trim();
    if (!want) return false;

    const opts = Array.from(sel.options || []);
    let match = opts.find(o => (o.textContent || '').trim() === want);

    if (!match) {
      const wlow = want.toLowerCase();
      match = opts.find(o => (o.textContent || '').trim().toLowerCase() === wlow)
           || opts.find(o => (o.textContent || '').trim().toLowerCase().includes(wlow));
    }
    if (!match && want.toLowerCase().includes('non')) {
      match = opts.find(o => (o.textContent || '').trim().toLowerCase().includes('non'));
    }

    if (!match) return false;
    if (sel.value === match.value) return false;

    sel.value = match.value;
    dispatchAll(sel);
    return true;
  }

  function setInputValue(input, value) {
    if (!input || input.disabled || input.readOnly) return false;
    const next = String(value ?? '').trim();
    if (!next) return false;
    if ((input.value || '').trim() === next) return false;
    input.focus?.();
    input.value = next;
    dispatchAll(input);
    return true;
  }

  function getInputByCell(cell) {
    if (!cell) return null;
    return cell.querySelector('input,textarea');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatMMDDYYYY(d) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
  }

  function parseDob(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!m) return null;

    let mm = Number(m[1]);
    let dd = Number(m[2]);
    let yyyy = Number(m[3]);

    if (!Number.isFinite(mm) || !Number.isFinite(dd) || !Number.isFinite(yyyy)) return null;
    if (yyyy < 100) yyyy += (yyyy >= 50 ? 1900 : 2000);

    const d = new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
    if (
      d.getFullYear() !== yyyy ||
      d.getMonth() !== (mm - 1) ||
      d.getDate() !== dd
    ) return null;

    return d;
  }

  function getAgeYears(dob, today = new Date()) {
    if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) return null;

    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();

    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
      age--;
    }

    return age;
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomDob26to50() {
    const today = new Date();
    const latest = new Date(today.getFullYear() - DRV_MIN_AGE_YEARS, today.getMonth(), today.getDate(), 12, 0, 0, 0);
    const earliest = new Date(today.getFullYear() - DRV_MAX_AGE_YEARS, today.getMonth(), today.getDate(), 12, 0, 0, 0);

    const start = earliest.getTime();
    const end = latest.getTime();
    const pick = randomInt(start, end);

    const d = new Date(pick);
    d.setHours(12, 0, 0, 0);
    return formatMMDDYYYY(d);
  }

  function normalizeNumberish(raw) {
    const cleaned = String(raw || '').trim().replace(/[^\d\-]/g, '');
    if (!cleaned) return null;
    const num = parseInt(cleaned, 10);
    return Number.isFinite(num) ? num : null;
  }

  function randomAgeLic16to22() {
    return String(randomInt(DRV_MAX_AGE_LIC_RANDOM_MIN, DRV_MAX_AGE_LIC_RANDOM_MAX));
  }

  function ensureDobRule(input) {
    if (!input || input.disabled || input.readOnly) return false;

    const raw = (input.value || '').trim();
    const parsed = parseDob(raw);
    const age = parsed ? getAgeYears(parsed) : null;

    if (!parsed || age == null || age < DRV_MIN_AGE_YEARS) {
      return setInputValue(input, randomDob26to50());
    }

    return false;
  }

  function ensureAgeLicRule(input, currentAgeFromDob) {
    if (!input || input.disabled || input.readOnly) return false;

    const raw = (input.value || '').trim();
    const num = normalizeNumberish(raw);

    if (!raw || num == null) {
      return setInputValue(input, String(DRV_MIN_AGE_LIC));
    }

    if (num < DRV_MIN_AGE_LIC) {
      return setInputValue(input, String(DRV_MIN_AGE_LIC));
    }

    if (Number.isFinite(currentAgeFromDob) && num > currentAgeFromDob) {
      return setInputValue(input, randomAgeLic16to22());
    }

    return false;
  }

  function findDriversTable() {
    const any = document.querySelector(
      'select[name*="PADriversExtPanelSet-DriversLV-"][name$="-maritalStatus"],' +
      'select[name*="PADriversExtPanelSet-DriversLV-"][name$="-acceptReason"]'
    );
    return any?.closest('table') || null;
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

  function getDriverRows(table) {
    if (!table) return [];
    const bodyRows = table.querySelectorAll('tbody tr').length
      ? table.querySelectorAll('tbody tr')
      : table.querySelectorAll('tr');

    return Array.from(bodyRows).filter(tr =>
      tr.querySelector('select[name*="PADriversExtPanelSet-DriversLV-"]')
    );
  }

  function applyDriversOnce() {
    const table = findDriversTable();
    if (!table) return;

    const dobIdx    = getColumnIndexByName(table, 'Date Of Birth');
    const genderIdx = getColumnIndexByName(table, 'Gender');
    const ageLicIdx = getColumnIndexByName(table, 'Age Lic in US/CAN');

    const rows = getDriverRows(table);
    for (const tr of rows) {
      setSelectByText(tr.querySelector('select[name$="-acceptReason"]'),      DRV_ACCEPT_REASON_TEXT);
      setSelectByText(tr.querySelector('select[name$="-relationShipToPNI"]'), DRV_REL_TO_PNI_TEXT);
      setSelectByText(tr.querySelector('select[name$="-maritalStatus"]'),     DRV_MARITAL_TEXT);

      if (genderIdx >= 0) {
        const tds = tr.querySelectorAll('td,th');
        const cell = tds[genderIdx];
        const sel = cell?.querySelector('select');
        if (sel) setSelectByText(sel, DRV_GENDER_WANT_TEXT);
      } else {
        const sels = Array.from(tr.querySelectorAll('select'));
        for (const s of sels) {
          if (Array.from(s.options || []).some(o =>
            (o.textContent || '').trim().toLowerCase().includes('non')
          )) {
            setSelectByText(s, DRV_GENDER_WANT_TEXT);
          }
        }
      }

      let dobInput = null;
      if (dobIdx >= 0) {
        const tds = tr.querySelectorAll('td,th');
        dobInput = getInputByCell(tds[dobIdx]);
      }
      ensureDobRule(dobInput);

      const finalDob = parseDob(dobInput?.value || '');
      const currentAgeFromDob = finalDob ? getAgeYears(finalDob) : null;

      let ageInp = tr.querySelector('input[name$="-AgeLicInUSCanada"],input[name$="AgeLicInUSCanada"]');
      if (!ageInp && ageLicIdx >= 0) {
        const tds = tr.querySelectorAll('td,th');
        ageInp = getInputByCell(tds[ageLicIdx]);
      }
      ensureAgeLicRule(ageInp, currentAgeFromDob);
    }
  }

  function setDoneFlag() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch {}
  }

  function clearDoneFlag() {
    try { localStorage.removeItem(DONE_KEY); } catch {}
  }

  function clearLegacyDoneFlag() {
    try { localStorage.removeItem(LEGACY_DONE_KEY); } catch {}
  }

  async function runSequence() {
    if (done || !armed || isGloballyPaused()) return;
    if (!gateOK() || !headerOK()) return;

    const start = Date.now();
    while (Date.now() - start < 1200) {
      if (!armed || done || isGloballyPaused()) return;
      applyDriversOnce();
      await new Promise(r => setTimeout(r, 200));
    }

    setDoneFlag();

    done = true;
    if (mo) {
      try { mo.disconnect(); } catch {}
      mo = null;
    }
  }

  function tick() {
    if (!armed || done || isGloballyPaused()) return;
    runSequence().catch(() => {});
  }

  function init() {
    clearDoneFlag();
    clearLegacyDoneFlag();
    mountToggle();

    mo = new MutationObserver(tick);
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

    document.addEventListener('visibilitychange', tick);
    tick();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();
