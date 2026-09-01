// ==UserScript==
// @name         Farmers Apex Automatic Login
// @namespace    local.automatic-renewals.apex-login
// @version      1.0.12
// @description  Automatically logs into Farmers Apex and completes SMS MFA through AgencyZoom.
// @author       Local
// @match        https://farmersagent.my.salesforce.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://eagentsaml.farmersinsurance.com/*
// @match        https://farmersinsurance.okta.com/*
// @match        https://app.agencyzoom.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/farmers-apex-automatic-login.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/farmers-apex-automatic-login.user.js
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const KEYS = Object.freeze({
    legacyCredentials: 'farmersApexLogin.v1.credentials',
    request: 'farmersApexLogin.v1.mfaRequest',
    response: 'farmersApexLogin.v1.mfaResponse',
    status: 'farmersApexLogin.v1.status',
    helperOpenLease: 'farmersApexLogin.v1.agencyZoomHelperOpenLease',
  });
  const CONFIG = Object.freeze({
    initialMfaWaitMs: 10_000,
    freshnessMs: 5 * 60_000,
    reloadLimit: 3,
    maxMfaAttempts: 2,
    scanIntervalMs: 300,
    actionLeaseMs: 12_000,
    helperOpenLeaseMs: 5 * 60_000,
  });
  const FARMERS_CODE_PATTERN = /Your Farmers verification code is\s+(\d{6})\./i;
  const AGENCY_ZOOM_HELPER_SESSION_KEY = 'farmersApexLogin.v1.agencyZoomHelper';
  const TEST_MODE = globalThis.__FARMERS_APEX_LOGIN_TEST_MODE__ === true;

  let stopped = false;
  let scanTimer;
  let observer;
  let requestListener;
  let responseListener;
  let helperTabHandle;
  let lastAction = { signature: '', at: 0 };
  let agencyPollTimer;
  let scanInterval;

  function now() { return Date.now(); }
  function textOf(element) { return String(element?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function bodyText() { return String(document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function isPlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function allPiercing(selector, root = document) {
    const matches = [];
    const visit = (node) => {
      if (!node?.querySelectorAll) return;
      matches.push(...node.querySelectorAll(selector));
      for (const element of node.querySelectorAll('*')) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(root);
    return [...new Set(matches)];
  }
  function isAgencyZoomHost() { return /(^|\.)agencyzoom\.com$/i.test(location.hostname); }
  function isApexHost() {
    return /(?:farmersagent\.(?:my\.salesforce|lightning\.force)\.com|farmersinsurance\.(?:okta\.com|com)|eagentsaml\.farmersinsurance\.com)$/i
      .test(location.hostname);
  }

  function clearAllStoredState() {
    Object.values(KEYS).forEach((key) => GM_deleteValue(key));
    removePanel();
  }

  function clearLegacyCredentials() {
    GM_deleteValue(KEYS.legacyCredentials);
  }

  function safeStatus(state, message) {
    const allowed = new Set(['idle', 'setup_required', 'logging_in', 'mfa_waiting', 'authenticated', 'blocked']);
    const safeState = allowed.has(state) ? state : 'blocked';
    const safeMessage = normalize(message).slice(0, 180);
    GM_setValue(KEYS.status, { state: safeState, message: safeMessage, updatedAt: new Date().toISOString() });
    if (safeState === 'blocked') showPanel(safeState, safeMessage);
    else removePanel();
  }

  function addStyles() {
    GM_addStyle(`
      #tm-apex-login-panel { position:fixed; right:16px; bottom:16px; z-index:2147483647; width:310px;
        padding:12px 14px; border-radius:8px; background:#172033; color:#fff; box-shadow:0 5px 24px #0006;
        font:13px/1.4 Arial,sans-serif; }
      #tm-apex-login-panel strong { display:block; margin-bottom:4px; }
    `);
  }

  function showPanel(state, message) {
    if (!document.body) return;
    let panel = document.getElementById('tm-apex-login-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tm-apex-login-panel';
      document.body.appendChild(panel);
    }
    panel.replaceChildren();
    const title = document.createElement('strong');
    title.textContent = state === 'blocked' ? 'Farmers login needs attention' : 'Farmers automatic login';
    const detail = document.createElement('div');
    detail.textContent = message;
    panel.append(title, detail);
  }

  function removePanel() { document.getElementById('tm-apex-login-panel')?.remove(); }

  function registerMenus() {
    GM_registerMenuCommand('Resume Automatic Login', () => {
      stopped = false;
      cleanupExpiredState();
      safeStatus('idle', 'Automatic login resumed.');
      scheduleScan(0);
    });
    GM_registerMenuCommand('Clear Automatic Login State', () => {
      if (globalThis.confirm?.('Clear automatic-login status and MFA state?')) clearAllStoredState();
    });
    GM_registerMenuCommand('Show Login Status', () => {
      const status = GM_getValue(KEYS.status, { state: 'idle', message: 'No login has run yet.', updatedAt: '' });
      globalThis.alert?.(`State: ${status.state}\n${status.message}\n${status.updatedAt || ''}`);
    });
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function firstVisible(selectors, root = document) {
    for (const selector of selectors) {
      for (const element of allPiercing(selector, root)) if (isVisible(element)) return element;
    }
    return null;
  }

  function controlsByText(pattern) {
    return allPiercing('button,a,input[type="submit"],input[type="button"],[role="button"],[role="tab"],[aria-haspopup],[aria-expanded],.dropdown-toggle,.caret,label,li')
      .filter((element) => isVisible(element) && pattern.test(normalize(element.value || textOf(element))));
  }

  function setNativeInputValue(input, value) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) throw new Error('Input setter unavailable.');
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    if (input.value !== value) throw new Error('Login input rejected its value.');
  }

  function inputHasValue(input) {
    return Boolean(input && String(input.value || '').trim());
  }

  function primeBrowserSavedLogin(user, password) {
    if (user) user.autocomplete = 'username';
    if (password) password.autocomplete = 'current-password';
    const target = (user && !inputHasValue(user) ? user : null)
      || (password && !inputHasValue(password) ? password : null)
      || password
      || user;
    if (!target) return;
    target.scrollIntoView?.({ block: 'center', inline: 'center' });
    target.focus();
    target.click();
  }

  function usernameInput() {
    return firstVisible(['input[type="email"]', 'input[autocomplete="username"]', 'input[name*="email" i]',
      'input[id*="email" i]', 'input[name*="user" i]', 'input[id*="user" i]', 'input[type="text"]']);
  }
  function passwordInput() { return firstVisible(['input[type="password"]']); }
  function codeInput() {
    return firstVisible(['input[autocomplete="one-time-code"]', 'input[name*="code" i]', 'input[id*="code" i]',
      'input[name*="verification" i]', 'input[id*="verification" i]', 'input[type="tel"]']);
  }

  function isRejectedLoginText(text) {
    return /\b(unable to sign in|invalid username|invalid password|incorrect username|incorrect password|login failed)\b/i
      .test(normalize(text));
  }

  function classifyPage() {
    const text = bodyText();
    if (isRejectedLoginText(text)) return 'login_rejected';
    if (/captcha|verify with a passkey|security key|webauthn|password expired|change your password/i.test(text)) {
      return 'unsupported_challenge';
    }
    if (isAgencyZoomHost()) {
      if (codeInput() || /verification code|authentication factor|multi-factor|\bmfa\b|one-time code/i.test(text)) {
        return 'unsupported_challenge';
      }
      if (passwordInput() || (/login|sign in/i.test(text) && usernameInput())) return 'agencyzoom_login';
      if (/conversations|service request|pipeline|customer/i.test(text)) return 'agencyzoom_authenticated';
      return 'unknown';
    }
    if (codeInput()) return 'apex_code';
    if (/select authentication factor|sms authentication|text message authentication|choose.*factor/i.test(text)
      || needsFactorDropdownFallback(text)) return 'apex_factor';
    if (controlsByText(/^finish logging in$/i).length) return 'apex_finish';
    if (passwordInput()) return 'apex_password';
    if (usernameInput()) return 'apex_username';
    if ((isApexHost() || TEST_MODE) && /salesforce|apex|alerts|home/i.test([document.title, text].join(' '))) {
      return 'apex_authenticated';
    }
    return 'unknown';
  }

  function actionSignature(kind) {
    const inputState = allPiercing('input')
      .filter((input) => isVisible(input))
      .map((input) => [
        normalize(input.type || 'text').toLowerCase(),
        normalize(input.name || input.id || input.autocomplete || ''),
        inputHasValue(input) ? 'filled' : 'empty',
      ].join(':'))
      .join(',');
    return [location.href, kind, bodyText().slice(0, 240), inputState, document.querySelectorAll('input,button,a').length].join('|');
  }

  function takeLease(kind) {
    const signature = actionSignature(kind);
    if (lastAction.signature === signature && now() - lastAction.at < CONFIG.actionLeaseMs) return false;
    lastAction = { signature, at: now() };
    return true;
  }

  function clickFirst(pattern) {
    const control = controlsByText(pattern)[0];
    if (!control) return false;
    control.click();
    return true;
  }

  function submitLoginForm(input) {
    if (clickFirst(/^(sign in|log in|login|continue|next|i agree)$/i)) return true;
    const form = input?.closest('form');
    if (form?.requestSubmit) { form.requestSubmit(); return true; }
    return false;
  }

  function needsFactorDropdownFallback(text) {
    const clean = normalize(text);
    return /okta verify/i.test(clean) && /send push/i.test(clean) && /or enter code/i.test(clean)
      && !/sms authentication|text message authentication/i.test(clean);
  }

  function isSmsFactorReady(text) {
    const clean = normalize(text);
    return /sms authentication|text message authentication/i.test(clean)
      && /enter code|send code|code sent|verification code/i.test(clean)
      && !needsFactorDropdownFallback(clean);
  }

  function clickSmsFactorOption() {
    const candidates = controlsByText(/\b(sms authentication|text message authentication|text message|sms)\b/i)
      .map((element) => ({ element, text: normalize(element.value || textOf(element)) }))
      .filter(({ text }) => !/okta verify|voice call|select an authentication factor|factor selected|enter code|send code|code sent|verification code/i.test(text));
    const factor = candidates.find(({ text }) => /^(sms authentication|text message authentication|text message|sms)(?:\s*\([^)]*\))?$/i.test(text))
      || candidates.find(({ text }) => /\b(sms authentication|text message authentication|text message)\b/i.test(text) && text.length <= 80);
    if (!factor) return false;
    factor.element.click();
    return true;
  }

  function clickFactorDropdownFallback() {
    if (!needsFactorDropdownFallback(bodyText())) return false;
    const candidates = allPiercing('button,a,[role="button"],input[type="button"],input[type="submit"],[aria-haspopup],[aria-expanded],.dropdown-toggle,.caret')
      .filter((element) => isVisible(element))
      .filter((element) => !/send push|back to sign in|need help/i.test(normalize(element.value || textOf(element))))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftArea = leftRect.width * leftRect.height;
        const rightArea = rightRect.width * rightRect.height;
        return leftArea - rightArea;
      });
    const dropdown = candidates.find((element) => /select authentication factor|factor/i.test(normalize(element.getAttribute('aria-label') || textOf(element))))
      || candidates.find((element) => /menu|listbox|true/i.test(normalize(element.getAttribute('aria-haspopup') || element.getAttribute('aria-expanded'))))
      || candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width <= 64 && rect.height <= 64;
      });
    if (!dropdown) return false;
    dropdown.click();
    return true;
  }

  function submitBrowserSavedLogin(serviceName, submittedState, submittedMessage) {
    const user = usernameInput();
    const password = passwordInput();
    const target = password || user;
    if (!target) throw new Error(`${serviceName} login fields were not recognized.`);
    if (user && !inputHasValue(user)) {
      primeBrowserSavedLogin(user, password);
      safeStatus('setup_required', `Select the saved ${serviceName} login in this tab; this script will continue after it fills.`);
      return false;
    }
    if (password && !inputHasValue(password)) {
      primeBrowserSavedLogin(user, password);
      safeStatus('setup_required', `Select the saved ${serviceName} login in this tab; this script will continue after it fills.`);
      return false;
    }
    if (!submitLoginForm(target)) throw new Error(`${serviceName} login control was not recognized.`);
    safeStatus(submittedState, submittedMessage);
    return true;
  }

  function fillApexLogin() {
    return submitBrowserSavedLogin('Apex', 'logging_in', 'Browser-saved Apex login submitted.');
  }

  function fillAgencyZoomLogin() {
    return submitBrowserSavedLogin('AgencyZoom', 'mfa_waiting', 'Browser-saved AgencyZoom login submitted.');
  }

  function newRunId() {
    return globalThis.crypto?.randomUUID?.() || `${now()}-${Math.random().toString(36).slice(2)}`;
  }

  function liveRequest() {
    const request = GM_getValue(KEYS.request, null);
    if (!request || typeof request !== 'object') return null;
    if (Number(request.expiresAt || 0) <= now()) { GM_deleteValue(KEYS.request); return null; }
    return request;
  }

  function patchLiveRequest(patch = {}) {
    const request = liveRequest();
    if (!request) return null;
    const updated = { ...request, ...patch };
    GM_setValue(KEYS.request, updated);
    return updated;
  }

  function readAgencyZoomHelperOpenLease() {
    const lease = GM_getValue(KEYS.helperOpenLease, null);
    if (!isPlainObject(lease)) return null;
    const expiresAt = Number(lease.expiresAt || 0);
    if (!expiresAt || expiresAt <= now()) {
      GM_deleteValue(KEYS.helperOpenLease);
      return null;
    }
    return lease;
  }

  function writeAgencyZoomHelperOpenLease(request, openedAt = now()) {
    const requestExpiresAt = Number(request?.expiresAt || 0);
    const maxExpiresAt = openedAt + CONFIG.helperOpenLeaseMs;
    const expiresAt = requestExpiresAt > openedAt ? Math.min(requestExpiresAt, maxExpiresAt) : maxExpiresAt;
    const lease = {
      runId: normalize(request?.runId || ''),
      openedAt,
      expiresAt,
      url: 'https://app.agencyzoom.com/login#tm-apex-mfa',
      openerUrl: String(location.href || ''),
    };
    GM_setValue(KEYS.helperOpenLease, lease);
    return lease;
  }

  function isAgencyZoomHelperTab() {
    if (location.hash === '#tm-apex-mfa') {
      try { sessionStorage.setItem(AGENCY_ZOOM_HELPER_SESSION_KEY, '1'); } catch {}
      return true;
    }
    try { return sessionStorage.getItem(AGENCY_ZOOM_HELPER_SESSION_KEY) === '1'; } catch {}
    return false;
  }

  function createMfaRequest(attempt = 1, alreadySent = false) {
    const existing = liveRequest();
    if (existing) return existing;
    const started = now();
    const request = {
      runId: newRunId(),
      attempt,
      state: alreadySent ? 'code_requested' : 'collecting_baseline',
      baselineIds: [],
      requestedAt: alreadySent ? started - CONFIG.initialMfaWaitMs : 0,
      expiresAt: started + CONFIG.freshnessMs,
      reloadCount: 0,
    };
    GM_setValue(KEYS.request, request);
    return request;
  }

  function transitionMfaRequest(runId, nextState, patch = {}) {
    const request = liveRequest();
    if (!request || request.runId !== runId) throw new Error('MFA run no longer matches.');
    const allowed = { collecting_baseline: 'baseline_ready', baseline_ready: 'code_requested' };
    if (allowed[request.state] !== nextState) throw new Error('Invalid MFA state transition.');
    const started = nextState === 'code_requested' ? Number(patch.requestedAt || now()) : request.requestedAt;
    const updated = { ...request, ...patch, state: nextState, requestedAt: started,
      expiresAt: nextState === 'code_requested' ? started + CONFIG.freshnessMs : request.expiresAt };
    GM_setValue(KEYS.request, updated);
    return updated;
  }

  function selectFreshFarmersMfa(messages, request) {
    const baseline = new Set(request.baselineIds || []);
    const unique = new Map(messages.filter((message) => message.id).map((message) => [message.id, message]));
    const candidates = [...unique.values()].flatMap((message) => {
      const match = normalize(message.text).match(FARMERS_CODE_PATTERN);
      const receivedAt = Number(message.receivedAt);
      if (!match || !/^\d{5}$/.test(normalize(message.sender)) || baseline.has(message.id)
        || receivedAt < request.requestedAt || receivedAt > request.expiresAt) return [];
      return [{ code: match[1], messageId: message.id }];
    });
    if (!candidates.length) return { status: 'missing' };
    if (candidates.length > 1) return { status: 'ambiguous', candidateCount: candidates.length };
    return { status: 'found', ...candidates[0] };
  }

  function openAgencyZoomHelper(request) {
    if (helperTabHandle) return;
    const existingLease = readAgencyZoomHelperOpenLease();
    if (existingLease) {
      if (!request.agencyZoomHelperOpenedAt) {
        patchLiveRequest({ agencyZoomHelperOpenedAt: Number(existingLease.openedAt || now()) });
      }
      safeStatus('mfa_waiting', 'AgencyZoom helper already opened. Waiting for a fresh Farmers verification message.');
      return;
    }
    if (request.agencyZoomHelperOpenedAt) {
      writeAgencyZoomHelperOpenLease(request, Number(request.agencyZoomHelperOpenedAt || now()));
      safeStatus('mfa_waiting', 'Waiting for a fresh Farmers verification message.');
      return;
    }
    const openedAt = now();
    writeAgencyZoomHelperOpenLease(request, openedAt);
    patchLiveRequest({ agencyZoomHelperOpenedAt: openedAt });
    helperTabHandle = GM_openInTab('https://app.agencyzoom.com/login#tm-apex-mfa', {
      active: true, insert: true, setParent: true,
    });
    safeStatus('mfa_waiting', 'AgencyZoom helper opened. Select saved login there if prompted.');
  }

  function isTrustDeviceText(value) {
    return /^do not challenge me on this device for the next (?:24\s*hours|24hours|30 days)\.?$/i
      .test(normalize(value));
  }

  function exactTrustCheckbox() {
    const labels = allPiercing('label');
    const label = labels.find((item) => isTrustDeviceText(textOf(item)));
    const checkbox = label?.querySelector('input[type="checkbox"]')
      || (label?.htmlFor ? document.getElementById(label.htmlFor) : null);
    return checkbox && isVisible(checkbox) ? checkbox : null;
  }

  function consumeMfaResponse(response) {
    const request = liveRequest();
    GM_deleteValue(KEYS.response);
    if (!request || !response || response.runId !== request.runId || !/^\d{6}$/.test(String(response.code || ''))
      || Number(response.expiresAt || 0) < now()) return false;
    const input = codeInput();
    if (!input) return false;
    const code = String(response.code);
    try {
      setNativeInputValue(input, code);
      exactTrustCheckbox()?.click();
      if (!clickFirst(/^(verify|continue|next)$/i)) throw new Error('Apex verification control was not recognized.');
      safeStatus('logging_in', 'Farmers verification submitted.');
      return true;
    } finally {
      response.code = '';
    }
  }

  function requestApexCodeAfterBaseline(request) {
    if (!request || request.state !== 'baseline_ready') return;
    const kind = classifyPage();
    const pageText = bodyText();
    const hasSendControl = controlsByText(/send(?:\s+\w+)?\s+code|^(continue|next)$/i).length > 0;
    if (kind !== 'apex_factor' && !hasSendControl && !codeInput()) return;
    if (!request.factorSelectedAt) {
      if (isSmsFactorReady(pageText)) {
        const updated = { ...request, factorSelectedAt: now() };
        GM_setValue(KEYS.request, updated);
        request = updated;
      } else if (clickSmsFactorOption()) {
        const updated = { ...request, factorSelectedAt: now() };
        GM_setValue(KEYS.request, updated);
        globalThis.setTimeout(() => requestApexCodeAfterBaseline(liveRequest()), 250);
        return;
      } else if (needsFactorDropdownFallback(pageText)) {
        const dropdown = controlsByText(/select authentication factor|factor selected|okta verify|authentication factor/i)[0];
        if (dropdown) {
          dropdown.click();
          globalThis.setTimeout(() => requestApexCodeAfterBaseline(liveRequest()), 250);
          return;
        }
        if (clickFactorDropdownFallback()) {
          globalThis.setTimeout(() => requestApexCodeAfterBaseline(liveRequest()), 250);
          return;
        }
      }
    }
    if (codeInput()) {
      transitionMfaRequest(request.runId, 'code_requested', { requestedAt: now() });
      return;
    }
    if (clickFirst(/send(?:\s+\w+)?\s+code|^(continue|next)$/i)) {
      transitionMfaRequest(request.runId, 'code_requested', { requestedAt: now() });
      return;
    }
    if (now() - Number(request.factorSelectedAt || now()) < 8_000) {
      globalThis.setTimeout(() => requestApexCodeAfterBaseline(liveRequest()), 250);
      return;
    }
    block('Apex SMS verification control was not recognized.');
  }

  function beginOrContinueMfa(kind) {
    let request = liveRequest();
    if (!request) request = createMfaRequest(1, kind === 'apex_code');
    openAgencyZoomHelper(request);
    if (request.state === 'baseline_ready') requestApexCodeAfterBaseline(request);
  }

  function cleanupMfaState() {
    GM_deleteValue(KEYS.request);
    GM_deleteValue(KEYS.response);
    try { helperTabHandle?.close?.(); } catch {}
    helperTabHandle = null;
  }

  function block(message) {
    stopped = true;
    safeStatus('blocked', message);
    stopWatchers();
  }

  function stopAuthenticated() {
    cleanupMfaState();
    stopped = true;
    safeStatus('authenticated', 'Apex login completed.');
    stopWatchers();
  }

  function runApexRole() {
    if (stopped || !document.body) return;
    const kind = classifyPage();
    if (kind === 'unknown') return;
    if (kind === 'login_rejected') return block('Farmers rejected the saved Apex login. Automatic retries paused.');
    if (kind === 'unsupported_challenge') return block('A browser or identity-provider challenge requires manual attention.');
    if (kind === 'apex_authenticated') return stopAuthenticated();
    if (!takeLease(kind)) return;
    try {
      if (kind === 'apex_username' || kind === 'apex_password') fillApexLogin();
      else if (kind === 'apex_finish') clickFirst(/^finish logging in$/i);
      else if (kind === 'apex_factor' || kind === 'apex_code') beginOrContinueMfa(kind);
    } catch {
      block('The Apex login page changed or the browser-saved login is unavailable.');
    }
  }

  function parseAgencyZoomTimestamp(value) {
    const normalizedValue = String(value || '').replace(/\s+\|\s+/, ' ');
    const parsed = Date.parse(normalizedValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseTime(value) {
    return parseAgencyZoomTimestamp(value);
  }

  function stableFingerprint(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `generated-${(hash >>> 0).toString(16)}`;
  }

  function readAgencyZoomMessages() {
    const rows = allPiercing(
      '[data-message-id],[data-sms-id],[data-received-at],[data-timestamp],article,section,li,tr',
    );
    const messages = rows.map((row) => {
      const rawRowText = String(row.innerText || row.textContent || '').replace(/\r/g, '').trim();
      const rowText = normalize(rawRowText);
      const body = row.querySelector('[data-message-body],.message-body,.message-text,p');
      const text = normalize(body?.textContent || row.getAttribute('data-message-body') || rowText);
      const sender = normalize(row.getAttribute('data-sender')
        || rawRowText.split(/\n/).map(normalize).find((part) => /^\d{5}$/.test(part)) || '');
      const time = row.querySelector('time');
      const timeText = row.getAttribute('data-received-at') || row.getAttribute('data-timestamp')
        || time?.getAttribute('datetime') || time?.textContent || '';
      const id = row.getAttribute('data-message-id') || row.getAttribute('data-sms-id') || row.id
        || (sender && timeText && text ? stableFingerprint(`${sender}|${timeText}|${text}`) : '');
      return { id, sender, text, receivedAt: parseTime(timeText) };
    }).filter((message) => message.id);
    return [...new Map(messages.map((message) => [message.id, message])).values()];
  }

  function openAgencyZoomTexts(request) {
    if (!/\/integration\/messages\/index/i.test(location.pathname)) {
      if (request.agencyZoomMessagesOpenedAt) return false;
      patchLiveRequest({ agencyZoomMessagesOpenedAt: now() });
      location.assign(`${location.origin}/integration/messages/index#tm-apex-mfa`);
      return false;
    }
    if (clickFirst(/^(text|texts|text messages|sms)$/i)) { scheduleScan(500); return false; }
    if (clickFirst(/^conversations$/i)) { scheduleScan(500); return false; }
    return true;
  }

  function finishAgencyZoomHelper() {
    globalThis.setTimeout(() => {
      try { globalThis.close(); } catch {}
      if (document.body) document.body.textContent = 'Farmers verification delivered. This helper tab is inactive.';
    }, 50);
  }

  function inspectAgencyZoomMessages() {
    const request = liveRequest();
    if (!request) return;
    const messages = readAgencyZoomMessages();
    if (request.state === 'collecting_baseline') {
      transitionMfaRequest(request.runId, 'baseline_ready', { baselineIds: messages.map((message) => message.id) });
      safeStatus('mfa_waiting', 'AgencyZoom is ready; requesting a new Farmers code.');
      return;
    }
    if (request.state !== 'code_requested') return;
    const selection = selectFreshFarmersMfa(messages, request);
    if (selection.status === 'found') {
      const code = selection.code;
      GM_setValue(KEYS.response, { runId: request.runId, code, expiresAt: request.expiresAt });
      selection.code = '';
      finishAgencyZoomHelper();
      return;
    }
    if (selection.status === 'ambiguous') return block('More than one fresh Farmers verification message was found.');
    if ((request.reloadCount || 0) >= CONFIG.reloadLimit) return block('A fresh Farmers verification message was not found.');
    const updated = { ...request, reloadCount: (request.reloadCount || 0) + 1 };
    GM_setValue(KEYS.request, updated);
    if (!TEST_MODE) location.reload();
  }

  function pollAgencyZoomForCode() {
    if (agencyPollTimer) return;
    const request = liveRequest();
    const wait = request?.state === 'code_requested' ? CONFIG.initialMfaWaitMs : 0;
    agencyPollTimer = globalThis.setTimeout(() => {
      agencyPollTimer = undefined;
      inspectAgencyZoomMessages();
    }, wait);
  }

  function runAgencyZoomRole() {
    if (stopped || !document.body) return;
    const helperTab = isAgencyZoomHelperTab();
    const request = liveRequest();
    if (!request || !helperTab) return;
    const kind = classifyPage();
    if (kind === 'unsupported_challenge') return block('AgencyZoom requires manual authentication.');
    if (kind === 'agencyzoom_login') {
      if (!takeLease(kind)) return;
      try { fillAgencyZoomLogin(); } catch { block('AgencyZoom browser-saved login could not be completed automatically.'); }
      return;
    }
    if (kind === 'agencyzoom_authenticated' || location.hash === '#tm-apex-mfa') {
      if (!openAgencyZoomTexts(request)) return;
      pollAgencyZoomForCode();
    }
  }

  function runCurrentRole() {
    if (isAgencyZoomHost()) runAgencyZoomRole();
    else runApexRole();
  }

  function scheduleScan(delay = CONFIG.scanIntervalMs) {
    if (stopped) return;
    clearTimeout(scanTimer);
    scanTimer = globalThis.setTimeout(() => {
      scanTimer = undefined;
      runCurrentRole();
    }, delay);
  }

  function stopWatchers() {
    clearTimeout(scanTimer);
    clearTimeout(agencyPollTimer);
    clearInterval(scanInterval);
    observer?.disconnect();
    if (requestListener) GM_removeValueChangeListener(requestListener);
    if (responseListener) GM_removeValueChangeListener(responseListener);
  }

  function cleanupExpiredState() {
    clearLegacyCredentials();
    const request = GM_getValue(KEYS.request, null);
    if (request && Number(request.expiresAt || 0) <= now()) GM_deleteValue(KEYS.request);
    const response = GM_getValue(KEYS.response, null);
    if (response && Number(response.expiresAt || 0) <= now()) GM_deleteValue(KEYS.response);
    const helperOpenLease = GM_getValue(KEYS.helperOpenLease, null);
    if (helperOpenLease && Number(helperOpenLease.expiresAt || 0) <= now()) GM_deleteValue(KEYS.helperOpenLease);
  }

  function startWatchers() {
    requestListener = GM_addValueChangeListener(KEYS.request, (_key, _oldValue, newValue) => {
      if (!isAgencyZoomHost() && newValue?.state === 'baseline_ready') requestApexCodeAfterBaseline(newValue);
      if (isAgencyZoomHost()) scheduleScan(0);
    });
    responseListener = GM_addValueChangeListener(KEYS.response, (_key, _oldValue, response) => {
      if (!isAgencyZoomHost()) consumeMfaResponse(response);
    });
    observer = new MutationObserver(() => scheduleScan(80));
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    scanInterval = globalThis.setInterval(() => scheduleScan(0), 1500);
  }

  function boot() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }
    addStyles();
    clearLegacyCredentials();
    cleanupExpiredState();
    startWatchers();
    scheduleScan(0);
  }

  registerMenus();
  if (TEST_MODE) {
    globalThis.__FARMERS_APEX_LOGIN_TEST_API__ = {
      KEYS, CONFIG, clearAllStoredState, clearLegacyCredentials,
      setNativeInputValue, classifyPage, selectFreshFarmersMfa, createMfaRequest,
      transitionMfaRequest, consumeMfaResponse, readAgencyZoomMessages, runApexRole, runAgencyZoomRole,
      requestApexCodeAfterBaseline, inputHasValue, primeBrowserSavedLogin, submitBrowserSavedLogin, isTrustDeviceText, parseAgencyZoomTimestamp, isRejectedLoginText,
      needsFactorDropdownFallback, isSmsFactorReady,
    };
  } else {
    boot();
  }
})();
