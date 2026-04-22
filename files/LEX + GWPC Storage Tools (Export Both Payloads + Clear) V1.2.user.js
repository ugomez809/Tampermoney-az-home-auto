// ==UserScript==
// @name         LEX + GWPC Storage Tools (Export Both Payloads + Clear) V1.2
// @namespace    homebot.lex.gwpc.storage.tools
// @version      1.2.0
// @description  Tiny standalone helper: exports current tm_lex_* storage plus mirrored payloads (LEX sheet-reader + GWPC home quote + GWPC auto quote) to TXT, and clears tm_lex_* + mirrored caches.
// @match        https://farmersagent.lightning.force.com/*
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==

(function () {
  'use strict';

  const UI_ID = 'tm-lex-gwpc-storage-tools-v12';
  const TOAST_ID = 'tm-lex-gwpc-storage-tools-toast-v12';

  const LEX_PREFIX = 'tm_lex_';

  const LIVE_KEYS = {
    lexPayload: 'tm_lex_home_bot_sheet_reader_payload_v1',
    lexReady: 'tm_lex_home_bot_sheet_reader_ready_v1',
    lexActiveRow: 'tm_lex_home_bot_sheet_reader_active_row_v1',
    gwpcHomePayload: 'tm_pc_home_quote_grab_payload_v1',
    gwpcAutoPayload: 'tm_pc_auto_quote_grab_payload_v1'
  };

  const CACHE_KEYS = {
    lexPayload: 'tm_shared_cache_lex_sheet_reader_payload_v1',
    lexReady: 'tm_shared_cache_lex_sheet_reader_ready_v1',
    lexActiveRow: 'tm_shared_cache_lex_sheet_reader_active_row_v1',
    gwpcHomePayload: 'tm_shared_cache_gwpc_home_quote_payload_v1',
    gwpcAutoPayload: 'tm_shared_cache_gwpc_auto_quote_payload_v1'
  };

  const CFG = {
    syncMs: 1500
  };

  const state = {
    lastSeen: Object.create(null)
  };

  if (document.getElementById(UI_ID)) return;

  function isLexHost() {
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
        maxWidth: '340px',
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

  function getAllLexPrefixedKeys(storageObj) {
    const keys = [];
    try {
      for (let i = 0; i < storageObj.length; i++) {
        const k = storageObj.key(i);
        if (k && k.startsWith(LEX_PREFIX)) keys.push(k);
      }
    } catch (err) {
      console.error('[LEX+GWPC Storage Tools] Failed reading keys:', err);
    }
    return keys.sort((a, b) => a.localeCompare(b));
  }

  function collectStorageSnapshot(storageName, storageObj) {
    const keys = getAllLexPrefixedKeys(storageObj);
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
    lines.push(`=== ${snapshot.storageName.toUpperCase()} tm_lex_* (${snapshot.count}) ===`);
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
      LIVE_KEYS.lexPayload,
      LIVE_KEYS.lexReady,
      LIVE_KEYS.lexActiveRow,
      LIVE_KEYS.gwpcHomePayload,
      LIVE_KEYS.gwpcAutoPayload
    ];

    for (const key of specialKeys) {
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
      console.error('[LEX+GWPC Storage Tools] Failed writing shared cache:', err);
    }
  }

  function clearCachedRecord(cacheKey) {
    try {
      GM_deleteValue(cacheKey);
    } catch {}
  }

  function syncOneCache(cacheKey, sourceKey, sources) {
    let rawValue = null;

    for (const sourceName of sources) {
      try {
        if (sourceName === 'localStorage') {
          rawValue = localStorage.getItem(sourceKey);
        } else if (sourceName === 'sessionStorage') {
          rawValue = sessionStorage.getItem(sourceKey);
        }
      } catch {}

      if (rawValue !== null) break;
    }

    if (rawValue === null) return;

    const lastKey = `${cacheKey}__lastRaw`;
    if (state.lastSeen[lastKey] === rawValue) return;

    state.lastSeen[lastKey] = rawValue;
    setCachedRecord(cacheKey, sourceKey, rawValue);
  }

  function syncSharedCaches() {
    if (isLexHost()) {
      syncOneCache(CACHE_KEYS.lexPayload, LIVE_KEYS.lexPayload, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.lexReady, LIVE_KEYS.lexReady, ['localStorage', 'sessionStorage']);
      syncOneCache(CACHE_KEYS.lexActiveRow, LIVE_KEYS.lexActiveRow, ['localStorage', 'sessionStorage']);
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

      const totalLex = localSnap.count + sessionSnap.count;

      const lexPayloadCache = getCachedRecord(CACHE_KEYS.lexPayload);
      const lexReadyCache = getCachedRecord(CACHE_KEYS.lexReady);
      const lexActiveRowCache = getCachedRecord(CACHE_KEYS.lexActiveRow);
      const gwpcHomePayloadCache = getCachedRecord(CACHE_KEYS.gwpcHomePayload);
      const gwpcAutoPayloadCache = getCachedRecord(CACHE_KEYS.gwpcAutoPayload);

      const parts = [];
      parts.push('LEX + GWPC STORAGE EXPORT');
      parts.push('');
      parts.push(`URL: ${location.href}`);
      parts.push(`HOST: ${location.host}`);
      parts.push(`ORIGIN: ${location.origin}`);
      parts.push(`EXPORTED AT: ${new Date().toISOString()}`);
      parts.push('NOTE: Browser storage is origin-specific. Live tm_lex_* keys are exported from the current site. Mirrored payloads below are also exported from shared cache when available.');
      parts.push('TIP: Open LEX once and GWPC once after installing this script so LEX + GWPC payload caches get captured.');
      parts.push(`TOTAL CURRENT-ORIGIN tm_lex_* KEYS FOUND: ${totalLex}`);
      parts.push('');
      parts.push(buildCurrentOriginSpecialSection());
      parts.push('');
      parts.push(buildStorageSection(localSnap));
      parts.push('');
      parts.push(buildStorageSection(sessionSnap));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED LEX SHEET READER PAYLOAD', lexPayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED LEX SHEET READER READY', lexReadyCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED LEX SHEET READER ACTIVE ROW', lexActiveRowCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED GWPC HOME QUOTE PAYLOAD', gwpcHomePayloadCache));
      parts.push('');
      parts.push(buildCachedSection('MIRRORED GWPC AUTO QUOTE PAYLOAD', gwpcAutoPayloadCache));
      parts.push('');

      const txt = parts.join('\n');
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const fileName = `lex-gwpc-storage-export_${location.host.replace(/[^\w.-]+/g, '_')}_${safeNowStamp()}.txt`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);

      const haveLex = !!(lexPayloadCache && lexPayloadCache.valueRaw != null);
      const haveHome = !!(gwpcHomePayloadCache && gwpcHomePayloadCache.valueRaw != null);
      const haveAuto = !!(gwpcAutoPayloadCache && gwpcAutoPayloadCache.valueRaw != null);

      toast(`Exported. LEX: ${haveLex ? 'YES' : 'NO'} | HOME: ${haveHome ? 'YES' : 'NO'} | AUTO: ${haveAuto ? 'YES' : 'NO'}`);
    } catch (err) {
      console.error('[LEX+GWPC Storage Tools] Export failed:', err);
      toast('Export failed');
    }
  }

  function clearLexKeysAndCaches() {
    const localKeys = getAllLexPrefixedKeys(localStorage);
    const sessionKeys = getAllLexPrefixedKeys(sessionStorage);
    const ok = window.confirm(
      `Clear current tm_lex_* keys on this site and clear the mirrored export caches?\n\nCurrent origin:\n${location.origin}`
    );
    if (!ok) return;

    let cleared = 0;

    for (const key of localKeys) {
      try {
        localStorage.removeItem(key);
        cleared++;
      } catch (err) {
        console.error('[LEX+GWPC Storage Tools] Failed clearing localStorage key:', key, err);
      }
    }

    for (const key of sessionKeys) {
      try {
        sessionStorage.removeItem(key);
        cleared++;
      } catch (err) {
        console.error('[LEX+GWPC Storage Tools] Failed clearing sessionStorage key:', key, err);
      }
    }

    clearCachedRecord(CACHE_KEYS.lexPayload);
    clearCachedRecord(CACHE_KEYS.lexReady);
    clearCachedRecord(CACHE_KEYS.lexActiveRow);
    clearCachedRecord(CACHE_KEYS.gwpcHomePayload);
    clearCachedRecord(CACHE_KEYS.gwpcAutoPayload);

    delete state.lastSeen[`${CACHE_KEYS.lexPayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.lexReady}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.lexActiveRow}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.gwpcHomePayload}__lastRaw`];
    delete state.lastSeen[`${CACHE_KEYS.gwpcAutoPayload}__lastRaw`];

    toast(`Cleared ${cleared} tm_lex_* key${cleared === 1 ? '' : 's'} + mirrored caches`);
  }

  function makeButton(label, titleText, bg, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = titleText;

    Object.assign(btn.style, {
      width: '66px',
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
      'BOTH TXT',
      'Export current tm_lex_* plus mirrored LEX + GWPC home + GWPC auto payloads',
      '#1f7a3d',
      exportTxt
    );

    const clearBtn = makeButton(
      'CLR',
      'Clear tm_lex_* keys and mirrored caches',
      '#b33a3a',
      clearLexKeysAndCaches
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