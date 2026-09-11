// ==UserScript==
// @name         Generic Selector Auto Clicker V1.1
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Pick elements, save multiple selectors per site, and auto-click matches every 1000ms. Auto-runs on load.
// @match        https://eagentsaml.farmersinsurance.com/login.html*
// @match        https://farmersinsurance.okta.com/app/salesforce/*/sso/saml*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/generic-selector-auto-clicker.user.js
// @downloadURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/files/generic-selector-auto-clicker.user.js
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * Config
     ******************************************************************/
    const STORAGE_KEY = 'tm_generic_selector_auto_clicker_v1';
    const CLICK_INTERVAL_MS = 1000;
    const PANEL_ID = 'tm-gsac-panel';
    const HIGHLIGHT_ID = 'tm-gsac-highlight';
    const LOG_LIMIT = 80;

    /******************************************************************
     * State
     ******************************************************************/
    const siteKey = location.hostname;
    let running = true; // auto-run by default on every load
    let picking = false;
    let clickTimer = null;
    let mutationObserver = null;
    let mutationDebounceTimer = null;
    let highlightBox = null;
    let hoveredElement = null;
    const lastClickMap = new WeakMap();

    /******************************************************************
     * Storage
     ******************************************************************/
    function loadStore() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== 'object') return {};
            if (!Array.isArray(parsed[siteKey])) parsed[siteKey] = [];
            return parsed;
        } catch {
            return { [siteKey]: [] };
        }
    }

    function saveStore(store) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    }

    function getSelectors() {
        const store = loadStore();
        return Array.isArray(store[siteKey]) ? store[siteKey] : [];
    }

    function setSelectors(selectors) {
        const store = loadStore();
        store[siteKey] = selectors;
        saveStore(store);
    }

    function addSelector(selector) {
        const list = getSelectors();
        if (!list.includes(selector)) {
            list.push(selector);
            setSelectors(list);
            log(`Saved: ${selector}`);
        } else {
            log(`Already saved: ${selector}`);
        }
        renderSelectorList();
    }

    function removeSelector(selector) {
        const list = getSelectors().filter(s => s !== selector);
        setSelectors(list);
        log(`Removed: ${selector}`);
        renderSelectorList();
    }

    function clearSelectors() {
        setSelectors([]);
        log('Cleared all selectors for this site');
        renderSelectorList();
    }

    /******************************************************************
     * Utils
     ******************************************************************/
    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }

    function getRealElement(event) {
        const path = event.composedPath ? event.composedPath() : [];
        for (const node of path) {
            if (node instanceof Element) return node;
        }
        return event.target instanceof Element ? event.target : null;
    }

    function isInsidePanel(el) {
        return !!(el && el.closest && el.closest(`#${PANEL_ID}`));
    }

    function isDisabledElement(el) {
        if (!el || !(el instanceof Element)) return true;
        if ('disabled' in el && el.disabled) return true;
        if (el.getAttribute('aria-disabled') === 'true') return true;
        return false;
    }

    function isActuallyPresentAndClickable(el) {
        if (!el || !(el instanceof Element)) return false;
        if (!document.documentElement.contains(el)) return false;
        if (isInsidePanel(el)) return false;
        if (isDisabledElement(el)) return false;

        const style = getComputedStyle(el);
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden') return false;
        if (style.visibility === 'collapse') return false;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 && rect.height <= 0) return false;

        return true;
    }

    function getUsefulClasses(el) {
        const classes = [...(el.classList || [])]
            .filter(c =>
                c &&
                c.length <= 40 &&
                !/\d{3,}/.test(c) &&
                !/^ng-/.test(c) &&
                !/^css-/.test(c) &&
                !/^jsx-/.test(c)
            )
            .slice(0, 3);

        return classes;
    }

    function buildSimplePart(el) {
        let part = el.tagName.toLowerCase();

        if (el.id && !/\s/.test(el.id)) {
            return `#${cssEscape(el.id)}`;
        }

        const preferredAttrs = [
            'data-testid',
            'data-test',
            'data-qa',
            'data-cy',
            'name',
            'aria-label',
            'title',
            'role',
            'type'
        ];

        for (const attr of preferredAttrs) {
            const value = el.getAttribute(attr);
            if (value && value.length <= 80) {
                part += `[${attr}="${cssEscape(value)}"]`;
                return part;
            }
        }

        const classes = getUsefulClasses(el);
        if (classes.length) {
            part += classes.map(c => `.${cssEscape(c)}`).join('');
        }

        return part;
    }

    function makeUniqueSelector(el) {
        if (!(el instanceof Element)) return null;
        if (el === document.body) return 'body';
        if (el.id && !/\s/.test(el.id)) return `#${cssEscape(el.id)}`;

        const parts = [];
        let current = el;
        let depth = 0;

        while (current && current.nodeType === 1 && current !== document.documentElement && depth < 6) {
            let part = buildSimplePart(current);

            const parent = current.parentElement;
            if (parent) {
                const sameTagSiblings = [...parent.children].filter(child => child.tagName === current.tagName);
                if (sameTagSiblings.length > 1) {
                    const index = sameTagSiblings.indexOf(current) + 1;
                    part += `:nth-of-type(${index})`;
                }
            }

            parts.unshift(part);

            const selector = parts.join(' > ');
            try {
                const matches = document.querySelectorAll(selector);
                if (matches.length === 1 && matches[0] === el) {
                    return selector;
                }
            } catch {}

            current = current.parentElement;
            depth++;
        }

        return parts.join(' > ');
    }

    function safeClick(el) {
        try {
            el.click();
            return true;
        } catch {
            try {
                el.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window
                }));
                return true;
            } catch {
                return false;
            }
        }
    }

    function log(message) {
        const box = document.getElementById('tm-gsac-log');
        if (!box) return;

        const time = new Date().toLocaleTimeString();
        const line = document.createElement('div');
        line.textContent = `[${time}] ${message}`;
        box.appendChild(line);

        while (box.children.length > LOG_LIMIT) {
            box.removeChild(box.firstChild);
        }

        box.scrollTop = box.scrollHeight;
    }

    /******************************************************************
     * UI
     ******************************************************************/
    function injectStyles() {
        if (document.getElementById('tm-gsac-styles')) return;

        const style = document.createElement('style');
        style.id = 'tm-gsac-styles';
        style.textContent = `
            #${PANEL_ID} {
                position: fixed;
                top: 14px;
                right: 14px;
                z-index: 2147483647;
                width: 360px;
                background: #111827;
                color: #f9fafb;
                border: 1px solid #374151;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.35);
                font: 12px/1.4 Arial, sans-serif;
                overflow: hidden;
            }
            #${PANEL_ID} * {
                box-sizing: border-box;
                font-family: Arial, sans-serif;
            }
            #${PANEL_ID} .tm-head {
                padding: 10px 12px;
                background: #0f172a;
                border-bottom: 1px solid #374151;
                font-weight: 700;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            #${PANEL_ID} .tm-body {
                padding: 10px;
            }
            #${PANEL_ID} .tm-row {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 8px;
            }
            #${PANEL_ID} button {
                border: 0;
                border-radius: 8px;
                padding: 8px 10px;
                cursor: pointer;
                font-weight: 700;
            }
            #${PANEL_ID} .tm-start { background: #16a34a; color: white; }
            #${PANEL_ID} .tm-stop { background: #dc2626; color: white; }
            #${PANEL_ID} .tm-pick { background: #2563eb; color: white; }
            #${PANEL_ID} .tm-clear { background: #6b7280; color: white; }
            #${PANEL_ID} .tm-status {
                font-weight: 700;
                padding: 4px 8px;
                border-radius: 999px;
                background: #1f2937;
                border: 1px solid #374151;
            }
            #${PANEL_ID} .tm-site {
                margin-bottom: 8px;
                color: #cbd5e1;
                word-break: break-all;
            }
            #${PANEL_ID} .tm-list {
                max-height: 150px;
                overflow: auto;
                border: 1px solid #374151;
                border-radius: 8px;
                background: #0b1220;
                margin-bottom: 8px;
            }
            #${PANEL_ID} .tm-item {
                display: flex;
                gap: 8px;
                align-items: flex-start;
                justify-content: space-between;
                padding: 8px;
                border-bottom: 1px solid #1f2937;
            }
            #${PANEL_ID} .tm-item:last-child {
                border-bottom: 0;
            }
            #${PANEL_ID} .tm-item-text {
                flex: 1;
                word-break: break-word;
                color: #e5e7eb;
            }
            #${PANEL_ID} .tm-remove {
                background: #7f1d1d;
                color: white;
                padding: 5px 8px;
                border-radius: 6px;
            }
            #${PANEL_ID} .tm-log {
                max-height: 140px;
                overflow: auto;
                border: 1px solid #374151;
                border-radius: 8px;
                background: #020617;
                padding: 8px;
                color: #93c5fd;
                white-space: pre-wrap;
                word-break: break-word;
            }
            #${HIGHLIGHT_ID} {
                position: fixed;
                z-index: 2147483646;
                pointer-events: none;
                border: 2px solid #22c55e;
                background: rgba(34, 197, 94, 0.12);
                box-shadow: 0 0 0 999999px rgba(0,0,0,0.08);
                display: none;
            }
        `;
        document.documentElement.appendChild(style);
    }

    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div class="tm-head">
                <span>Selector Auto Clicker</span>
                <span class="tm-status" id="tm-gsac-status">RUNNING</span>
            </div>
            <div class="tm-body">
                <div class="tm-site">Site: ${siteKey}</div>
                <div class="tm-row">
                    <button class="tm-start" id="tm-gsac-start">START</button>
                    <button class="tm-stop" id="tm-gsac-stop">STOP</button>
                    <button class="tm-pick" id="tm-gsac-pick">SAVE SELECTOR</button>
                    <button class="tm-clear" id="tm-gsac-clear">CLEAR ALL</button>
                </div>
                <div class="tm-list" id="tm-gsac-list"></div>
                <div class="tm-log" id="tm-gsac-log"></div>
            </div>
        `;
        document.documentElement.appendChild(panel);

        document.getElementById('tm-gsac-start').addEventListener('click', () => {
            running = true;
            updateStatus();
            startLoop();
            log('Started');
        });

        document.getElementById('tm-gsac-stop').addEventListener('click', () => {
            running = false;
            updateStatus();
            stopLoop();
            log('Stopped');
        });

        document.getElementById('tm-gsac-pick').addEventListener('click', () => {
            startPicking();
        });

        document.getElementById('tm-gsac-clear').addEventListener('click', () => {
            clearSelectors();
        });

        renderSelectorList();
        updateStatus();
        log('Ready');
    }

    function createHighlightBox() {
        if (document.getElementById(HIGHLIGHT_ID)) {
            highlightBox = document.getElementById(HIGHLIGHT_ID);
            return;
        }
        highlightBox = document.createElement('div');
        highlightBox.id = HIGHLIGHT_ID;
        document.documentElement.appendChild(highlightBox);
    }

    function updateStatus() {
        const status = document.getElementById('tm-gsac-status');
        if (!status) return;
        status.textContent = picking ? 'PICK MODE' : (running ? 'RUNNING' : 'STOPPED');
        status.style.color = picking ? '#facc15' : (running ? '#86efac' : '#fca5a5');
    }

    function renderSelectorList() {
        const wrap = document.getElementById('tm-gsac-list');
        if (!wrap) return;

        const selectors = getSelectors();

        if (!selectors.length) {
            wrap.innerHTML = `<div class="tm-item"><div class="tm-item-text">No selectors saved yet.</div></div>`;
            return;
        }

        wrap.innerHTML = '';
        selectors.forEach(selector => {
            const row = document.createElement('div');
            row.className = 'tm-item';

            const text = document.createElement('div');
            text.className = 'tm-item-text';
            text.textContent = selector;

            const btn = document.createElement('button');
            btn.className = 'tm-remove';
            btn.textContent = 'X';
            btn.addEventListener('click', () => removeSelector(selector));

            row.appendChild(text);
            row.appendChild(btn);
            wrap.appendChild(row);
        });
    }

    /******************************************************************
     * Pick Mode
     ******************************************************************/
    function showHighlight(el) {
        if (!highlightBox || !el || !(el instanceof Element) || isInsidePanel(el)) {
            hideHighlight();
            return;
        }

        const rect = el.getBoundingClientRect();
        highlightBox.style.display = 'block';
        highlightBox.style.left = `${rect.left}px`;
        highlightBox.style.top = `${rect.top}px`;
        highlightBox.style.width = `${rect.width}px`;
        highlightBox.style.height = `${rect.height}px`;
    }

    function hideHighlight() {
        if (highlightBox) highlightBox.style.display = 'none';
    }

    function onPickMove(event) {
        if (!picking) return;
        const el = getRealElement(event);
        if (!el || isInsidePanel(el) || el === highlightBox) return;
        hoveredElement = el;
        showHighlight(el);
    }

    function onPickClick(event) {
        if (!picking) return;

        const el = getRealElement(event);
        if (!el || isInsidePanel(el) || el === highlightBox) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const selector = makeUniqueSelector(el);
        if (!selector) {
            log('Could not build selector');
            stopPicking();
            return;
        }

        addSelector(selector);
        stopPicking();
    }

    function startPicking() {
        picking = true;
        hoveredElement = null;
        updateStatus();
        log('Pick mode: click the element to save');
        document.addEventListener('mousemove', onPickMove, true);
        document.addEventListener('click', onPickClick, true);
    }

    function stopPicking() {
        picking = false;
        hoveredElement = null;
        updateStatus();
        hideHighlight();
        document.removeEventListener('mousemove', onPickMove, true);
        document.removeEventListener('click', onPickClick, true);
        log('Pick mode off');
    }

    /******************************************************************
     * Auto Click Loop
     ******************************************************************/
    function processSelectors(source = 'timer') {
        if (!running || picking) return;

        const selectors = getSelectors();
        if (!selectors.length) return;

        const now = Date.now();

        for (const selector of selectors) {
            let matches = [];
            try {
                matches = [...document.querySelectorAll(selector)];
            } catch {
                log(`Bad selector: ${selector}`);
                continue;
            }

            for (const el of matches) {
                if (!isActuallyPresentAndClickable(el)) continue;

                const last = lastClickMap.get(el) || 0;
                if (now - last < CLICK_INTERVAL_MS) continue;

                const clicked = safeClick(el);
                if (clicked) {
                    lastClickMap.set(el, now);
                    log(`Clicked (${source}): ${selector}`);
                }
            }
        }
    }

    function startLoop() {
        stopLoop();

        clickTimer = setInterval(() => {
            processSelectors('timer');
        }, CLICK_INTERVAL_MS);

        mutationObserver = new MutationObserver(() => {
            if (!running || picking) return;
            clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = setTimeout(() => {
                processSelectors('mutation');
            }, 50);
        });

        mutationObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: false
        });
    }

    function stopLoop() {
        if (clickTimer) {
            clearInterval(clickTimer);
            clickTimer = null;
        }

        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        if (mutationDebounceTimer) {
            clearTimeout(mutationDebounceTimer);
            mutationDebounceTimer = null;
        }
    }

    /******************************************************************
     * Init
     ******************************************************************/
    function init() {
        injectStyles();
        createPanel();
        createHighlightBox();
        startLoop();

        if (getSelectors().length) {
            log(`Auto-run armed with ${getSelectors().length} saved selector(s)`);
        } else {
            log('Auto-run armed, no saved selectors yet');
        }

        document.addEventListener('visibilitychange', () => {
            log(document.hidden ? 'Tab in background' : 'Tab active');
        });
    }

    init();
})();