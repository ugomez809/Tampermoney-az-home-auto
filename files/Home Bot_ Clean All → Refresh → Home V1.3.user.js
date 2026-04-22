// ==UserScript==
// @name         Home Bot: Clean All → Refresh → Home V1.3
// @namespace    homebot.clean.refresh.home
// @version      1.3
// @description  APEX Account page in front 2s -> open 1 GWPC cleaner tab in front -> wait 3s there -> GWPC clears keys and closes -> APEX clears keys -> refresh -> click Home. No UI.
// @match        https://farmersagent.lightning.force.com/*
// @match        https://policycenter.farmersinsurance.com/*
// @run-at       document-start
// @noframes
// @grant        GM_openInTab
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Clean%20All%20%E2%86%92%20Refresh%20%E2%86%92%20Home%20V1.3.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20Clean%20All%20%E2%86%92%20Refresh%20%E2%86%92%20Home%20V1.3.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const CFG = {
    apexHoldMs: 2000,
    apexTickMs: 300,
    apexBlockMs: 30000,
    gwpcWaitMs: 3000,
    gwpcBlockMs: 10000,
    gwpcTabTotalWaitMs: 5200,
    refreshCooldownMs: 20000,
    postRefreshHomeTimeoutMs: 30000,
    postRefreshHomePollMs: 250,
    doneCooldownMs: 12000
  };

  const KEYS = {
    VISIBLE_SINCE: 'hb_carh_visible_since_v13',
    LAST_TRIGGER: 'hb_carh_last_trigger_v13',
    BLOCK_UNTIL: 'hb_carh_block_until_v13',
    PHASE: 'hb_carh_phase_v13',
    PENDING_HOME: 'hb_carh_pending_home_v13',
    DONE_UNTIL: 'hb_carh_done_until_v13'
  };

  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;

  const isAPEX = location.host === 'farmersagent.lightning.force.com';
  const isGWPC = location.host === 'policycenter.farmersinsurance.com';

  let storagePatched = false;
  let apexBusy = false;
  let homeBusy = false;

  function log(msg) {
    console.log(`[HB Clean All Refresh Home] ${msg}`);
  }

  function now() {
    return Date.now();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function safeJsonParse(raw, fallback = null) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function getSessionJson(key) {
    try { return safeJsonParse(sessionStorage.getItem(key), null); } catch { return null; }
  }

  function setSessionJson(key, value) {
    try { nativeSetItem.call(sessionStorage, key, JSON.stringify(value)); } catch {}
  }

  function getSessionNumber(key) {
    try {
      const n = Number(sessionStorage.getItem(key) || 0);
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  function setSessionNumber(key, value) {
    try { nativeSetItem.call(sessionStorage, key, String(Number(value) || 0)); } catch {}
  }

  function removeSessionKey(key) {
    try { nativeRemoveItem.call(sessionStorage, key); } catch {}
  }

  function getPhase() {
    try { return sessionStorage.getItem(KEYS.PHASE) || 'idle'; } catch { return 'idle'; }
  }

  function setPhase(value) {
    try { nativeSetItem.call(sessionStorage, KEYS.PHASE, String(value || 'idle')); } catch {}
  }

  function clearFlowState() {
    removeSessionKey(KEYS.VISIBLE_SINCE);
    removeSessionKey(KEYS.PENDING_HOME);
    removeSessionKey(KEYS.DONE_UNTIL);
    setPhase('idle');
    clearBlock();
  }

  function keyShouldClear(key) {
    return /^(tm_|aqb_)/i.test(String(key || ''));
  }

  function blockActive() {
    return getSessionNumber(KEYS.BLOCK_UNTIL) > now();
  }

  function setBlock(ms) {
    setSessionNumber(KEYS.BLOCK_UNTIL, now() + ms);
  }

  function clearBlock() {
    setSessionNumber(KEYS.BLOCK_UNTIL, 0);
  }

  function installStoragePatch() {
    if (storagePatched) return;
    storagePatched = true;

    Storage.prototype.setItem = function (key, value) {
      if (blockActive() && keyShouldClear(key)) return;
      return nativeSetItem.apply(this, arguments);
    };
  }

  function clearCurrentOriginKeys() {
    let removedLocal = 0;
    let removedSession = 0;

    const localKeys = [];
    const sessionKeys = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (keyShouldClear(k)) localKeys.push(k);
      }
    } catch {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (keyShouldClear(k)) sessionKeys.push(k);
      }
    } catch {}

    for (const k of localKeys) {
      try { nativeRemoveItem.call(localStorage, k); removedLocal++; } catch {}
    }

    for (const k of sessionKeys) {
      try { nativeRemoveItem.call(sessionStorage, k); removedSession++; } catch {}
    }

    log(`Cleared ${location.host} | local=${removedLocal} session=${removedSession}`);
  }

  function getVisibleSince() {
    const data = getSessionJson(KEYS.VISIBLE_SINCE);
    return data && Number.isFinite(data.at) ? data.at : 0;
  }

  function setVisibleSince(ts) {
    setSessionJson(KEYS.VISIBLE_SINCE, { at: ts });
  }

  function clearVisibleSince() {
    removeSessionKey(KEYS.VISIBLE_SINCE);
  }

  function getLastTrigger() {
    return getSessionJson(KEYS.LAST_TRIGGER);
  }

  function setLastTrigger(url, id) {
    setSessionJson(KEYS.LAST_TRIGGER, {
      at: now(),
      url: url || '',
      id: id || ''
    });
  }

  function coolingDown(url) {
    const last = getLastTrigger();
    if (!last || !last.at) return false;
    if ((last.url || '') !== (url || '')) return false;
    return (now() - Number(last.at)) < CFG.refreshCooldownMs;
  }

  function getPendingHome() {
    return getSessionJson(KEYS.PENDING_HOME);
  }

  function setPendingHome(data) {
    setSessionJson(KEYS.PENDING_HOME, data);
  }

  function setDoneCooldown() {
    setSessionNumber(KEYS.DONE_UNTIL, now() + CFG.doneCooldownMs);
  }

  function doneCooling() {
    return getSessionNumber(KEYS.DONE_UNTIL) > now();
  }

  function isFrontTab() {
    try {
      return document.visibilityState === 'visible' && document.hasFocus();
    } catch {
      return false;
    }
  }

  function isApexAccountPage() {
    return /\/lightning\/r\/Account\/[^/]+\/view(?:[?#]|$)/i.test(location.href);
  }

  function getAllWindows(root = window.top, out = []) {
    out.push(root);
    let frames = [];
    try { frames = Array.from(root.frames || []); } catch {}
    for (const fr of frames) {
      try {
        if (!fr || fr === root) continue;
        void fr.document;
        getAllWindows(fr, out);
      } catch {}
    }
    return out;
  }

  function getAllDocuments() {
    const docs = [];
    for (const w of getAllWindows()) {
      try { if (w.document) docs.push(w.document); } catch {}
    }
    return docs;
  }

  function queryAllDeep(selector, root = document, out = []) {
    try { out.push(...root.querySelectorAll(selector)); } catch {}

    let all = [];
    try { all = Array.from(root.querySelectorAll('*')); } catch {}

    for (const el of all) {
      try {
        if (el.shadowRoot) queryAllDeep(selector, el.shadowRoot, out);
      } catch {}
    }

    return out;
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      return !!(el.offsetParent || el.getClientRects().length) && r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }

  function findHomeLink() {
    const docs = getAllDocuments();

    const selectors = [
      'a[title="Home"]',
      'a[href="/lightning/page/home"]',
      'a[href*="/lightning/page/home"]',
      'a.slds-context-bar__label-action'
    ];

    for (const doc of docs) {
      for (const sel of selectors) {
        const nodes = queryAllDeep(sel, doc);
        for (const el of nodes) {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const title = (el.getAttribute('title') || '').trim();
          const href = (el.getAttribute('href') || '').trim();

          if (!isVisible(el)) continue;
          if (title === 'Home') return el;
          if (text === 'Home' && href.includes('/lightning/page/home')) return el;
          if (href === '/lightning/page/home') return el;
        }
      }
    }

    for (const doc of docs) {
      const anchors = queryAllDeep('a', doc);
      for (const a of anchors) {
        const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
        const title = (a.getAttribute('title') || '').trim();
        const href = (a.getAttribute('href') || '').trim();

        if (!isVisible(a)) continue;
        if (text === 'Home' || title === 'Home' || href.includes('/lightning/page/home')) {
          return a;
        }
      }
    }

    return null;
  }

  function realClick(el) {
    if (!el) return false;

    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}

    const evs = [
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }),
      new MouseEvent('mousedown',   { bubbles: true, cancelable: true, composed: true }),
      new MouseEvent('pointerup',   { bubbles: true, cancelable: true, composed: true }),
      new MouseEvent('mouseup',     { bubbles: true, cancelable: true, composed: true }),
      new MouseEvent('click',       { bubbles: true, cancelable: true, composed: true })
    ];

    try {
      for (const ev of evs) el.dispatchEvent(ev);
      if (typeof el.click === 'function') el.click();
      return true;
    } catch {
      return false;
    }
  }

  function makeReqId() {
    return `hbcrh_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function openGwpcCleanerTab(reqId) {
    const url = `https://policycenter.farmersinsurance.com/pc/PolicyCenter.do?hb_auto_clean=1&hb_req=${encodeURIComponent(reqId)}&_=${Date.now()}`;
    try {
      return GM_openInTab(url, {
        active: true,
        insert: true,
        setParent: true
      });
    } catch (err) {
      log(`GM_openInTab failed: ${err && err.message ? err.message : err}`);
      return null;
    }
  }

  async function waitAndCloseGwpcTab(handle) {
    await sleep(CFG.gwpcTabTotalWaitMs);
    try { handle && handle.close && handle.close(); } catch {}
  }

  async function runPendingHome() {
    if (!isAPEX || homeBusy) return;

    const pending = getPendingHome();
    if (!pending) return;

    if (Number(pending.until || 0) <= now()) {
      clearFlowState();
      return;
    }

    homeBusy = true;

    try {
      while (true) {
        const cur = getPendingHome();
        if (!cur) return;

        if (Number(cur.until || 0) <= now()) {
          clearFlowState();
          return;
        }

        if (blockActive()) {
          clearCurrentOriginKeys();
        }

        if (!isFrontTab()) {
          await sleep(CFG.postRefreshHomePollMs);
          continue;
        }

        const home = findHomeLink();
        if (home && realClick(home)) {
          log('Home clicked');
          setDoneCooldown();
          setPhase('done');
          removeSessionKey(KEYS.PENDING_HOME);
          clearBlock();
          return;
        }

        await sleep(CFG.postRefreshHomePollMs);
      }
    } finally {
      homeBusy = false;
    }
  }

  async function runApexFlow() {
    if (!isAPEX || apexBusy) return;
    apexBusy = true;

    try {
      const reqId = makeReqId();
      const handle = openGwpcCleanerTab(reqId);

      await waitAndCloseGwpcTab(handle);

      setBlock(CFG.apexBlockMs);
      clearCurrentOriginKeys();

      setPendingHome({
        id: reqId,
        until: now() + CFG.postRefreshHomeTimeoutMs
      });

      setPhase('waiting_home');
      setLastTrigger(location.href, reqId);

      log('Refreshing APEX');
      location.reload();
    } finally {
      apexBusy = false;
    }
  }

  function startApexLoop() {
    if (!isAPEX) return;

    setInterval(() => {
      const phase = getPhase();

      runPendingHome().catch(err => {
        log(`Pending Home error: ${err && err.message ? err.message : err}`);
      });

      if (phase === 'waiting_home') return;

      if (phase === 'done') {
        if (!isApexAccountPage() || !doneCooling()) {
          clearFlowState();
        }
        return;
      }

      if (!isApexAccountPage()) {
        clearVisibleSince();
        return;
      }

      if (!isFrontTab()) {
        clearVisibleSince();
        return;
      }

      if (coolingDown(location.href)) return;

      let since = getVisibleSince();
      if (!since) {
        since = now();
        setVisibleSince(since);
        return;
      }

      if ((now() - since) < CFG.apexHoldMs) return;

      clearVisibleSince();
      setPhase('cleaning');
      runApexFlow().catch(err => {
        log(`APEX flow error: ${err && err.message ? err.message : err}`);
        clearFlowState();
      });
    }, CFG.apexTickMs);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') clearVisibleSince();
    });

    window.addEventListener('blur', () => {
      clearVisibleSince();
    });
  }

  async function startGwpcCleanerMode() {
    if (!isGWPC) return false;

    const url = new URL(location.href);
    const isCleaner = url.searchParams.get('hb_auto_clean') === '1';
    if (!isCleaner) return false;

    setBlock(CFG.gwpcBlockMs);

    await sleep(CFG.gwpcWaitMs);
    clearCurrentOriginKeys();

    const loop = setInterval(() => {
      if (!blockActive()) {
        clearInterval(loop);
        return;
      }
      clearCurrentOriginKeys();
    }, 500);

    const closeSelf = () => {
      try { window.open('', '_self'); } catch {}
      try { window.close(); } catch {}
      try { location.replace('about:blank'); } catch {}
      setTimeout(() => {
        try { window.close(); } catch {}
      }, 120);
    };

    setTimeout(closeSelf, 600);
    return true;
  }

  installStoragePatch();

  if (blockActive()) {
    clearCurrentOriginKeys();
  }

  startGwpcCleanerMode().then((handled) => {
    if (handled) return;

    startApexLoop();

    if (isAPEX) {
      runPendingHome().catch(err => {
        log(`Startup Home error: ${err && err.message ? err.message : err}`);
      });
    }
  });
})();