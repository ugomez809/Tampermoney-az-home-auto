// ==UserScript==
// @name         97 AUTO Cross-Origin AZ + APEX Single Click Helper
// @namespace    autoflow.az-apex-single-click-helper
// @version      1.0.0.1
// @description  Clicks the visible AgencyZoom login control or APEX I AGREE button once per page load, and only advances to a second control after the first one disappears.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.my.salesforce.com/*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/az-apex-single-click-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/az-apex-single-click-helper.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = '97 AUTO Cross-Origin AZ + APEX Single Click Helper';
  const VERSION = '1.0.0.1';

  const CFG = {
    scanMs: 400,
    routeWatchMs: 800,
    clickCooldownMs: 1200
  };

  const KIND = {
    APEX_AGREE: 'apex-agree',
    AZ_LOGIN_LINK: 'az-login-link',
    AZ_LOGIN_BUTTON: 'az-login-button'
  };

  const state = {
    observer: null,
    scanTimer: 0,
    routeTimer: 0,
    lastUrl: location.href,
    clickedKinds: new Set(),
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
    const buttons = Array.from(document.querySelectorAll('button.action-login.btn.btn-primary[type="submit"]'));
    return buttons.find((el) => {
      if (!isVisible(el) || !isEnabled(el)) return false;
      return lower(el.textContent) === 'login' && normalizeText(el.getAttribute('data-target')) === '#confirmEmail';
    }) || null;
  }

  function findApexAgreeButton() {
    const button = document.querySelector('#okta-signin-submit.button.button-primary[type="submit"]');
    if (!button || !isVisible(button) || !isEnabled(button)) return null;
    return lower(button.value) === 'i agree' ? button : null;
  }

  function findTarget(kind) {
    if (kind === KIND.APEX_AGREE) return findApexAgreeButton();
    if (kind === KIND.AZ_LOGIN_LINK) return findAgencyZoomLoginLink();
    if (kind === KIND.AZ_LOGIN_BUTTON) return findAgencyZoomLoginButton();
    return null;
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

    try {
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

  function getSteps() {
    if (isApexHost()) {
      return [
        { kind: KIND.APEX_AGREE, label: 'APEX I AGREE' }
      ];
    }

    if (isAgencyZoomHost()) {
      return [
        { kind: KIND.AZ_LOGIN_LINK, label: 'AgencyZoom Click here' },
        { kind: KIND.AZ_LOGIN_BUTTON, label: 'AgencyZoom Login' }
      ];
    }

    return [];
  }

  function scanNow() {
    if (document.readyState === 'loading') return;

    for (const step of getSteps()) {
      if (!canClickKind(step.kind)) continue;

      const el = findTarget(step.kind);
      if (!el) continue;
      if (!clickElement(el, step.label)) continue;

      markClicked(step.kind);
      break;
    }
  }
})();
