// ==UserScript==
// @name         Home Bot: Guidewire Policy Info
// @namespace    homebot.gwpc-policy-info
// @version      1.9
// @description  Policy Info hybrid: if Personal Auto is present, run AQB Policy Info actions; otherwise keep the Home Bot Policy Info flow without clicking Home Auto discount. If the Non-Binary/Flex error appears, switch Gender to Male. Uses DT2 Next retry if stuck. Hard stops if Submission (Quoted) appears.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-policy-info.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/gwpc-policy-info.user.js
// ==/UserScript==

(function () {
  'use strict';

  const REQUIRED_LABELS = ['Submission (Draft)'];
  const TRIGGER_TITLE_STARTS_WITH = 'Policy Info';
  const PERSONAL_AUTO_LABEL = 'Personal Auto';
  const HARD_STOP_LABEL = 'Submission (Quoted)';

  // ----- HOME MODE -----
  const SEL_GENDER =
    'select[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Gender_Ext"]';
  const SEL_MARITAL =
    'select[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-MartialStatus_Ext"]';

  const GENDER_VALUE = 'X';
  const GENDER_FALLBACK_VALUE = 'M';
  const GENDER_FALLBACK_ERROR_TEXT =
    'Non-Binary gender is only available for Farmers Flex products.';
  const MARITAL_VALUE = 'S';

  // ----- AQB MODE -----
  const SEL_AQB_CHECKBOX =
    'input[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-MultiLineDiscounts_ExtInputSet-MultiLineDiscounts_ExtLV-1-DiscountSelected"]';
  const ID_SIGNAL_NO =
    'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-SignalEnrollPolicyInd_1';
  const SEL_EFFECTIVE_DATE =
    'input[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-PolicyInfoInputSet-EffectiveDate"]';

  // ----- SHARED -----
  const SEL_ESIGNATURE =
    'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyInfo_PaperlessOptions_ExtInputSet-PaperlessOptionEditMode-ESignature"]';
  const SEL_PAPERLESS_POLICY =
    'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyInfo_PaperlessOptions_ExtInputSet-PaperlessOptionEditMode-PaperlessPolicy"]';

  const RETRY_EVERY_MS = 250;
  const WAIT_BEFORE_NEXT_MS = 2000;
  const STUCK_CHECK_WAIT_MS = 3000;
  const MAX_NEXT_ATTEMPTS = 3;

  const NEXT_HOST_ID = 'SubmissionWizard-Next';

  let armed = true;
  let done = false;
  let running = false;

  let mo = null;
  let workTimer = null;
  let nextTimer = null;
  let stuckTimer = null;

  let nextAttempts = 0;

  function mountToggle() {
    const btn = document.createElement('button');
    btn.textContent = 'HB PI: STOP';
    btn.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:999999;' +
      'border:0;border-radius:10px;padding:8px 12px;' +
      'background:#2f80ed;color:#fff;font:12px/1 system-ui,Segoe UI,Arial;font-weight:700;' +
      'cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.25);';

    btn.addEventListener('click', () => {
      armed = !armed;
      btn.textContent = armed ? 'HB PI: STOP' : 'HB PI: START';
      if (!armed) hardStop();
      else tick();
    });

    document.body.appendChild(btn);
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

  function normText(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function* allDocs() {
    yield document;
    for (const f of document.querySelectorAll('iframe, frame')) {
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (d) yield d;
      } catch {}
    }
  }

  function hasLabelExactAnyDoc(txt) {
    for (const doc of allDocs()) {
      const ok = Array.from(doc.querySelectorAll('.gw-label'))
        .some(n => (n.textContent || '').trim() === txt && isVisible(n));
      if (ok) return true;
    }
    return false;
  }

  function hasTextAnyDoc(txt) {
    const want = normText(txt).toLowerCase();
    if (!want) return false;

    for (const doc of allDocs()) {
      const candidates = Array.from(
        doc.querySelectorAll('.gw-message, .gw-WebMessage, .gw-MessagesWidget, .gw-message-and-suffix')
      );

      for (const el of candidates) {
        const text = normText(el.textContent || '').toLowerCase();
        if (!text) continue;
        if (!isVisible(el) && !isVisible(el.closest?.('.gw-message--displayable') || el.parentElement)) continue;
        if (text.includes(want)) return true;
      }
    }

    return false;
  }

  function gateOK() {
    return REQUIRED_LABELS.every(hasLabelExactAnyDoc);
  }

  function isPersonalAutoMode() {
    return hasLabelExactAnyDoc(PERSONAL_AUTO_LABEL);
  }

  function hasQuotedLabel() {
    return hasLabelExactAnyDoc(HARD_STOP_LABEL);
  }

  function hasGenderFallbackErrorAnyDoc() {
    return hasTextAnyDoc(GENDER_FALLBACK_ERROR_TEXT);
  }

  function getWantedHomeGenderValue() {
    return hasGenderFallbackErrorAnyDoc() ? GENDER_FALLBACK_VALUE : GENDER_VALUE;
  }

  function titleIsPolicyInfoAnyDoc() {
    for (const doc of allDocs()) {
      const titles = Array.from(doc.querySelectorAll('.gw-TitleBar--title'));
      if (titles.some(t => {
        const txt = (t.textContent || '').trim();
        return txt.startsWith(TRIGGER_TITLE_STARTS_WITH) && isVisible(t);
      })) return true;
    }
    return false;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function formatMMDDYYYY(d) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
  }

  function targetDatePlus21() {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return formatMMDDYYYY(d);
  }

  function dispatchAll(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.blur?.(); } catch {}
  }

  function safeCheck(el) {
    if (!el || el.disabled) return false;
    if (!el.checked) {
      try { el.click(); } catch {}
      if (!el.checked) {
        try { el.checked = true; } catch {}
      }
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function safeUncheck(el) {
    if (!el || el.disabled) return false;
    if (el.checked) {
      try { el.click(); } catch {}
      if (el.checked) {
        try { el.checked = false; } catch {}
      }
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function safeRadio(el) {
    if (!el || el.disabled) return false;
    if (!el.checked) {
      try { el.click(); } catch {}
      if (!el.checked) {
        try { el.checked = true; } catch {}
      }
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function safeSetSelect(el, value) {
    if (!el || el.disabled) return false;
    if (el.value === value) return false;

    try { el.focus(); } catch {}
    el.value = value;
    dispatchAll(el);
    return true;
  }

  function safeSetDate(el, value) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.value !== value) {
      try { el.focus(); } catch {}
      el.value = value;
      dispatchAll(el);
      return true;
    }
    return false;
  }

  function* deepChildren(root) {
    if (!root) return;
    const kids = root.children || [];
    for (const el of kids) {
      yield el;
      if (el.shadowRoot) {
        yield el.shadowRoot;
        yield* deepChildren(el.shadowRoot);
      }
      yield* deepChildren(el);
    }
  }

  function deepGetElementById(root, id) {
    try {
      const hit = root.getElementById?.(id);
      if (hit) return hit;
    } catch {}

    for (const node of deepChildren(root)) {
      try {
        const hit = node.getElementById?.(id);
        if (hit) return hit;
      } catch {}
    }

    return null;
  }

  function applyHomePolicyInfoOnce(doc) {
    const wantedGender = getWantedHomeGenderValue();

    try { safeSetSelect(doc.querySelector(SEL_GENDER), wantedGender); } catch {}
    try { safeSetSelect(doc.querySelector(SEL_MARITAL), MARITAL_VALUE); } catch {}

    try { safeUncheck(doc.querySelector(SEL_ESIGNATURE)); } catch {}
    try { safeUncheck(doc.querySelector(SEL_PAPERLESS_POLICY)); } catch {}
  }

  function applyAqbPolicyInfoOnce(doc) {
    const wanted = targetDatePlus21();

    try { safeCheck(doc.querySelector(SEL_AQB_CHECKBOX)); } catch {}
    try { safeRadio(doc.getElementById?.(ID_SIGNAL_NO)); } catch {}
    try { safeSetDate(doc.querySelector(SEL_EFFECTIVE_DATE), wanted); } catch {}

    if (hasGenderFallbackErrorAnyDoc()) {
      try { safeSetSelect(doc.querySelector(SEL_GENDER), GENDER_FALLBACK_VALUE); } catch {}
    }

    try { safeUncheck(doc.querySelector(SEL_ESIGNATURE)); } catch {}
    try { safeUncheck(doc.querySelector(SEL_PAPERLESS_POLICY)); } catch {}
  }

  function applyPolicyInfoOnce() {
    const autoMode = isPersonalAutoMode();

    for (const doc of allDocs()) {
      if (autoMode) applyAqbPolicyInfoOnce(doc);
      else applyHomePolicyInfoOnce(doc);
    }
  }

  function fireMouse(el, type) {
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    }));
  }

  function getNextTarget(doc) {
    const host = deepGetElementById(doc, NEXT_HOST_ID);
    if (!host || !isVisible(host)) return null;

    return (
      host.querySelector('.gw-action--inner[aria-disabled="false"]') ||
      host.querySelector('.gw-action--inner') ||
      host.querySelector('.gw-label[aria-label="Next"]') ||
      host
    );
  }

  function clickNextDt2Once() {
    for (const doc of allDocs()) {
      const target = getNextTarget(doc);
      if (!target || !isVisible(target)) continue;

      try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try { target.focus({ preventScroll: true }); } catch {
        try { target.focus(); } catch {}
      }

      fireMouse(target, 'pointerover');
      fireMouse(target, 'mouseover');
      fireMouse(target, 'pointerdown');
      fireMouse(target, 'mousedown');
      fireMouse(target, 'pointerup');
      fireMouse(target, 'mouseup');
      fireMouse(target, 'click');

      try { target.click(); } catch {}

      return true;
    }

    return false;
  }

  function hardStopAndFinish() {
    if (workTimer) clearInterval(workTimer);
    if (nextTimer) clearTimeout(nextTimer);
    if (stuckTimer) clearTimeout(stuckTimer);
    workTimer = null;
    nextTimer = null;
    stuckTimer = null;
    running = false;
    done = true;
    if (mo) {
      try { mo.disconnect(); } catch {}
      mo = null;
    }
  }

  function finalizeIfLeftPolicyInfo() {
    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return true;
    }

    if (!titleIsPolicyInfoAnyDoc()) {
      done = true;
      running = false;
      if (mo) { try { mo.disconnect(); } catch {} mo = null; }
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      return true;
    }
    return false;
  }

  function attemptNextAndCheck() {
    if (!armed || done) return;

    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return;
    }

    if (finalizeIfLeftPolicyInfo()) return;

    if (nextAttempts >= MAX_NEXT_ATTEMPTS) {
      done = true;
      running = false;
      if (mo) { try { mo.disconnect(); } catch {} mo = null; }
      return;
    }

    applyPolicyInfoOnce();

    if (clickNextDt2Once()) {
      nextAttempts++;
    }

    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      if (!armed || done) return;
      if (hasQuotedLabel()) {
        hardStopAndFinish();
        return;
      }
      if (titleIsPolicyInfoAnyDoc()) attemptNextAndCheck();
      else finalizeIfLeftPolicyInfo();
    }, STUCK_CHECK_WAIT_MS);
  }

  function hardStop() {
    if (workTimer) clearInterval(workTimer);
    if (nextTimer) clearTimeout(nextTimer);
    if (stuckTimer) clearTimeout(stuckTimer);
    workTimer = null;
    nextTimer = null;
    stuckTimer = null;
    running = false;
  }

  function runSequence() {
    if (!armed || done || running) return;
    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return;
    }
    if (!gateOK()) return;
    if (!titleIsPolicyInfoAnyDoc()) return;

    running = true;
    nextAttempts = 0;

    applyPolicyInfoOnce();

    workTimer = setInterval(() => {
      if (!armed || done) return;
      if (hasQuotedLabel()) {
        hardStopAndFinish();
        return;
      }
      applyPolicyInfoOnce();
    }, RETRY_EVERY_MS);

    nextTimer = setTimeout(() => {
      if (workTimer) clearInterval(workTimer);
      workTimer = null;
      if (hasQuotedLabel()) {
        hardStopAndFinish();
        return;
      }
      attemptNextAndCheck();
    }, WAIT_BEFORE_NEXT_MS);
  }

  function tick() {
    if (!armed || done) return;
    if (hasQuotedLabel()) {
      hardStopAndFinish();
      return;
    }
    runSequence();
  }

  function init() {
    mountToggle();

    mo = new MutationObserver(tick);
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    document.addEventListener('visibilitychange', tick);
    tick();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });
})();