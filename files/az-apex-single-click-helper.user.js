// ==UserScript==
// @name         Cross-Origin AZ + APEX Single Click Helper
// @namespace    homebot.az-apex-single-click-helper
// @version      1.0.4
// @description  Clicks the first visible AgencyZoom login control, APEX autofilled credential submit, or APEX I AGREE button once per route, only advancing after the prior control disappears.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.my.salesforce.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://*.okta.com/*
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
  const VERSION = '1.0.4';

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

  function isApexHost() {
    return /farmersagent\.(?:my\.salesforce|lightning\.force)\.com$/i.test(location.host);
  }

  function isOktaHost() {
    return /\.okta\.com$/i.test(location.host);
  }

  function isApexAuthHost() {
    return isApexHost() || isOktaHost();
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
    const buttons = Array.from(document.querySelectorAll('#okta-signin-submit, button, input[type="submit"], input[type="button"], [role="button"]'));
    return buttons.find((el) => {
      if (!isVisible(el) || !isEnabled(el)) return false;
      const label = [
        el.textContent,
        el.value,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('name')
      ].filter(Boolean).join(' ');
      return isTrustedDeviceAgreeLabel(label);
    }) || null;
  }

  function findApexCredentialSubmitButton() {
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'))
      .filter((el) => isVisible(el) && isEnabled(el));
    if (!passwordInputs.length) return null;

    const passwordInput = passwordInputs.find((el) => normalizeText(el.value).length > 0) || passwordInputs[0];
    const form = passwordInput.closest('form') || document;

    const userInputs = Array.from(form.querySelectorAll('input[type="text"], input[type="email"], input[name], input[id]'))
      .filter((el) => isVisible(el) && isEnabled(el) && el !== passwordInput);
    const hasFilledUser = userInputs.some((el) => normalizeText(el.value).length > 0);
    const hasFilledPassword = normalizeText(passwordInput.value).length > 0;
    if (!hasFilledPassword || !hasFilledUser) return null;

    const buttons = Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]'));
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
    if (state.clickedKinds.has(kind)) return false;
    if ((now() - state.lastClickAt) < CFG.clickCooldownMs) return false;

    if (state.lastClickedKind && state.lastClickedKind !== kind) {
      const previousTarget = findTarget(state.lastClickedKind);
      if (previousTarget) return false;
    }

    return true;
  }

  function clickElement(el, label) {
    if (!el || !isVisible(el) || !isEnabled(el)) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus({ preventScroll: true }); } catch {}

    try {
      dispatchPressSequence(el);
      el.click();
      log(`Clicked ${label}`);
      return true;
    } catch (err) {
      log(`Click failed for ${label}: ${err?.message || err}`);
      return false;
    }
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
      if (!clickElement(el, step.label)) continue;

      markClicked(step.kind);
      break;
    }
  }
})();
