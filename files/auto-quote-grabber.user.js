// ==UserScript==
// @name         GWPC Auto Quote Extractor
// @namespace    homebot.auto-quote-grabber
// @version      2.9.2
// @description  Shared-payload AUTO gatherer. Uses stronger tab navigation to click Policy Info, Auto Data Prefill, Drivers, Vehicles, PA Coverages, and Quote. Starts from auto/quote_grabber or from the live Quote screen fallback, reads insured names + drivers + vehicles + PA coverages + quote fields, and saves AUTO payload + bundle data without sending.
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/auto-quote-grabber.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/auto-quote-grabber.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_NAME = 'Home Bot: Auto Quote Grabber';
  const VERSION = '2.9';
  const GLOBAL_PAUSE_KEY = 'tm_pc_global_pause_v1';
  const FLOW_STAGE_KEY = 'tm_pc_flow_stage_v1';

  const KEYS = {
    payload: 'tm_pc_auto_quote_grab_payload_v1',
    panelPos: 'tm_pc_auto_quote_grab_panel_pos_v1'
  };



  const CURRENT_JOB_KEY = 'tm_pc_current_job_v1';
  const BUNDLE_KEY = 'tm_pc_webhook_bundle_v1';
  const LEGACY_SHARED_JOB_KEY = 'tm_shared_az_job_v1';

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

    if (!isPlainObject(raw)) return out;

    const az = isPlainObject(raw.az) ? raw.az : {};
    const legacyName = [az['AZ Name'], az['AZ Last']].map(v => normalizeText(v)).filter(Boolean).join(' ').trim();
    const legacyAddress = buildMailingAddress(az['AZ Street Address'], az['AZ City'], az['AZ State'], az['AZ Postal Code']);

    out['AZ ID'] = normalizeText(raw['AZ ID'] || raw.ticketId || raw.masterId || raw.id || az['AZ ID'] || '');
    out['Name'] = normalizeText(raw['Name'] || raw.name || legacyName || '');
    out['Mailing Address'] = normalizeText(raw['Mailing Address'] || raw.mailingAddress || legacyAddress || '');
    out['SubmissionNumber'] = normalizeText(raw['SubmissionNumber'] || raw.submissionNumber || '');
    out['updatedAt'] = normalizeText(raw['updatedAt'] || raw.lastUpdatedAt || raw?.meta?.lastUpdatedAt || raw?.meta?.createdAt || '');
    out['First Name'] = normalizeText(raw['First Name'] || raw.firstName || az['First Name'] || az['AZ Name'] || '');
    out['Last Name'] = normalizeText(raw['Last Name'] || raw.lastName || az['Last Name'] || az['AZ Last'] || '');
    out['Email'] = normalizeText(raw['Email'] || raw.email || az['Email'] || az['AZ Email'] || '');
    out['Phone'] = normalizeText(raw['Phone'] || raw.phone || az['Phone'] || az['AZ Phone'] || '');
    out['DOB'] = normalizeText(raw['DOB'] || raw.dob || az['DOB'] || az['AZ DOB'] || '');
    out['Street Address'] = normalizeText(raw['Street Address'] || raw.streetAddress || az['Street Address'] || az['AZ Street Address'] || '');
    out['City'] = normalizeText(raw['City'] || raw.city || az['City'] || az['AZ City'] || '');
    out['State'] = normalizeText(raw['State'] || raw.state || az['State'] || az['AZ State'] || '');
    out['Zip'] = normalizeText(raw['Zip'] || raw.zip || raw.zipCode || az['Zip'] || az['AZ Postal Code'] || '');
    return out;
  }

  function readCurrentJob() {
    let raw = safeJsonParse(localStorage.getItem(CURRENT_JOB_KEY), null);
    let job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    try { raw = GM_getValue(CURRENT_JOB_KEY, null); } catch {}
    job = normalizeCurrentJob(raw);
    if (job['AZ ID']) return job;

    try { raw = GM_getValue(LEGACY_SHARED_JOB_KEY, null); } catch {}
    job = normalizeCurrentJob(raw);
    return job;
  }

  function writeCurrentJob(job) {
    const next = normalizeCurrentJob(job);
    next.updatedAt = next.updatedAt || new Date().toISOString();
    try { localStorage.setItem(CURRENT_JOB_KEY, JSON.stringify(next, null, 2)); } catch {}
    try { GM_setValue(CURRENT_JOB_KEY, next); } catch {}
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
      'updatedAt': new Date().toISOString(),
      'First Name': incoming['First Name'] || current['First Name'] || '',
      'Last Name': incoming['Last Name'] || current['Last Name'] || '',
      'Email': incoming['Email'] || current['Email'] || '',
      'Phone': incoming['Phone'] || current['Phone'] || '',
      'DOB': incoming['DOB'] || current['DOB'] || '',
      'Street Address': incoming['Street Address'] || current['Street Address'] || '',
      'City': incoming['City'] || current['City'] || '',
      'State': incoming['State'] || current['State'] || '',
      'Zip': incoming['Zip'] || current['Zip'] || ''
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

  function normalizeCompare(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[\.,#]/g, '')
      .replace(/street/g, 'st')
      .replace(/avenue/g, 'ave')
      .replace(/road/g, 'rd')
      .replace(/drive/g, 'dr')
      .replace(/circle/g, 'cir')
      .replace(/lane/g, 'ln')
      .replace(/place/g, 'pl')
      .replace(/court/g, 'ct')
      .replace(/south/g, 's')
      .replace(/north/g, 'n')
      .replace(/east/g, 'e')
      .replace(/west/g, 'w')
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
    return !!aa && !!bb && (aa === bb || aa.includes(bb) || bb.includes(aa));
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


  const CFG = {
    tickMs: 1000,
    triggerDelayMs: 5000,
    waitTimeoutMs: 20000,
    waitPollMs: 250,
    afterClickMs: 800,
    maxLogLines: 24,
    maxTabAttempts: 3
  };

  const IDS = {
    policyInfoTab: 'SubmissionWizard-LOBWizardStepGroup-PolicyInfo',
    autoDataPrefillTab: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PriorCarrier_Ext',
    driversTab: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-PADrivers',
    vehiclesTab: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-PAVehicles',
    paCoveragesTab: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-PersonalAuto',
    quoteTab: 'SubmissionWizard-ViewQuote',

    policyInfoNameWrap: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Name_Input',
    policyInfoNameValue: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-AccountInfoInputSet-Name',
    secondaryWrap: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-SecondaryNamedInsuredInputSet-ChangeSecondaryNamedInsuredLabel_Input',
    secondaryValue: 'SubmissionWizard-LOBWizardStepGroup-SubmissionWizard_PolicyInfoScreen-SubmissionWizard_PolicyInfoDV-SecondaryNamedInsuredInputSet-ChangeSecondaryNamedInsuredLabel',

    driversRoot: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-PADriversScreen-PADriversPanelSet-DriversListDetailPanel-DriversLV',
    vehiclesRoot: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-PAVehiclesScreen-PAVehiclesPanelSet-VehiclesListDetailPanel-VehiclesLV',
    paCoveragesRootPrefix: 'SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-PersonalAutoScreen-PersonalAutoScreen_Coverages_ExtPanelSet-PersonalAuto_AllVehicleCoveragesDV'
  };

  const SEL = {
    quoteTitle: '.gw-TitleBar--title, .gw-TitleBar--Title',
    premium: 'div#SubmissionWizard-SubmissionWizard_QuoteScreen-Quote_SummaryDV-QuoteSummaryInputSet-ChangeInCost > div.gw-vw--value.gw-align-h--left > div.gw-value-readonly-wrapper',
    accountName: '#SubmissionWizard-JobWizardInfoBar-AccountName > .gw-label.gw-infoValue'
  };

  const state = {
    running: true,
    busy: false,
    doneThisLoad: false,
    triggerSince: 0,
    lastWaitReason: '',
    lastStatus: '',
    logLines: [],
    ui: null
  };

  init();

  function init() {
    buildUI();
    log('Script started');
    log('Shared payload gatherer loaded');
    log('Tabs enabled: Policy Info -> Auto Data Prefill -> Drivers -> Vehicles -> PA Coverages -> Quote');
    setStatus('Waiting for trigger');
    setInterval(tick, CFG.tickMs);
    tick();
  }

  function isGloballyPaused() {
    try { return localStorage.getItem(GLOBAL_PAUSE_KEY) === '1'; } catch { return false; }
  }

  function tick() {
    if (!state.running || state.busy || state.doneThisLoad) return;
    if (isGloballyPaused()) {
      setStatus('Paused by shared selector');
      return;
    }

    const currentJob = readCurrentJob();
    if (!currentJob['AZ ID']) {
      state.triggerSince = 0;
      setWaiting('Waiting for tm_pc_current_job_v1 / AZ ID');
      return;
    }

    const trigger = getAutoQuoteTriggerState(currentJob);
    if (!trigger.ready) {
      state.triggerSince = 0;
      setWaiting(trigger.waitingReason);
      return;
    }

    if (!state.triggerSince) {
      state.triggerSince = Date.now();
      log(trigger.logReason);
      setStatus('Trigger found, waiting 5 seconds');
      return;
    }

    const elapsed = Date.now() - state.triggerSince;
    if (elapsed < CFG.triggerDelayMs) {
      setStatus(`Trigger stable... ${Math.ceil((CFG.triggerDelayMs - elapsed) / 1000)}s`);
      return;
    }

    const stableTrigger = getAutoQuoteTriggerState(currentJob);
    if (!stableTrigger.ready) {
      state.triggerSince = 0;
      log('Trigger reset');
      setStatus('Trigger reset');
      return;
    }

    if (!stableTrigger.stageReady) {
      writeFlowStage('auto', 'quote_grabber', currentJob['AZ ID']);
      log('Recovered auto/quote_grabber stage from Quote page');
    }

    state.busy = true;
    runGrab()
      .catch((err) => {
        log(`Failed: ${err?.message || err}`);
        setStatus('Failed');
        state.running = false;
        log('Stopped after fatal AUTO grab failure. Press START to retry.');
      })
      .finally(() => {
        state.busy = false;
      });
  }

  async function runGrab() {
    log('Starting grab flow');

    const submissionNumberEarly = extractSubmissionNumber();
    if (submissionNumberEarly) log(`Submission Number early: ${submissionNumberEarly}`);

    setStatus('Opening Policy Info');
    await goToPolicyInfo();
    await sleep(CFG.afterClickMs);
    const policyInfoData = extractPolicyInfoFields();
    log(`Policy Info read: ${JSON.stringify(policyInfoData)}`);

    setStatus('Opening Auto Data Prefill');
    await goToAutoDataPrefill();
    await sleep(CFG.afterClickMs);
    log('Auto Data Prefill visited');

    setStatus('Opening Drivers');
    await goToDrivers();
    await sleep(CFG.afterClickMs);
    const driversData = extractDriversFields();
    log(`Drivers read: ${JSON.stringify(driversData)}`);

    setStatus('Opening Vehicles');
    await goToVehicles();
    await sleep(CFG.afterClickMs);
    const vehiclesData = extractVehiclesFields();
    log(`Vehicles read: ${JSON.stringify(vehiclesData)}`);

    setStatus('Opening PA Coverages');
    await goToPACoverages();
    await sleep(CFG.afterClickMs);
    const paCoveragesData = extractPACoveragesFields();
    log(`PA Coverages read: ${JSON.stringify(paCoveragesData)}`);

    setStatus('Opening Quote');
    await goToQuote();
    await sleep(CFG.afterClickMs);
    const quoteData = extractQuoteFields(submissionNumberEarly);
    log(`Quote read: ${JSON.stringify(quoteData)}`);

    if (quoteData['Total Policy Premium'] === 'N/A') {
      throw new Error('Total Policy Premium not found');
    }

    if (quoteData['Submission Number (Auto)'] === 'N/A') {
      throw new Error('Submission Number (Auto) not found');
    }

    const driversList = buildDriversList(driversData);
    const vehiclesList = buildVehiclesList(vehiclesData);
    const coveragesList = buildCoveragesList(paCoveragesData);

    const row = {
      'Auto': 'Completed',
      'Total Policy Premium': asRequiredValue(quoteData['Total Policy Premium']),
      'Submission Number (Auto)': asRequiredValue(quoteData['Submission Number (Auto)']),
      'PolicyNumber': '',
      'PrimaryInsuredName': asRequiredValue(policyInfoData['PrimaryInsuredName']),
      'SecondaryInsuredName': asRequiredValue(policyInfoData['SecondaryInsuredName']),
      'Driver1_Name': asRequiredValue(driversData['Driver1_Name']),
      'Driver1_DLLast4': asRequiredValue(driversData['Driver1_DLLast4']),
      'Driver2_Name': asRequiredValue(driversData['Driver2_Name']),
      'Driver2_DLLast4': asRequiredValue(driversData['Driver2_DLLast4']),
      'Driver3_Name': asRequiredValue(driversData['Driver3_Name']),
      'Driver3_DLLast4': asRequiredValue(driversData['Driver3_DLLast4']),
      'Driver4_Name': asRequiredValue(driversData['Driver4_Name']),
      'Driver4_DLLast4': asRequiredValue(driversData['Driver4_DLLast4']),
      'PA_All_Coverages': asRequiredValue(paCoveragesData['PA_All_Coverages']),
      'Quote_TotalCost_Raw': asRequiredValue(quoteData['Quote_TotalCost_Raw']),
      'Vehicle1_UnitNo': asRequiredValue(vehiclesData['Vehicle1_UnitNo']),
      'Vehicle1_Type': asRequiredValue(vehiclesData['Vehicle1_Type']),
      'Vehicle1_ModelYear': asRequiredValue(vehiclesData['Vehicle1_ModelYear']),
      'Vehicle1_Make': asRequiredValue(vehiclesData['Vehicle1_Make']),
      'Vehicle1_Model': asRequiredValue(vehiclesData['Vehicle1_Model']),
      'Vehicle1_VIN': asRequiredValue(vehiclesData['Vehicle1_VIN']),
      'Vehicle2_UnitNo': asRequiredValue(vehiclesData['Vehicle2_UnitNo']),
      'Vehicle2_Type': asRequiredValue(vehiclesData['Vehicle2_Type']),
      'Vehicle2_ModelYear': asRequiredValue(vehiclesData['Vehicle2_ModelYear']),
      'Vehicle2_Make': asRequiredValue(vehiclesData['Vehicle2_Make']),
      'Vehicle2_Model': asRequiredValue(vehiclesData['Vehicle2_Model']),
      'Vehicle2_VIN': asRequiredValue(vehiclesData['Vehicle2_VIN']),
      'Vehicle3_UnitNo': asRequiredValue(vehiclesData['Vehicle3_UnitNo']),
      'Vehicle3_Type': asRequiredValue(vehiclesData['Vehicle3_Type']),
      'Vehicle3_ModelYear': asRequiredValue(vehiclesData['Vehicle3_ModelYear']),
      'Vehicle3_Make': asRequiredValue(vehiclesData['Vehicle3_Make']),
      'Vehicle3_Model': asRequiredValue(vehiclesData['Vehicle3_Model']),
      'Vehicle3_VIN': asRequiredValue(vehiclesData['Vehicle3_VIN']),
      'Vehicle4_UnitNo': asRequiredValue(vehiclesData['Vehicle4_UnitNo']),
      'Vehicle4_Type': asRequiredValue(vehiclesData['Vehicle4_Type']),
      'Vehicle4_ModelYear': asRequiredValue(vehiclesData['Vehicle4_ModelYear']),
      'Vehicle4_Make': asRequiredValue(vehiclesData['Vehicle4_Make']),
      'Vehicle4_Model': asRequiredValue(vehiclesData['Vehicle4_Model']),
      'Vehicle4_VIN': asRequiredValue(vehiclesData['Vehicle4_VIN'])
    };

    const currentJob = readCurrentJob();
    if (!currentJob['AZ ID']) {
      throw new Error('Missing tm_pc_current_job_v1 / AZ ID');
    }

    const autoSubmissionNumber = asRequiredValue(quoteData['Submission Number (Auto)']);
    const autoTotalPolicyPremium = asRequiredValue(quoteData['Total Policy Premium']);
    const autoQuoteTotalRaw = asRequiredValue(quoteData['Quote_TotalCost_Raw']);
    const primaryInsuredName = asRequiredValue(policyInfoData['PrimaryInsuredName']);
    const secondaryInsuredName = asRequiredValue(policyInfoData['SecondaryInsuredName']);
    const paAllCoverages = asRequiredValue(paCoveragesData['PA_All_Coverages']);

    if (currentJob['Name'] && !namesLikelySame(primaryInsuredName, currentJob['Name'])) {
      throw new Error(`Current job Name mismatch | job=${currentJob['Name']} | page=${primaryInsuredName}`);
    }

    const webhookData = {
      'AZ ID': currentJob['AZ ID'],
      auto: 'Yes',
      totalPolicyPremium: autoTotalPolicyPremium,
      submissionNumber: autoSubmissionNumber,
      policyNumber: '',
      primaryInsuredName,
      secondaryInsuredName,
      paAllCoverages,
      quoteTotalCostRaw: autoQuoteTotalRaw,
      drivers: driversList,
      vehicles: vehiclesList,
      coverages: coveragesList
    };

    const payload = {
      script: SCRIPT_NAME,
      version: VERSION,
      event: 'auto_quote_gathered',
      product: 'auto',
      'AZ ID': currentJob['AZ ID'],
      currentJob,
      submissionNumber: autoSubmissionNumber,
      savedAt: new Date().toISOString(),
      page: {
        url: location.href,
        title: document.title
      },
      tabsUsed: {
        policyInfo: true,
        autoDataPrefill: true,
        drivers: true,
        vehicles: true,
        paCoverages: true,
        quote: true
      },

      'Auto': 'Yes',
      'Total Policy Premium': autoTotalPolicyPremium,
      totalPolicyPremium: autoTotalPolicyPremium,
      'Submission Number (Auto)': autoSubmissionNumber,
      submissionNumberAuto: autoSubmissionNumber,
      autoSubmissionNumber,
      submissionNumber: autoSubmissionNumber,
      'PolicyNumber': '',
      policyNumber: '',
      'PrimaryInsuredName': primaryInsuredName,
      primaryInsuredName,
      'SecondaryInsuredName': secondaryInsuredName,
      secondaryInsuredName,
      'PA_All_Coverages': paAllCoverages,
      paAllCoverages,
      allCoverages: paAllCoverages,
      coveragesText: paAllCoverages,
      'Quote_TotalCost_Raw': autoQuoteTotalRaw,
      quoteTotalCostRaw: autoQuoteTotalRaw,
      quoteTotalRaw: autoQuoteTotalRaw,

      'Driver1_Name': asRequiredValue(driversData['Driver1_Name']),
      'Driver1_DLLast4': asRequiredValue(driversData['Driver1_DLLast4']),
      'Driver2_Name': asRequiredValue(driversData['Driver2_Name']),
      'Driver2_DLLast4': asRequiredValue(driversData['Driver2_DLLast4']),
      'Driver3_Name': asRequiredValue(driversData['Driver3_Name']),
      'Driver3_DLLast4': asRequiredValue(driversData['Driver3_DLLast4']),
      'Driver4_Name': asRequiredValue(driversData['Driver4_Name']),
      'Driver4_DLLast4': asRequiredValue(driversData['Driver4_DLLast4']),

      'Vehicle1_UnitNo': asRequiredValue(vehiclesData['Vehicle1_UnitNo']),
      'Vehicle1_Type': asRequiredValue(vehiclesData['Vehicle1_Type']),
      'Vehicle1_ModelYear': asRequiredValue(vehiclesData['Vehicle1_ModelYear']),
      'Vehicle1_Make': asRequiredValue(vehiclesData['Vehicle1_Make']),
      'Vehicle1_Model': asRequiredValue(vehiclesData['Vehicle1_Model']),
      'Vehicle1_VIN': asRequiredValue(vehiclesData['Vehicle1_VIN']),
      'Vehicle2_UnitNo': asRequiredValue(vehiclesData['Vehicle2_UnitNo']),
      'Vehicle2_Type': asRequiredValue(vehiclesData['Vehicle2_Type']),
      'Vehicle2_ModelYear': asRequiredValue(vehiclesData['Vehicle2_ModelYear']),
      'Vehicle2_Make': asRequiredValue(vehiclesData['Vehicle2_Make']),
      'Vehicle2_Model': asRequiredValue(vehiclesData['Vehicle2_Model']),
      'Vehicle2_VIN': asRequiredValue(vehiclesData['Vehicle2_VIN']),
      'Vehicle3_UnitNo': asRequiredValue(vehiclesData['Vehicle3_UnitNo']),
      'Vehicle3_Type': asRequiredValue(vehiclesData['Vehicle3_Type']),
      'Vehicle3_ModelYear': asRequiredValue(vehiclesData['Vehicle3_ModelYear']),
      'Vehicle3_Make': asRequiredValue(vehiclesData['Vehicle3_Make']),
      'Vehicle3_Model': asRequiredValue(vehiclesData['Vehicle3_Model']),
      'Vehicle3_VIN': asRequiredValue(vehiclesData['Vehicle3_VIN']),
      'Vehicle4_UnitNo': asRequiredValue(vehiclesData['Vehicle4_UnitNo']),
      'Vehicle4_Type': asRequiredValue(vehiclesData['Vehicle4_Type']),
      'Vehicle4_ModelYear': asRequiredValue(vehiclesData['Vehicle4_ModelYear']),
      'Vehicle4_Make': asRequiredValue(vehiclesData['Vehicle4_Make']),
      'Vehicle4_Model': asRequiredValue(vehiclesData['Vehicle4_Model']),
      'Vehicle4_VIN': asRequiredValue(vehiclesData['Vehicle4_VIN']),

      drivers: driversList,
      vehicles: vehiclesList,
      coverages: coveragesList,
      data: { ...webhookData },
      quote: {
        submissionNumber: autoSubmissionNumber,
        totalPolicyPremium: autoTotalPolicyPremium,
        totalCostRaw: autoQuoteTotalRaw,
        primaryInsuredName,
        secondaryInsuredName,
        coveragesText: paAllCoverages,
        drivers: driversList,
        vehicles: vehiclesList
      },
      summary: {
        submissionNumber: autoSubmissionNumber,
        totalPolicyPremium: autoTotalPolicyPremium,
        totalCostRaw: autoQuoteTotalRaw,
        primaryInsuredName,
        secondaryInsuredName
      },
      row
    };

    localStorage.setItem(KEYS.payload, JSON.stringify(payload, null, 2));

    const mergeJob = mergeCurrentJob({
      'AZ ID': currentJob['AZ ID'],
      'Name': currentJob['Name'] || primaryInsuredName,
      'Mailing Address': currentJob['Mailing Address'],
      'SubmissionNumber': autoSubmissionNumber || currentJob['SubmissionNumber'],
      'First Name': currentJob['First Name'],
      'Last Name': currentJob['Last Name'],
      'Email': currentJob['Email'],
      'Phone': currentJob['Phone'],
      'DOB': currentJob['DOB'],
      'Street Address': currentJob['Street Address'],
      'City': currentJob['City'],
      'State': currentJob['State'],
      'Zip': currentJob['Zip']
    });
    if (!mergeJob.ok) {
      throw new Error(mergeJob.reason || 'Current job merge failed');
    }

    const bundleSave = saveBundleSection('auto', payload, mergeJob.next || currentJob, {
      submissionNumber: autoSubmissionNumber,
      payloadKey: KEYS.payload
    });
    if (!bundleSave.ok) {
      throw new Error(bundleSave.reason || 'Bundle save failed');
    }

    log(`Payload saved: ${KEYS.payload}`);
    log('Bundle merged: tm_pc_webhook_bundle_v1.auto');
    writeFlowStage('auto', 'handoff', currentJob['AZ ID']);
    setStatus('Grab complete');
    state.doneThisLoad = true;
  }

  function buildDriversList(driversData) {
    return [1, 2, 3, 4].map((slot) => ({
      Name: asRequiredValue(driversData[`Driver${slot}_Name`]),
      DLLast4: asRequiredValue(driversData[`Driver${slot}_DLLast4`])
    }));
  }

  function buildVehiclesList(vehiclesData) {
    return [1, 2, 3, 4].map((slot) => ({
      UnitNo: asRequiredValue(vehiclesData[`Vehicle${slot}_UnitNo`]),
      Type: asRequiredValue(vehiclesData[`Vehicle${slot}_Type`]),
      ModelYear: asRequiredValue(vehiclesData[`Vehicle${slot}_ModelYear`]),
      Make: asRequiredValue(vehiclesData[`Vehicle${slot}_Make`]),
      Model: asRequiredValue(vehiclesData[`Vehicle${slot}_Model`]),
      VIN: asRequiredValue(vehiclesData[`Vehicle${slot}_VIN`])
    }));
  }

  function buildCoveragesList(paCoveragesData) {
    const raw = asRequiredValue(paCoveragesData['PA_All_Coverages']);
    if (!raw || raw === 'N/A') return [];
    return raw
      .split(/\n+/)
      .map((x) => normalizeText(x))
      .filter(Boolean)
      .map((line) => ({ label: line, value: '' }));
  }

  async function goToPolicyInfo() {
    await navigateToTab(
      'Policy Info',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.policyInfoTab)} > div.gw-action--inner`)),
        () => findTabActionByVisibleLabel('Policy Info'),
        () => findActionByText('Policy Info')
      ],
      () => !!findByIdInDocs(IDS.policyInfoNameWrap) || !!findByIdInDocs(IDS.secondaryWrap)
    );
  }

  async function goToAutoDataPrefill() {
    await navigateToTab(
      'Auto Data Prefill',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.autoDataPrefillTab)} > div.gw-action--inner`)),
        () => findTabActionByVisibleLabel('Auto Data Prefill'),
        () => findActionByText('Auto Data Prefill')
      ],
      () => isTitleStartsWith('Auto Data Prefill')
    );
  }

  async function goToDrivers() {
    await navigateToTab(
      'Drivers',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.driversTab)} > div.gw-action--inner`)),
        () => findTabActionByVisibleLabel('Drivers'),
        () => findActionByText('Drivers')
      ],
      () => !!findByIdInDocs(IDS.driversRoot)
    );
  }

  async function goToVehicles() {
    await navigateToTab(
      'Vehicles',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.vehiclesTab)} > div.gw-action--inner`)),
        () => findTabActionByVisibleLabel('Vehicles'),
        () => findActionByText('Vehicles')
      ],
      () => !!findByIdInDocs(IDS.vehiclesRoot)
    );
  }

  async function goToPACoverages() {
    await navigateToTab(
      'PA Coverages',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.paCoveragesTab)} > div.gw-action--inner`)),
        () => findTabActionByVisibleLabel('PA Coverages'),
        () => findActionByText('PA Coverages')
      ],
      () => !!findByIdStartsWithInDocs(IDS.paCoveragesRootPrefix)
    );
  }

  async function goToQuote() {
    await navigateToTab(
      'Quote',
      [
        () => findInDocs((doc) => doc.querySelector(`#${cssEscape(IDS.quoteTab)} > div.gw-action--inner`)),
        () => findTabActionByVisibleLabel('Quote'),
        () => findActionByText('Quote')
      ],
      () => isQuoteReady()
    );
  }

  async function navigateToTab(name, resolvers, readyFn) {
    if (readyFn()) {
      log(`${name} already ready`);
      return;
    }

    for (let attempt = 1; attempt <= CFG.maxTabAttempts; attempt++) {
      const raw = resolveFirst(resolvers);

      if (!raw) {
        log(`${name} tab not found, attempt ${attempt}/${CFG.maxTabAttempts}`);
        await sleep(500);
        continue;
      }

      const target = resolveClickableTab(raw);
      if (!target) {
        log(`${name} tab resolved target is disabled/unclickable (raw=${describeElement(raw)}), attempt ${attempt}/${CFG.maxTabAttempts}`);
        await sleep(500);
        continue;
      }

      const headerBefore = getHeaderText();
      log(`Clicking ${name} ${describeElement(target)} attempt ${attempt}/${CFG.maxTabAttempts}`);
      strongClick(target);

      const ok = await waitFor(readyFn, CFG.waitTimeoutMs, `${name} readiness`);
      if (ok) {
        const headerAfter = getHeaderText();
        if (headerBefore && headerAfter && headerBefore === headerAfter && headerBefore !== name) {
          log(`${name} ready (but header unchanged: "${headerBefore}")`);
        } else {
          log(`${name} ready (header "${headerBefore}" -> "${headerAfter}")`);
        }
        return;
      }

      log(`${name} did not become ready`);
    }

    throw new Error(`Could not open ${name}`);
  }

  function extractPolicyInfoFields() {
    let primary = normalizeText(
      getDisplayValueById(IDS.policyInfoNameValue) ||
      getTextById(IDS.policyInfoNameValue) ||
      getDisplayValueById(IDS.policyInfoNameWrap) ||
      getTextById(IDS.policyInfoNameWrap)
    );

    let secondary = normalizeText(
      getDisplayValueById(IDS.secondaryValue) ||
      getTextById(IDS.secondaryValue) ||
      getDisplayValueById(IDS.secondaryWrap) ||
      getTextById(IDS.secondaryWrap)
    );

    if (!primary) {
      primary = cleanName(readAnySelector(SEL.accountName));
    }

    if (!secondary || secondary === 'Secondary Named Insured') {
      secondary = 'N/A';
    }

    return {
      'PrimaryInsuredName': primary || 'N/A',
      'SecondaryInsuredName': secondary || 'N/A'
    };
  }

  function extractDriversFields() {
    const out = {};
    const root = findByIdInDocs(IDS.driversRoot);
    const rows = [];

    if (root) {
      const candidates = Array.from(root.querySelectorAll('tbody tr')).length
        ? Array.from(root.querySelectorAll('tbody tr'))
        : Array.from(root.querySelectorAll('tr'));

      for (const row of candidates) {
        if (!isVisible(row)) continue;
        if (!row.querySelector('[id$="-Name"], [id$="licensePrivacyLink"]')) continue;
        rows.push(row);
        if (rows.length >= 4) break;
      }
    }

    for (let i = 0; i < 4; i++) {
      const slot = i + 1;
      const row = rows[i];

      if (!row) {
        out[`Driver${slot}_Name`] = 'N/A';
        out[`Driver${slot}_DLLast4`] = 'N/A';
        continue;
      }

      const name = normalizeText(
        readBestValue(row.querySelector('[id$="-Name"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-Name"]'))
      ) || 'N/A';

      const masked = normalizeText(
        readBestValue(row.querySelector('[id$="licensePrivacyLink"]'))
      );

      const last4 = extractLast4Digits(masked) || 'N/A';

      out[`Driver${slot}_Name`] = name;
      out[`Driver${slot}_DLLast4`] = last4;
    }

    return out;
  }

  function extractVehiclesFields() {
    const out = {};
    const root = findByIdInDocs(IDS.vehiclesRoot);
    const rows = [];

    if (root) {
      const candidates = Array.from(root.querySelectorAll('tbody tr')).length
        ? Array.from(root.querySelectorAll('tbody tr'))
        : Array.from(root.querySelectorAll('tr'));

      for (const row of candidates) {
        if (!isVisible(row)) continue;
        if (!row.querySelector('[id$="-VehicleNumber"], [id$="-Type"], [id$="-Year"], [id$="-Make"], [id$="-Model"], [id$="-Vin"]')) continue;
        rows.push(row);
        if (rows.length >= 4) break;
      }
    }

    for (let i = 0; i < 4; i++) {
      const slot = i + 1;
      const row = rows[i];

      if (!row) {
        out[`Vehicle${slot}_UnitNo`] = 'N/A';
        out[`Vehicle${slot}_Type`] = 'N/A';
        out[`Vehicle${slot}_ModelYear`] = 'N/A';
        out[`Vehicle${slot}_Make`] = 'N/A';
        out[`Vehicle${slot}_Model`] = 'N/A';
        out[`Vehicle${slot}_VIN`] = 'N/A';
        continue;
      }

      const unitNo = normalizeText(
        readBestValue(row.querySelector('[id$="-VehicleNumber"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-VehicleNumber"]'))
      ) || 'N/A';

      const type = normalizeText(
        readBestValue(row.querySelector('[id$="-Type"] .gw-label')) ||
        readBestValue(row.querySelector('[id$="-Type"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-Type"]'))
      ) || 'N/A';

      const year = normalizeText(
        readBestValue(row.querySelector('[id$="-Year"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-Year"]'))
      ) || 'N/A';

      const make = normalizeText(
        readBestValue(row.querySelector('[id$="-Make"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-Make"]'))
      ) || 'N/A';

      const model = normalizeText(
        readBestValue(row.querySelector('[id$="-Model"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-Model"]'))
      ) || 'N/A';

      const vin = normalizeText(
        readBestValue(row.querySelector('[id$="-Vin"] .gw-value-readonly-wrapper')) ||
        readBestValue(row.querySelector('[id$="-Vin"]'))
      ) || 'N/A';

      out[`Vehicle${slot}_UnitNo`] = unitNo;
      out[`Vehicle${slot}_Type`] = type;
      out[`Vehicle${slot}_ModelYear`] = year;
      out[`Vehicle${slot}_Make`] = make;
      out[`Vehicle${slot}_Model`] = model;
      out[`Vehicle${slot}_VIN`] = vin;
    }

    return out;
  }

  function extractPACoveragesFields() {
    const out = {
      'PA_All_Coverages': 'N/A'
    };

    const root = findByIdStartsWithInDocs(IDS.paCoveragesRootPrefix);
    if (!root) return out;

    const groups = Array.from(root.querySelectorAll('.gw-InputGroupWidget[aria-label]'));
    const lines = [];

    for (const group of groups) {
      const name = normalizeText(
        readBestValue(group.querySelector('.gw-InputGroup--header--label')) ||
        group.getAttribute('aria-label') ||
        ''
      );

      if (!name) continue;

      const value = extractCoverageValue(group, name);
      if (!value) continue;

      lines.push(`${name} / ${value}`);
    }

    if (lines.length) {
      out['PA_All_Coverages'] = lines.join('\n');
    }

    return out;
  }

  function extractCoverageValue(group, coverageName) {
    const values = [];
    const seen = new Set();

    const add = (raw) => {
      const value = normalizeText(raw);
      if (!value) return;
      if (value === coverageName) return;
      if (seen.has(value)) return;
      seen.add(value);
      values.push(value);
    };

    group.querySelectorAll('.gw-RangeValue .gw-label, .gw-value-readonly-wrapper, .gw-vw--value, .gw-ChoiceValueWidget .gw-label, .gw-ValueWidget .gw-label').forEach((el) => {
      add(readBestValue(el));
    });

    group.querySelectorAll('select').forEach((sel) => {
      const opt = sel.options?.[sel.selectedIndex];
      if (opt) add(opt.textContent || '');
    });

    if (!values.length) {
      const leafs = collectLeafTexts(group);
      for (const text of leafs) add(text);
    }

    return values.join(' | ');
  }

  function collectLeafTexts(root) {
    const out = [];
    if (!root || !root.ownerDocument) return out;

    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (!node.children.length) {
        const text = normalizeText(node.textContent || '');
        if (text) out.push(text);
      }
      node = walker.nextNode();
    }

    return Array.from(new Set(out));
  }

  function extractQuoteFields(submissionNumberEarly) {
    const premium = normalizeText(readAnySelector(SEL.premium)) || 'N/A';
    const submission = normalizeText(extractSubmissionNumber() || submissionNumberEarly || '') || 'N/A';

    return {
      'Auto': 'Completed',
      'Total Policy Premium': premium,
      'Submission Number (Auto)': submission,
      'Quote_TotalCost_Raw': premium
    };
  }

  function isQuoteReady() {
    return hasVisibleTitleExact('Quote') && !!normalizeText(readAnySelector(SEL.premium));
  }

  function getHeaderText() {
    for (const doc of getAccessibleDocs()) {
      const titles = queryAllSafe('.gw-TitleBar--title, .gw-TitleBar--Title', doc);
      for (const el of titles) {
        if (!isVisible(el)) continue;
        const text = normalizeText(el.textContent || '');
        if (text) return text;
      }
    }
    return '';
  }

  function isTitleStartsWith(text) {
    const wanted = normalizeText(text);
    for (const doc of getAccessibleDocs()) {
      const titles = queryAllSafe(SEL.quoteTitle, doc);
      for (const el of titles) {
        if (!isVisible(el)) continue;
        const got = normalizeText(el.textContent || '');
        if (got.startsWith(wanted)) return true;
      }
    }
    return false;
  }

  function extractSubmissionNumber() {
    for (const doc of getAccessibleDocs()) {
      const heads = queryAllSafe('.gw-Wizard--Title, [role="heading"], h1, h2', doc);
      for (const el of heads) {
        const text = normalizeText(el.textContent || '');
        const m = text.match(/Submission\s+(\d{6,})/i);
        if (m) return m[1];
      }
    }
    return '';
  }

  function hasVisibleExactLabel(text) {
    for (const doc of getAccessibleDocs()) {
      const labels = queryAllSafe('.gw-label', doc);
      for (const el of labels) {
        if (!isVisible(el)) continue;
        if (normalizeText(el.textContent || '') === text) return true;
      }
    }
    return false;
  }

  function hasVisibleTitleExact(text) {
    for (const doc of getAccessibleDocs()) {
      const titles = queryAllSafe(SEL.quoteTitle, doc);
      for (const el of titles) {
        if (!isVisible(el)) continue;
        if (normalizeText(el.textContent || '') === text) return true;
      }
    }
    return false;
  }

  function getAutoQuoteTriggerState(currentJob) {
    const stageReady = matchesStage('auto', 'quote_grabber', currentJob['AZ ID']);
    const quotedAutoReady = hasVisibleExactLabel('Submission (Quoted)') && hasVisibleExactLabel('Personal Auto');
    const quoteHeaderReady = hasVisibleTitleExact('Quote');
    const quotePageReady = quotedAutoReady && quoteHeaderReady;

    if (stageReady && quotedAutoReady) {
      return {
        ready: true,
        stageReady: true,
        logReason: quotePageReady ? 'Trigger found (stage + Quote page)' : 'Trigger found (stage)',
        waitingReason: ''
      };
    }

    if (quotePageReady) {
      return {
        ready: true,
        stageReady: false,
        logReason: 'Trigger found (Quote page fallback)',
        waitingReason: ''
      };
    }

    if (quotedAutoReady) {
      return {
        ready: false,
        stageReady,
        logReason: '',
        waitingReason: 'Waiting for AUTO Quote header'
      };
    }

    return {
      ready: false,
      stageReady,
      logReason: '',
      waitingReason: 'Waiting for: Submission (Quoted) + Personal Auto'
    };
  }

  function findTabActionByExactText(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="tab"], div[role="menuitem"], div[role="button"]');

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        if (normalizeText(el.textContent || '') === wanted) return el;
      }

      return null;
    });
  }

  function findTabActionByVisibleLabel(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const labels = doc.querySelectorAll('.gw-label, .gw-label-min');

      for (const label of labels) {
        if (!isVisible(label)) continue;

        const got = normalizeText(
          label.getAttribute('aria-label') ||
          label.textContent ||
          ''
        );

        if (got !== wanted) continue;

        const actionOuter = label.closest('.gw-action--outer');
        if (actionOuter) {
          const inner = actionOuter.querySelector('.gw-action--inner');
          if (inner && isVisible(inner)) return inner;
        }

        const actionInner = label.closest('.gw-action--inner');
        if (actionInner && isVisible(actionInner)) return actionInner;

        const buttonish = label.closest('[role="button"], [role="tab"], [role="menuitem"], a, button, [tabindex]');
        if (buttonish && isVisible(buttonish)) return buttonish;
      }

      return null;
    });
  }

  function findActionByText(text) {
    return findInDocs((doc) => {
      const wanted = normalizeText(text);
      const candidates = doc.querySelectorAll('div.gw-action--inner, div[role="tab"], div[role="menuitem"], div[role="button"], button, a');

      for (const el of candidates) {
        if (!isVisible(el)) continue;
        if (normalizeText(el.textContent || '').includes(wanted)) return el;
      }

      return null;
    });
  }

  function readAnySelector(selector) {
    for (const doc of getAccessibleDocs()) {
      const el = querySafe(selector, doc);
      const text = normalizeText(readBestValue(el));
      if (text) return text;
    }
    return '';
  }

  function getDisplayValueById(id) {
    const el = findByIdInDocs(id);
    if (!el) return '';

    const candidates = [
      el.matches?.('.gw-value-readonly-wrapper, .gw-vw--value, .gw-value, .gw-label') ? el : null,
      querySafe('.gw-value-readonly-wrapper', el),
      querySafe('.gw-vw--value', el),
      querySafe('.gw-value', el),
      querySafe('.gw-label', el),
      querySafe('input, textarea, select', el)
    ].filter(Boolean);

    for (const node of candidates) {
      if ('value' in node && normalizeText(node.value || '')) return normalizeText(node.value || '');
      const text = normalizeText(node.innerText || node.textContent || '');
      if (text) return text;
    }

    return '';
  }

  function getTextById(id) {
    const el = findByIdInDocs(id);
    return el ? normalizeText(el.innerText || el.textContent || '') : '';
  }

  function findByIdInDocs(id) {
    return findInDocs((doc) => doc.getElementById(id));
  }

  function findByIdStartsWithInDocs(prefix) {
    return findInDocs((doc) => {
      const hits = queryAllSafe(`[id^="${cssEscapeForAttr(prefix)}"]`, doc);
      return hits.length ? hits[0] : null;
    });
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

  function querySafe(selector, root) {
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  }

  function queryAllSafe(selector, root) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  }

  function safeClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {}

    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const type of events) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        }));
      } catch {}
    }

    try { el.click(); } catch {}
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

  function isProbablyClickable(el) {
    if (!el || !(el instanceof Element) || !isVisible(el)) return false;
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

  function upgradeToClickable(el) {
    if (!el) return null;
    if (el.matches?.('.gw-action--inner') && el.getAttribute('aria-disabled') !== 'true' && isVisible(el)) return el;
    if (el.querySelector) {
      const inner = el.querySelector('.gw-action--inner[aria-disabled="false"]');
      if (inner && isVisible(inner)) return inner;
    }
    let cur = el;
    for (let i = 0; i < 12 && cur; i++, cur = cur.parentElement) {
      if (cur.matches?.('.gw-action--inner') && cur.getAttribute('aria-disabled') !== 'true' && isVisible(cur)) return cur;
    }
    return isVisible(el) ? el : null;
  }

  function resolveClickableTab(el) {
    if (!el) return null;
    const upgraded = upgradeToClickable(el);
    if (upgraded && upgraded.getAttribute?.('aria-disabled') !== 'true') return upgraded;
    const owner = getClickableOwner(el);
    if (owner && owner.getAttribute?.('aria-disabled') !== 'true') return owner;
    return null;
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

  function readBestValue(el) {
    if (!el) return '';

    if ('value' in el && normalizeText(el.value || '')) {
      return normalizeText(el.value || '');
    }

    const candidates = [
      el.matches?.('.gw-value-readonly-wrapper, .gw-vw--value, .gw-value, .gw-label') ? el : null,
      querySafe('.gw-value-readonly-wrapper', el),
      querySafe('.gw-vw--value', el),
      querySafe('.gw-value', el),
      querySafe('.gw-label', el),
      querySafe('input, textarea, select', el)
    ].filter(Boolean);

    for (const node of candidates) {
      if ('value' in node && normalizeText(node.value || '')) return normalizeText(node.value || '');
      const text = normalizeText(node.innerText || node.textContent || '');
      if (text) return text;
    }

    return normalizeText(el.innerText || el.textContent || '');
  }

  function extractLast4Digits(value) {
    const digits = String(value || '').replace(/\D+/g, '');
    return digits.length >= 4 ? digits.slice(-4) : '';
  }

  function cleanName(value) {
    let s = normalizeText(value);
    if (!s) return '';
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    s = s.replace(/change\s*to:?\s*/gi, '');
    s = s.replace(/np\s*new\s*person/gi, '');
    s = s.replace(/ec\s*existing\s*contact/gi, '');
    s = s.replace(/new\s*person/gi, '');
    s = s.replace(/existing\s*contact/gi, '');
    s = s.replace(/\bNP\b/gi, '');
    s = s.replace(/\bEC\b/gi, '');
    s = s.replace(/[:\-–—]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (/click on validate|choose|select|contact|change\s*to/i.test(s)) return '';
    return s;
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function asRequiredValue(value) {
    const text = typeof value === 'string' ? value.trim() : String(value || '').trim();
    return text || 'N/A';
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    try {
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (el.closest('[aria-hidden="true"]')) return false;
      return true;
    } catch {
      return false;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function cssEscapeForAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function setWaiting(msg) {
    if (state.lastWaitReason === msg) return;
    state.lastWaitReason = msg;
    log(msg);
    setStatus(msg);
  }

  function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'hb-auto-quote-grabber-panel-v22';
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
      <div id="hb-auto-quote-grabber-head-v22" style="padding:8px 10px;cursor:move;border-bottom:1px solid #374151;background:#0f172a;border-radius:12px 12px 0 0;">
        <div style="font-weight:700;">${SCRIPT_NAME}</div>
        <div style="opacity:.8;">V${VERSION}</div>
      </div>
      <div style="padding:8px 10px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
          <button id="hb-auto-quote-grabber-toggle-v22" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#dc2626;color:#fff;">STOP</button>
          <button id="hb-auto-quote-grabber-copylogs-v22" style="border:0;border-radius:8px;padding:7px 8px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff;">COPY LOGS</button>
        </div>
        <div id="hb-auto-quote-grabber-status-v22" style="margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#1f2937;">Waiting...</div>
        <div id="hb-auto-quote-grabber-logs-v22" style="max-height:240px;overflow:auto;background:#0b1220;border:1px solid #243041;border-radius:8px;padding:6px;"></div>
      </div>
    `;

    document.documentElement.appendChild(panel);

    const head = panel.querySelector('#hb-auto-quote-grabber-head-v22');
    const toggleBtn = panel.querySelector('#hb-auto-quote-grabber-toggle-v22');
    const copyLogsBtn = panel.querySelector('#hb-auto-quote-grabber-copylogs-v22');

    toggleBtn.addEventListener('click', () => {
      state.running = !state.running;
      toggleBtn.textContent = state.running ? 'STOP' : 'START';
      toggleBtn.style.background = state.running ? '#dc2626' : '#16a34a';
      log(state.running ? 'Resumed' : 'Stopped for this page session');
      setStatus(state.running ? 'Running' : 'Stopped');
      state.triggerSince = 0;
      state.doneThisLoad = false;
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

    makeDraggable(panel, head);

    state.ui = {
      status: panel.querySelector('#hb-auto-quote-grabber-status-v22'),
      logs: panel.querySelector('#hb-auto-quote-grabber-logs-v22')
    };
  }

  function setStatus(text) {
    if (state.lastStatus === text) return;
    state.lastStatus = text;
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
        .map((x) => `<div style="margin-bottom:4px;white-space:pre-wrap;">${escapeHtml(x)}</div>`)
        .join('');
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function loadPanelPos() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.panelPos) || 'null');
    } catch {
      return null;
    }
  }

  function savePanelPos(pos) {
    try {
      localStorage.setItem(KEYS.panelPos, JSON.stringify(pos));
    } catch {}
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
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

      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(4, startLeft + (e.clientX - startX));
      const top = Math.max(4, startTop + (e.clientY - startY));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      savePanelPos({
        left: panel.style.left,
        top: panel.style.top
      });
    });
  }
})();
