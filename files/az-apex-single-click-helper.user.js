// ==UserScript==
// @name         Cross-Origin AZ + APEX Single Click Helper
// @namespace    homebot.az-apex-single-click-helper
// @version      1.0.9
// @description  Clicks the first visible AgencyZoom login control, APEX autofilled credential submit, or APEX I AGREE button once per route, only advancing after the prior control disappears.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.my.salesforce.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://*.okta.com/*
// @match        https://eagentsaml.farmersinsurance.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-apex-single-click-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/az-apex-single-click-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Cross-Origin AZ + APEX Single Click Helper';
  const VERSION = '1.0.9';

  const CFG = {
    scanMs: 400,
    routeWatchMs: 800,
    clickCooldownMs: 1200
  };

  const KIND = {
    APEX_LOGIN_SUBMIT: 'apex-login-submit',
    APEX_AGREE: 'apex-agree',
    AZ_LOGIN_LINK: 'az-login-link',
    AZ_LOGIN_BUTTON: 'az-login-button'
  };

  const TIE_BREAK_RANK = {
    [KIND.APEX_LOGIN_SUBMIT]: 0,
    [KIND.AZ_LOGIN_BUTTON]: 0,
    [KIND.AZ_LOGIN_LINK]: 1,
    [KIND.APEX_AGREE]: 2
  };

  const state = {
    observer: null,
    scanTimer: 0,
    routeTimer: 0,
    lastUrl: location.href,
    clickedKinds: new Set(),
    firstSeenAt: Object.create(null),
    lastClickedKind: '',
    lastClickAt: 0
  };

  boot();

  function boot() {
    log(`Started v${VERSION}`);
    scanNow();
    state.scanTimer = window.setInterval(scanNow, CFG.scanMs);
    state.routeTimer = window.setInterval(watchRoute, CFG.routeWatchMs);

    document.addEventListener('visibilitychange', scanNow, true);
    window.addEventListener('focus', scanNow, true);
    window.addEventListener('pageshow', scanNow, true);

    installObserver();
  }

  function log(message) {
    try { console.log(`[${SCRIPT_NAME}] ${message}`); } catch {}
  }

  function watchRoute() {
    if (location.href === state.lastUrl) return;

    state.lastUrl = location.href;
    state.clickedKinds.clear();
    state.firstSeenAt = Object.create(null);
    state.lastClickedKind = '';
    state.lastClickAt = 0;
    log(`Route changed -> ${location.href}`);
    scanNow();
  }

  function installObserver() {
    try { state.observer?.disconnect?.(); } catch {}

    try {
      state.observer = new MutationObserver(() => scanNow());
      state.observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true
      });
    } catch {}
  }

  function now() {
    return Date.now();
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function lower(value) {
    return normalizeText(value).toLowerCase();
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;

    try {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch {
      return false;
    }
  }

  function isEnabled(el) {
    if (!el || !(el instanceof Element)) return false;

    return !(
      el.disabled ||
      el.getAttribute('disabled') !== null ||
      el.getAttribute('aria-disabled') === 'true'
    );
  }

  function getInputType(el) {
    return lower(el?.getAttribute?.('type') || el?.type || '');
  }

  function isLikelyCredentialUserInput(el) {
    if (!el || !isVisible(el) || !isEnabled(el)) return false;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    if (el instanceof HTMLTextAreaElement) return true;

    const type = getInputType(el);
    if (!type || type === 'text' || type === 'email' || type === 'search' || type === 'tel') return true;
    return false;
  }

  function getCredentialUserScore(el) {
    if (!el) return Number.NEGATIVE_INFINITY;
    const meta = lower([
      el.getAttribute?.('autocomplete'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.labels?.[0]?.textContent,
      el.closest?.('label')?.textContent
    ].filter(Boolean).join(' '));
    let score = 0;
    if (/\busername\b/.test(meta)) score += 30;
    if (/\bemail\b/.test(meta)) score += 20;
    if (/\buser\b/.test(meta)) score += 10;
    if (/\blogin\b/.test(meta)) score += 8;
    if (lower(el.getAttribute?.('autocomplete') || '') === 'username') score += 25;
    if (getInputType(el) === 'email') score += 5;
    return score;
  }

  function getVisibleCredentialUserInputs(root) {
    return Array.from((root || document).querySelectorAll('input, textarea'))
      .filter((el) => isLikelyCredentialUserInput(el))
      .sort((a, b) => getCredentialUserScore(b) - getCredentialUserScore(a));
  }

  function getVisibleApexLoginFormContext(root = document) {
    const passwordInput = Array.from((root || document).querySelectorAll('input[type="password"]'))
      .find((el) => isVisible(el) && isEnabled(el));
    if (!passwordInput) return null;

    const form = passwordInput.closest('form') || root || document;
    const userInput = getVisibleCredentialUserInputs(form)
      .find((el) => el !== passwordInput) || null;
    const submitButton = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'))
      .find((el) => isVisible(el) && isEnabled(el)) || null;

    return {
      form,
      userInput,
      passwordInput,
      submitButton
    };
  }

  function setNativeInputValue(el, value) {
    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && typeof desc.set === 'function' ? desc.set : null;
    if (!setter) return false;
    try {
      setter.call(el, value);
      return true;
    } catch {
      return false;
    }
  }

  function syncFrameworkValueTracker(el, previousValue) {
    const tracker = el?._valueTracker;
    if (!tracker || typeof tracker.setValue !== 'function') return false;
    try {
      tracker.setValue(String(previousValue ?? ''));
      return true;
    } catch {
      return false;
    }
  }

  function dispatchAuthFieldLifecycle(el) {
    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    const value = String(el.value || '');
    if (!value) return false;
    const lastChar = value.slice(-1) || ' ';

    try { el.focus({ preventScroll: true }); } catch {}
    try { el.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: false })); } catch {}
    try { setNativeInputValue(el, ''); syncFrameworkValueTracker(el, value); } catch {}
    try { el.setAttribute('value', ''); } catch {}
    try {
      if (typeof InputEvent === 'function') {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: null, inputType: 'deleteContentBackward' }));
      } else {
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }
    } catch {}
    setNativeInputValue(el, value);
    syncFrameworkValueTracker(el, '');
    try { el.setAttribute('value', value); } catch {}
    try {
      if (typeof InputEvent === 'function') {
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: lastChar, inputType: 'insertText' }));
      }
    } catch {}
    try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' })); } catch {}
    try { el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: lastChar })); } catch {}
    try {
      if (typeof InputEvent === 'function') {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: lastChar, inputType: 'insertText' }));
      } else {
        el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      }
    } catch {}
    try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: lastChar })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })); } catch {}
    try { el.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false })); } catch {}
    try { el.blur(); } catch {}
    return true;
  }

  function forceNativeFormSubmit(form) {
    if (!form || !(form instanceof HTMLFormElement)) return false;
    try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch {}
    try {
      HTMLFormElement.prototype.submit.call(form);
      return true;
    } catch {
      return false;
    }
  }

  function prepareApexAuthForm(triggerEl) {
    const formContext = getVisibleApexLoginFormContext(triggerEl?.closest?.('form') || document);
    if (!formContext) return false;

    let prepared = false;
    for (const input of [formContext.userInput, formContext.passwordInput].filter(Boolean)) {
      if (!normalizeText(input.value).length) continue;
      prepared = dispatchAuthFieldLifecycle(input) || prepared;
    }
    return prepared;
  }

  function isApexHost() {
    return /farmersagent\.(?:my\.salesforce|lightning\.force)\.com$/i.test(location.host);
  }

  function isOktaHost() {
    return /\.okta\.com$/i.test(location.host);
  }

  function isEagentSamlHost() {
    return /^eagentsaml\.farmersinsurance\.com$/i.test(location.host);
  }

  function isApexAuthHost() {
    return isApexHost() || isOktaHost() || isEagentSamlHost();
  }

  function isAgencyZoomHost() {
    return /app\.agencyzoom\.com$/i.test(location.host);
  }

  function findAgencyZoomLoginLink() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links.find((el) => {
      if (!isVisible(el) || !isEnabled(el)) return false;

      let pathname = '';
      try { pathname = new URL(el.href, location.href).pathname; } catch {}
      return pathname === '/login' && lower(el.textContent) === 'click here';
    }) || null;
  }

  function findAgencyZoomLoginButton() {
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'));
    return buttons.find((el) => {
      if (!isVisible(el) || !isEnabled(el)) return false;

      const label = lower([
        el.textContent,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('name')
      ].filter(Boolean).join(' '));
      const className = lower(el.className);
      const dataTarget = lower(el.getAttribute('data-target'));
      const dataToggle = lower(el.getAttribute('data-toggle'));
      const type = lower(el.getAttribute('type') || el.type || '');

      const exactAgencyZoomModalButton = dataTarget === '#confirmemail' && label === 'login';
      const likelyAgencyZoomLoginButton =
        /\blogin\b/.test(label) &&
        (
          className.includes('action-login') ||
          dataTarget === '#confirmemail' ||
          (type === 'submit' && dataToggle === 'modal')
        );

      return exactAgencyZoomModalButton || likelyAgencyZoomLoginButton;
    }) || null;
  }

  function isTrustedDeviceAgreeLabel(label) {
    const text = lower(label);
    if (!text) return false;
    if (text === 'i agree') return true;
    if (/\bagree\b/.test(text) && /\b(i|yes|trust|device|remember|recognize)\b/.test(text)) return true;
    if (/\b(trust|remember|recognize)\b/.test(text) && /\b(device|browser|me)\b/.test(text)) return true;
    return false;
  }

  function findApexAgreeButton() {
    const loginForm = getVisibleApexLoginFormContext(document);
    if (loginForm?.passwordInput && loginForm?.userInput) return null;

    const bodyText = lower(document.body?.innerText || '');
    const looksLikeTrustedDevicePage = /\b(i agree|trust|trusted|remember|recognize|recognized|this device|this browser)\b/.test(bodyText);
    const exact = document.querySelector('#okta-signin-submit');
    if (exact && isVisible(exact) && isEnabled(exact)) {
      const label = [
        exact.textContent,
        exact.value,
        exact.getAttribute('aria-label'),
        exact.getAttribute('title'),
        exact.getAttribute('name')
      ].filter(Boolean).join(' ');
      if (isTrustedDeviceAgreeLabel(label) || looksLikeTrustedDevicePage) return exact;
    }

    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'));
    return buttons.find((el) => {
      if (!isVisible(el) || !isEnabled(el)) return false;
      const label = [
        el.textContent,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('name')
      ].filter(Boolean).join(' ');
      return isTrustedDeviceAgreeLabel(label) || (looksLikeTrustedDevicePage && el.id === 'okta-signin-submit');
    }) || null;
  }

  function findApexCredentialSubmitButton() {
    const loginForm = getVisibleApexLoginFormContext(document);
    if (!loginForm?.passwordInput || !loginForm?.userInput) return null;

    const hasFilledUser = normalizeText(loginForm.userInput.value).length > 0;
    const hasFilledPassword = normalizeText(loginForm.passwordInput.value).length > 0;
    if (!hasFilledPassword || !hasFilledUser) return null;

    const buttons = Array.from(loginForm.form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'));
    return buttons.find((el) => {
      if (!isVisible(el) || !isEnabled(el)) return false;
      const label = lower([
        el.textContent,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('name')
      ].filter(Boolean).join(' '));
      if (label === 'i agree') return false;
      return /\b(sign in|login|log in|submit|continue)\b/.test(label) || el.id === 'okta-signin-submit';
    }) || null;
  }

  function findTarget(kind) {
    if (kind === KIND.APEX_LOGIN_SUBMIT) return findApexCredentialSubmitButton();
    if (kind === KIND.APEX_AGREE) return findApexAgreeButton();
    if (kind === KIND.AZ_LOGIN_LINK) return findAgencyZoomLoginLink();
    if (kind === KIND.AZ_LOGIN_BUTTON) return findAgencyZoomLoginButton();
    return null;
  }

  function noteFirstSeen(kind, el) {
    if (!kind || !el) return;
    if (state.firstSeenAt[kind]) return;
    state.firstSeenAt[kind] = now();
  }

  function canClickKind(kind) {
    if (state.clickedKinds.has(kind)) {
      if (kind !== KIND.APEX_AGREE && kind !== KIND.APEX_LOGIN_SUBMIT) return false;
      if (!findTarget(kind)) return false;
    }
    if ((now() - state.lastClickAt) < CFG.clickCooldownMs) return false;

    if (state.lastClickedKind && state.lastClickedKind !== kind) {
      const previousTarget = findTarget(state.lastClickedKind);
      if (previousTarget) return false;
    }

    return true;
  }

  function clickElement(el, label, kind = '') {
    if (!el || !isVisible(el) || !isEnabled(el)) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}
    if (kind === KIND.APEX_LOGIN_SUBMIT || kind === KIND.APEX_AGREE) {
      prepareApexAuthForm(el);
    }

    let activated = false;
    try {
      dispatchPressSequence(el);
      el.click();
      activated = true;
    } catch {}

    if (kind === KIND.APEX_LOGIN_SUBMIT) {
      const form = el.closest?.('form');
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit(el instanceof HTMLElement ? el : undefined);
          activated = true;
        } catch {}
      }
      if (form) {
        activated = forceNativeFormSubmit(form) || activated;
      }
    }

    if (activated) {
      log(`Clicked ${label}`);
      return true;
    }

    log(`Click failed for ${label}`);
    return false;
  }

  function markClicked(kind) {
    state.clickedKinds.add(kind);
    state.lastClickedKind = kind;
    state.lastClickAt = now();
  }

  function dispatchPressSequence(el) {
    const mouseInit = {
      view: window,
      bubbles: true,
      cancelable: true,
      composed: true
    };

    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerdown', { ...mouseInit, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 1 }));
      }
    } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { ...mouseInit, button: 0, buttons: 1 })); } catch {}
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(new PointerEvent('pointerup', { ...mouseInit, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0 }));
      }
    } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { ...mouseInit, button: 0, buttons: 0 })); } catch {}
  }

  function getSteps() {
    if (isApexAuthHost()) {
      return [
        { kind: KIND.APEX_LOGIN_SUBMIT, label: 'APEX Login Submit' },
        { kind: KIND.APEX_AGREE, label: 'APEX I AGREE' }
      ];
    }

    if (isAgencyZoomHost()) {
      const steps = [
        { kind: KIND.AZ_LOGIN_LINK, label: 'AgencyZoom Click here', el: findAgencyZoomLoginLink() },
        { kind: KIND.AZ_LOGIN_BUTTON, label: 'AgencyZoom Login', el: findAgencyZoomLoginButton() }
      ];

      for (const step of steps) {
        if (step.el) noteFirstSeen(step.kind, step.el);
      }

      return steps.sort((a, b) => {
        const aSeenAt = a.el ? (state.firstSeenAt[a.kind] || 0) : Number.POSITIVE_INFINITY;
        const bSeenAt = b.el ? (state.firstSeenAt[b.kind] || 0) : Number.POSITIVE_INFINITY;
        if (aSeenAt !== bSeenAt) return aSeenAt - bSeenAt;
        return (TIE_BREAK_RANK[a.kind] || 0) - (TIE_BREAK_RANK[b.kind] || 0);
      });
    }

    return [];
  }

  function scanNow() {
    if (document.readyState === 'loading') return;

    for (const step of getSteps()) {
      if (!canClickKind(step.kind)) continue;

      const el = step.el || findTarget(step.kind);
      if (!el) continue;
      if (!clickElement(el, step.label, step.kind)) continue;

      markClicked(step.kind);
      break;
    }
  }
})();
