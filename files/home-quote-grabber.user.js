// ==UserScript==
// @name         Home Bot: Home Quote Grabber
// @namespace    homebot.home-quote-grabber
<<<<<<< HEAD
// @version      3.1
// @description  End-to-end Home quote driver. Detects the Coverages page, sets the 8 required coverage values, runs the initial Quote, grabs initial pricing + Policy Info, clicks the Auto radio in the Job Wizard Info Bar, re-Quotes, grabs Dwelling + final pricing, checks FAIR Plan Companion Endorsement on Exclusions and Conditions, grabs Quote tab info, and writes flow stage 'home/handoff' for shared-ticket-handoff to continue. Replaces 04 GWPC Home Coverages Quote + Risk Analysis.
=======
// @version      3.2
// @description  End-to-end Home quote driver. Detects the Coverages page, sets required coverages, runs the initial Quote, grabs pre/post auto-discount pricing through Edit Quote, checks FAIR Plan Companion Endorsement, and saves the HOME payload to localStorage.
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/home-quote-grabber.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/home-quote-grabber.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: Home Quote Grabber';
<<<<<<< HEAD
  const VERSION = '3.1';
=======
  const VERSION = '3.2';
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';
  const HOME_QUOTE_GRABBER_TRIGGER_KEY = 'tm_pc_home_quote_grabber_trigger_v1';

  const KEYS = {
    payload: 'tm_pc_home_quote_grab_payload_v1',
    panelPos: 'tm_pc_home_quote_grab_panel_pos_v1'
  };

  const CFG = {
    tickMs: 1000,
    triggerDelayMs: 3000,
    waitTimeoutMs: 20000,
    waitPollMs: 250,
    afterClickMs: 800,
    maxLogLines: 24,
<<<<<<< HEAD
    // Coverage edit phase timings (formerly in writer):
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    afterEditAllMs: 1200,
    afterFieldMs: 250,
    afterQuoteWaitMs: 1200,
    maxQuoteAttempts: 6,
    quoteTransitionTimeoutMs: 25000,
    betweenQuoteAttemptsMs: 1500,
    triggerStableMs: 1000,
    tabNudgeCooldownMs: 1500,
    tabNudgeSettleMs: 2500,
<<<<<<< HEAD
    // Wait for the re-Quote (post auto-discount) to settle before navigating
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    afterRequoteSettleMs: 4000
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
      'input[type="checkbox"][name="SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideScreenBasePanelSet-SideBySideScreenPanelSet-HOSideBySideAddnCoveragesPanelSet-1-HOCoverageInputSet-CovPatternInputGroup-_checkbox"]',
<<<<<<< HEAD
    fairPlanLabelClass: '.gw-InputGroup--header--label'
=======
    fairPlanLabelClass: '.gw-InputGroup--header--label',
    autoDiscountCheckboxExact:
      'input[name="SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-MultiLineDiscounts_ExtInputSet-MultiLineDiscounts_ExtLV-1-DiscountSelected"]'
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  };

  const IDS = {
    policyInfoTab: 'SubmissionWizard-LOBWizardStepGroup-PolicyInfo',
    dwellingTab: 'SubmissionWizard-LOBWizardStepGroup-HomeownersDwelling',
    coveragesTab: 'SubmissionWizard-LOBWizardStepGroup-HOCoveragesSideBySide',
    exclusionsTab: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideScreenBasePanelSet-SideBySideScreenPanelSet-HOPolicyLevelExclusionsAndConditionsCardTab',
    quoteTab: 'SubmissionWizard-ViewQuote',
    coveragesHeader: 'Coverages',
    coveragesScreen: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen',
    mainArea: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    quoteButtonHost: 'SubmissionWizard-Quote',

    // Coverage edit phase (formerly in 04 GWPC Home Coverages Quote + Risk Analysis):
    coveragesHeader: 'Coverages',
    coveragesScreen: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen',
    mainArea: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    quoteButtonHost: 'SubmissionWizard-Quote',

    // Job Wizard Info Bar Auto link (clicked to apply the auto cross-sell discount):
    autoRadio: 'SubmissionWizard-JobWizardInfoBar-ViewAuto',

    name: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Name_Input',
    mailingAddress: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-PolicyAddressDisplayInputSet-PolicyAddress_Ext_Input',

    fireCode: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HOFirelineCode_Input',
    fireBlock: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-7',
    protectionBlock: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-5',
    reconstruction: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-VRsikUpdateDV-reconstructionCostId_Input',
    yearBuilt: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-YearBuilt_Input',
    squareFeet: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-ApproxSqFoot_Input',
    stories: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-NumberOfStoriesorStyle_Input',
    waterDevice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingConstructionSingleHOEPanelSet-HODwellingConstructionDetailsHOEDV-HoWaterProtectionDevice_Input',

    pricingTable: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV',
    standardPrice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-periodInfoPremiumIterator-0-PremiumValue',
    enhancePrice: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-SideBySideScreen-SideBySideNewTableLayoutPanelSet-SideBySideNewTableLayoutDV-periodInfoPremiumIterator-1-PremiumValue',

    autoDiscountLV: 'SubmissionWizard-SubmissionWizard_QuoteScreen-HOCrossSellDetailsPanelSet-potentialLV'
  };

  const LABELS = {
    editQuote: 'Edit Quote',
    fairPlanCompanionEndorsement: 'FAIR Plan Companion Endorsement'
  };

  const state = {
    running: true,
    busy: false,
    doneThisLoad: false,
    flowStartedThisLoad: false,
    triggerSince: 0,
    activeHandoffRequestedAt: '',
    lastWaitReason: '',
    logLines: [],
    ui: null,
    tickCount: 0,
    lastSnapshotTick: 0,
    lastTriggerSource: '',
    announcedSkipReason: '',
<<<<<<< HEAD
    // Coverage edit phase (formerly in writer):
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    coverageTriggerSince: 0,
    lastQuoteClickAt: 0,
    lastTabNudgeAt: 0
  };

  const SNAPSHOT_EVERY_TICKS = 10;

  init();

  function safeJsonParse(value, fallback = null) {
    try { return JSON.parse(value); } catch { return fallback; }
  }

  function readFlowStage() {
    const stage = safeJsonParse(localStorage.getItem(FLOW_STAGE_KEY), null);
    return isPlainObject(stage) ? stage : {};
  }

  function matchesStage(product, step, azId = '') {
    const stage = readFlowStage();
    if (normalizeText(stage.product) !== normalizeText(product)) return false;
    if (normalizeText(stage.step) !== normalizeText(step)) return false;
    if (!normalizeText(stage.azId) || !normalizeText(azId)) return true;
    return normalizeText(stage.azId) === normalizeText(azId);
  }

  function writeFlowStage(product, step, azId = '') {
    const next = {
      product: normalizeText(product),
      step: normalizeText(step),
      azId: normalizeText(azId),
      updatedAt: new Date().toISOString(),
      source: SCRIPT_NAME,
      version: VERSION
    };
    localStorage.setItem(FLOW_STAGE_KEY, JSON.stringify(next, null, 2));
    return next;
  }

  function readHomeQuoteGrabberTriggerFromGm() {
    try {
      if (typeof GM_getValue !== 'function') return null;
      const raw = GM_getValue(HOME_QUOTE_GRABBER_TRIGGER_KEY, null);
      if (raw == null) return null;
      const parsed = typeof raw === 'string' ? safeJsonParse(raw, null) : raw;
      return isPlainObject(parsed) ? parsed : null;
    } catch { return null; }
  }

  function readHomeQuoteGrabberTriggerFromLocalStorage() {
    const parsed = safeJsonParse(localStorage.getItem(HOME_QUOTE_GRABBER_TRIGGER_KEY), null);
    return isPlainObject(parsed) ? parsed : null;
  }

  function readHomeQuoteGrabberTrigger() {
    // GM storage bridges PolicyCenter subdomains (writer may be on a
    // different origin). localStorage is the same-origin fast path.
    // If both exist, prefer the one with the newer requestedAt.
    const gm = readHomeQuoteGrabberTriggerFromGm();
    const ls = readHomeQuoteGrabberTriggerFromLocalStorage();
    if (gm && ls) {
      const gmAt = normalizeText(gm.requestedAt || '');
      const lsAt = normalizeText(ls.requestedAt || '');
      if (lsAt && lsAt > gmAt) {
        state.lastTriggerSource = 'localStorage';
        return ls;
      }
      state.lastTriggerSource = 'GM';
      return gm;
    }
    if (gm) { state.lastTriggerSource = 'GM'; return gm; }
    if (ls) { state.lastTriggerSource = 'localStorage'; return ls; }
    state.lastTriggerSource = '';
    return {};
  }

  function getUsableHomeQuoteGrabberHandoff(azId = '') {
    const handoff = readHomeQuoteGrabberTrigger();
    const requestedAt = normalizeText(handoff.requestedAt || '');
    if (!requestedAt) return null;
    if (handoff.consumed === true) return null;
    if (normalizeText(handoff.to || '') && normalizeText(handoff.to || '') !== normalizeText(SCRIPT_NAME)) return null;

    const handoffAzId = normalizeText(handoff.azId || '');
    if (handoffAzId && normalizeText(azId) && handoffAzId !== normalizeText(azId)) return null;

    return handoff;
  }

  function consumeHomeQuoteGrabberHandoff(azId = '') {
    const handoff = readHomeQuoteGrabberTrigger();
    const requestedAt = normalizeText(handoff.requestedAt || '');
    if (!requestedAt) return;
    const handoffAzId = normalizeText(handoff.azId || '');
    if (handoffAzId && normalizeText(azId) && handoffAzId !== normalizeText(azId)) return;

    const next = {
      ...handoff,
      consumed: true,
      consumedAt: new Date().toISOString(),
      consumedBy: SCRIPT_NAME
    };
    const serialized = JSON.stringify(next, null, 2);
    try { localStorage.setItem(HOME_QUOTE_GRABBER_TRIGGER_KEY, serialized); } catch {}
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(HOME_QUOTE_GRABBER_TRIGGER_KEY, serialized);
      }
    } catch {}
  }

  function deepClone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function buildMailingAddress(address, city, stateValue, zipCode) {
    const a = normalizeText(address);
    const c = normalizeText(city);
    const s = normalizeText(stateValue);
    const z = normalizeText(zipCode);
    if (a && c && s && z) return `${a}, ${c}, ${s} ${z}`.trim();
    return [a, c, s, z].filter(Boolean).join(', ').trim();
  }

  function normalizeCurrentJob(raw) {
    const out = {
      'AZ ID': '',
      'Name': '',
      'Mailing Address': '',
      'SubmissionNumber': '',
      'updatedAt': ''
    };

    if (!isPlainObject(raw)) return out;

    const az = isPlainObject(raw.az) ? raw.az : {};
    const legacyName = [az['AZ Name'], az['AZ Last']].map(v => normalizeText(v)).filter(Boolean).join(' ').trim();
    const legacyAddress = buildMailingAddress(az['AZ Street Address'], az['AZ City'], az['AZ State'], az['AZ Postal Code']);

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || raw['Submission Number'] || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.lastUpdatedAt || raw?.meta?.createdAt || '');
    return out;
  }

  function readCurrentJob() {
    let raw = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    let job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    raw = safeJsonParse(localStorage.getItem(LEGACY_SHARED_JOB_KEY), null);
    job = normalizeCurrentJob(raw);
    return job;
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    next.updatedAt = next.updatedAt || new Date().toISOString();
    try { localStorage.setItem(CURRENT_JOB_KEY, JSON.stringify(next, null, 2)); } catch {}
    return next;
  }

  function mergeCurrentJob(update) {
    const current = readCurrentJob();
    const incoming = normalizeCurrentJob(update || {});

    if (current['AZ ID'] && incoming['AZ ID'] && current['AZ ID'] !== incoming['AZ ID']) {
      return { ok: false, reason: `AZ ID mismatch (${current['AZ ID']} != ${incoming['AZ ID']})`, current };
    }

    const next = {
      'AZ ID': incoming['AZ ID'] || current['AZ ID'] || '',
      'Name': incoming['Name'] || current['Name'] || '',
      'Mailing Address': incoming['Mailing Address'] || current['Mailing Address'] || '',
      'SubmissionNumber': incoming['SubmissionNumber'] || current['SubmissionNumber'] || '',
      'updatedAt': new Date().toISOString()
    };

    return { ok: true, current, next: writeCurrentJob(next) };
  }

  function readBundle() {
    return safeJsonParse(localStorage.getItem(BUNDLE_KEY), null);
  }

  function writeBundle(bundle) {
    localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle, null, 2));
    return bundle;
  }

  function emptyBundleForJob(job) {
    return {
      'AZ ID': normalizeText(job && job['AZ ID']),
      'Name': normalizeText(job && job['Name']),
      'Mailing Address': normalizeText(job && job['Mailing Address']),
      'SubmissionNumber': normalizeText(job && job['SubmissionNumber']),
      home: {},
      auto: {},
      timeout: { events: [] },
      meta: {
        updatedAt: new Date().toISOString(),
        lastWriter: SCRIPT_NAME,
        version: VERSION
      }
    };
  }

  function ensureBundleForJob(job) {
    const azId = normalizeText(job && job['AZ ID']);
    if (!azId) return null;

    const bundle = readBundle();
    if (!isPlainObject(bundle) || !normalizeText(bundle['AZ ID'])) {
      return writeBundle(emptyBundleForJob(job));
    }

    if (normalizeText(bundle['AZ ID']) !== azId) {
      return writeBundle(emptyBundleForJob(job));
    }

    bundle['Name'] = bundle['Name'] || normalizeText(job['Name']);
    bundle['Mailing Address'] = bundle['Mailing Address'] || normalizeText(job['Mailing Address']);
    bundle['SubmissionNumber'] = bundle['SubmissionNumber'] || normalizeText(job['SubmissionNumber']);
    bundle.timeout = isPlainObject(bundle.timeout) ? bundle.timeout : { events: [] };
    if (!Array.isArray(bundle.timeout.events)) bundle.timeout.events = [];
    bundle.meta = isPlainObject(bundle.meta) ? bundle.meta : {};
    bundle.meta.updatedAt = new Date().toISOString();
    bundle.meta.lastWriter = SCRIPT_NAME;
    bundle.meta.version = VERSION;
    return writeBundle(bundle);
  }

  function saveBundleSection(sectionName, sectionValue, job, extra = {}) {
    const bundle = ensureBundleForJob(job);
    if (!bundle) return { ok: false, reason: 'Missing current AZ job' };

    const next = deepClone(bundle);
    next['Name'] = normalizeText(job['Name']) || next['Name'] || '';
    next['Mailing Address'] = normalizeText(job['Mailing Address']) || next['Mailing Address'] || '';

    if (extra.submissionNumber) {
      next['SubmissionNumber'] = normalizeText(extra.submissionNumber);
      mergeCurrentJob({ 'AZ ID': job['AZ ID'], 'SubmissionNumber': next['SubmissionNumber'] });
    }

    next[sectionName] = {
      ready: true,
      savedAt: new Date().toISOString(),
      script: SCRIPT_NAME,
      version: VERSION,
      payloadKey: extra.payloadKey || '',
      submissionNumber: normalizeText(extra.submissionNumber || ''),
      data: deepClone(sectionValue)
    };

    next.meta = isPlainObject(next.meta) ? next.meta : {};
    next.meta.updatedAt = new Date().toISOString();
    next.meta.lastWriter = SCRIPT_NAME;
    next.meta.version = VERSION;
    writeBundle(next);
    return { ok: true, bundle: next };
  }

  function init() {
    buildUI();
    log(`Script started v${VERSION}`);
    log(`Origin: ${location.origin}`);
    log(`Grants: GM_getValue=${typeof GM_getValue}, GM_setValue=${typeof GM_setValue}, GM_deleteValue=${typeof GM_deleteValue}`);
    log('Auto-run armed');
    setStatus('Waiting for Coverages page or HOME quote-grabber trigger');
    setInterval(() => {
      try { tick(); } catch (err) {
        log(`tick() crashed: ${err?.message || err}`);
        setStatus('Tick error (see log)');
      }
    }, CFG.tickMs);
    try { tick(); } catch (err) {
      log(`tick() crashed: ${err?.message || err}`);
      setStatus('Tick error (see log)');
    }
  }

  function announceSkipReason(reason) {
    if (state.announcedSkipReason === reason) return;
    state.announcedSkipReason = reason;
    log(`Tick skipped: ${reason}`);
  }

  function logTriggerSnapshot(currentJob) {
    const gm = readHomeQuoteGrabberTriggerFromGm();
    const ls = readHomeQuoteGrabberTriggerFromLocalStorage();
    const stage = readFlowStage();
    function describe(t) {
      if (!t) return 'none';
      const consumed = t.consumed === true ? 'consumed' : 'fresh';
      return `@${t.requestedAt || '?'} azId=${t.azId || '(empty)'} from=${t.from || '(n/a)'} to=${t.to || '(n/a)'} [${consumed}]`;
    }
    const parts = [
      `job.AZ=${currentJob['AZ ID'] || '(empty)'}`,
      `GM=${describe(gm)}`,
      `LS=${describe(ls)}`,
      `stage=${normalizeText(stage.product) || '(none)'}/${normalizeText(stage.step) || '(none)'}`
    ];
    log(`Snapshot: ${parts.join(' | ')}`);
  }

  function tick() {
    state.tickCount++;
    if (!state.running) { announceSkipReason('state.running=false'); return; }
    if (state.busy) { announceSkipReason('state.busy=true'); return; }
    if (state.doneThisLoad) { announceSkipReason('doneThisLoad=true (reload tab for another quote)'); return; }
    state.announcedSkipReason = '';

<<<<<<< HEAD
    // PRIMARY PATH (v3.0): we are sitting on the Coverages edit page with a
    // Homeowners line visible -> drive the full 9-step flow ourselves.
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    if (!state.flowStartedThisLoad && isOnCoverageEditPage()) {
      if (!state.coverageTriggerSince) {
        state.coverageTriggerSince = Date.now();
        setStatus('Coverages detected, stabilizing...');
        log('Coverages detected, stabilizing...');
        return;
      }
      if ((Date.now() - state.coverageTriggerSince) < CFG.triggerStableMs) {
        setStatus('Coverages stable...');
        return;
      }
      state.flowStartedThisLoad = true;
      state.busy = true;
      log(`Starting full flow on ${location.origin}${location.pathname}`);
      runGrab({ fullFlow: true })
        .catch((err) => {
          log(`Full flow failed: ${err?.message || err}`);
          setStatus('Failed');
        })
        .finally(() => {
          state.busy = false;
        });
      return;
    }
    state.coverageTriggerSince = 0;

<<<<<<< HEAD
    // LEGACY PATH: an older standalone writer fired a direct trigger. Run
    // the grab phase only (skip coverage edits, since the writer did them).
    // Also gated by flowStartedThisLoad so a failed full flow doesn't fall
    // through here and silently retry.
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    if (state.flowStartedThisLoad) {
      announceSkipReason('flowStartedThisLoad=true (reload tab to retry after failure)');
      return;
    }
<<<<<<< HEAD
=======

>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    const currentJob = readCurrentJob();
    const handoff = getUsableHomeQuoteGrabberHandoff(currentJob['AZ ID']);
    const stageReady = matchesStage('home', 'quote_grabber', currentJob['AZ ID']);

    if (!handoff && !stageReady) {
      state.triggerSince = 0;
      state.activeHandoffRequestedAt = '';
<<<<<<< HEAD
      setWaiting('Waiting for Coverages page or legacy trigger');
=======
      setWaiting('Waiting for Coverages page or HOME quote-grabber trigger');
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
      if (state.tickCount - state.lastSnapshotTick >= SNAPSHOT_EVERY_TICKS) {
        state.lastSnapshotTick = state.tickCount;
        logTriggerSnapshot(currentJob);
      }
      return;
    }

    if (handoff && !stageReady) {
      writeFlowStage('home', 'quote_grabber', currentJob['AZ ID']);
      const src = state.lastTriggerSource || '?';
      log(`Recovered quote-grabber stage from direct handoff (source=${src})`);
    }

    if (hasVisibleExactLabel('Personal Auto')) {
      state.triggerSince = 0;
      setWaiting('Blocked: Personal Auto present');
      return;
    }

    const currentRequestedAt = normalizeText(handoff?.requestedAt || '');
    if (currentRequestedAt && currentRequestedAt !== state.activeHandoffRequestedAt) {
      state.triggerSince = 0;
      state.activeHandoffRequestedAt = currentRequestedAt;
      const src = state.lastTriggerSource || '?';
      log(`Handoff received from ${normalizeText(handoff?.from || 'unknown sender')} (source=${src})`);
    }

    if (!state.triggerSince) {
      state.triggerSince = Date.now();
      log('Trigger found: HOME quote-grabber handoff (legacy path)');
      setStatus('Trigger found, waiting 3 seconds');
      return;
    }

    const elapsed = Date.now() - state.triggerSince;
    if (elapsed < CFG.triggerDelayMs) {
      setStatus(`Trigger stable... ${Math.ceil((CFG.triggerDelayMs - elapsed) / 1000)}s`);
      return;
    }

    state.flowStartedThisLoad = true;
    state.busy = true;
    log(`Starting legacy grab on ${location.origin}${location.pathname}`);
    runGrab({ fullFlow: false })
      .catch((err) => {
        log(`Legacy grab failed: ${err?.message || err}`);
        setStatus('Failed');
      })
      .finally(() => {
        state.busy = false;
      });
  }

  function hasVisibleExactLabel(labelText) {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      try {
        const nodes = doc.querySelectorAll('.gw-label');
        for (const el of nodes) {
          if (!isVisible(el)) continue;
          if (normalizeText(el.textContent || '') === labelText) return true;
        }
      } catch {}
    }
    return false;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const r = el.getBoundingClientRect?.();
      if (!r || r.width === 0 || r.height === 0) return false;
      const win = el.ownerDocument?.defaultView || window;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (el.closest?.('[aria-hidden="true"]')) return false;
      return true;
    } catch { return false; }
  }

<<<<<<< HEAD
  // ===========================================================================
  // Coverage edit phase (formerly in 04 GWPC Home Coverages Quote + Risk Analysis)
  // ===========================================================================

=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  function byId(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function q(sel, root = document) {
    try { return root.querySelector(sel); } catch { return null; }
  }

  function queryFirstVisible(selector) {
    try {
<<<<<<< HEAD
      return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
=======
      return Array.from(document.querySelectorAll(selector)).find(isVisibleEl) || null;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    } catch { return null; }
  }

  function getHeaderText() {
    const nodes = Array.from(document.querySelectorAll('.gw-TitleBar--title'));
<<<<<<< HEAD
    const el = nodes.find(isVisible) || null;
=======
    const el = nodes.find(isVisibleEl) || null;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    return normalizeText(el?.textContent || '');
  }

  function headerStillCoverages() {
<<<<<<< HEAD
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisible);
    return titles.some(t => normalizeText(t.textContent || '') === IDS.coveragesHeader);
=======
    const titles = Array.from(document.querySelectorAll('.gw-TitleBar--title')).filter(isVisibleEl);
    return titles.some((t) => normalizeText(t.textContent || '') === IDS.coveragesHeader);
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  }

  function isOnCoverageEditPage() {
    return getHeaderText() === IDS.coveragesHeader &&
      !!byId(IDS.coveragesScreen) &&
      !!byId(IDS.mainArea) &&
      hasVisibleExactLabel('Homeowners');
  }

  function cssAttrEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

  function dispatchValueEvents(el) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch {}
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

  function verifyContextLabels(el, expectedLabels) {
    if (!expectedLabels || !expectedLabels.length) return true;
    const context = gatherContextText(el).toLowerCase();
<<<<<<< HEAD
    return expectedLabels.every(label => context.includes(String(label).toLowerCase()));
=======
    return expectedLabels.every((label) => context.includes(String(label).toLowerCase()));
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  }

  function getSelectedText(selectEl) {
    if (!selectEl) return '';
    const opt = selectEl.options?.[selectEl.selectedIndex];
    return normalizeText(opt?.textContent || opt?.innerText || '');
  }

  function optionCanon(text) {
<<<<<<< HEAD
    return normalizeText(text).toLowerCase().replace(/ /g, '').replace(/\s+/g, '').replace(/,/g, '').replace(/\$/g, '');
=======
    return normalizeText(text).toLowerCase().replace(/\u00a0/g, '').replace(/\s+/g, '').replace(/,/g, '').replace(/\$/g, '');
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  }

  function optionMatchesText(text, desiredTexts) {
    const actual = optionCanon(text);
<<<<<<< HEAD
    return desiredTexts.some(want => actual === optionCanon(want));
=======
    return desiredTexts.some((want) => actual === optionCanon(want));
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
  }

  function findMatchingOption(selectEl, desiredTexts) {
    const options = Array.from(selectEl?.options || []);
    for (const opt of options) {
      const txt = normalizeText(opt.textContent || opt.innerText || '');
      if (optionMatchesText(txt, desiredTexts)) return opt;
    }
    return null;
  }

  function isProbablyClickable(el) {
<<<<<<< HEAD
    if (!el || !(el instanceof Element) || !isVisible(el)) return false;
=======
    if (!el || !(el instanceof Element) || !isVisibleEl(el)) return false;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    return (
      el.matches('button, a, input[type="button"], input[type="submit"], [role="button"], [role="tab"], [role="menuitem"]') ||
      el.classList.contains('gw-action--inner') ||
      el.classList.contains('gw-TabWidget') ||
      el.classList.contains('gw-ButtonWidget') ||
      el.hasAttribute('onclick') ||
      el.getAttribute('tabindex') === '0'
    );
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

  function findClickableOwnerByLabel(labelText) {
<<<<<<< HEAD
    const direct = Array.from(document.querySelectorAll(`.gw-label[aria-label="${cssAttrEscape(labelText)}"]`)).filter(isVisible);
    for (const label of direct) {
      const owner = getClickableOwner(label);
      if (owner && isVisible(owner)) return owner;
=======
    const direct = Array.from(document.querySelectorAll(`.gw-label[aria-label="${cssAttrEscape(labelText)}"]`)).filter(isVisibleEl);
    for (const label of direct) {
      const owner = getClickableOwner(label);
      if (owner && isVisibleEl(owner)) return owner;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    }
    const generic = Array.from(document.querySelectorAll('.gw-label, [aria-label], [role="button"], [role="tab"], .gw-action--inner, a, button, div'));
    for (const el of generic) {
      const aria = normalizeText(el.getAttribute?.('aria-label') || '');
      const txt = normalizeText(el.textContent || '');
<<<<<<< HEAD
      if ((aria === labelText || txt === labelText) && isVisible(el)) {
        const owner = getClickableOwner(el);
        if (owner && isVisible(owner)) return owner;
=======
      if ((aria === labelText || txt === labelText) && isVisibleEl(el)) {
        const owner = getClickableOwner(el);
        if (owner && isVisibleEl(owner)) return owner;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
      }
    }
    return null;
  }

  function findEditAllTarget() {
    return findClickableOwnerByLabel('Edit All');
  }

<<<<<<< HEAD
  function nudgeCoveragesTabIfNeeded() {
    if ((Date.now() - state.lastTabNudgeAt) < CFG.tabNudgeCooldownMs) return false;
    const target = findActionByText('Coverages');
    if (!target) return false;
    state.lastTabNudgeAt = Date.now();
    strongClick(target);
    log('Clicked Coverages tab helper');
    return true;
  }

=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
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
    const host = byId(IDS.quoteButtonHost);
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
<<<<<<< HEAD
    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisible(el)) return el;
    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
      if (inner && isVisible(inner)) return inner;
    }
    let p = el;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisible(p)) return p;
    }
    return isVisible(el) ? el : null;
=======
    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisibleEl(el)) return el;
    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
      if (inner && isVisibleEl(inner)) return inner;
    }
    let p = el;
    for (let i = 0; i < 12 && p; i++, p = p.parentElement) {
      if (p.matches?.('.gw-action--inner') && p.getAttribute('aria-disabled') !== 'true' && isVisibleEl(p)) return p;
    }
    return isVisibleEl(el) ? el : null;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
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
      const movedOff = await waitFor(() => !headerStillCoverages(), CFG.quoteTransitionTimeoutMs, `Quote transition (attempt ${attempt})`);
      if (movedOff) {
        log('Quote succeeded (moved off Coverages)');
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

<<<<<<< HEAD
  // After the Auto radio is clicked the page stays on its current screen, so
  // clickQuoteUntilTransition's "moved off Coverages" criterion does not apply.
  // We just click the Quote button and sleep for the re-quote to settle.
  async function clickQuoteRequote() {
    state.lastQuoteClickAt = 0; // reset cooldown so clickQuoteOnce is allowed
    for (let attempt = 1; attempt <= CFG.maxQuoteAttempts; attempt++) {
      setStatus(`Re-Quote click (${attempt}/${CFG.maxQuoteAttempts})`);
      if (clickQuoteOnce()) {
        log('Re-Quote click sent, waiting to settle');
        await sleep(CFG.afterRequoteSettleMs);
        return true;
      }
      await sleep(CFG.betweenQuoteAttemptsMs);
    }
    throw new Error('Could not click Quote for re-quote');
  }

=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
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
    if (!verifyContextLabels(el, expectedLabels)) throw new Error(`${label}: context mismatch`);
    return el;
  }

  async function setSelectVerified(selector, expectedLabels, desiredTexts, label) {
    const el = await waitForField(selector, expectedLabels, label);
    const match = findMatchingOption(el, desiredTexts);
    if (!match) throw new Error(`${label}: option not found (${desiredTexts.join(' / ')})`);
    if (optionMatchesText(getSelectedText(el), desiredTexts)) {
      log(`${label}: already set to ${getSelectedText(el)}`);
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
    if (!optionMatchesText(finalText, desiredTexts)) throw new Error(`${label}: failed to stick (${finalText || 'blank'})`);
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
    if (!el.checked) throw new Error(`${label}: failed to stay checked`);
    log(`${label}: checked`);
  }

  async function driveCoveragesAndQuote() {
    log('Phase 1: editing coverages');
    await ensureEditMode();
    await setSelectVerified(SEL.stdAllPerils, ['All Perils'], ['$3,000', '3000'], 'Standard / All Perils');
    await setSelectVerified(SEL.enhAllPerils, ['All Perils'], ['$7,500', '7500'], 'Enhanced / All Perils');
    await setSelectVerified(SEL.enhSplitWater, ['Split Water'], ['$10,000', '10000'], 'Enhanced / Split Water');
    await setSelectVerified(SEL.enhSeparateStructures, ['Separate Structures'], ['5%'], 'Enhanced / Separate Structures');
    await setSelectVerified(SEL.enhPersonalPropertyLimit, ['Personal Property', 'Limit'], ['40%'], 'Enhanced / Personal Property Limit');
    await setSelectVerified(SEL.enhPersonalLiability, ['Personal Liability'], ['$1,000,000', '1000000'], 'Enhanced / Personal Liability');
    await ensureCheckboxVerified(SEL.enhExtendedReplacementCheckbox, ['Extended Replacement Cost'], 'Enhanced / Extended Replacement Cost checkbox');
    await setSelectVerified(SEL.enhExtendedReplacementSelect, ['Extended Replacement Cost'], ['120%', '120'], 'Enhanced / Extended Replacement Cost value');
    await ensureCheckboxVerified(SEL.personalInjuryCheckbox, ['Personal Injury'], 'Additional / Personal Injury');
    log('Phase 1: clicking initial Quote');
    const quoteOK = await clickQuoteUntilTransition();
    if (!quoteOK) throw new Error('Initial Quote click did not move off Coverages');
  }

<<<<<<< HEAD
  // ===========================================================================
  // Auto-discount step + Fair Plan check (new in v3.0)
  // ===========================================================================

  function findAutoRadioTarget() {
    return findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.autoRadio)} > div`));
  }

  async function clickAutoRadio() {
    // waitFor only returns true/false in this script, so look up the element
    // fresh once the wait succeeds.
    const ok = await waitFor(
      () => !!findAutoRadioTarget(),
      CFG.waitTimeoutMs,
      'Auto radio (Job Wizard Info Bar)'
    );
    if (!ok) throw new Error('Auto radio not found within timeout');
    const target = findAutoRadioTarget();
    if (!target) throw new Error('Auto radio vanished after wait');
    log('Clicking Auto radio (Job Wizard Info Bar)');
    strongClick(target);
    await sleep(CFG.afterClickMs);
  }

  function hasFairPlanCompanionEndorsement() {
    return !!findInDocs((doc) => {
      const labels = doc.querySelectorAll(SEL.fairPlanLabelClass);
      for (const el of labels) {
        if (!isVisible(el)) continue;
        if (normalizeText(el.textContent || '') === 'FAIR Plan Companion Endorsement') return el;
      }
      return null;
    });
  }

  function extractExclusionsFields() {
    return { 'CFP?': hasFairPlanCompanionEndorsement() ? 'YES' : 'NO' };
  }

  // Top-level orchestrator. Two entry shapes:
  //   - fullFlow=true: drive coverage edits + initial Quote first, then run
  //     the new 9-step grab (dual pricing + auto radio + fair plan check).
  //   - fullFlow=false: legacy path, used when the old separate writer fired
  //     a direct trigger. Skips coverage edits and runs a single-pricing grab
  //     with the fair-plan check.
  async function runGrab(opts = {}) {
    const fullFlow = !!opts.fullFlow;
    log(`Starting ${fullFlow ? 'full flow (coverage edits + 9-step grab)' : 'legacy grab (post-trigger)'}`);
=======
  async function runGrab(opts = {}) {
    const fullFlow = !!opts.fullFlow;
    log(`Starting ${fullFlow ? 'full flow (coverage edits + quote grab)' : 'legacy grab (post-trigger)'}`);
>>>>>>> 4422efa (Update home quote grabber edit quote flow)

    if (fullFlow) {
      setStatus('Phase 1: editing coverages and quoting');
      await driveCoveragesAndQuote();
    }

    const submissionNumberEarly = extractSubmissionNumber();
    if (submissionNumberEarly) log(`Submission Number found early: ${submissionNumberEarly}`);

<<<<<<< HEAD
    // Step 1: Coverages → INITIAL prices (only meaningful in full flow)
    let initialPricing = { 'Standard Pricing': '', 'Enhance Pricing': '' };
    if (fullFlow) {
      setStatus('Step 1: Coverages (initial pricing)');
      await goToCoverages();
      await sleep(CFG.afterClickMs);
      initialPricing = extractPricingFields();
      log(`Initial pricing: ${JSON.stringify(initialPricing)}`);
    }

    // Step 2: Policy Info → Name, Mailing Address
    setStatus('Step 2: Policy Info');
=======
    setStatus('Opening Coverages (No Auto Discount)');
    await goToCoverages();
    await sleep(CFG.afterClickMs);
    const pricingNoAutoData = extractPricingFields();
    log(`Pricing before auto discount: ${JSON.stringify(pricingNoAutoData)}`);

    setStatus('Opening Policy Info');
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    await goToPolicyInfo();
    await sleep(CFG.afterClickMs);
    const policyInfoData = extractPolicyInfoFields();
    log(`Policy Info fields: ${JSON.stringify(policyInfoData)}`);

<<<<<<< HEAD
    // Steps 3-4: Click Auto radio + Re-Quote (only meaningful in full flow)
    if (fullFlow) {
      setStatus('Step 3: clicking Auto radio (Policy Level Discount)');
      await clickAutoRadio();
      setStatus('Step 4: re-Quote with Auto discount');
      await clickQuoteRequote();
    }

    // Step 5: Dwelling → fields
    setStatus('Step 5: Dwelling');
=======
    setStatus('Opening Edit Quote');
    await goToEditQuote();
    await sleep(CFG.afterClickMs);
    log('Edit Quote ready');

    setStatus('Applying Auto Discount');
    await applyAutoDiscount();
    await sleep(CFG.afterClickMs);
    log('Auto discount applied');

    setStatus('Opening Quote');
    await goToQuote();
    await sleep(CFG.afterClickMs);
    const quoteAfterDiscountData = extractQuoteFields();
    log(`Quote fields after auto discount: ${JSON.stringify(quoteAfterDiscountData)}`);

    setStatus('Opening Dwelling');
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    await goToDwelling();
    await sleep(CFG.afterClickMs);
    const dwellingData = extractDwellingFields();
    log(`Dwelling fields: ${JSON.stringify(dwellingData)}`);

<<<<<<< HEAD
    // Step 6: Coverages → FINAL prices (the only pricing in legacy mode)
    setStatus(fullFlow ? 'Step 6: Coverages (final pricing, with auto discount)' : 'Coverages pricing');
    await goToCoverages();
    await sleep(CFG.afterClickMs);
    const finalPricing = extractPricingFields();
    log(`Final pricing: ${JSON.stringify(finalPricing)}`);

    const submissionNumber = extractSubmissionNumber() || submissionNumberEarly || '';
=======
    setStatus('Opening Coverages (Auto Discount)');
    await goToCoverages();
    await sleep(CFG.afterClickMs);
    const pricingAutoData = extractPricingFields();
    const submissionNumber = extractSubmissionNumber() || submissionNumberEarly || '';
    log(`Pricing after auto discount: ${JSON.stringify(pricingAutoData)}`);
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    if (submissionNumber) log(`Submission Number confirmed: ${submissionNumber}`);

    // Step 7: Exclusions and Conditions → check FAIR Plan Companion Endorsement
    setStatus('Step 7: Exclusions and Conditions (Fair Plan check)');
    await goToExclusionsAndConditions();
    await sleep(CFG.afterClickMs);
<<<<<<< HEAD
    const exclusionsData = extractExclusionsFields();
    log(`Exclusions fields: ${JSON.stringify(exclusionsData)}`);
=======
    const cfpValue = extractCFPValue();
    log(`CFP detected: ${cfpValue}`);
>>>>>>> 4422efa (Update home quote grabber edit quote flow)

    // Step 8: Quote tab → Auto Discount value
    setStatus('Step 8: Quote tab');
    await goToQuote();
    await sleep(CFG.afterClickMs);
    const quoteData = extractQuoteFields();
<<<<<<< HEAD
    log(`Quote fields: ${JSON.stringify(quoteData)}`);
=======
    log(`Final quote fields read: ${JSON.stringify(quoteData)}`);
>>>>>>> 4422efa (Update home quote grabber edit quote flow)

    // Build the row. Initial pricing fields are blank in legacy mode (they
    // weren't captured because the old writer's pre-trigger pricing wasn't
    // accessible by the time the grab started).
    const row = {
      'Name': policyInfoData['Name'] || '',
      'Mailing Address': policyInfoData['Mailing Address'] || '',
      'Fire Code': dwellingData['Fire Code'] || '',
      'Protection Class': dwellingData['Protection Class'] || '',
<<<<<<< HEAD
      'CFP?': exclusionsData['CFP?'] || 'NO',
=======
      'CFP?': cfpValue,
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
      'Reconstruction Cost': dwellingData['Reconstruction Cost'] || '',
      'Year Built': dwellingData['Year Built'] || '',
      'Square FT': dwellingData['Square FT'] || '',
      '# of Story': dwellingData['# of Story'] || '',
      'Water Device?': dwellingData['Water Device?'] || '',
<<<<<<< HEAD
      'Standard Pricing Initial': initialPricing['Standard Pricing'] || '',
      'Enhance Pricing Initial': initialPricing['Enhance Pricing'] || '',
      'Standard Pricing': finalPricing['Standard Pricing'] || '',
      'Enhance Pricing': finalPricing['Enhance Pricing'] || '',
=======
      'Standard Pricing No Auto Discount': pricingNoAutoData['Standard Pricing'] || '',
      'Enhance Pricing No Auto Discount': pricingNoAutoData['Enhance Pricing'] || '',
      'Standard Pricing Auto Discount': pricingAutoData['Standard Pricing'] || '',
      'Enhance Pricing Auto Discount': pricingAutoData['Enhance Pricing'] || '',
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
      'Submission Number': submissionNumber || '',
      'Auto Discount': quoteData['Auto Discount'] || quoteAfterDiscountData['Auto Discount'] || '',
      'Date Processed?': formatDate(new Date()),
      'Done?': '',
      'Result': ''
    };

    // In legacy mode the initial pricing fields are expected to be blank, so
    // exclude them from the missing-field check.
    const skipMissingKeys = new Set(['Done?', 'Result']);
    if (!fullFlow) {
      skipMissingKeys.add('Standard Pricing Initial');
      skipMissingKeys.add('Enhance Pricing Initial');
    }
    const missing = Object.entries(row)
      .filter(([key, value]) => !value && !skipMissingKeys.has(key))
      .map(([key]) => key);

    if (missing.length) {
      row['Done?'] = 'No';
      row['Result'] = `Missing: ${missing.join(', ')}`;
      log(`Missing fields: ${missing.join(', ')}`);
    } else {
      row['Done?'] = 'Yes';
      row['Result'] = fullFlow ? 'Grabbed (full flow)' : 'Grabbed (legacy)';
      log('All fields grabbed successfully');
    }

    let currentJob = readCurrentJob();
    if (!currentJob['AZ ID']) {
<<<<<<< HEAD
      // Cross-origin fallback: the handoff reached this tab via GM storage
      // but tm_pc_current_job_v1 is origin-scoped and may not have been
      // written on this subdomain yet. Bootstrap from the handoff payload
      // plus the data we already grabbed off the page so we can still save.
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
      const handoffNow = readHomeQuoteGrabberTrigger();
      const handoffAzId = normalizeText(handoffNow?.azId || '');
      if (handoffAzId) {
        log(`current_job missing AZ ID; bootstrapping from handoff (azId=${handoffAzId})`);
        currentJob = writeCurrentJob({
          'AZ ID': handoffAzId,
          'Name': row['Name'] || '',
          'Mailing Address': row['Mailing Address'] || '',
          'SubmissionNumber': row['Submission Number'] || normalizeText(handoffNow?.submissionNumber || '')
        });
      }
    }
    if (!currentJob['AZ ID']) {
      throw new Error('Missing tm_pc_current_job_v1 / AZ ID (handoff also had no azId)');
    }

    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'home_quote_gathered',
      product: 'home',
      'AZ ID': currentJob['AZ ID'],
      currentJob,
      savedAt: new Date().toISOString(),
      page: {
        url: location.href,
        title: document.title
      },
      flow: fullFlow ? 'full' : 'legacy',
      tabsUsed: {
<<<<<<< HEAD
        coveragesInitial: fullFlow,
        policyInfo: true,
        autoRadioClicked: fullFlow,
        requoted: fullFlow,
        dwelling: true,
        coveragesFinal: true,
        exclusionsAndConditions: true,
        quote: true,
        cfpFromFairPlanEndorsement: true
=======
        coveragesEditedAndQuotedInitially: fullFlow,
        coveragesNoAutoDiscount: true,
        policyInfo: true,
        editQuote: true,
        quoteAfterAutoDiscount: true,
        dwelling: true,
        coveragesAutoDiscount: true,
        exclusionsAndConditions: true,
        quoteFinal: true,
        fairPlanCompanionEndorsementDetected: cfpValue === 'YES'
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
      },
      quoteAfterDiscount: quoteAfterDiscountData,
      row
    };

    const mergeJob = mergeCurrentJob({
      'AZ ID': currentJob['AZ ID'],
      'Name': currentJob['Name'] || row['Name'],
      'Mailing Address': currentJob['Mailing Address'] || row['Mailing Address'],
      'SubmissionNumber': row['Submission Number'] || currentJob['SubmissionNumber']
    });
    if (!mergeJob.ok) {
      throw new Error(mergeJob.reason || 'Current job merge failed');
    }

    localStorage.setItem(KEYS.payload, JSON.stringify(payload, null, 2));
    const bundleSave = saveBundleSection('home', payload, mergeJob.next || currentJob, {
      submissionNumber: row['Submission Number'] || '',
      payloadKey: KEYS.payload
    });
    if (!bundleSave.ok) {
      throw new Error(bundleSave.reason || 'Bundle save failed');
    }
    log(`Payload saved: ${KEYS.payload}`);
    log('Bundle merged: tm_pc_webhook_bundle_v1.home');
    // shared-ticket-handoff watches for product='home' step='handoff' and
    // advances the flow to 'home/sender'. This is the exit handoff.
    writeFlowStage('home', 'handoff', (mergeJob.next || currentJob)['AZ ID']);
    consumeHomeQuoteGrabberHandoff((mergeJob.next || currentJob)['AZ ID']);
    setStatus('Grab complete (handed off to shared-ticket-handoff)');
    state.doneThisLoad = true;
  }

  async function goToPolicyInfo() {
    await navigateToTab(
      'Policy Info',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.policyInfoTab)} > div.gw-action--inner`)),
        () => findActionByText('Policy Info')
      ],
      () => !!findByIdInDocs(IDS.name) || !!findByIdInDocs(IDS.mailingAddress)
    );
  }

  async function goToEditQuote() {
    await navigateToTab(
      LABELS.editQuote,
      [
        () => findActionByExactText(LABELS.editQuote),
        () => findActionByText(LABELS.editQuote)
      ],
      () => !!findAutoDiscountControl() || (!findQuotedTriggerElement() && (!!findByIdInDocs(IDS.name) || !!findByIdInDocs(IDS.mailingAddress)))
    );
  }

  async function goToDwelling() {
    await navigateToTab(
      'Dwelling',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.dwellingTab)} > div.gw-action--inner`)),
        () => findActionByText('Dwelling')
      ],
      () => !!findByIdInDocs(IDS.fireCode) || !!findByIdInDocs(IDS.reconstruction)
    );
  }

  async function goToCoverages() {
    await navigateToTab(
      'Coverages',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.coveragesTab)} > div.gw-action--inner`)),
        () => findActionByText('Coverages')
      ],
      () => !!findByIdInDocs(IDS.standardPrice) || !!findByIdInDocs(IDS.pricingTable)
    );
  }

  async function goToExclusionsAndConditions() {
    await navigateToTab(
      'Exclusions and Conditions',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.exclusionsTab)} > div.gw-action--inner`)),
        () => findActionByText('Exclusions and Conditions')
      ],
      () => {
        const inner = findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.exclusionsTab)} > div.gw-action--inner`));
        if (!inner) return false;
        const selected = inner.getAttribute('aria-selected');
        return selected === 'true' || inner.classList.contains('gw-focus');
      }
    );
  }

  async function goToQuote() {
    await navigateToTab(
      'Quote',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.quoteTab)} > div.gw-action--inner`)),
        () => findActionByText('Quote')
      ],
      () => !!findByIdInDocs(IDS.autoDiscountLV) || isTitleLike('Quote')
    );
  }

  function describeElement(el) {
    if (!el) return 'null';
    const tag = el.tagName?.toLowerCase?.() || '?';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    const aria = el.getAttribute?.('aria-label');
    const role = el.getAttribute?.('role');
    const disabled = el.getAttribute?.('aria-disabled');
    const bits = [`<${tag}>`];
    if (id) bits.push(id);
    if (cls) bits.push(cls);
    if (aria) bits.push(`aria="${aria}"`);
    if (role) bits.push(`role="${role}"`);
    if (disabled === 'true') bits.push('aria-disabled=true');
    return bits.join(' ');
  }

<<<<<<< HEAD
  // Walks up from an element to the nearest non-disabled clickable ancestor.
  // Returns null if the resolved target is aria-disabled and has no enabled
  // clickable ancestor within the search depth. This prevents "click landed
  // on a disabled tab" silent failures.
  function resolveClickableTab(el) {
    if (!el) return null;
    // Prefer an enabled .gw-action--inner at or above this element.
    const upgraded = upgradeToClickable(el);
    if (upgraded && upgraded.getAttribute?.('aria-disabled') !== 'true') return upgraded;
    // Walk up for a non-disabled clickable owner.
=======
  function resolveClickableTab(el) {
    if (!el) return null;
    const upgraded = upgradeToClickable(el);
    if (upgraded && upgraded.getAttribute?.('aria-disabled') !== 'true') return upgraded;
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
    const owner = getClickableOwner(el);
    if (owner && owner.getAttribute?.('aria-disabled') !== 'true') return owner;
    return null;
  }

  async function navigateToTab(name, resolvers, readyFn) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const raw = resolveFirst(resolvers);
      if (!raw) {
        log(`${name} tab not found, attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      const target = resolveClickableTab(raw);
      if (!target) {
        log(`${name} tab resolved target is disabled/unclickable (raw=${describeElement(raw)}), attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      log(`Clicking ${name} ${describeElement(target)} attempt ${attempt}/3`);
      const headerBefore = getHeaderText();
      strongClick(target);

      const ok = await waitFor(readyFn, CFG.waitTimeoutMs, `${name} readiness`);
      if (ok) {
        const headerAfter = getHeaderText();
        if (headerBefore && headerAfter && headerBefore === headerAfter && headerBefore !== name) {
<<<<<<< HEAD
          // Page became ready but the header never moved. Likely the operator
          // clicked manually while we were waiting, or readyFn is too lenient.
=======
>>>>>>> 4422efa (Update home quote grabber edit quote flow)
          log(`${name} ready (but header unchanged: "${headerBefore}")`);
        } else {
          log(`${name} ready (header "${headerBefore}" -> "${headerAfter}")`);
        }
        return;
      }

      log(`${name} did not become ready after click`);
    }

    throw new Error(`Could not open ${name}`);
  }

  function extractPolicyInfoFields() {
    const nameRaw =
      getDisplayValueById(IDS.name) ||
      extractWithRegex(getTextById(IDS.name), /^Name\s+(.+)$/i);

    const mailingAddressRaw =
      getDisplayValueById(IDS.mailingAddress) ||
      extractWithRegex(getTextById(IDS.mailingAddress), /^Mailing\s*Address\s+(.+)$/i);

    return {
      'Name': normalizeSimpleValue(nameRaw),
      'Mailing Address': normalizeSimpleValue(mailingAddressRaw)
    };
  }

  function extractDwellingFields() {
    const fireRaw =
      getDisplayValueById(IDS.fireCode) ||
      extractWithRegex(getTextById(IDS.fireBlock), /FireLine\s*Code\s+(.+?)(?:\s+Slope|\s*$)/i);

    const protectionRaw =
      extractWithRegex(getTextById(IDS.protectionBlock), /Code\s+([A-Z0-9-]+)/i);

    const reconstructionRaw =
      getDisplayValueById(IDS.reconstruction) ||
      extractWithRegex(getTextById(IDS.reconstruction), /Reconstruction\s*Cost\s+(.+)$/i);

    const yearBuiltRaw =
      getDisplayValueById(IDS.yearBuilt) ||
      extractWithRegex(getTextById(IDS.yearBuilt), /Year\s*Built\s+(.+)$/i);

    const squareFeetRaw =
      getDisplayValueById(IDS.squareFeet) ||
      extractWithRegex(getTextById(IDS.squareFeet), /Square\s*Feet\s+(.+)$/i);

    const storiesRaw =
      getDisplayValueById(IDS.stories) ||
      extractWithRegex(getTextById(IDS.stories), /Number\s*of\s*Stories\/Style\s+(.+)$/i);

    const waterRaw =
      getDisplayValueById(IDS.waterDevice) ||
      extractWithRegex(getTextById(IDS.waterDevice), /Water\s*Protection\s+(.+)$/i);

    return {
      'Fire Code': normalizeFireCode(fireRaw),
      'Protection Class': normalizeSimpleValue(protectionRaw),
      'Reconstruction Cost': normalizeMoneyText(reconstructionRaw),
      'Year Built': normalizeSimpleValue(yearBuiltRaw),
      'Square FT': normalizeSimpleValue(squareFeetRaw),
      '# of Story': normalizeSimpleValue(storiesRaw),
      'Water Device?': normalizeWaterDevice(waterRaw)
    };
  }

  function extractPricingFields() {
    let standard = getTextById(IDS.standardPrice);
    let enhance = getTextById(IDS.enhancePrice);

    if (!standard || !enhance) {
      const row2 = findInDocs((doc) => {
        const root = doc.getElementById(IDS.pricingTable);
        return root?.querySelector('table tbody tr:nth-of-type(2)') || null;
      });

      if (row2) {
        standard = standard || getElementText(row2.querySelector('td:nth-of-type(3)'));
        enhance = enhance || getElementText(row2.querySelector('td:nth-of-type(5)'));
      }
    }

    return {
      'Standard Pricing': normalizeMoneyText(standard),
      'Enhance Pricing': normalizeMoneyText(enhance)
    };
  }

  function extractCFPValue() {
    const found = findInDocs((doc) => {
      const headers = doc.querySelectorAll(SEL.fairPlanLabelClass);
      for (const el of headers) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent || '') === LABELS.fairPlanCompanionEndorsement) return el;
      }
      return null;
    });

    return found ? 'YES' : 'NO';
  }

  function extractQuoteFields() {
    const raw = getTextById(IDS.autoDiscountLV);
    const amount = extractFirstMoney(raw);

    return {
      'Auto Discount': amount
    };
  }

  function extractSubmissionNumber() {
    const titleEl = findInDocs((doc) => {
      const nodes = doc.querySelectorAll('div.gw-Wizard--Title');
      for (const el of nodes) {
        const text = normalizeText(el.textContent);
        if (/^Submission\s+\d+/i.test(text)) return el;
      }
      return null;
    });

    if (!titleEl) return '';
    const text = normalizeText(titleEl.textContent);
    const m = text.match(/Submission\s+(\d+)/i);
    return m ? m[1] : '';
  }

  function findQuotedTriggerElement() {
    return findInDocs((doc) => {
      const nodes = doc.querySelectorAll('div.gw-label');
      for (const el of nodes) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent) === 'Submission (Quoted)') return el;
      }
      return null;
    });
  }

  function findActionByExactText(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="menuitem"], div[role="tab"], div[role="button"], button, a');
      for (const el of candidates) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent) === wanted) return el;
      }
      return null;
    });
  }

  function findActionByText(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="menuitem"], div[role="tab"], div[role="button"], button, a');
      for (const el of candidates) {
        if (!isVisibleEl(el)) continue;
        if (normalizeText(el.textContent).includes(wanted)) return el;
      }
      return null;
    });
  }

  function findAutoDiscountControl() {
    return findInDocs((doc) => {
      const exact = doc.querySelector(SEL.autoDiscountCheckboxExact);
      if (exact) return exact;

      const inputs = doc.querySelectorAll('input[type="checkbox"], input[type="radio"]');
      for (const input of inputs) {
        const signature = `${input.name || ''} ${input.id || ''}`;
        if (/MultiLineDiscounts/i.test(signature) && /DiscountSelected/i.test(signature)) return input;
      }

      return null;
    });
  }

  function isAutoDiscountApplied() {
    const control = findAutoDiscountControl();
    if (!control) return false;
    return control.checked === true || control.getAttribute('checked') != null || control.getAttribute('aria-checked') === 'true';
  }

  async function applyAutoDiscount() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const control = findAutoDiscountControl();
      if (!control) {
        log(`Auto discount control not found, attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      if (isAutoDiscountApplied()) {
        log('Auto discount already selected');
        return;
      }

      if (control.disabled) {
        log(`Auto discount control disabled, attempt ${attempt}/3`);
        await sleep(500);
        continue;
      }

      log(`Selecting auto discount, attempt ${attempt}/3`);
      const clickTarget = isVisibleEl(control) ? control : control.closest('label') || control.parentElement || control;
      strongClick(clickTarget);

      try { control.checked = true; } catch {}
      try { control.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { control.dispatchEvent(new Event('change', { bubbles: true })); } catch {}

      const ok = await waitFor(() => isAutoDiscountApplied(), CFG.waitTimeoutMs, 'auto discount selection');
      if (ok) {
        log('Auto discount selected');
        return;
      }
    }

    throw new Error('Could not apply auto discount');
  }

  function isTitleLike(word) {
    return !!findInDocs((doc) => {
      const nodes = doc.querySelectorAll('title, .gw-TitleBar--Title, .gw-TitleBar--title, .gw-TabBar, .gw-Wizard--Title');
      for (const el of nodes) {
        if (normalizeText(el.textContent).includes(word)) return el;
      }
      return null;
    });
  }

  function getDisplayValueById(id) {
    const el = findByIdInDocs(id);
    if (!el) return '';

    const candidates = [
      el.querySelector('.gw-value-readonly-wrapper'),
      el.querySelector('.gw-vw--value'),
      el.querySelector('.gw-value'),
      el.querySelector('[data-gw-getset="text"]')
    ];

    for (const c of candidates) {
      const value = getElementText(c);
      if (value && value !== 'Code') return value;
    }

    return '';
  }

  function getTextById(id) {
    const el = findByIdInDocs(id);
    return getElementText(el);
  }

  function getElementText(el) {
    if (!el) return '';
    return normalizeText(el.innerText || el.textContent || '');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSimpleValue(value) {
    return normalizeText(value);
  }

  function normalizeMoneyText(value) {
    const text = normalizeText(value);
    const money = extractFirstMoney(text);
    return money || text;
  }

  function normalizeFireCode(value) {
    const text = normalizeText(value);
    const m = text.match(/(?:^|\b)Code\s+([A-Z0-9.-]+)/i);
    if (m) return m[1];
    return text;
  }

  function normalizeWaterDevice(value) {
    const text = normalizeText(value);
    if (!text) return 'No';

    if (
      /^(none|no|n\/a|na|null|no device|not installed|not present|not applicable)$/i.test(text) ||
      /\b(no device|none|not installed|not present|not applicable)\b/i.test(text)
    ) {
      return 'No';
    }

    return 'Yes';
  }

  function extractFirstMoney(text) {
    const m = normalizeText(text).match(/\$[\d,]+(?:\.\d{2})?/);
    return m ? m[0] : '';
  }

  function extractWithRegex(text, regex) {
    const m = normalizeText(text).match(regex);
    return m ? normalizeText(m[1]) : '';
  }

  function findByIdInDocs(id) {
    return findInDocs((doc) => doc.getElementById(id));
  }

  function findInDocs(resolver) {
    const docs = getAccessibleDocs();
    for (const doc of docs) {
      try {
        const found = resolver(doc);
        if (found === true) return true;
        if (found) return found;
      } catch {}
    }
    return null;
  }

  function getAccessibleDocs() {
    const docs = [];
    const seen = new Set();

    function walk(win) {
      try {
        if (!win || seen.has(win)) return;
        seen.add(win);

        if (win.document) docs.push(win.document);

        for (let i = 0; i < win.frames.length; i++) {
          try {
            walk(win.frames[i]);
          } catch {}
        }
      } catch {}
    }

    walk(window.top);
    return docs;
  }

  function resolveFirst(resolvers) {
    for (const fn of resolvers) {
      try {
        const value = fn();
        if (value) return value;
      } catch {}
    }
    return null;
  }

  function safeClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}

    const events = [
      ['pointerdown', MouseEvent],
      ['mousedown', MouseEvent],
      ['pointerup', MouseEvent],
      ['mouseup', MouseEvent],
      ['click', MouseEvent]
    ];

    for (const [type, Ctor] of events) {
      try {
        el.dispatchEvent(new Ctor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    try { el.click(); } catch {}
  }

  async function waitFor(checkFn, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (checkFn()) return true;
      } catch {}
      await sleep(CFG.waitPollMs);
    }
    log(`Timeout waiting for ${label}`);
    return false;
  }

  function formatDate(date) {
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function setWaiting(msg) {
    if (state.lastWaitReason === msg) return;
    state.lastWaitReason = msg;
    log(msg);
    setStatus(msg);
  }

  function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'hb-home-quote-grabber-panel';
    panel.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'right:12px',
      'bottom:12px',
      'width:360px',
      'background:#111827',
      'color:#f9fafb',
      'border:1px solid #374151',
      'border-radius:12px',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)',
      'font:12px/1.35 Arial,sans-serif',
      'user-select:none'
    ].join(';');

    const saved = loadPanelPos();
    if (saved) {
      panel.style.left = saved.left;
      panel.style.top = saved.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    panel.innerHTML = `
      <div id="hb-home-quote-grabber-head" style="padding:8px 10px;cursor:move;border-bottom:1px solid #374151;background:#0f172a;border-radius:12px 12px 0 0;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.8;">V${VERSION}</div>
      </div>
      <div style="padding:8px 10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;">
          <button id="hb-home-quote-grabber-toggle" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#dc2626;color:#fff;">STOP</button>
          <button id="hb-home-quote-grabber-copylogs" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff;">COPY LOGS</button>
          <button id="hb-home-quote-grabber-copypayload" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#4b5563;color:#fff;">COPY PAYLOAD</button>
        </div>
        <div id="hb-home-quote-grabber-status" style="margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937;">Waiting...</div>
        <div id="hb-home-quote-grabber-logs" style="max-height:220px;overflow:auto;background:#0b1220;border:1px solid #243041;border-radius:8px;padding:6px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-home-quote-grabber-head');
    const toggleBtn = panel.querySelector('#hb-home-quote-grabber-toggle');
    const copyLogsBtn = panel.querySelector('#hb-home-quote-grabber-copylogs');
    const copyPayloadBtn = panel.querySelector('#hb-home-quote-grabber-copypayload');

    toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      toggleBtn.textContent = state.running ? 'STOP' : 'START';
      toggleBtn.style.background = state.running ? '#dc2626' : '#16a34a';
      log(state.running ? 'Resumed' : 'Stopped for this page session');
      setStatus(state.running ? 'Running' : 'Stopped');

      if (state.running) {
        state.triggerSince = 0;
        state.doneThisLoad = false;
        state.flowStartedThisLoad = false;
        state.coverageTriggerSince = 0;
      }
    });

    copyLogsBtn.addEventListener('click', async () => {
      try {
        const text = [...state.logLines].reverse().join('\n');
        await navigator.clipboard.writeText(text);
        log('Logs copied');
      } catch {
        log('Copy logs failed');
      }
    });

    copyPayloadBtn.addEventListener('click', async () => {
      try {
        const value = localStorage.getItem(KEYS.payload) || '';
        await navigator.clipboard.writeText(value);
        log('Payload copied');
      } catch {
        log('Copy payload failed');
      }
    });

    makeDraggable(panel, head);

    state.ui = {
      panel,
      status: panel.querySelector('#hb-home-quote-grabber-status'),
      logs: panel.querySelector('#hb-home-quote-grabber-logs')
    };
  }

  function setStatus(text) {
    if (state.ui?.status) state.ui.status.textContent = text;
  }

  function log(message) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;
    state.logLines.unshift(line);
    if (state.logLines.length > CFG.maxLogLines) state.logLines.length = CFG.maxLogLines;
    console.log(`[${SCRIPT_NAME}] ${message}`);

    if (state.ui?.logs) {
      state.ui.logs.innerHTML = state.logLines
        .map((x) => `<div style="margin-bottom:4px;">${escapeHtml(x)}</div>`)
        .join('');
    }
  }

  function makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });

    function onMove(e) {
      if (!dragging) return;
      const left = startLeft + (e.clientX - startX);
      const top = startTop + (e.clientY - startY);
      panel.style.left = `${Math.max(0, left)}px`;
      panel.style.top = `${Math.max(0, top)}px`;
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      savePanelPos({
        left: panel.style.left,
        top: panel.style.top
      });
    }
  }

  function savePanelPos(pos) {
    try {
      localStorage.setItem(KEYS.panelPos, JSON.stringify(pos));
    } catch {}
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.panelPos) || 'null');
    } catch {
      return null;
    }
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
