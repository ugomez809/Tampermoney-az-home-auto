// ==UserScript==
// @name         Home Bot: Dwelling Water Rule
// @namespace    homebot.dwelling-water-rule
// @version      3.5
// @description  Dwelling step with Submission (Draft) gate, optional Create Valuation, optional Plumbing Replaced field, Year Built water-device rule, Garage Type fix after first Quote failure, then Quote.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/dwelling-water-rule.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/dwelling-water-rule.user.js
// ==/UserScript==

(function () {
  'use strict';

  try { window.__HB_DWELLING_WATER_RULE_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Home Bot: Dwelling Water Rule';
  const VERSION = '3.5';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';

  const CFG = {
    tickMs: 900,
    clickPauseMs: 400,
    fieldWaitMs: 25000,
    optionalFieldWaitMs: 2500,
    fieldsWaitAfterCreateMs: 30000,
    beforeQuoteWaitMs: 5000,
    afterQuoteWaitMs: 3000,
    afterGarageFixMs: 1200,
    garageErrorWaitMs: 7000,
    maxCreateAttempts: 3,
    maxQuoteAttempts: 3,
    tabNudgeCooldownMs: 1500,
    tabNudgeSettleMs: 2500,
    maxLogLines: 14,
    panelRight: 12,
    panelBottom: 12,
    zIndex: 2147483647
  };

  const REQUIRED_LABELS = ['Submission (Draft)', 'Homeowners'];
  const HEADER_STUCK_EXACT = 'Dwelling';

  const IDS = {
    createWrap:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-VRsikDV-createvaluation2',

    poolNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-SwimmingPool_1',

    solarNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-SolarPanels_1',

    trampolineNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-Trampoline_1',

    plumbingReplacedNo:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-PlmbngRplcdInLast20YrsNB_Ext_1'
  };

  const NAMES = {
    plumbing:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-PlumbingSystem',

    water:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-HoWaterProtectionDevice',

    yearBuilt:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-YearBuilt',

    garageType:
      'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-GarageType'
  };

  const state = {
    running: true,
    busy: false,
    done: false,
    createAttempts: 0,
    lastQuoteClickAt: 0,
    logs: [],
    intervalId: null,
    panel: null,
    statusEl: null,
    logEl: null,
    btn: null,
    styleEl: null,
    lastTabNudgeAt: 0
  };

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function readCurrentAzId() {
    const job = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    return normalizeText(job?.['AZ ID'] || '');
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
  }

  function matchesStage(product, step) {
    const stage = readFlowStage();
    if (normalizeText(stage.product) !== product || normalizeText(stage.step) !== step) return false;
    if (!normalizeText(stage.azId)) return true;
    return normalizeText(stage.azId) === readCurrentAzId();
  }

  function writeFlowStage(product, step) {
    const next = {
      product,
      step,
      azId: readCurrentAzId(),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    try { localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2)); } catch {}
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);
    if (state.logEl) state.logEl.textContent = state.logs.join('\n');
    console.log(`${SCRIPT_NAME}: ${msg}`);
  }

  function setStatus(msg) {
    if (state.statusEl) state.statusEl.textContent = msg;
  }

  function q(sel, root = document) {
    try { return root.querySelector(sel); } catch { return null; }
  }

  function byId(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function escAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function byName(name, tag = '') {
    return q(`${tag || ''}[name="${escAttr(name)}"]`);
  }

  function getTitleBarText() {
    return q('.gw-TitleBar--title')?.textContent?.trim() || '';
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect?.();
      if (!r || r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (el.closest?.('[aria-hidden="true"]')) return false;
      return true;
    } catch {
      return false;
    }
  }

  function hasLabelExact(txt) {
    return Array.from(document.querySelectorAll('.gw-label'))
      .some(el => (el.textContent || '').trim() === txt && isVisible(el));
  }

  function isDwellingHere() {
    if (getTitleBarText() === 'Dwelling') return true;
    if (byId(IDS.createWrap)) return true;
    if (byName(NAMES.yearBuilt, 'input')) return true;
    return false;
  }

  function gateOk() {
    return matchesStage('home', 'dwelling') && REQUIRED_LABELS.every(hasLabelExact) && isDwellingHere();
  }

  function stageReadyForDwelling() {
    if (!REQUIRED_LABELS.every(hasLabelExact)) return false;
    return matchesStage('home', 'dwelling') || getTitleBarText() === 'Dwelling';
  }

  function scrollFocus(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {
      try { el.focus(); } catch {}
    }
  }

  function strongClick(el) {
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

  function findActionByText(text) {
    const want = normalizeText(text).toLowerCase();
    if (!want) return null;

    const candidates = Array.from(document.querySelectorAll('.gw-action--inner, [role="tab"], [role="menuitem"], .gw-TabWidget, .gw-label'));
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const value = normalizeText(el.getAttribute?.('aria-label') || el.textContent || '').toLowerCase();
      if (!value || !value.includes(want)) continue;

      let cur = el;
      for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
        if (!isVisible(cur)) continue;
        if (cur.matches?.('.gw-action--inner, [role="tab"], [role="menuitem"], .gw-TabWidget, button, a')) {
          return cur;
        }
      }

      return el;
    }

    return null;
  }

  function nudgeDwellingTabIfNeeded() {
    if (!stageReadyForDwelling() || isDwellingHere()) return false;
    if ((Date.now() - state.lastTabNudgeAt) < CFG.tabNudgeCooldownMs) return false;

    const target = findActionByText('Dwelling');
    if (!target) return false;

    state.lastTabNudgeAt = Date.now();
    strongClick(target);
    log('Clicked Dwelling tab helper');
    return true;
  }

  function dispatchChange(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch {}
  }

  async function waitFor(fn, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!state.running) throw new Error('Stopped');
      const result = fn();
      if (result) return result;
      await sleep(250);
    }
    throw new Error(`Timeout waiting for ${label}`);
  }

  async function waitForOptional(fn, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!state.running) return null;
      const result = fn();
      if (result) return result;
      await sleep(250);
    }
    return null;
  }

  function fieldsReady() {
    return !!(
      byId(IDS.poolNo) &&
      byId(IDS.solarNo) &&
      byId(IDS.trampolineNo) &&
      byName(NAMES.plumbing, 'select') &&
      byName(NAMES.yearBuilt, 'input')
    );
  }

  function getCreateTargets() {
    const wrap = byId(IDS.createWrap);
    if (!wrap) return [];

    const exactRoleBtn = q(
      `#${CSS.escape(IDS.createWrap)} > div.gw-action--inner.gw-hasDivider[role="button"]`
    );
    const roleBtn = wrap.querySelector('div.gw-action--inner.gw-hasDivider[role="button"]');
    const inner = wrap.querySelector('div.gw-action--inner.gw-hasDivider');
    const label = wrap.querySelector('[aria-label="Create Valuation"], .gw-label');

    return [exactRoleBtn, roleBtn, inner, label, wrap].filter(Boolean);
  }

  function hasCreateValuationButton() {
    return getCreateTargets().length > 0;
  }

  async function clickCreateValuation() {
    const targets = getCreateTargets();

    if (!targets.length) {
      log('Create Valuation not available. Going straight to fill');
      return false;
    }

    for (const el of targets) {
      const txt = (el.textContent || '').trim();
      const tag = el.tagName.toLowerCase();
      const cls = String(el.className || '').trim().replace(/\s+/g, '.');
      log(`Trying Create Valuation -> ${tag}${cls ? '.' + cls : ''}${txt ? ` [${txt}]` : ''}`);

      strongClick(el);
      await sleep(CFG.clickPauseMs);

      if (fieldsReady()) {
        log('Dwelling fields appeared after Create Valuation');
        return true;
      }
    }

    return false;
  }

  async function ensureRadioChecked(id, label) {
    const el = await waitFor(() => byId(id), CFG.fieldWaitMs, label);

    if (el.checked) {
      log(`${label} already set`);
      return;
    }

    strongClick(el);
    await sleep(CFG.clickPauseMs);

    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (!el.checked) throw new Error(`Could not set ${label}`);
    log(`${label} set`);
  }

  async function ensureRadioCheckedOptional(id, label) {
    const el = await waitForOptional(() => byId(id), CFG.optionalFieldWaitMs);

    if (!el) {
      log(`${label} missing. Continuing`);
      return false;
    }

    if (el.checked) {
      log(`${label} already set`);
      return true;
    }

    strongClick(el);
    await sleep(CFG.clickPauseMs);

    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (!el.checked) {
      log(`${label} found but not set. Continuing`);
      return false;
    }

    log(`${label} set`);
    return true;
  }

  async function ensureSelectValue(name, value, label) {
    const el = await waitFor(() => byName(name, 'select'), CFG.fieldWaitMs, label);

    if (el.value === value) {
      log(`${label} already set`);
      return;
    }

    scrollFocus(el);
    el.value = value;
    dispatchChange(el);
    await sleep(CFG.clickPauseMs);

    if (el.value !== value) {
      const opt = [...el.options].find(o => o.value === value);
      if (!opt) throw new Error(`${label} option not found: ${value}`);
      opt.selected = true;
      el.value = value;
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (el.value !== value) throw new Error(`Failed setting ${label}`);
    log(`${label} set`);
  }

  async function ensureSelectValueOptional(name, value, label) {
    const el = await waitForOptional(() => byName(name, 'select'), CFG.optionalFieldWaitMs);

    if (!el) {
      log(`${label} missing. Continuing`);
      return false;
    }

    if (el.value === value) {
      log(`${label} already set`);
      return true;
    }

    scrollFocus(el);
    el.value = value;
    dispatchChange(el);
    await sleep(CFG.clickPauseMs);

    if (el.value !== value) {
      const opt = [...el.options].find(o => o.value === value);
      if (!opt) {
        log(`${label} option not found. Continuing`);
        return false;
      }
      opt.selected = true;
      el.value = value;
      dispatchChange(el);
      await sleep(CFG.clickPauseMs);
    }

    if (el.value !== value) {
      log(`${label} not set. Continuing`);
      return false;
    }

    log(`${label} set`);
    return true;
  }

  async function getYearBuiltWait() {
    const el = await waitFor(() => byName(NAMES.yearBuilt, 'input'), CFG.fieldWaitMs, 'Year Built input');
    const start = Date.now();

    while (Date.now() - start < CFG.fieldWaitMs) {
      const raw = String(el.value || '').trim();
      const match = raw.match(/\d{4}/);
      if (match) {
        const year = parseInt(match[0], 10);
        if (Number.isFinite(year)) return year;
      }
      await sleep(250);
    }

    throw new Error('Year Built value not found');
  }

  function headerStillDwelling() {
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
    return titles.some(t => ((t.textContent || '').trim() === HEADER_STUCK_EXACT));
  }

  function quoteRecentlyClicked() {
    return Date.now() - state.lastQuoteClickAt < 1500;
  }

  function markQuoteClicked() {
    state.lastQuoteClickAt = Date.now();
  }

  function findQuoteCandidates() {
    const out = [];

    const exactInner = q('#SubmissionWizard-Quote > div.gw-action--inner.gw-hasDivider');
    if (exactInner) out.unshift(exactInner);

    const host = byId('SubmissionWizard-Quote');
    if (host) out.unshift(host);

    out.push(...document.querySelectorAll('.gw-label[aria-label="Quote"]'));

    const nextLab = document.querySelector('.gw-label[aria-label="Next"]');
    if (nextLab) {
      let p = nextLab;
      for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
        const qEl = p.querySelector?.('.gw-label[aria-label="Quote"]');
        if (qEl) {
          out.unshift(qEl);
          break;
        }
      }
    }

    return Array.from(new Set(out));
  }

  function upgradeToClickable(el) {
    if (!el) return null;

    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisible(el)) {
      return el;
    }

    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
      if (inner && isVisible(inner)) return inner;
    }

    let p = el;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisible(p)) {
        return p;
      }
    }

    return isVisible(el) ? el : null;
  }

  function clickQuoteOnce() {
    if (quoteRecentlyClicked()) return false;

    const candidates = findQuoteCandidates();
    for (const el of candidates) {
      const target = upgradeToClickable(el);
      if (target && strongClick(target)) {
        markQuoteClicked();
        log('Quote clicked');
        return true;
      }
    }

    log('Quote target not found');
    return false;
  }

  function hasGarageTypeRequiredMessage() {
    const nodes = Array.from(document.querySelectorAll('.gw-message, .gw-message-and-suffix'))
      .filter(isVisible);

    return nodes.some(el => {
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return txt.includes('garage type') && txt.includes('missing required field');
    });
  }

  async function waitForGarageError(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!state.running) return false;
      if (hasGarageTypeRequiredMessage()) return true;
      await sleep(250);
    }
    return false;
  }

  async function setGarageTypeNoneExact() {
    const sel = await waitForOptional(() => byName(NAMES.garageType, 'select'), CFG.optionalFieldWaitMs);

    if (!sel) {
      log('Garage Type select missing');
      return false;
    }

    const opt = [...sel.options].find(o =>
      o.value === 'None' || (o.textContent || '').trim() === 'None'
    );

    if (!opt) {
      log('Garage Type option None not found');
      return false;
    }

    if (sel.value === opt.value) {
      log('Garage Type already set to None');
      return true;
    }

    scrollFocus(sel);

    try { sel.value = opt.value; } catch {}
    opt.selected = true;
    dispatchChange(sel);
    await sleep(CFG.clickPauseMs);

    if (sel.value !== opt.value) {
      try { sel.selectedIndex = opt.index; } catch {}
      try { sel.value = opt.value; } catch {}
      opt.selected = true;
      dispatchChange(sel);
      await sleep(CFG.clickPauseMs);
    }

    const selectedText = sel.options[sel.selectedIndex]?.textContent?.trim() || '';
    const ok = sel.value === opt.value && selectedText === 'None';

    if (!ok) {
      log(`Garage Type did not stick. value="${sel.value}" text="${selectedText}"`);
      return false;
    }

    log(`Garage Type set to None. value="${sel.value}" text="${selectedText}"`);
    return true;
  }

  async function fixGarageTypeIfNeeded() {
    setStatus('Waiting for Garage error');
    const sawError = await waitForGarageError(CFG.garageErrorWaitMs);

    if (!sawError) {
      log('Garage Type required message not found in time');
      return false;
    }

    log('Garage Type required message detected');
    setStatus('Fixing Garage Type');

    const fixed = await setGarageTypeNoneExact();

    if (fixed) {
      await sleep(CFG.afterGarageFixMs);
      return true;
    }

    log('Garage Type fix failed');
    return false;
  }

  async function clickQuoteUpTo3IfStuck() {
    for (let attempt = 1; attempt <= CFG.maxQuoteAttempts; attempt++) {
      setStatus(`Clicking Quote (${attempt}/${CFG.maxQuoteAttempts})`);
      clickQuoteOnce();
      await sleep(CFG.afterQuoteWaitMs);

      if (!headerStillDwelling()) {
        log('Quote succeeded');
        return true;
      }

      log(`Still on Dwelling after Quote attempt ${attempt}`);

      if (attempt === 1) {
        await fixGarageTypeIfNeeded();
      }
    }

    return false;
  }

  async function quoteFlow() {
    setStatus('Waiting 5s before Quote');
    log('Waiting 5s before Quote');
    await sleep(CFG.beforeQuoteWaitMs);

    const quoteOK = await clickQuoteUpTo3IfStuck();
    if (!quoteOK) throw new Error('Quote click did not move off Dwelling');
  }

  async function fillDwellingFlow() {
    await ensureRadioChecked(IDS.poolNo, 'Swimming Pool = No');
    await ensureRadioChecked(IDS.solarNo, 'Solar Panels = No');
    await ensureRadioChecked(IDS.trampolineNo, 'Trampoline = No');
    await ensureSelectValue(NAMES.plumbing, 'copper', 'Plumbing System = Copper');

    await ensureRadioCheckedOptional(
      IDS.plumbingReplacedNo,
      'Plumbing replaced in last 20 years = No'
    );

    const yearBuilt = await getYearBuiltWait();
    log(`Year Built detected: ${yearBuilt}`);

    if (yearBuilt <= 1996) {
      await ensureSelectValueOptional(
        NAMES.water,
        'O',
        'Water Protection Device = Whole House Water Detection and Shutoff'
      );
    } else {
      log('Year Built is 1997 or newer. Water device left unchanged');
    }

    await quoteFlow();
  }

  async function tick() {
    if (!state.running || state.busy || state.done) return;
    if ((Date.now() - state.lastTabNudgeAt) < CFG.tabNudgeSettleMs) {
      setStatus('Waiting for Dwelling tab to load');
      return;
    }

    if (!stageReadyForDwelling()) {
      setStatus('Waiting for Submission (Draft) + Dwelling');
      return;
    }

    if (!isDwellingHere()) {
      if (nudgeDwellingTabIfNeeded()) {
        setStatus('Opening Dwelling tab');
      } else {
        setStatus('Waiting for Dwelling tab');
      }
      return;
    }

    state.busy = true;
    try {
      if (fieldsReady()) {
        setStatus('Filling Dwelling');
        await fillDwellingFlow();
        writeFlowStage('home', 'coverages');
        state.done = true;
        setStatus('Done');
        log('Dwelling step complete');
        return;
      }

      if (hasCreateValuationButton()) {
        if (state.createAttempts >= CFG.maxCreateAttempts) {
          setStatus('Failed');
          log('Create Valuation max attempts reached');
          state.done = true;
          return;
        }

        setStatus(`Clicking Create Valuation (${state.createAttempts + 1}/${CFG.maxCreateAttempts})`);
        const clicked = await clickCreateValuation();
        state.createAttempts += 1;

        if (clicked) {
          const start = Date.now();
          setStatus('Waiting for Dwelling fields');

          while (Date.now() - start < CFG.fieldsWaitAfterCreateMs) {
            if (!state.running) throw new Error('Stopped');
            if (fieldsReady()) {
              setStatus('Filling Dwelling');
              await fillDwellingFlow();
              writeFlowStage('home', 'coverages');
              state.done = true;
              setStatus('Done');
              log('Dwelling step complete');
              return;
            }
            await sleep(300);
          }

          log('Fields did not appear after Create Valuation');
          return;
        }

        log(`Create attempt ${state.createAttempts}/${CFG.maxCreateAttempts} did not open fields`);
        return;
      }

      log('Create Valuation missing. Going straight to fill');
      setStatus('Filling Dwelling');
      await fillDwellingFlow();
      writeFlowStage('home', 'coverages');
      state.done = true;
      setStatus('Done');
      log('Dwelling step complete');
    } catch (err) {
      setStatus('Failed');
      log(`Failed: ${err.message}`);
      state.done = true;
    } finally {
      state.busy = false;
    }
  }

  function buildUi() {
    const style = document.createElement('style');
    style.id = 'hb-dwelling-water-rule-style';
    style.textContent = `
      #hb-dwelling-water-rule-panel{
        position:fixed;right:${CFG.panelRight}px;bottom:${CFG.panelBottom}px;width:340px;
        background:rgba(18,18,18,.96);color:#fff;border:1px solid rgba(255,255,255,.14);
        border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;overflow:hidden
      }
      #hb-dwelling-water-rule-head{
        display:flex;align-items:center;justify-content:space-between;gap:8px;
        padding:8px 10px;background:rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.10)
      }
      #hb-dwelling-water-rule-title{font-weight:700;font-size:12px}
      #hb-dwelling-water-rule-sub{font-size:11px;opacity:.8}
      #hb-dwelling-water-rule-btn{border:0;border-radius:6px;padding:6px 10px;cursor:pointer;font-weight:700}
      #hb-dwelling-water-rule-body{padding:8px 10px}
      #hb-dwelling-water-rule-status{margin-bottom:8px;font-weight:700}
      #hb-dwelling-water-rule-log{
        white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;
        background:rgba(255,255,255,.04);border-radius:6px;padding:8px
      }
    `;
    document.documentElement.appendChild(style);
    state.styleEl = style;

    const panel = document.createElement('div');
    panel.id = 'hb-dwelling-water-rule-panel';
    panel.innerHTML = `
      <div id="hb-dwelling-water-rule-head">
        <div>
          <div id="hb-dwelling-water-rule-title">Home Bot: Dwelling Water Rule</div>
          <div id="hb-dwelling-water-rule-sub">V${VERSION}</div>
        </div>
        <button id="hb-dwelling-water-rule-btn" type="button">STOP</button>
      </div>
      <div id="hb-dwelling-water-rule-body">
        <div id="hb-dwelling-water-rule-status">Starting</div>
        <div id="hb-dwelling-water-rule-log"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    state.panel = panel;
    state.statusEl = panel.querySelector('#hb-dwelling-water-rule-status');
    state.logEl = panel.querySelector('#hb-dwelling-water-rule-log');
    state.btn = panel.querySelector('#hb-dwelling-water-rule-btn');

    state.btn.addEventListener('click', () => {
      state.running = !state.running;
      state.btn.textContent = state.running ? 'STOP' : 'START';

      if (state.running) {
        state.done = false;
        state.createAttempts = 0;
        log('Script resumed');
        setStatus('Resumed');
      } else {
        log('Script stopped for this page session');
        setStatus('Stopped');
      }
    });
  }

  function cleanup() {
    try { clearInterval(state.intervalId); } catch {}
    try { state.panel?.remove?.(); } catch {}
    try { state.styleEl?.remove?.(); } catch {}
    delete window.__HB_DWELLING_WATER_RULE_CLEANUP__;
  }

  function init() {
    buildUi();
    log('Script start');
    setStatus('Armed');

    state.intervalId = setInterval(() => {
      tick().catch(err => {
        setStatus('Failed');
        log(`Tick error: ${err.message}`);
        state.busy = false;
        state.done = true;
      });
    }, CFG.tickMs);
  }

  window.__HB_DWELLING_WATER_RULE_CLEANUP__ = cleanup;
  init();
})();
