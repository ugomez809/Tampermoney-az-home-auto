// ==UserScript==
// @name         Home Bot: UI Dock Organizer V1.3
// @namespace    home.bot.ui.dock.organizer
// @version      1.3
// @description  Organizes floating UIs safely inside the viewport. Biggest panel anchors bottom-right, others stack to the left within the anchor height, then continue upward on the right. Includes the organizer's own panel in the dock.
// @author       OpenAI
// @match        https://policycenter.farmersinsurance.com/*
// @match        https://policycenter-2.farmersinsurance.com/*
// @match        https://policycenter-3.farmersinsurance.com/*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20UI%20Dock%20Organizer%20V1.3.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/Home%20Bot_%20UI%20Dock%20Organizer%20V1.3.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  try { window.__HB_UI_DOCK_ORGANIZER_CLEANUP__?.(); } catch {}

  const SCRIPT_NAME = 'Home Bot: UI Dock Organizer V1.3';
  const VERSION = '1.3';

  const CFG = {
    tickMs: 900,
    rescanMs: 2200,

    sideGap: 12,
    rightGap: 12,
    bottomGap: 12,
    topGap: 12,
    itemGap: 8,

    minZIndex: 900000,
    maxWidthRatio: 0.82,
    maxHeightRatio: 0.90,
    maxAreaRatio: 0.40,

    maxLogs: 12,
    uiZ: 2147483647,
    posKey: 'tm_ui_dock_organizer_panel_pos_v13',
    logsOpenKey: 'tm_ui_dock_organizer_logs_open_v13'
  };

  const UI = {
    panelId: 'hb-ui-dock-organizer-panel-v13',
    headId: 'hb-ui-dock-organizer-head-v13',
    statusId: 'hb-ui-dock-organizer-status-v13',
    countId: 'hb-ui-dock-organizer-count-v13',
    toggleId: 'hb-ui-dock-organizer-toggle-v13',
    rescanId: 'hb-ui-dock-organizer-rescan-v13',
    logsBtnId: 'hb-ui-dock-organizer-logs-btn-v13',
    logsWrapId: 'hb-ui-dock-organizer-logs-wrap-v13',
    logsId: 'hb-ui-dock-organizer-logs-v13',
    styleId: 'hb-ui-dock-organizer-style-v13'
  };

  const state = {
    running: true,
    logs: [],
    registry: new Map(), // el -> { order }
    orderSeed: 1,
    tickTimer: null,
    mo: null,
    drag: null,
    lastRescanAt: 0,
    lastDockedCount: -1
  };

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function cleanup() {
    try { state.mo?.disconnect(); } catch {}
    try { clearInterval(state.tickTimer); } catch {}
    try { window.removeEventListener('resize', onResize, true); } catch {}
    try { window.removeEventListener('mousemove', onDragMove, true); } catch {}
    try { window.removeEventListener('mouseup', onDragEnd, true); } catch {}
    try { document.getElementById(UI.panelId)?.remove(); } catch {}
    try { document.getElementById(UI.styleId)?.remove(); } catch {}
  }

  window.__HB_UI_DOCK_ORGANIZER_CLEANUP__ = cleanup;

  init();

  function init() {
    injectStyle();
    buildUI();
    bindUI();
    startObserver();

    window.addEventListener('resize', onResize, true);

    log('Organizer loaded');
    log('Viewport clamp enabled');
    log('Organizer panel included in dock');

    fullScanAndArrange();
    state.tickTimer = setInterval(tick, CFG.tickMs);
  }

  function tick() {
    if (!state.running) return;

    const now = Date.now();
    if (now - state.lastRescanAt >= CFG.rescanMs) {
      fullScanAndArrange();
    } else {
      arrangeDock();
    }
  }

  function onResize() {
    if (!state.running) return;
    setTimeout(() => {
      if (!state.running) return;
      fullScanAndArrange();
    }, 80);
  }

  function startObserver() {
    const root = document.documentElement || document.body;
    if (!root) return;

    let queued = false;

    state.mo = new MutationObserver((mutations) => {
      if (!state.running) return;

      let shouldQueue = false;

      for (const m of mutations) {
        const targetEl = m.target instanceof Element ? m.target : null;
        if (targetEl && targetEl.closest(`#${UI.panelId}`)) continue;

        let allAddedInsideSelf = true;
        for (const n of m.addedNodes || []) {
          if (!(n instanceof Element) || !n.closest?.(`#${UI.panelId}`)) {
            allAddedInsideSelf = false;
            break;
          }
        }

        let allRemovedInsideSelf = true;
        for (const n of m.removedNodes || []) {
          if (!(n instanceof Element)) {
            allRemovedInsideSelf = false;
            break;
          }
        }

        if (!allAddedInsideSelf || !allRemovedInsideSelf) {
          shouldQueue = true;
          break;
        }
      }

      if (!shouldQueue || queued) return;
      queued = true;

      setTimeout(() => {
        queued = false;
        if (!state.running) return;
        fullScanAndArrange();
      }, 120);
    });

    state.mo.observe(root, {
      childList: true,
      subtree: true
    });
  }

  function fullScanAndArrange() {
    state.lastRescanAt = Date.now();
    scanCandidates();
    arrangeDock();
  }

  function scanCandidates() {
    const seen = new Set();
    const nodes = getTopLevelNodes();

    for (const el of nodes) {
      if (!isDockCandidate(el)) continue;
      seen.add(el);

      if (!state.registry.has(el)) {
        state.registry.set(el, { order: state.orderSeed++ });
      }
    }

    for (const el of Array.from(state.registry.keys())) {
      if (!el || !el.isConnected || !seen.has(el) || !isDockCandidate(el)) {
        state.registry.delete(el);
      }
    }

    updateUI();
  }

  function getTopLevelNodes() {
    const set = new Set();

    try {
      for (const el of Array.from(document.body?.children || [])) set.add(el);
    } catch {}

    try {
      for (const el of Array.from(document.documentElement?.children || [])) {
        if (el !== document.body && el !== document.head) set.add(el);
      }
    } catch {}

    return Array.from(set);
  }

  function getStyle(el) {
    try { return getComputedStyle(el); } catch { return null; }
  }

  function isVisible(el, cs = null) {
    const style = cs || getStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return !!rect && rect.width > 0 && rect.height > 0;
  }

  function getMarkerText(el) {
    return [
      el.id || '',
      typeof el.className === 'string' ? el.className : '',
      el.getAttribute?.('aria-label') || '',
      (el.textContent || '').slice(0, 260)
    ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isDockCandidate(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (!el.isConnected) return false;

    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'META') return false;

    const cs = getStyle(el);
    if (!cs) return false;

    const pos = cs.position;
    if (pos !== 'fixed' && pos !== 'absolute') return false;
    if (!isVisible(el, cs)) return false;

    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;

    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);
    const areaRatio = (rect.width * rect.height) / (vw * vh);

    if (rect.width > vw * CFG.maxWidthRatio) return false;
    if (rect.height > vh * CFG.maxHeightRatio) return false;
    if (areaRatio > CFG.maxAreaRatio) return false;

    const z = parseInt(cs.zIndex, 10);
    const marker = getMarkerText(el);

    const hasBigZ = Number.isFinite(z) && z >= CFG.minZIndex;
    const hasMarker =
      /(^|[^a-z])(hb|tm|aqb|home bot|guidewire|apex|vin|cnq|dup|az-ha)([^a-z]|$)/i.test(marker) ||
      /aqb:\s*(start|stop)/i.test(marker) ||
      /home bot/i.test(marker);

    if (!hasBigZ && !hasMarker) return false;

    if (/(toast|tooltip|modal|backdrop|overlay|spinner|loading|dropdown|listbox|menu|popover|dialog|autocomplete|suggestion)/i.test(marker)) {
      return false;
    }

    const hasControls = !!el.querySelector('button, input, textarea, select, [role="button"]');
    const shortText = (el.textContent || '').replace(/\s+/g, ' ').trim();

    if (hasMarker) return true;
    if (hasBigZ && hasControls) return true;
    if (hasBigZ && el.matches('button, [role="button"]')) return true;
    if (hasBigZ && shortText.length > 0 && shortText.length < 220) return true;

    return false;
  }

  function getDockItems() {
    const items = [];

    for (const [el, meta] of state.registry.entries()) {
      if (!el || !el.isConnected || !isDockCandidate(el)) continue;

      const rect = el.getBoundingClientRect();

      items.push({
        el,
        order: meta.order,
        width: Math.max(1, Math.ceil(rect.width)),
        height: Math.max(1, Math.ceil(rect.height)),
        area: Math.max(1, Math.ceil(rect.width * rect.height))
      });
    }

    return items;
  }

  function sortBiggestFirst(a, b) {
    if (b.height !== a.height) return b.height - a.height;
    if (b.area !== a.area) return b.area - a.area;
    if (b.width !== a.width) return b.width - a.width;
    return a.order - b.order;
  }

  function arrangeDock() {
    const items = getDockItems().sort(sortBiggestFirst);

    if (items.length !== state.lastDockedCount) {
      state.lastDockedCount = items.length;
      log(`Docked UI count: ${items.length}`);
    }

    updateUI();

    if (!items.length) return;

    const placements = buildPlacements(items);

    for (const p of placements) {
      applyPlacement(p);
    }

    requestAnimationFrame(() => {
      for (const item of items) {
        clampElementIntoViewport(item.el);
      }
    });
  }

  function buildPlacements(items) {
    const remaining = items.slice();
    const placements = [];

    const viewportW = Math.max(window.innerWidth || 1, 1);
    const viewportH = Math.max(window.innerHeight || 1, 1);
    const usableWidth = Math.max(80, viewportW - (CFG.rightGap * 2));

    let bandBottom = CFG.bottomGap;

    while (remaining.length) {
      const verticalRoom = viewportH - CFG.topGap - bandBottom;
      if (verticalRoom <= 24) break;

      const anchorIndex = remaining.findIndex(item => item.height <= verticalRoom);
      if (anchorIndex < 0) break;

      const anchor = remaining.splice(anchorIndex, 1)[0];
      const bandHeight = anchor.height;

      const columns = [
        {
          items: [anchor],
          width: anchor.width,
          usedHeight: anchor.height
        }
      ];

      let usedWidth = anchor.width;

      while (remaining.length) {
        const draft = buildBestColumn(remaining, bandHeight);
        if (!draft) break;

        const proposedWidth = usedWidth + CFG.itemGap + draft.column.width;
        if (proposedWidth > usableWidth) break;

        columns.push(draft.column);
        usedWidth = proposedWidth;

        for (const idx of draft.indices.sort((a, b) => b - a)) {
          remaining.splice(idx, 1);
        }
      }

      let currentRight = CFG.rightGap;

      for (const col of columns) {
        let currentBottom = bandBottom;

        for (const item of col.items) {
          placements.push({
            el: item.el,
            right: currentRight,
            bottom: currentBottom
          });

          currentBottom += item.height + CFG.itemGap;
        }

        currentRight += col.width + CFG.itemGap;
      }

      bandBottom += bandHeight + CFG.itemGap;
    }

    return placements;
  }

  function buildBestColumn(items, bandHeight) {
    const candidates = items
      .map((item, index) => ({ item, index }))
      .filter(x => x.item.height <= bandHeight)
      .sort((a, b) => sortBiggestFirst(a.item, b.item));

    if (!candidates.length) return null;

    const pickedItems = [];
    const pickedIndices = [];
    let usedHeight = 0;
    let colWidth = 0;

    const seed = candidates[0];
    pickedItems.push(seed.item);
    pickedIndices.push(seed.index);
    usedHeight = seed.item.height;
    colWidth = seed.item.width;

    while (true) {
      let bestIndex = -1;
      let bestScore = -1;

      for (let i = 0; i < items.length; i++) {
        if (pickedIndices.includes(i)) continue;

        const item = items[i];
        const nextHeight = usedHeight + CFG.itemGap + item.height;
        if (nextHeight > bandHeight) continue;

        const score = (item.height * 1000000) + item.area;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex < 0) break;

      const item = items[bestIndex];
      pickedItems.push(item);
      pickedIndices.push(bestIndex);
      usedHeight += CFG.itemGap + item.height;
      colWidth = Math.max(colWidth, item.width);
    }

    return {
      column: {
        items: pickedItems,
        width: colWidth,
        usedHeight
      },
      indices: pickedIndices
    };
  }

  function applyPlacement(p) {
    const el = p.el;
    if (!el || !el.isConnected) return;

    try {
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', 'auto', 'important');
      el.style.setProperty('top', 'auto', 'important');
      el.style.setProperty('right', `${Math.max(0, Math.round(p.right))}px`, 'important');
      el.style.setProperty('bottom', `${Math.max(0, Math.round(p.bottom))}px`, 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('margin', '0', 'important');
    } catch {}
  }

  function clampElementIntoViewport(el) {
    if (!el || !el.isConnected) return;

    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const vw = Math.max(window.innerWidth || 1, 1);
    const vh = Math.max(window.innerHeight || 1, 1);

    const maxLeft = Math.max(CFG.sideGap, vw - rect.width - CFG.sideGap);
    const maxTop = Math.max(CFG.topGap, vh - rect.height - CFG.bottomGap);

    const nextLeft = clamp(rect.left, CFG.sideGap, maxLeft);
    const nextTop = clamp(rect.top, CFG.topGap, maxTop);

    try {
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', `${Math.round(nextLeft)}px`, 'important');
      el.style.setProperty('top', `${Math.round(nextTop)}px`, 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.style.setProperty('margin', '0', 'important');
    } catch {}
  }

  function injectStyle() {
    if (document.getElementById(UI.styleId)) return;

    const style = document.createElement('style');
    style.id = UI.styleId;
    style.textContent = `
      #${UI.panelId}{
        position:fixed;
        left:12px;
        bottom:12px;
        width:300px;
        z-index:${CFG.uiZ};
        background:rgba(16,20,27,.96);
        color:#eef3f7;
        border:1px solid rgba(255,255,255,.12);
        border-radius:12px;
        box-shadow:0 8px 22px rgba(0,0,0,.30);
        font:12px/1.35 Arial,sans-serif;
        overflow:hidden;
        user-select:none;
      }
      #${UI.panelId} *{ box-sizing:border-box; }
      #${UI.headId}{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        padding:8px 10px;
        background:rgba(255,255,255,.06);
        cursor:move;
      }
      #${UI.panelId} .title{ font-weight:700; }
      #${UI.panelId} .ver{ font-size:11px; opacity:.75; }
      #${UI.panelId} .body{ padding:10px; }
      #${UI.panelId} .row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:8px;
        margin-bottom:8px;
      }
      #${UI.statusId}{ font-weight:700; }
      #${UI.countId}{ opacity:.85; }
      #${UI.panelId} .btns{
        display:flex;
        gap:8px;
        margin-bottom:8px;
      }
      #${UI.panelId} button{
        border:1px solid rgba(255,255,255,.12);
        border-radius:8px;
        padding:6px 10px;
        cursor:pointer;
        color:#fff;
        font-weight:700;
        font-size:12px;
      }
      #${UI.toggleId}.on{ background:#166534; }
      #${UI.toggleId}.off{ background:#991b1b; }
      #${UI.rescanId}{ background:#1d4ed8; }
      #${UI.logsBtnId}{ background:#374151; }
      #${UI.logsWrapId}{
        display:none;
        margin-top:8px;
        background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.08);
        border-radius:8px;
        padding:8px;
      }
      #${UI.logsId}{
        max-height:160px;
        overflow:auto;
        white-space:pre-wrap;
        word-break:break-word;
        font-family:Consolas, monospace;
        font-size:11px;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function buildUI() {
    if (document.getElementById(UI.panelId)) return;

    const panel = document.createElement('div');
    panel.id = UI.panelId;
    panel.innerHTML = `
      <div id="${UI.headId}">
        <div>
          <div class="title">${SCRIPT_NAME}</div>
          <div class="ver">V${VERSION}</div>
        </div>
        <div>Dock</div>
      </div>
      <div class="body">
        <div class="row">
          <div id="${UI.statusId}">RUNNING</div>
          <div id="${UI.countId}">0 UI</div>
        </div>
        <div class="btns">
          <button id="${UI.toggleId}" class="on" type="button">STOP</button>
          <button id="${UI.rescanId}" type="button">RESCAN</button>
          <button id="${UI.logsBtnId}" type="button">LOGS</button>
        </div>
        <div id="${UI.logsWrapId}">
          <div id="${UI.logsId}"></div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    restorePanelPos(panel);
    makeDraggable(panel, panel.querySelector(`#${UI.headId}`));
    setLogsOpen(loadLogsOpen());
    updateUI();
  }

  function bindUI() {
    document.getElementById(UI.toggleId)?.addEventListener('click', () => {
      state.running = !state.running;
      log(state.running ? 'Organizer resumed' : 'Organizer stopped for this page session');
      updateUI();
      if (state.running) fullScanAndArrange();
    });

    document.getElementById(UI.rescanId)?.addEventListener('click', () => {
      log('Manual rescan');
      fullScanAndArrange();
    });

    document.getElementById(UI.logsBtnId)?.addEventListener('click', () => {
      setLogsOpen(!loadLogsOpen());
      setTimeout(() => {
        if (state.running) fullScanAndArrange();
      }, 30);
    });
  }

  function updateUI() {
    const status = document.getElementById(UI.statusId);
    const count = document.getElementById(UI.countId);
    const toggle = document.getElementById(UI.toggleId);

    if (status) {
      status.textContent = state.running ? 'RUNNING' : 'STOPPED';
      status.style.color = state.running ? '#86efac' : '#fca5a5';
    }

    if (count) {
      count.textContent = `${state.registry.size} UI`;
    }

    if (toggle) {
      toggle.textContent = state.running ? 'STOP' : 'START';
      toggle.classList.toggle('on', state.running);
      toggle.classList.toggle('off', !state.running);
    }

    renderLogs();
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, CFG.maxLogs);
    renderLogs();
    console.log(`[${SCRIPT_NAME}] ${msg}`);
  }

  function renderLogs() {
    const logs = document.getElementById(UI.logsId);
    if (logs) logs.textContent = state.logs.join('\n');
  }

  function loadLogsOpen() {
    try { return localStorage.getItem(CFG.logsOpenKey) === '1'; } catch { return false; }
  }

  function setLogsOpen(open) {
    const wrap = document.getElementById(UI.logsWrapId);
    if (wrap) wrap.style.display = open ? 'block' : 'none';
    try { localStorage.setItem(CFG.logsOpenKey, open ? '1' : '0'); } catch {}
  }

  function restorePanelPos(panel) {
    try {
      const raw = localStorage.getItem(CFG.posKey);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;

      panel.style.left = `${Math.max(0, pos.left)}px`;
      panel.style.top = `${Math.max(0, pos.top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } catch {}
  }

  function savePanelPos(panel) {
    try {
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(CFG.posKey, JSON.stringify({
        left: rect.left,
        top: rect.top
      }));
    } catch {}
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;

      const rect = panel.getBoundingClientRect();
      state.drag = {
        startX: e.clientX,
        startY: e.clientY,
        left: rect.left,
        top: rect.top
      };

      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onDragMove, true);
      window.addEventListener('mouseup', onDragEnd, true);

      e.preventDefault();
    });
  }

  function onDragMove(e) {
    if (!state.drag) return;

    const panel = document.getElementById(UI.panelId);
    if (!panel) return;

    const dx = e.clientX - state.drag.startX;
    const dy = e.clientY - state.drag.startY;

    const nextLeft = Math.max(0, state.drag.left + dx);
    const nextTop = Math.max(0, state.drag.top + dy);

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function onDragEnd() {
    const panel = document.getElementById(UI.panelId);
    if (panel) savePanelPos(panel);

    state.drag = null;
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onDragMove, true);
    window.removeEventListener('mouseup', onDragEnd, true);
  }
})();