// ==UserScript==
// @name         GWPC Shared Ticket Handoff
// @namespace    homebot.shared-ticket-handoff
// @version      1.9.4
// @description  Shared AZ -> GWPC Ticket ID handoff using one Tampermonkey script. AZ saves Ticket ID into shared GM storage; GWPC resets once per tab entry, seeds tm_pc_current_job_v1 plus incomplete payload records early, preserves same-AZ current job values to avoid noisy reseeding, enriches the current job from GWPC identity, and only advances Home -> Auto after final same-AZ Home payload readiness. APEX ignored.
// @match        https://app.agencyzoom.com/*
// @match        https://app.agencyzoom.com/referral/pipeline*
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/shared-ticket-handoff.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/shared-ticket-handoff.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'GWPC Shared Ticket Handoff';
  const VERSION = '1.9.4';

  // Log-export integration — key choice depends on origin since this script
  // runs on both AZ and GWPC. Suffix `_logs_v1` and the `tm_*` prefix match
  // what storage-tools.user.js discovers via TRACKED_PREFIXES.
  const LOG_PERSIST_KEY = String(location.host || '').includes('agencyzoom.com')
    ? 'tm_az_shared_ticket_handoff_logs_v1'
    : 'tm_pc_shared_ticket_handoff_logs_v1';
  const LOG_CLEAR_SIGNAL_KEY = 'hb_logs_clear_request_v1';
  const LOG_PERSIST_THROTTLE_MS = 1500;
  const LOG_TICK_MS = 2000;
  let _lastLogPersistAt = 0;
  let _lastLogClearHandledAt = '';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FORCE_SEND_KEY = 'tm_pc_force_send_now_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';

  const GM_KEYS = {
    HANDOFF: 'hb_shared_az_to_gwpc_ticket_handoff_v1'
  };

  const LS_KEYS = {
    PANEL_POS: 'hb_shared_az_to_gwpc_ticket_handoff_panel_pos_v1',
    LAST_APPLIED: 'hb_shared_az_to_gwpc_ticket_handoff_last_applied_v1'
  };

  const SS_KEYS = {
    STOP: 'hb_shared_az_to_gwpc_ticket_handoff_stop_v1',
    GWPC_ENTRY_INIT: 'hb_shared_az_to_gwpc_ticket_handoff_gwpc_entry_init_v1'
  };

  const GWPC_KEYS = {
    currentJob: 'tm_pc_current_job_v1',
    legacySharedJob: 'tm_shared_az_job_v1',
    homePayload: 'tm_pc_home_quote_grab_payload_v1',
    autoPayload: 'tm_pc_auto_quote_grab_payload_v1',
    bundle: 'tm_pc_webhook_bundle_v1',
    homeTrigger: 'tm_pc_home_quote_grabber_trigger_v1',
    webhookSentMeta: 'tm_pc_webhook_submit_sent_meta_v17',
    forceSend: 'tm_pc_force_send_now_v1'
  };

  const CFG = {
    tickMs: 1000,
    handoffMaxAgeMs: 6 * 60 * 60 * 1000,
    maxLogs: 18,
    zIndex: 2147483647,
    panelRight: 12,
    panelBottom: 12
  };

  const state = {
    running: sessionStorage.getItem(SS_KEYS.STOP) !== '1',
    busy: false,
    logs: [],
    ui: null,
    lastIdleKey: '',
    lastAzSig: ''
  };

  init();

  function init() {
    buildUI();
    log(`Loaded ${SCRIPT_NAME} V${VERSION}`);
    log(isAzOrigin() ? 'Mode: AZ capture' : isGwpcOrigin() ? 'Mode: GWPC apply' : 'Mode: idle');
    ensureGwpcEntryResetOnce();
    setStatus(state.running ? 'Running' : 'Stopped');
    setInterval(tick, CFG.tickMs);
    setInterval(logsTick, LOG_TICK_MS);
    window.addEventListener('storage', handleLogClearStorageEvent, true);
    persistLogsThrottled();
    tick();
  }

  function tick() {
    if (!state.running || state.busy) return;
    if (isGloballyPaused() && !hasForceSendRequest()) {
      setStatus('Paused by shared selector');
      return;
    }

    state.busy = true;

    Promise.resolve()
      .then(() => {
        if (isAzOrigin()) return runAzCapture();
        if (isGwpcOrigin()) return runGwpcApply();
        setIdle('unsupported', 'Unsupported origin');
      })
      .catch((err) => {
        log(`Failed: ${err?.message || err}`);
        setStatus('Failed');
      })
      .finally(() => {
        state.busy = false;
      });
  }

  function isAzOrigin() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isGwpcOrigin() {
    return /(^|\.)policycenter(?:-2|-3)?\.farmersinsurance\.com$/i.test(location.hostname);
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  function hasForceSendRequest() {
    const request = safeJsonParse(localStorage.getItem(FORCE_SEND_KEY), null);
    return !!(request && typeof request === 'object' && request.requestedAt);
  }

  function runAzCapture() {
    const payload = safeJsonParse(localStorage.getItem('tm_az_payload_v1'), null);
    if (!payload || typeof payload !== 'object') {
      setIdle('az-wait', 'AZ waiting for tm_az_payload_v1');
      return;
    }

    const ticketId = clean(
      payload.ticketId ||
      payload['AZ ID'] ||
      payload.az?.['AZ ID'] ||
      payload.az?.ticketId ||
      ''
    );

    const first = clean(payload.az?.['AZ Name'] || payload.az?.firstName || payload.az?.first || '');
    const last = clean(payload.az?.['AZ Last'] || payload.az?.lastName || payload.az?.last || '');
    const name = clean([first, last].filter(Boolean).join(' '));

    const mailingAddress = buildAzMailingAddress(payload.az || {});
    const savedAt = clean(payload.meta?.savedAt || payload.savedAt || new Date().toISOString());

    if (!ticketId || !name || !mailingAddress) {
      setIdle('az-incomplete', 'AZ payload found but missing Ticket ID / Name / Address');
      return;
    }

    const handoff = {
      ticketId,
      name,
      mailingAddress,
      firstName: clean(payload.az?.['First Name'] || payload.az?.['AZ Name'] || ''),
      lastName: clean(payload.az?.['Last Name'] || payload.az?.['AZ Last'] || ''),
      email: clean(payload.az?.['Email'] || payload.az?.['AZ Email'] || ''),
      phone: clean(payload.az?.['Phone'] || payload.az?.['AZ Phone'] || ''),
      dob: clean(payload.az?.['DOB'] || payload.az?.['AZ DOB'] || ''),
      streetAddress: clean(payload.az?.['Street Address'] || payload.az?.['AZ Street Address'] || ''),
      city: clean(payload.az?.['City'] || payload.az?.['AZ City'] || ''),
      state: clean(payload.az?.['State'] || payload.az?.['AZ State'] || ''),
      zip: clean(payload.az?.['Zip'] || payload.az?.['AZ Postal Code'] || ''),
      savedAt,
      source: {
        origin: location.origin,
        href: location.href
      }
    };

    const sig = JSON.stringify(handoff);
    if (sig === state.lastAzSig) {
      setIdle('az-saved-same', `AZ ready: ${ticketId}`);
      return;
    }

    const existing = gmGetJson(GM_KEYS.HANDOFF, null);
    const existingSig = existing ? JSON.stringify(existing) : '';

    if (sig !== existingSig) {
      GM_setValue(GM_KEYS.HANDOFF, handoff);
      log(`AZ handoff saved | Ticket ID ${ticketId}`);
      log(`AZ Name: ${name}`);
      log(`AZ Address: ${mailingAddress}`);
    }

    state.lastAzSig = sig;
    setStatus(`AZ saved ${ticketId}`);
  }

  function runGwpcApply() {
    const forceSend = hasForceSendRequest();
    const handoff = gmGetJson(GM_KEYS.HANDOFF, null);
    if (!handoff || typeof handoff !== 'object') {
      if (forceSend) {
        const currentJob = safeJsonParse(localStorage.getItem('tm_pc_current_job_v1'), null);
        if (currentJob?.['AZ ID']) {
          setIdle('gw-force-existing-job', `Force send using existing current job ${currentJob['AZ ID']}`);
          return;
        }
      }
      setIdle('gw-no-handoff', 'GWPC waiting for AZ handoff');
      return;
    }

    const ageMs = Date.now() - toMs(handoff.savedAt);
    if (!Number.isFinite(ageMs) || ageMs > CFG.handoffMaxAgeMs) {
      if (forceSend) {
        const currentJob = safeJsonParse(localStorage.getItem('tm_pc_current_job_v1'), null);
        if (currentJob?.['AZ ID']) {
          setIdle('gw-force-stale-handoff', `Force send using existing current job ${currentJob['AZ ID']}`);
          return;
        }
      }
      setIdle('gw-stale-handoff', 'GWPC waiting for fresh AZ handoff');
      return;
    }

    const seededJob = seedGwpcJobAndPayloadsFromHandoff(handoff);
    if (seededJob?.['AZ ID']) {
      maybeAdvanceGwpcFlow(seededJob);
    }

    const gwpcIdentity = getGwpcIdentity();
    if (!gwpcIdentity) {
      setIdle('gw-no-gwpc-identity', 'GWPC waiting for current job / auto payload / home payload / bundle');
      return;
    }

    const gwName = clean(gwpcIdentity.name || '');
    const gwAddress = clean(gwpcIdentity.mailingAddress || '');
    const submissionNumber = clean(gwpcIdentity.submissionNumber || '');

    if (!gwName || !gwAddress) {
      setIdle('gw-home-incomplete', 'GWPC payload missing Name / Mailing Address');
      return;
    }

    const nameMatch = namesLikelySame(handoff.name, gwName);
    const addressMatch = addressesLikelySame(handoff.mailingAddress, gwAddress);

    if (!nameMatch || !addressMatch) {
      setIdle(
        'gw-mismatch',
        `GWPC mismatch | AZ=${handoff.name} | GWPC=${gwName}`
      );
      return;
    }

    const applySig = [
      clean(handoff.ticketId),
      normalizeCompare(gwName),
      normalizeCompare(gwAddress),
      clean(submissionNumber)
    ].join(' | ');

    const lastApplied = localStorage.getItem(LS_KEYS.LAST_APPLIED) || '';
    const currentJob = safeJsonParse(localStorage.getItem(GWPC_KEYS.currentJob), {}) || {};

    const currentAzId = clean(currentJob['AZ ID'] || currentJob.azId || '');
    const currentName = clean(currentJob['Name'] || currentJob.name || '');
    const currentAddress = clean(currentJob['Mailing Address'] || currentJob.mailingAddress || '');

    if (lastApplied === applySig &&
        currentAzId === clean(handoff.ticketId) &&
        namesLikelySame(currentName || gwName, gwName) &&
        addressesLikelySame(currentAddress || gwAddress, gwAddress)) {
      const enrichedJob = {
        'AZ ID': clean(handoff.ticketId),
        'Name': gwName,
        'Mailing Address': gwAddress,
        'SubmissionNumber': submissionNumber,
        'updatedAt': new Date().toISOString(),
        'First Name': clean(currentJob['First Name'] || handoff.firstName || ''),
        'Last Name': clean(currentJob['Last Name'] || handoff.lastName || ''),
        'Email': clean(currentJob['Email'] || handoff.email || ''),
        'Phone': clean(currentJob['Phone'] || handoff.phone || ''),
        'DOB': clean(currentJob['DOB'] || handoff.dob || ''),
        'Street Address': clean(currentJob['Street Address'] || handoff.streetAddress || ''),
        'City': clean(currentJob['City'] || handoff.city || ''),
        'State': clean(currentJob['State'] || handoff.state || ''),
        'Zip': clean(currentJob['Zip'] || handoff.zip || '')
      };

      localStorage.setItem(GWPC_KEYS.currentJob, JSON.stringify(enrichedJob, null, 2));
      maybeAdvanceGwpcFlow(enrichedJob);
      setIdle('gw-already-applied', `GWPC linked ${handoff.ticketId}`);
      return;
    }

    if (currentAzId &&
        currentAzId !== clean(handoff.ticketId) &&
        !namesLikelySame(currentName, gwName)) {
      log(`Blocked overwrite | existing AZ ID ${currentAzId} != ${handoff.ticketId}`);
      setStatus('Blocked overwrite');
      return;
    }

    const nextJob = {
      'AZ ID': clean(handoff.ticketId),
      'Name': gwName,
      'Mailing Address': gwAddress,
      'SubmissionNumber': submissionNumber,
      'updatedAt': new Date().toISOString(),
      'First Name': clean(currentJob['First Name'] || handoff.firstName || ''),
      'Last Name': clean(currentJob['Last Name'] || handoff.lastName || ''),
      'Email': clean(currentJob['Email'] || handoff.email || ''),
      'Phone': clean(currentJob['Phone'] || handoff.phone || ''),
      'DOB': clean(currentJob['DOB'] || handoff.dob || ''),
      'Street Address': clean(currentJob['Street Address'] || handoff.streetAddress || ''),
      'City': clean(currentJob['City'] || handoff.city || ''),
      'State': clean(currentJob['State'] || handoff.state || ''),
      'Zip': clean(currentJob['Zip'] || handoff.zip || '')
    };

    localStorage.setItem(GWPC_KEYS.currentJob, JSON.stringify(nextJob, null, 2));
    localStorage.setItem(LS_KEYS.LAST_APPLIED, applySig);

    log(`GWPC current job written | AZ ID ${nextJob['AZ ID']}`);
    log(`GWPC Name: ${nextJob['Name']}`);
    log(`GWPC Address: ${nextJob['Mailing Address']}`);
    log(`GWPC Submission: ${nextJob['SubmissionNumber'] || '(blank)'}`);
    maybeAdvanceGwpcFlow(nextJob);
    setStatus(`GWPC linked ${nextJob['AZ ID']}`);
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return stage && typeof stage === 'object' && !Array.isArray(stage) ? stage : {};
  }

  function writeFlowStage(product, step, azId = '') {
    const next = {
      product: clean(product),
      step: clean(step),
      azId: clean(azId),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function hasVisibleExactLabel(labelText) {
    const wanted = clean(labelText);
    if (!wanted) return false;
    for (const doc of getAccessibleDocs()) {
      const hit = Array.from(doc.querySelectorAll('.gw-label'))
        .some((el) => isVisible(el) && clean(el.textContent) === wanted);
      if (hit) return true;
    }
    return false;
  }

  function readGwpcHomePayload() {
    const payload = safeJsonParse(localStorage.getItem(GWPC_KEYS.homePayload), null);
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  }

  function readGwpcBundle() {
    const bundle = safeJsonParse(localStorage.getItem(GWPC_KEYS.bundle), null);
    return bundle && typeof bundle === 'object' && !Array.isArray(bundle) ? bundle : null;
  }

  function getHomeGatherState(azId) {
    const wantedAzId = clean(azId);
    const payload = readGwpcHomePayload();
    const bundle = readGwpcBundle();

    const payloadAzId = clean(payload?.['AZ ID'] || payload?.currentJob?.['AZ ID'] || '');
    const bundleAzId = clean(bundle?.['AZ ID'] || '');
    const payloadMatches = !!wantedAzId && payloadAzId === wantedAzId;
    const bundleMatches = !!wantedAzId && bundleAzId === wantedAzId;

    const row =
      (payloadMatches && payload?.row && typeof payload.row === 'object' ? payload.row : null) ||
      (bundleMatches && bundle?.home?.data?.row && typeof bundle.home.data.row === 'object' ? bundle.home.data.row : null) ||
      {};

    const progress =
      (payloadMatches && payload?.meta?.progress && typeof payload.meta.progress === 'object' ? payload.meta.progress : null) ||
      (bundleMatches && bundle?.home?.data?.meta?.progress && typeof bundle.home.data.meta.progress === 'object' ? bundle.home.data.meta.progress : null) ||
      {};

    const pass1Ready =
      progress.pass1PricingCaptured === true ||
      (!!clean(row['Standard Pricing No Auto Discount']) && !!clean(row['Enhance Pricing No Auto Discount']));

    const pass2Ready =
      progress.pass2PricingCaptured === true ||
      (!!clean(row['Standard Pricing Auto Discount']) && !!clean(row['Enhance Pricing Auto Discount']));

    const payloadReady = payloadMatches && payload?.ready === true;
    const bundleReady = bundleMatches && bundle?.home?.ready === true;

    return {
      payloadMatches,
      bundleMatches,
      pass1Ready,
      pass2Ready,
      payloadReady,
      bundleReady,
      finalReady: pass1Ready && pass2Ready && payloadReady && bundleReady
    };
  }

  function maybeAdvanceGwpcFlow(job) {
    const azId = clean(job && job['AZ ID']);
    if (!azId) return;

    const stage = readFlowStage();
    const stageAzId = clean(stage.azId);

    if (stageAzId && stageAzId !== azId) {
      if (hasVisibleExactLabel('Homeowners')) {
        writeFlowStage('home', 'disclosure', azId);
      }
      return;
    }

    if (!clean(stage.product) || !clean(stage.step)) {
      if (hasVisibleExactLabel('Homeowners')) {
        writeFlowStage('home', 'disclosure', azId);
      }
      return;
    }

    if (clean(stage.product) === 'home' && clean(stage.step) === 'handoff') {
      const homeState = getHomeGatherState(azId);
      if (homeState.finalReady) {
        writeFlowStage('auto', 'start', azId);
      }
      return;
    }

    if (clean(stage.product) === 'auto' && clean(stage.step) === 'handoff') {
      writeFlowStage('auto', 'sender', azId);
    }
  }

  function getGwpcIdentity() {
    const currentJob = safeJsonParse(localStorage.getItem(GWPC_KEYS.currentJob), null);
    const homePayload = safeJsonParse(localStorage.getItem(GWPC_KEYS.homePayload), null);
    const autoPayload = safeJsonParse(localStorage.getItem(GWPC_KEYS.autoPayload), null);
    const bundle = safeJsonParse(localStorage.getItem(GWPC_KEYS.bundle), null);
    const pageIdentity = getGwpcPageIdentity();

    const candidates = [
      {
        name: pageIdentity?.name || '',
        mailingAddress: pageIdentity?.mailingAddress || '',
        submissionNumber: pageIdentity?.submissionNumber || ''
      },
      {
        name: currentJob?.['Name'] || currentJob?.name || '',
        mailingAddress: currentJob?.['Mailing Address'] || currentJob?.mailingAddress || '',
        submissionNumber: currentJob?.['SubmissionNumber'] || currentJob?.submissionNumber || ''
      },
      {
        name: homePayload?.row?.['Name'] || homePayload?.row?.name || '',
        mailingAddress: homePayload?.row?.['Mailing Address'] || homePayload?.row?.mailingAddress || '',
        submissionNumber: homePayload?.row?.['Submission Number'] || homePayload?.row?.submissionNumber || ''
      },
      {
        name: autoPayload?.currentJob?.['Name'] || autoPayload?.row?.['Name'] || autoPayload?.summary?.primaryInsuredName || '',
        mailingAddress: autoPayload?.currentJob?.['Mailing Address'] || autoPayload?.row?.['Mailing Address'] || '',
        submissionNumber: autoPayload?.currentJob?.['SubmissionNumber'] || autoPayload?.row?.['Submission Number (Auto)'] || autoPayload?.summary?.submissionNumber || ''
      },
      {
        name: bundle?.['Name'] || bundle?.auto?.data?.currentJob?.['Name'] || bundle?.home?.data?.row?.['Name'] || '',
        mailingAddress: bundle?.['Mailing Address'] || bundle?.auto?.data?.currentJob?.['Mailing Address'] || bundle?.home?.data?.row?.['Mailing Address'] || '',
        submissionNumber: bundle?.['SubmissionNumber'] || bundle?.auto?.data?.currentJob?.['SubmissionNumber'] || bundle?.auto?.data?.summary?.submissionNumber || bundle?.home?.data?.row?.['Submission Number'] || ''
      }
    ];

    for (const candidate of candidates) {
      const name = clean(candidate.name);
      const mailingAddress = clean(candidate.mailingAddress);
      if (!name || !mailingAddress) continue;
      return {
        name,
        mailingAddress,
        submissionNumber: clean(candidate.submissionNumber)
      };
    }

    return null;
  }

  function getGwpcPageIdentity() {
    const accountName = clean(firstVisibleTextBySelectors([
      '#SubmissionWizard-JobWizardInfoBar-AccountName .gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-AccountName .gw-label.gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-AccountName'
    ]));

    const mailingAddress = clean(firstVisibleTextBySelectors([
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress .gw-label.gw-infoValue',
      '#SubmissionWizard-JobWizardInfoBar-PolicyAddress'
    ]));

    const submissionNumber = clean(extractSubmissionNumberFromPage());

    if (!accountName || !mailingAddress) return null;
    return { name: accountName, mailingAddress, submissionNumber };
  }

  function firstVisibleTextBySelectors(selectors) {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      for (const selector of selectors) {
        let el = null;
        try { el = doc.querySelector(selector); } catch {}
        if (!el || !isVisible(el)) continue;
        const text = clean(el.textContent || '');
        if (text) return text;
      }
    }
    return '';
  }

  function extractSubmissionNumberFromPage() {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      let nodes = [];
      try { nodes = Array.from(doc.querySelectorAll('.gw-Wizard--Title, .gw-TitleBar--title, .gw-TitleBar--Title, [role="heading"], h1, h2')); } catch {}
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const text = clean(el.textContent || '');
        const match = text.match(/Submission\s+(\d{6,})/i);
        if (match) return match[1];
      }
    }
    return '';
  }

  function getAccessibleDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);
        if (win.document) docs.push(win.document);
        for (let i = 0; i < win.frames.length; i++) walk(win.frames[i]);
      } catch {}
    }

    walk(window.top);
    return docs;
  }

  function isVisible(el) {
    try {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch {
      return false;
    }
  }

  function buildAzMailingAddress(az) {
    const street = clean(az['Street Address'] || az['AZ Street Address'] || az.address || '');
    const city = clean(az['City'] || az['AZ City'] || az.city || '');
    const stateValue = clean(az['State'] || az['AZ State'] || az.state || '');
    const zip = clean(az['Zip'] || az['AZ Postal Code'] || az.zip || az.zipCode || '');

    if (street && city && stateValue && zip) return `${street}, ${city}, ${stateValue} ${zip}`;
    if (street && city && stateValue) return `${street}, ${city}, ${stateValue}`;
    return clean([street, city, stateValue, zip].filter(Boolean).join(', '));
  }

  function gmGetJson(key, fallback) {
    try {
      const value = GM_getValue(key, null);
      if (value == null) return fallback;
      if (typeof value === 'object') return value;
      if (typeof value === 'string') return safeJsonParse(value, fallback);
      return fallback;
    } catch {
      return fallback;
    }
  }

  function toMs(value) {
    const n = Date.parse(String(value || ''));
    return Number.isFinite(n) ? n : NaN;
  }

  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeCompare(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[\.,#]/g, ' ')
      .replace(/\bunit\b/g, ' ')
      .replace(/\bapartment\b/g, ' ')
      .replace(/\bsuite\b/g, ' ')
      .replace(/\bstreet\b/g, 'st')
      .replace(/\bavenue\b/g, 'ave')
      .replace(/\broad\b/g, 'rd')
      .replace(/\bdrive\b/g, 'dr')
      .replace(/\bcircle\b/g, 'cir')
      .replace(/\bboulevard\b/g, 'blvd')
      .replace(/\blane\b/g, 'ln')
      .replace(/\bplace\b/g, 'pl')
      .replace(/\bcourt\b/g, 'ct')
      .replace(/\bhighway\b/g, 'hwy')
      .replace(/\btrail\b/g, 'trl')
      .replace(/\bterrace\b/g, 'ter')
      .replace(/\bnorth\b/g, 'n')
      .replace(/\bsouth\b/g, 's')
      .replace(/\beast\b/g, 'e')
      .replace(/\bwest\b/g, 'w')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function namesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
  }

  function addressesLikelySame(a, b) {
    const aa = normalizeCompare(a);
    const bb = normalizeCompare(b);

    if (!aa || !bb) return false;
    if (aa === bb) return true;
    if (aa.includes(bb) || bb.includes(aa)) return true;

    const aaNoComma = aa.replace(/,/g, ' ');
    const bbNoComma = bb.replace(/,/g, ' ');
    if (aaNoComma === bbNoComma) return true;

    return false;
  }

  function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function ensureGwpcEntryResetOnce() {
    if (!isGwpcOrigin()) return;
    try {
      if (sessionStorage.getItem(SS_KEYS.GWPC_ENTRY_INIT) === '1') return;
    } catch {}

    resetGwpcEntryState();

    try { sessionStorage.setItem(SS_KEYS.GWPC_ENTRY_INIT, '1'); } catch {}
    log('GWPC entry reset complete');
  }

  function resetGwpcEntryState() {
    const keysToRemove = [
      GWPC_KEYS.currentJob,
      GWPC_KEYS.legacySharedJob,
      GWPC_KEYS.homePayload,
      GWPC_KEYS.autoPayload,
      GWPC_KEYS.bundle,
      GWPC_KEYS.homeTrigger,
      GWPC_KEYS.webhookSentMeta,
      GWPC_KEYS.forceSend,
      FLOW_STAGE_KEY,
      LS_KEYS.LAST_APPLIED
    ];

    for (const key of keysToRemove) {
      try { localStorage.removeItem(key); } catch {}
    }
  }

  function normalizeCurrentJob(job) {
    const out = {
      'AZ ID': '',
      'Name': '',
      'Mailing Address': '',
      'SubmissionNumber': '',
      'updatedAt': '',
      'First Name': '',
      'Last Name': '',
      'Email': '',
      'Phone': '',
      'DOB': '',
      'Street Address': '',
      'City': '',
      'State': '',
      'Zip': ''
    };

    if (!job || typeof job !== 'object' || Array.isArray(job)) return out;

    out['AZ ID'] = clean(job['AZ ID'] || job.azId || job.ticketId || '');
    out['Name'] = clean(job['Name'] || job.name || '');
    out['Mailing Address'] = clean(job['Mailing Address'] || job.mailingAddress || '');
    out['SubmissionNumber'] = clean(job['SubmissionNumber'] || job.submissionNumber || '');
    out['updatedAt'] = clean(job['updatedAt'] || '');
    out['First Name'] = clean(job['First Name'] || job.firstName || '');
    out['Last Name'] = clean(job['Last Name'] || job.lastName || '');
    out['Email'] = clean(job['Email'] || job.email || '');
    out['Phone'] = clean(job['Phone'] || job.phone || '');
    out['DOB'] = clean(job['DOB'] || job.dob || '');
    out['Street Address'] = clean(job['Street Address'] || job.streetAddress || '');
    out['City'] = clean(job['City'] || job.city || '');
    out['State'] = clean(job['State'] || job.state || '');
    out['Zip'] = clean(job['Zip'] || job.zip || job.zipCode || '');
    return out;
  }

  function buildSeedJobFromHandoff(handoff) {
    return normalizeCurrentJob({
      'AZ ID': clean(handoff?.ticketId || ''),
      'Name': clean(handoff?.name || ''),
      'Mailing Address': clean(handoff?.mailingAddress || ''),
      'SubmissionNumber': '',
      'updatedAt': new Date().toISOString(),
      'First Name': clean(handoff?.firstName || ''),
      'Last Name': clean(handoff?.lastName || ''),
      'Email': clean(handoff?.email || ''),
      'Phone': clean(handoff?.phone || ''),
      'DOB': clean(handoff?.dob || ''),
      'Street Address': clean(handoff?.streetAddress || ''),
      'City': clean(handoff?.city || ''),
      'State': clean(handoff?.state || ''),
      'Zip': clean(handoff?.zip || '')
    });
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    next.updatedAt = next.updatedAt || new Date().toISOString();
    localStorage.setItem(GWPC_KEYS.currentJob, JSON.stringify(next, null, 2));
    return next;
  }

  function ensureSeedBundle(job) {
    const azId = clean(job?.['AZ ID'] || '');
    if (!azId) return null;

    const current = safeJsonParse(localStorage.getItem(GWPC_KEYS.bundle), null);
    if (current && typeof current === 'object' && !Array.isArray(current) && clean(current['AZ ID']) === azId) {
      let changed = false;
      if (!current['Name'] && clean(job['Name'])) {
        current['Name'] = clean(job['Name']);
        changed = true;
      }
      if (!current['Mailing Address'] && clean(job['Mailing Address'])) {
        current['Mailing Address'] = clean(job['Mailing Address']);
        changed = true;
      }
      if (!current.home || typeof current.home !== 'object') {
        current.home = { ready: false, data: null };
        changed = true;
      }
      if (!current.auto || typeof current.auto !== 'object') {
        current.auto = { ready: false, data: null };
        changed = true;
      }
      if (!current.timeout || typeof current.timeout !== 'object') {
        current.timeout = { ready: false, events: [] };
        changed = true;
      }
      current.meta = current.meta && typeof current.meta === 'object' ? current.meta : {};
      if (!current.meta.lastWriter) {
        current.meta.lastWriter = SCRIPT_NAME;
        changed = true;
      }
      if (!current.meta.version) {
        current.meta.version = VERSION;
        changed = true;
      }
      if (!current.meta.stage) {
        current.meta.stage = 'entry_seeded';
        changed = true;
      }
      if (!current.meta.stageWriter) {
        current.meta.stageWriter = SCRIPT_NAME;
        changed = true;
      }
      if (!current.meta.updatedAt) {
        current.meta.updatedAt = new Date().toISOString();
        changed = true;
      }
      if (changed) {
        localStorage.setItem(GWPC_KEYS.bundle, JSON.stringify(current, null, 2));
      }
      return current;
    }

    const next = {
      'AZ ID': azId,
      'Name': clean(job['Name']),
      'Mailing Address': clean(job['Mailing Address']),
      'SubmissionNumber': clean(job['SubmissionNumber']),
      home: {
        ready: false,
        data: null,
        meta: {
          product: 'home',
          step: 'seeded',
          savedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: SCRIPT_NAME,
          version: VERSION
        }
      },
      auto: {
        ready: false,
        data: null,
        meta: {
          product: 'auto',
          step: 'seeded',
          savedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: SCRIPT_NAME,
          version: VERSION
        }
      },
      timeout: {
        ready: false,
        events: []
      },
      meta: {
        updatedAt: new Date().toISOString(),
        lastWriter: SCRIPT_NAME,
        version: VERSION,
        stage: 'entry_seeded',
        stageWriter: SCRIPT_NAME
      }
    };
    localStorage.setItem(GWPC_KEYS.bundle, JSON.stringify(next, null, 2));
    return next;
  }

  function ensureSeedPayload(payloadKey, product, job) {
    const azId = clean(job?.['AZ ID'] || '');
    if (!azId) return null;

    const current = safeJsonParse(localStorage.getItem(payloadKey), null);
    if (current && typeof current === 'object' && !Array.isArray(current) && clean(current['AZ ID'] || current?.currentJob?.['AZ ID']) === azId) {
      return current;
    }

    const now = new Date().toISOString();
    const next = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: `${product}_payload_seeded`,
      product,
      ready: false,
      'AZ ID': azId,
      currentJob: normalizeCurrentJob(job),
      savedAt: now,
      page: {
        url: location.href,
        title: document.title
      },
      meta: {
        product,
        step: 'seeded',
        savedAt: now,
        updatedAt: now,
        source: SCRIPT_NAME,
        version: VERSION
      }
    };
    localStorage.setItem(payloadKey, JSON.stringify(next, null, 2));
    return next;
  }

  function seedGwpcJobAndPayloadsFromHandoff(handoff) {
    const seedJob = buildSeedJobFromHandoff(handoff);
    if (!seedJob['AZ ID']) return null;

    const current = safeJsonParse(localStorage.getItem(GWPC_KEYS.currentJob), null);
    const currentAzId = clean(current?.['AZ ID'] || current?.azId || '');
    const currentName = clean(current?.['Name'] || current?.name || '');
    const currentAddress = clean(current?.['Mailing Address'] || current?.mailingAddress || '');
    const currentSubmission = clean(current?.['SubmissionNumber'] || current?.submissionNumber || '');
    const sameAz = currentAzId && currentAzId === seedJob['AZ ID'];
    const nextJob = {
      'AZ ID': seedJob['AZ ID'],
      'Name': sameAz ? (currentName || seedJob['Name']) : seedJob['Name'],
      'Mailing Address': sameAz ? (currentAddress || seedJob['Mailing Address']) : seedJob['Mailing Address'],
      'SubmissionNumber': sameAz ? currentSubmission : '',
      'updatedAt': new Date().toISOString()
    };
    const shouldSeed =
      currentAzId !== nextJob['AZ ID'] ||
      (!sameAz && currentName !== nextJob['Name']) ||
      (!sameAz && currentAddress !== nextJob['Mailing Address']) ||
      (sameAz && (!currentName || !currentAddress)) ||
      currentSubmission !== nextJob['SubmissionNumber'];

    if (shouldSeed) {
      writeCurrentJob(nextJob);
      log(`GWPC current job seeded | AZ ID ${nextJob['AZ ID']}`);
    }

    ensureSeedBundle(seedJob);
    ensureSeedPayload(GWPC_KEYS.homePayload, 'home', seedJob);
    ensureSeedPayload(GWPC_KEYS.autoPayload, 'auto', seedJob);
    return normalizeCurrentJob(safeJsonParse(localStorage.getItem(GWPC_KEYS.currentJob), null));
  }

  function setIdle(key, text) {
    if (state.lastIdleKey === key) return;
    state.lastIdleKey = key;
    setStatus(text);
    log(text);
  }

  function setStatus(text) {
    if (state.ui?.status) state.ui.status.textContent = text;
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    if (state.logs.length > CFG.maxLogs) state.logs.length = CFG.maxLogs;
    console.log(`[${SCRIPT_NAME}] ${msg}`);
    renderLogs();
    persistLogsThrottled();
  }

  function persistLogsThrottled() {
    const now = Date.now();
    if (now - _lastLogPersistAt < LOG_PERSIST_THROTTLE_MS) return;
    _lastLogPersistAt = now;
    const raw = Array.isArray(state.logs) ? state.logs : [];
    const lines = raw.map(entry => (typeof entry === 'string' ? entry : (entry?.line || '')));
    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      origin: location.origin,
      updatedAt: new Date().toISOString(),
      lines
    };
    try { localStorage.setItem(LOG_PERSIST_KEY, JSON.stringify(payload)); } catch {}
    try { GM_setValue(LOG_PERSIST_KEY, payload); } catch {}
  }

  function checkLogClearRequest() {
    let req = null;
    try { req = JSON.parse(localStorage.getItem(LOG_CLEAR_SIGNAL_KEY) || 'null'); } catch {}
    if (!req) { try { req = GM_getValue(LOG_CLEAR_SIGNAL_KEY, null); } catch {} }
    const at = typeof req?.requestedAt === 'string' ? req.requestedAt : '';
    if (!at || at === _lastLogClearHandledAt) return;
    _lastLogClearHandledAt = at;
    state.logs.length = 0;
    _lastLogPersistAt = 0;
    try { renderLogs(); } catch {}
    persistLogsThrottled();
  }

  function handleLogClearStorageEvent(event) {
    if (!event || event.key !== LOG_CLEAR_SIGNAL_KEY) return;
    checkLogClearRequest();
  }

  function logsTick() {
    persistLogsThrottled();
    checkLogClearRequest();
  }

  function renderLogs() {
    if (!state.ui?.logs) return;
    state.ui.logs.innerHTML = state.logs.map(x => `<div style="margin-bottom:4px;">${escapeHtml(x)}</div>`).join('');
  }

  function buildUI() {
    const old = document.getElementById('hb-shared-az-gwpc-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'hb-shared-az-gwpc-panel';
    panel.style.cssText = [
      'position:fixed',
      `right:${CFG.panelRight}px`,
      `bottom:${CFG.panelBottom}px`,
      'width:360px',
      'background:rgba(17,24,39,.96)',
      'color:#f9fafb',
      'border:1px solid rgba(255,255,255,.12)',
      'border-radius:12px',
      'box-shadow:0 10px 28px rgba(0,0,0,.35)',
      'font:12px/1.35 Arial,sans-serif',
      `z-index:${CFG.zIndex}`,
      'overflow:hidden'
    ].join(';');

    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <div id="hb-shared-az-gwpc-head" style="padding:8px 10px;background:rgba(255,255,255,.06);cursor:move;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.75;">V${VERSION}</div>
      </div>
      <div style="padding:10px;">
        <div id="hb-shared-az-gwpc-status" style="font-weight:700;color:#93c5fd;margin-bottom:8px;">Ready</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <button id="hb-shared-az-gwpc-toggle" type="button" style="border:0;border-radius:8px;padding:8px 10px;background:${state.running ? '#b91c1c' : '#166534'};color:#fff;font-weight:700;cursor:pointer;">${state.running ? 'STOP' : 'START'}</button>
          <button id="hb-shared-az-gwpc-copy" type="button" style="border:0;border-radius:8px;padding:8px 10px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">COPY LOGS</button>
        </div>
        <div style="font-size:11px;opacity:.82;margin-bottom:8px;">AZ captures Ticket ID. GWPC writes tm_pc_current_job_v1. APEX ignored.</div>
        <div id="hb-shared-az-gwpc-logs" style="max-height:180px;overflow:auto;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px;white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-shared-az-gwpc-head');
    const toggleBtn = panel.querySelector('#hb-shared-az-gwpc-toggle');
    const copyBtn = panel.querySelector('#hb-shared-az-gwpc-copy');

    toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      if (state.running) {
        sessionStorage.removeItem(SS_KEYS.STOP);
        log('Resumed');
      } else {
        sessionStorage.setItem(SS_KEYS.STOP, '1');
        log('Stopped for this page session');
      }
      toggleBtn.textContent = state.running ? 'STOP' : 'START';
      toggleBtn.style.background = state.running ? '#b91c1c' : '#166534';
      setStatus(state.running ? 'Running' : 'Stopped');
      state.lastIdleKey = '';
    });

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText([...state.logs].reverse().join('\n'));
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    makeDraggable(panel, head);

    state.ui = {
      panel,
      status: panel.querySelector('#hb-shared-az-gwpc-status'),
      logs: panel.querySelector('#hb-shared-az-gwpc-logs')
    };

    renderLogs();
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEYS.PANEL_POS) || 'null');
    } catch {
      return null;
    }
  }

  function savePanelPos(panel) {
    try {
      localStorage.setItem(LS_KEYS.PANEL_POS, JSON.stringify({
        left: panel.style.left || '',
        top: panel.style.top || ''
      }));
    } catch {}
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
      if (!dragging) return;
      dragging = false;
      savePanelPos(panel);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
