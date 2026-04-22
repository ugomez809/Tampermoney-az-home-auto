// ==UserScript==
// @name         AZ + APEX + GWPC Storage Tools (Export Payloads + Clear + Close) V1.4
// @namespace    homebot.az.apex.gwpc.storage.tools
// @version      1.4.0
// @description  Tiny standalone helper: exports tracked AZ + APEX + GWPC payload/storage to TXT, mirrors key payloads into shared cache, clears tracked data, then closes the tab.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.lightning.force.com/*
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// ==/UserScript==

(function () {
  'use strict';

  const UI_ID = 'tm-az-apex-gwpc-storage-tools-v14';
  const TOAST_ID = 'tm-az-apex-gwpc-storage-tools-toast-v14';

  const TRACKED_PREFIXES = [
    'tm_',
    'aqb_',
    'hb_'
  ];

  const LIVE_KEYS = {
    azPayloadCandidates: [
      'tm_az_home_auto_payload_v1',
      'tm_az_stage_runner_payload_v1',
      'tm_az_payload_v1',
      'tm_az_current_job_v1',
      'tm_pc_current_job_v1'
    ],
    apexPayload: 'tm_apex_home_bot_payload_v1',
    apexReady: 'tm_apex_home_bot_ready_v1',
    apexActiveRow: 'tm_apex_home_bot_active_row_v1',
    gwpcHomePayload: 'tm_pc_home_quote_grab_payload_v1',
    gwpcAutoPayload: 'tm_pc_auto_quote_grab_payload_v1',
    sharedCurrentJob: 'tm_pc_current_job_v1'
  };

  const CACHE_KEYS = {
    azPayload: 'tm_shared_cache_az_payload_v1',
    apexPayload: 'tm_shared_cache_apex_payload_v1',
    apexReady: 'tm_shared_cache_apex_ready_v1',
    apexActiveRow: 'tm_shared_cache_apex_active_row_v1',
    gwpcHomePayload: 'tm_shared_cache_gwpc_home_quote_payload_v1',
    gwpcAutoPayload: 'tm_shared_cache_gwpc_auto_quote_payload_v1'
  };

  const EXACT_TRACKED_KEYS = new Set([
    LIVE_KEYS.apexPayload,
    LIVE_KEYS.apexReady,
    LIVE_KEYS.apexActiveRow,
    LIVE_KEYS.gwpcHomePayload,
    LIVE_KEYS.gwpcAutoPayload,
    LIVE_KEYS.sharedCurrentJob,
    ...LIVE_KEYS.azPayloadCandidates
  ]);

  const CFG = {
    syncMs: 1500,
    closeDelayMs: 450
  };

  const state = {
    lastSeen: Object.create(null),
    closeStarted: false
  };

  if (document.getElementById(UI_ID)) return;

  function isAzHost() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(location.hostname);
  }

  function isApexHost() {
    return location.hostname === 'farmersagent.lightning.force.com';
  }

  function isGwpcHost() {
    return /^policycenter(?:-2|-3)?\.farmersinsurance\.com$/i.test(location.hostname);
  }

  function safeNowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '_',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join('');
  }

  function toast(msg, ms = 2200) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      Object.assign(el.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        zIndex: '2147483647',
        background: 'rgba(20,20,20,0.95)',
        color: '#fff',
        fontSize: '12px',
        lineHeight: '1.35',
        padding: '8px 10px',
        borderRadius: '8px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
        maxWidth: '360px',
        opacity: '0',
        transition: 'opacity 140ms ease',
        pointerEvents: 'none',
        fontFamily: 'Arial, sans-serif'
      });
      document.body.appendChild(el);
    }

    el.textContent = msg;
    el.style.opacity = '1';

    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, ms);
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function prettyValue(raw) {
    if (raw == null) return 'null';

    if (typeof raw !== 'string') {
      try {
        return JSON.stringify(raw, null, 2);
      } catch {
        return String(raw);
      }
    }

    const parsed = safeJsonParse(raw);
    if (parsed !== null) {
      try {
        return JSON.stringify(parsed, null, 2);
      } catch {
        return raw;
      }
    }

    return String(raw);
  }

  function getAllTrackedKeys(storageObj) {
    const found = new Set();

    try {
      for (let i = 0; i < storageObj.length; i++) {
        const k = storageObj.key(i);
        if (!k) continue;

        if (isTrackedKey(k)) {
          found.add(k);
        }
      }
    } catch (err) {
      console.error('[AZ+APEX+GWPC Storage Tools] Failed reading keys:', err);
    }

    return [...found].sort((a, b) => a.localeCompare(b));
  }

  function collectStorageSnapshot(storageName, storageObj) {
    const keys = getAllTrackedKeys(storageObj);
    const items = [];

    for (const key of keys) {
      let value = null;
      try {
        value = storageObj.getItem(key);
      } catch (err) {
        value = `[[ERROR READING VALUE: ${err && err.message ? err.message : String(err)}]]`;
      }

      items.push({
        key,
        value,
        pretty: prettyValue(value)
      });
    }

    return {
      storageName,
      count: items.length,
      items
    };
  }

  function buildStorageSection(snapshot) {
    const lines = [];
    lines.push(`=== ${snapshot.storageName.toUpperCase()} TRACKED KEYS (${snapshot.count}) ===`);
    lines.push('');

    if (!snapshot.items.length) {
      lines.push('(none)');
      lines.push('');
      return lines.join('\n');
    }

    for (const item of snapshot.items) {
      lines.push(`KEY: ${item.key}`);
      lines.push('VALUE:');
      lines.push(item.pretty);
      lines.push('');
      lines.push('----------------------------------------');
      lines.push('');
    }

    return lines.join('\n');
  }

  function buildCurrentOriginSpecialSection() {
    const lines = [];
    lines.push('=== CURRENT ORIGIN SPECIAL KEYS CHECK ===');
    lines.push('');

    const specialKeys = [
      ...LIVE_KEYS.azPayloadCandidates,
      LIVE_KEYS.apexPayload,
      LIVE_KEYS.apexReady,
      LIVE_KEYS.apexActiveRow,
      LIVE_KEYS.gwpcHomePayload,
      LIVE_KEYS.gwpcAutoPayload,
      LIVE_KEYS.sharedCurrentJob
    ];

    const seen = new Set();

    for (const key of specialKeys) {
      if (!key || seen.has(key)) continue;
      seen.add(key);

      let localVal = null;
      let sessionVal = null;

      try { localVal = localStorage.getItem(key); } catch {}
      try { sessionVal = sessionStorage.getItem(key); } catch {}

      const localPresent = localVal !== null;
      const sessionPresent = sessionVal !== null;

      lines.push(`KEY: ${key}`);
      lines.push(`- localStorage present: ${localPresent ? 'YES' : 'NO'}`);
      if (localPresent) {
        lines.push('- localStorage value:');
        lines.push(prettyValue(localVal));
      }
      lines.push(`- sessionStorage present: ${sessionPresent ? 'YES' : 'NO'}`);
      if (sessionPresent) {
        lines.push('- sessionStorage value:');
        lines.push(prettyValue(sessionVal));
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function getCachedRecord(cacheKey) {
    try {
      return GM_getValue(cacheKey, null);
    } catch {
      return null;
    }
  }

  function setCachedRecord(cacheKey, sourceKey, rawValue) {
    const payload = {
      cacheKey,
      sourceKey,
      sourceHost: location.host,
      sourceOrigin: location.origin,
      sourceUrl: location.href,
      savedAt: new Date().toISOString(),
      valueRaw: rawValue
    };

    try {
      GM_setValue(cacheKey, payload);
    } catch (err) {
      console.error('[AZ+APEX+GWPC Storage Tools] Failed writing shared cache:', err);
    }
  }

  function clearCachedRecord(cacheKey) {
    try {
      GM_deleteValue(cacheKey);
    } catch {}
  }

  function listAllGmKeysSafe() {
    try {
      const keys = GM_listValues();
      return Array.isArray(keys) ? keys : [];
    } catch {
      return [];
    }
  }

  function isTrackedKey(key) {
    if (!key) return false;
    if (TRACKED_PREFIXES.some(prefix => key.startsWith(prefix))) return true;
    return EXACT_TRACKED_KEYS.has(key);
  }

  function readFromSource(sourceName, key) {
    try {
      if (sourceName === 'localStorage') return localStorage.getItem(key);
      if (sourceName === 'sessionStorage') return sessionStorage.getItem(key);
    } catch {}
    return null;
  }

  function syncOneCache(cacheKey, sourceKey, sources) {
    let rawValue = null;

    for (const sourceName of sources) {
      rawValue = readFromSource(sourceName, sourceKey);
      if (rawValue !== null) break;
    }

    if (rawValue === null) return;

    const lastKey = `${cacheKey}__lastRaw`;
    if (state.lastSeen[lastKey] === rawValue) return;

    state.lastSeen[lastKey] = rawValue;
    setCachedRecord(cacheKey, sourceKey, rawValue);
  }

  function syncCacheFromCandidates(cacheKey, candidateKeys, sources) {
    for (const key of candidateKeys) {
      for (const sourceName of sources) {
        const rawValue = readFromSource(sourceName, key);
        if (rawValue === null) continue;

        const lastKey = `${cacheKey}__lastRaw`;
        const lastSourceKey = `${cacheKey}__lastSourceKey`;

        if (state.lastSeen[lastKey] === rawValue && state.lastSeen[lastSourceKey] === key) {
          return;
        }

        state.lastSeen[lastKey] = rawValue;
        state.lastSeen[lastSourceKey] = key;
        setCachedRecord(cacheKey, key, rawValue);
        return;
      }
    }
  }

  function syncSharedCaches() {
    if (isAzHost()) {
      syncCacheFromCandidates(CACHE_KEYS.azPayload, LIVE_KEYS.azPayloadCandidates, ['localStorage', 'sessionStorage']);
    }

    if (isApexHost()) {
      syncOneCache(CACHE_KEYS.apexPayload, LIVE_KEYS.apexPayload, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.apexReady, LIVE_KEYS.apexReady, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.apexActiveRow, LIVE_KEYS.apexActiveRow, ['localStorage', 'sessionStorage']);
    }

    if (isGwpcHost()) {
      syncOneCache(CACHE_KEYS.gwpcHomePayload, LIVE_KEYS.gwpcHomePayload, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.gwpcAutoPayload, LIVE_KEYS.gwpcAutoPayload, ['localStorage', 'sessionStorage']);
    }
  }

  function buildCachedSection(title, record) {
    const lines = [];
    lines.push(`=== ${title} ===`);
    lines.push('');

    if (!record || record.valueRaw == null) {
      lines.push('(not cached yet)');
      lines.push('');
      return lines.join('\n');
    }

    lines.push(`SOURCE KEY: ${record.sourceKey || ''}`);
    lines.push(`SOURCE HOST: ${record.sourceHost || ''}`);
    lines.push(`SOURCE ORIGIN: ${record.sourceOrigin || ''}`);
    lines.push(`SOURCE URL: ${record.sourceUrl || ''}`);
    lines.push(`CACHED AT: ${record.savedAt || ''}`);
    lines.push('');
    lines.push('VALUE:');
    lines.push(prettyValue(record.valueRaw));
    lines.push('');
    return lines.join('\n');
  }

  function exportTxt() {
    try {
      syncSharedCaches();

      const localSnap = collectStorageSnapshot('localStorage', localStorage);
      const sessionSnap = collectStorageSnapshot('sessionStorage', sessionStorage);

      const totalTracked = localSnap.count + sessionSnap.count;

      const azPayloadCache = getCachedRecord(CACHE_KEYS.azPayload);
      const apexPayloadCache = getCachedRecord(CACHE_KEYS.apexPayload);
      const apexReadyCache = getCachedRecord(CACHE_KEYS.apexReady);
      const apexActiveRowCache = getCachedRecord(CACHE_KEYS.apexActiveRow);
      const gwpcHomePayloadCache = getCachedRecord(CACHE_KEYS.gwpcHomePayload);
      const gwpcAutoPayloadCache = getCachedRecord(CACHE_KEYS.gwpcAutoPayload);

      const parts = [];
      parts.push('AZ + APEX + GWPC STORAGE EXPORT');
      parts.push('');
      parts.push(`URL: ${location.href}`);
      parts.push(`HOST: ${location.host}`);
      parts.push(`ORIGIN: ${location.origin}`);
      parts.push(`EXPORTED AT: ${new Date().toISOString()}`);
      parts.push('NOTE: Browser storage is origin-specific. Current-origin tracked keys are exported below. Mirrored payloads are also exported from shared cache when available.');
      parts.push('TIP: Open AZ once, APEX once, and GWPC once after installing this script so all mirrored payload caches get captured.');
      parts.push(`TOTAL CURRENT-ORIGIN TRACKED KEYS FOUND: ${totalTracked}`);
      parts.push('');
      parts.push(buildCurrentOriginSpecialSection());
      parts.push('');
      parts.push(buildStorageSection(localSnap));
      parts.push('');
      parts.push(buildStorageSection(sessionSnap));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED AZ PAYLOAD', azPayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED APEX PAYLOAD', apexPayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED APEX READY', apexReadyCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED APEX ACTIVE ROW', apexActiveRowCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED GWPC HOME QUOTE PAYLOAD', gwpcHomePayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED GWPC AUTO QUOTE PAYLOAD', gwpcAutoPayloadCache));
      parts.push('');

      const txt = parts.join('\n');
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const fileName = `az-apex-gwpc-storage-export_${location.host.replace(/[^\w.-]+/g, '_')}_${safeNowStamp()}.txt`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);

      const haveAz = !!(azPayloadCache && azPayloadCache.valueRaw != null);
      const haveApex = !!(apexPayloadCache && apexPayloadCache.valueRaw != null);
      const haveHome = !!(gwpcHomePayloadCache && gwpcHomePayloadCache.valueRaw != null);
      const haveAuto = !!(gwpcAutoPayloadCache && gwpcAutoPayloadCache.valueRaw != null);

      toast(`Exported. AZ: ${haveAz ? 'YES' : 'NO'} | APEX: ${haveApex ? 'YES' : 'NO'} | HOME: ${haveHome ? 'YES' : 'NO'} | AUTO: ${haveAuto ? 'YES' : 'NO'}`);
    } catch (err) {
      console.error('[AZ+APEX+GWPC Storage Tools] Export failed:', err);
      toast('Export failed');
    }
  }

  function closeCurrentTabSoon() {
    if (state.closeStarted) return;
    state.closeStarted = true;

    setTimeout(() => {
      try { window.open('', '_self'); } catch {}
      try { window.close(); } catch {}

      setTimeout(() => {
        if (document.visibilityState === 'hidden' || window.closed) return;

        try { window.opener = null; } catch {}
        try { window.open('', '_self'); } catch {}
        try { window.close(); } catch {}
      }, 80);

      setTimeout(() => {
        if (document.visibilityState === 'hidden' || window.closed) return;

        try { location.replace('about:blank'); } catch {}
        setTimeout(() => {
          try { window.open('', '_self'); } catch {}
          try { window.close(); } catch {}
        }, 60);
      }, 220);
    }, CFG.closeDelayMs);
  }

  function clearTrackedKeysAndCaches() {
    const localKeys = getAllTrackedKeys(localStorage);
    const sessionKeys = getAllTrackedKeys(sessionStorage);
    const gmTrackedKeys = listAllGmKeysSafe().filter(isTrackedKey);

    const ok = window.confirm(
      `Clear tracked AZ / APEX / GWPC data on this site, clear mirrored caches, then close this tab?\n\nCurrent origin:\n${location.origin}`
    );
    if (!ok) return;

    let cleared = 0;

    for (const key of localKeys) {
      try {
        localStorage.removeItem(key);
        cleared++;
      } catch (err) {
        console.error('[AZ+APEX+GWPC Storage Tools] Failed clearing localStorage key:', key, err);
      }
    }

    for (const key of sessionKeys) {
      try {
        sessionStorage.removeItem(key);
        cleared++;
      } catch (err) {
        console.error('[AZ+APEX+GWPC Storage Tools] Failed clearing sessionStorage key:', key, err);
      }
    }

    for (const key of gmTrackedKeys) {
      try {
        GM_deleteValue(key);
        cleared++;
      } catch (err) {
        console.error('[AZ+APEX+GWPC Storage Tools] Failed clearing GM key:', key, err);
      }
    }

    clearCachedRecord(CACHE_KEYS.azPayload);
    clearCachedRecord(CACHE_KEYS.apexPayload);
    clearCachedRecord(CACHE_KEYS.apexReady);
    clearCachedRecord(CACHE_KEYS.apexActiveRow);
    clearCachedRecord(CACHE_KEYS.gwpcHomePayload);
    clearCachedRecord(CACHE_KEYS.gwpcAutoPayload);

    delete state.lastSeen[`${CACHE_KEYS.azPayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.azPayload}__lastSourceKey`];
    delete state.lastSeen[`${CACHE_KEYS.apexPayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.apexReady}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.apexActiveRow}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.gwpcHomePayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.gwpcAutoPayload}__lastRaw`];

    toast(`Cleared ${cleared} tracked key${cleared === 1 ? '' : 's'} (local/session/GM) + mirrored caches. Closing tab...`, 1800);
    closeCurrentTabSoon();
  }

  function makeButton(label, titleText, bg, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = titleText;

    Object.assign(btn.style, {
      width: '72px',
      height: '26px',
      padding: '0 6px',
      border: '1px solid rgba(0,0,0,0.18)',
      borderRadius: '8px',
      background: bg,
      color: '#fff',
      fontSize: '11px',
      fontWeight: '700',
      lineHeight: '1',
      cursor: 'pointer',
      boxShadow: '0 3px 10px rgba(0,0,0,0.18)',
      fontFamily: 'Arial, sans-serif'
    });

    btn.addEventListener('mouseenter', () => {
      btn.style.filter = 'brightness(1.06)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.filter = 'none';
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    return btn;
  }

  function mountUI() {
    if (!document.body || document.getElementById(UI_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = UI_ID;

    Object.assign(wrap.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      pointerEvents: 'auto'
    });

    const exportBtn = makeButton(
      'ALL TXT',
      'Export tracked current-origin keys plus mirrored AZ + APEX + GWPC payloads',
      '#1f7a3d',
      exportTxt
    );

    const clearBtn = makeButton(
      'CLR+CLOSE',
      'Clear tracked current-origin data and mirrored caches, then close this tab',
      '#b33a3a',
      clearTrackedKeysAndCaches
    );

    wrap.appendChild(exportBtn);
    wrap.appendChild(clearBtn);
    document.body.appendChild(wrap);
  }

  function boot() {
    if (document.body) {
      mountUI();
    } else {
      const t = setInterval(() => {
        if (document.body) {
          clearInterval(t);
          mountUI();
        }
      }, 100);
    }

    syncSharedCaches();
    setInterval(syncSharedCaches, CFG.syncMs);
  }

  boot();
})();
