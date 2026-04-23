// ==UserScript==
// @name         04 GWPC Home Coverages Quote + Risk Analysis
// @namespace    homebot.gwpc-home-coverages-risk-analysis
// @version      1.1.0
// @description  On Home Coverages, clicks Edit All, applies required coverage changes, clicks Quote, then clicks Risk Analysis.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-home-coverages-risk-analysis.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-home-coverages-risk-analysis.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = '04 GWPC Home Coverages Quote + Risk Analysis';
  const VERSION = '1.1.0';

  const CFG = {
    tickMs: 900,
    waitPollMs: 250,
    waitTimeoutMs: 30000,
    afterEditAllMs: 1200,
    afterFieldMs: 250,
    afterQuoteWaitMs: 1200,
    afterClickMs: 450,
    maxQuoteAttempts: 6,
    quoteTransitionTimeoutMs: 25000,
    betweenQuoteAttemptsMs: 1500,
    triggerStableMs: 1000,
    maxLogLines: 14,
    panelRight: 12,
    panelBottom: 12,
    zIndex: 2147483647
  };

  const IDS = {
    coveragesHeader: 'Coverages',
    coveragesScreen: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen',
    mainArea: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    quoteButtonHost: 'SubmissionWizard-Quote'
  };

  const SEL = {
    stdAllPerils:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-0-lineCovTermRow-0-0-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    enhAllPerils:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-0-lineCovTermRow-0-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    enhSplitWater:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-0-lineCovTermRow-1-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    enhSeparateStructures:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-2-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    enhPersonalPropertyLimit:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-3-lineCovTermRow-0-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    enhPersonalLiability:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-5-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    enhExtendedReplacementCheckbox:
      'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-8-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-covTermEnabledId"]',

    enhExtendedReplacementSelect:
      'select[name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-lineLevelCoverages-8-lineCovRow-1-targetedCovTermId-SideBySideCovTermInputSet-SideBySideRangeCovTermValue"]',

    personalInjuryCheckbox:
      'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideScreenBasePanelSet-SideBySideScreenPanelSet-HOSideBySideAddnCoveragesPanelSet-1-HOCoverageInputSet-CovPatternInputGroup-_checkbox"]'
  };

  const state = {
    running: true,
    busy: false,
    doneThisLoad: false,
    attemptedThisLoad: false,
    triggerSince: 0,
    lastWait: '',
    logs: [],
    ui: null,
    lastQuoteClickAt: 0
  };

  init();

  function init() {
    if (window.top !== window.self) return;
    buildUI();
    log(`Loaded ${SCRIPT_NAME}`);
    setStatus('Waiting for Coverages');
    setInterval(tick, CFG.tickMs);
    tick();
  }

  function tick() {
    if (!state.running || state.busy || state.doneThisLoad || state.attemptedThisLoad) return;

    if (!isOnTriggerPage()) {
      state.triggerSince = 0;
      setWaiting('Waiting for exact Coverages page...');
      return;
    }

    if (!state.triggerSince) {
      state.triggerSince = Date.now();
      setStatus('Coverages found');
      log('Trigger found: Coverages');
      return;
    }

    if ((Date.now() - state.triggerSince) < CFG.triggerStableMs) {
      setStatus('Coverages stable...');
      return;
    }

    state.attemptedThisLoad = true;
    state.busy = true;

    runFlow()
      .then(() => {
        state.doneThisLoad = true;
        setStatus('Done');
        log('Flow complete');
      })
      .catch((err) => {
        setStatus('Failed');
        log(`Failed: ${err?.message || err}`);
      })
      .finally(() => {
        state.busy = false;
      });
  }

  async function runFlow() {
    log('Starting flow');

    await ensureEditMode();

    await setSelectVerified(
      SEL.stdAllPerils,
      ['All Perils'],
      ['$3,000', '3000'],
      'Standard / All Perils'
    );

    await setSelectVerified(
      SEL.enhAllPerils,
      ['All Perils'],
      ['$7,500', '7500'],
      'Enhanced / All Perils'
    );

    await setSelectVerified(
      SEL.enhSplitWater,
      ['Split Water'],
      ['$10,000', '10000'],
      'Enhanced / Split Water'
    );

    await setSelectVerified(
      SEL.enhSeparateStructures,
      ['Separate Structures'],
      ['5%'],
      'Enhanced / Separate Structures'
    );

    await setSelectVerified(
      SEL.enhPersonalPropertyLimit,
      ['Personal Property', 'Limit'],
      ['40%'],
      'Enhanced / Personal Property Limit'
    );

    await setSelectVerified(
      SEL.enhPersonalLiability,
      ['Personal Liability'],
      ['$1,000,000', '1000000'],
      'Enhanced / Personal Liability'
    );

    await ensureCheckboxVerified(
      SEL.enhExtendedReplacementCheckbox,
      ['Extended Replacement Cost'],
      'Enhanced / Extended Replacement Cost checkbox'
    );

    await setSelectVerified(
      SEL.enhExtendedReplacementSelect,
      ['Extended Replacement Cost'],
      ['120%', '120'],
      'Enhanced / Extended Replacement Cost value'
    );

    await ensureCheckboxVerified(
      SEL.personalInjuryCheckbox,
      ['Personal Injury'],
      'Additional / Personal Injury'
    );

    const quoteOK = await clickQuoteUntilTransition();
    if (!quoteOK) {
      throw new Error('Quote click did not move off Coverages');
    }

    const riskOK = await clickRiskAnalysisLocked();
    if (!riskOK) {
      throw new Error('Risk Analysis did not open');
    }

    log('Risk Analysis opened');
  }

  async function ensureEditMode() {
    const editTarget = findEditAllTarget();

    if (editTarget) {
      log('Clicking Edit All');
      strongClick(editTarget);
      await sleep(CFG.afterEditAllMs);
    } else if (queryFirstVisible(SEL.stdAllPerils)) {
      log('Edit All not visible. Controls already editable.');
      return;
    } else {
      throw new Error('Edit All not found');
    }

    const ok = await waitFor(
      () => !!queryFirstVisible(SEL.stdAllPerils) || !!queryFirstVisible(SEL.personalInjuryCheckbox),
      CFG.waitTimeoutMs,
      'editable coverage controls'
    );

    if (!ok) throw new Error('Edit mode did not become ready');
    log('Edit mode ready');
  }

  async function setSelectVerified(selector, expectedLabels, desiredTexts, label) {
    const el = await waitForField(selector, expectedLabels, label);
    const match = findMatchingOption(el, desiredTexts);

    if (!match) {
      throw new Error(`${label}: option not found (${desiredTexts.join(' / ')})`);
    }

    const currentText = getSelectedText(el);
    if (optionMatchesText(currentText, desiredTexts)) {
      log(`${label}: already set to ${currentText}`);
      return;
    }

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}

    try { el.value = match.value; } catch {}
    try { match.selected = true; } catch {}
    dispatchValueEvents(el);
    await sleep(CFG.afterFieldMs);

    if (!optionMatchesText(getSelectedText(el), desiredTexts)) {
      try { el.selectedIndex = match.index; } catch {}
      try { el.value = match.value; } catch {}
      try { match.selected = true; } catch {}
      dispatchValueEvents(el);
      await sleep(CFG.afterFieldMs);
    }

    const finalText = getSelectedText(el);
    if (!optionMatchesText(finalText, desiredTexts)) {
      throw new Error(`${label}: failed to stick (${finalText || 'blank'})`);
    }

    log(`${label}: set to ${finalText}`);
  }

  async function ensureCheckboxVerified(selector, expectedLabels, label) {
    const el = await waitForField(selector, expectedLabels, label);

    if (el.checked) {
      log(`${label}: already checked`);
      return;
    }

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    strongClick(el);
    await sleep(CFG.afterFieldMs);

    if (!el.checked) {
      try { el.checked = true; } catch {}
      dispatchValueEvents(el);
      await sleep(CFG.afterFieldMs);
    }

    if (!el.checked) {
      strongClick(el);
      await sleep(CFG.afterFieldMs);
    }

    if (!el.checked) {
      throw new Error(`${label}: failed to stay checked`);
    }

    log(`${label}: checked`);
  }

  async function waitForField(selector, expectedLabels, label) {
    const ok = await waitFor(
      () => {
        const el = queryFirstVisible(selector);
        if (!el) return false;
        return verifyContextLabels(el, expectedLabels);
      },
      CFG.waitTimeoutMs,
      label
    );

    if (!ok) throw new Error(`${label}: field not found or context mismatch`);

    const el = queryFirstVisible(selector);
    if (!el) throw new Error(`${label}: field vanished`);

    if (!verifyContextLabels(el, expectedLabels)) {
      throw new Error(`${label}: context mismatch`);
    }

    return el;
  }

  function verifyContextLabels(el, expectedLabels) {
    if (!expectedLabels || !expectedLabels.length) return true;
    const context = gatherContextText(el).toLowerCase();
    return expectedLabels.every(label => context.includes(String(label).toLowerCase()));
  }

  function gatherContextText(el) {
    const parts = [];
    let cur = el;
    let depth = 0;

    while (cur && depth < 9) {
      if (cur.nodeType === 1) {
        const id = cur.id ? ` ${cur.id} ` : '';
        const aria = cur.getAttribute ? (cur.getAttribute('aria-label') || '') : '';
        const txt = normalizeText(cur.textContent || '');
        if (id) parts.push(id);
        if (aria) parts.push(aria);
        if (txt) parts.push(txt);
      }
      cur = cur.parentElement;
      depth++;
    }

    return normalizeText(parts.join(' | '));
  }

  function getSelectedText(selectEl) {
    if (!selectEl) return '';
    const opt = selectEl.options?.[selectEl.selectedIndex];
    return normalizeText(opt?.textContent || opt?.innerText || '');
  }

  function findMatchingOption(selectEl, desiredTexts) {
    const options = Array.from(selectEl?.options || []);
    for (const opt of options) {
      const txt = normalizeText(opt.textContent || opt.innerText || '');
      if (optionMatchesText(txt, desiredTexts)) return opt;
    }
    return null;
  }

  function optionMatchesText(text, desiredTexts) {
    const actual = optionCanon(text);
    return desiredTexts.some(want => actual === optionCanon(want));
  }

  function optionCanon(text) {
    return normalizeText(text)
      .toLowerCase()
      .replace(/\u00a0/g, '')
      .replace(/\s+/g, '')
      .replace(/,/g, '')
      .replace(/\$/g, '');
  }

  function dispatchValueEvents(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch {}
  }

  function findEditAllTarget() {
    return findClickableOwnerByLabel('Edit All');
  }

  function findClickableOwnerByLabel(labelText) {
    const labels = Array.from(document.querySelectorAll(`.gw-label[aria-label="${cssAttrEscape(labelText)}"]`))
      .filter(isVisible);

    for (const label of labels) {
      const owner = getClickableOwner(label);
      if (owner && isVisible(owner)) return owner;
    }

    const generic = Array.from(document.querySelectorAll('.gw-label, [aria-label], [role="button"], [role="tab"], .gw-action--inner, a, button, div'));
    for (const el of generic) {
      const aria = normalizeText(el.getAttribute?.('aria-label') || '');
      const txt = normalizeText(el.textContent || '');
      if ((aria === labelText || txt === labelText) && isVisible(el)) {
        const owner = getClickableOwner(el);
        if (owner && isVisible(owner)) return owner;
      }
    }

    return null;
  }

  function getClickableOwner(el) {
    if (!el) return null;

    let cur = el;
    let depth = 0;
    while (cur && depth < 10) {
      if (isProbablyClickable(cur)) return cur;
      cur = cur.parentElement;
      depth++;
    }

    return el;
  }

  function isProbablyClickable(el) {
    if (!el || !(el instanceof Element) || !isVisible(el)) return false;

    if (
      el.matches('button, a, input[type="button"], input[type="submit"], [role="button"], [role="tab"], [role="menuitem"]') ||
      el.classList.contains('gw-action--inner') ||
      el.classList.contains('gw-TabWidget') ||
      el.classList.contains('gw-ButtonWidget') ||
      el.hasAttribute('onclick') ||
      el.getAttribute('tabindex') === '0'
    ) {
      return true;
    }

    return false;
  }

  function strongClick(el) {
    if (!el) return false;

    try { el.scrollIntoView?.({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus?.({ preventScroll: true }); } catch {}

    try { el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); } catch {}
    try { el.click?.(); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); } catch {}

    return true;
  }

  function headerStillCoverages() {
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
    return titles.some(t => ((t.textContent || '').trim() === IDS.coveragesHeader));
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

  async function clickQuoteUntilTransition() {
    for (let attempt = 1; attempt <= CFG.maxQuoteAttempts; attempt++) {
      setStatus(`Clicking Quote (${attempt}/${CFG.maxQuoteAttempts})`);
      const clicked = clickQuoteOnce();
      if (!clicked) {
        await sleep(CFG.betweenQuoteAttemptsMs);
        continue;
      }

      await sleep(CFG.afterQuoteWaitMs);

      const movedOffCoverages = await waitFor(
        () => !headerStillCoverages(),
        CFG.quoteTransitionTimeoutMs,
        `Quote transition after attempt ${attempt}`
      );

      if (movedOffCoverages) {
        log('Quote succeeded');
        return true;
      }

      log(`Still on Coverages after Quote attempt ${attempt}`);
      if (attempt < CFG.maxQuoteAttempts) {
        setStatus(`Waiting to retry Quote (${attempt}/${CFG.maxQuoteAttempts})`);
        await sleep(CFG.betweenQuoteAttemptsMs);
      }
    }

    return false;
  }

  function isTabLike(el) {
    if (!el || !(el instanceof Element)) return false;
    return el.matches('[role="tab"], .gw-TabWidget, .gw-action--inner, button, a');
  }

  function ownRiskLabel(el) {
    if (!el || !(el instanceof Element)) return '';
    return normalizeText(el.getAttribute('aria-label') || el.textContent || '');
  }

  function findRiskAnalysisLabelNode() {
    const direct = Array.from(document.querySelectorAll('.gw-label[aria-label="Risk Analysis"]'))
      .find(isVisible);
    if (direct) return direct;

    const labels = Array.from(document.querySelectorAll('.gw-label'))
      .filter(isVisible);
    return labels.find(el => normalizeText(el.textContent || '') === 'Risk Analysis') || null;
  }

  function findRiskAnalysisTarget() {
    const directSelectors = [
      '[role="tab"][aria-label="Risk Analysis"]',
      '.gw-TabWidget[aria-label="Risk Analysis"]',
      '.gw-action--inner[aria-label="Risk Analysis"]',
      'button[aria-label="Risk Analysis"]',
      'a[aria-label="Risk Analysis"]'
    ];

    for (const sel of directSelectors) {
      const hit = Array.from(document.querySelectorAll(sel)).find(isVisible);
      if (hit) return hit;
    }

    const labelNode = findRiskAnalysisLabelNode();
    if (labelNode) {
      let cur = labelNode.parentElement;
      for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
        if (!isVisible(cur)) continue;
        if (!isTabLike(cur)) continue;

        const label = ownRiskLabel(cur);
        if (label === 'Risk Analysis') return cur;

        const childExact = Array.from(cur.querySelectorAll(':scope > .gw-label, :scope .gw-label'))
          .find(el => isVisible(el) && normalizeText(el.textContent || el.getAttribute('aria-label') || '') === 'Risk Analysis');

        if (childExact) return cur;
      }
    }

    const tabLikes = Array.from(document.querySelectorAll('[role="tab"], .gw-TabWidget, .gw-action--inner, button, a'))
      .filter(isVisible);

    for (const el of tabLikes) {
      if (ownRiskLabel(el) === 'Risk Analysis') return el;
    }

    return null;
  }

  async function clickRiskAnalysisLocked() {
    const target = await waitFor(
      () => findRiskAnalysisTarget(),
      CFG.waitTimeoutMs,
      'Risk Analysis tab'
    );

    if (!target) return false;

    log('Clicking Risk Analysis');
    strongClick(target);
    await sleep(CFG.afterClickMs);

    const opened = await waitFor(
      () => isRiskAnalysisOpen(),
      CFG.waitTimeoutMs,
      'Risk Analysis open'
    );

    return !!opened;
  }

  function isRiskAnalysisOpen() {
    const header = getHeaderText();
    if (header === 'Risk Analysis') return true;

    const target = findRiskAnalysisTarget();
    if (!target) return false;

    const label = ownRiskLabel(target);
    if (label !== 'Risk Analysis') return false;

    return (
      target.getAttribute('aria-selected') === 'true' ||
      target.getAttribute('aria-current') === 'page' ||
      target.classList.contains('gw-focus') ||
      target.classList.contains('gw-selected') ||
      target.closest('[aria-selected="true"]') !== null
    );
  }

  function isOnTriggerPage() {
    return getHeaderText() === IDS.coveragesHeader &&
      !!byId(IDS.coveragesScreen) &&
      !!byId(IDS.mainArea);
  }

  function getHeaderText() {
    const nodes = Array.from(document.querySelectorAll('.gw-TitleBar--title'));
    const el = nodes.find(isVisible) || null;
    return normalizeText(el?.textContent || '');
  }

  function byId(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function q(sel, root = document) {
    try { return root.querySelector(sel); } catch { return null; }
  }

  function queryFirstVisible(selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
    } catch {
      return null;
    }
  }

  async function waitFor(checkFn, timeoutMs, label) {
    const start = Date.now();

    while ((Date.now() - start) < timeoutMs) {
      if (!state.running) return false;

      try {
        const result = checkFn();
        if (result) return result;
      } catch {}

      await sleep(CFG.waitPollMs);
    }

    log(`Timeout waiting for ${label}`);
    return false;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;

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

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function cssAttrEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function setWaiting(msg) {
    if (state.lastWait === msg) return;
    state.lastWait = msg;
    setStatus(msg);
    log(msg);
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogLines);

    if (state.ui?.logs) {
      state.ui.logs.textContent = state.logs.join('\n');
    }

    console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function setStatus(text) {
    if (state.ui?.status) state.ui.status.textContent = text;
  }

  function buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      #hb-gw-home-cov-panel{
        position:fixed;
        right:${CFG.panelRight}px;
        bottom:${CFG.panelBottom}px;
        width:330px;
        background:rgba(17,24,39,.96);
        color:#fff;
        border:1px solid rgba(255,255,255,.16);
        border-radius:12px;
        box-shadow:0 10px 28px rgba(0,0,0,.35);
        z-index:${CFG.zIndex};
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
      }
      #hb-gw-home-cov-head{
        padding:8px 10px;
        background:rgba(255,255,255,.08);
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        cursor:move;
        user-select:none;
      }
      #hb-gw-home-cov-title{font-weight:700}
      #hb-gw-home-cov-ver{opacity:.82;font-size:11px}
      #hb-gw-home-cov-body{padding:8px 10px 10px 10px}
      #hb-gw-home-cov-row{
        display:flex;
        gap:8px;
        align-items:center;
        margin-bottom:8px;
      }
      #hb-gw-home-cov-toggle{
        border:0;
        border-radius:8px;
        padding:6px 10px;
        font-weight:700;
        cursor:pointer;
        color:#fff;
      }
      #hb-gw-home-cov-status{
        margin-left:auto;
        font-weight:700;
        color:#93c5fd;
      }
      #hb-gw-home-cov-logs{
        max-height:170px;
        overflow:auto;
        white-space:pre-wrap;
        word-break:break-word;
      }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'hb-gw-home-cov-panel';
    panel.innerHTML = `
      <div id="hb-gw-home-cov-head">
        <div>
          <div id="hb-gw-home-cov-title">${SCRIPT_NAME}</div>
          <div id="hb-gw-home-cov-ver">V${VERSION}</div>
        </div>
      </div>
      <div id="hb-gw-home-cov-body">
        <div id="hb-gw-home-cov-row">
          <button id="hb-gw-home-cov-toggle" type="button">STOP</button>
          <div id="hb-gw-home-cov-status">Waiting</div>
        </div>
        <div id="hb-gw-home-cov-logs"></div>
      </div>
    `;
    document.documentElement.appendChild(panel);

    const ui = {
      panel,
      head: panel.querySelector('#hb-gw-home-cov-head'),
      toggle: panel.querySelector('#hb-gw-home-cov-toggle'),
      status: panel.querySelector('#hb-gw-home-cov-status'),
      logs: panel.querySelector('#hb-gw-home-cov-logs')
    };

    ui.toggle.addEventListener('click', () => {
      state.running = !state.running;
      syncToggle();
      if (state.running) {
        setStatus('Running');
        log('Started');
      } else {
        setStatus('Stopped');
        log('Stopped for this page session');
      }
    });

    makeDraggable(ui.panel, ui.head);
    state.ui = ui;
    syncToggle();
  }

  function syncToggle() {
    if (!state.ui?.toggle) return;
    if (state.running) {
      state.ui.toggle.textContent = 'STOP';
      state.ui.toggle.style.background = '#c62828';
    } else {
      state.ui.toggle.textContent = 'START';
      state.ui.toggle.style.background = '#2e7d32';
    }
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
      dragging = false;
    });
  }
})();
