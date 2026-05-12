// ==UserScript==
// @name         Ricochet Pickup / Hangup Counters
// @namespace    local.ricochet-counters
// @version      0.4.0
// @description  Adds Pickup and Hangup counters to Ricochet and sends click/report webhooks.
// @match        https://giainc.ricochet.me/*
// @updateURL    https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/Ricochet%20TM/ricochet-counters.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/Ricochet%20TM/ricochet-counters.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      hooks.zapier.com
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.4.0';
  const HOST_ID = 'rc-call-counter-host';
  const STYLE_ID = 'rc-call-counter-style';
  const PICKER_HIGHLIGHT_ID = 'rc-field-picker-highlight';
  const PICKER_BANNER_ID = 'rc-field-picker-banner';
  const STORAGE_PREFIX = 'rcCallCounter.';
  const ALLOW_NEGATIVE = false;
  const EXTRA_FIELD_COUNT = 10;
  const CALIFORNIA_TIME_ZONE = 'America/Los_Angeles';
  const DAILY_REPORT_HOUR = 17;
  const DAILY_REPORT_MINUTE = 25;
  const CLICK_WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/20214705/4ygs2a0/';
  const REPORT_WEBHOOK_URL = 'https://hooks.zapier.com/hooks/catch/20214705/4ygsty0/';

  // If Ricochet does not expose a name in the page, put the agent name here.
  const CLICKED_BY_OVERRIDE = '';

  const counterDateKey = `${STORAGE_PREFIX}counterDate`;
  const reportSentDateKey = `${STORAGE_PREFIX}reportSentDate`;
  const reportLockKey = `${STORAGE_PREFIX}reportLock`;
  const clickedByOverrideKey = `${STORAGE_PREFIX}clickedByOverride`;
  const extraFieldsKey = `${STORAGE_PREFIX}extraFields`;

  let globalListenersAttached = false;
  let dailyReportTimerStarted = false;
  let activePicker = null;

  const counters = [
    { id: 'pickup', label: 'Pick Ups', payloadKey: 'pickupCount' },
    { id: 'hangup', label: 'Hang Ups', payloadKey: 'hangupCount' },
  ];

  const californiaDisplayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CALIFORNIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const californiaClockFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: CALIFORNIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });

  function storageGet(key, fallback = '') {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      console.warn('[Ricochet Counters] Unable to read localStorage.', error);
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
      return true;
    } catch (error) {
      console.warn('[Ricochet Counters] Unable to write localStorage.', error);
      return false;
    }
  }

  function countKey(id) {
    return `${STORAGE_PREFIX}${id}`;
  }

  function readDateParts(formatter, date = new Date()) {
    const parts = formatter.formatToParts(date).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});

    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      dayPeriod: parts.dayPeriod || '',
      timeZoneName: parts.timeZoneName || 'PT',
    };
  }

  function getCaliforniaParts(date = new Date()) {
    return readDateParts(californiaDisplayFormatter, date);
  }

  function getCaliforniaClockParts(date = new Date()) {
    return readDateParts(californiaClockFormatter, date);
  }

  function getCaliforniaDateKey(date = new Date()) {
    const parts = getCaliforniaParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function getCaliforniaTimestamp(date = new Date()) {
    const parts = getCaliforniaParts(date);
    const displayTime = `${parts.hour}:${parts.minute}:${parts.second}${parts.dayPeriod ? ` ${parts.dayPeriod}` : ''}`;

    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: displayTime,
      timestamp: `${parts.year}-${parts.month}-${parts.day} ${displayTime} ${parts.timeZoneName}`,
      timeZone: CALIFORNIA_TIME_ZONE,
      timeZoneName: parts.timeZoneName,
      parts,
    };
  }

  function ensureCurrentCounterDate() {
    const today = getCaliforniaDateKey();
    const savedDate = storageGet(counterDateKey);

    if (savedDate && savedDate !== today) {
      counters.forEach((counter) => storageSet(countKey(counter.id), '0'));
    }

    if (savedDate !== today) {
      storageSet(counterDateKey, today);
    }
  }

  function readCount(id) {
    ensureCurrentCounterDate();
    const value = Number(storageGet(countKey(id), '0'));
    return Number.isFinite(value) ? value : 0;
  }

  function writeCount(id, value) {
    ensureCurrentCounterDate();
    const nextValue = ALLOW_NEGATIVE ? value : Math.max(0, value);
    storageSet(countKey(id), nextValue);
    renderCounts();
    return nextValue;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${HOST_ID}.rc-call-counter-host {
        --rc-counter-nav-height: 44px;
        display: flex !important;
        align-items: center;
        gap: 7px;
        height: var(--rc-counter-nav-height);
        padding: 0 10px 0 4px;
        line-height: normal;
        position: relative;
        white-space: nowrap;
      }

      .navbar-nav > #${HOST_ID}.rc-call-counter-host {
        float: left;
      }

      #${HOST_ID} .rc-call-counter {
        display: grid;
        grid-template-rows: 13px 21px;
        width: 86px;
        height: 36px;
        box-sizing: border-box;
        overflow: hidden;
        color: #fff;
        background: linear-gradient(180deg, rgba(84, 163, 222, 0.24), rgba(44, 64, 84, 0.5));
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 3px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 1px 2px rgba(0, 0, 0, 0.18);
        font-family: inherit;
      }

      #${HOST_ID} .rc-call-counter-title {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        padding: 1px 5px 0;
        font-size: 10px;
        font-weight: 700;
        line-height: 12px;
        color: rgba(255, 255, 255, 0.94);
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
      }

      #${HOST_ID} .rc-call-counter-controls {
        display: grid;
        grid-template-columns: 22px 1fr 22px;
        align-items: center;
        gap: 2px;
        padding: 1px 3px 3px;
      }

      #${HOST_ID} .rc-call-counter-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 19px;
        padding: 0;
        color: #fff;
        background: rgba(255, 255, 255, 0.13);
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 2px;
        font-size: 15px;
        font-weight: 700;
        line-height: 1;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease, transform 80ms ease;
      }

      #${HOST_ID} .rc-call-counter-button:hover,
      #${HOST_ID} .rc-call-counter-button:focus {
        background: #4da3df;
        border-color: rgba(255, 255, 255, 0.55);
        outline: none;
      }

      #${HOST_ID} .rc-call-counter-button:active {
        transform: translateY(1px);
      }

      #${HOST_ID} .rc-call-counter-button:disabled {
        cursor: default;
        opacity: 0.42;
      }

      #${HOST_ID} .rc-call-counter-value {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        height: 19px;
        color: #fff;
        font-size: 15px;
        font-weight: 700;
        line-height: 19px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      #${HOST_ID} .rc-counter-options {
        position: relative;
        display: flex;
        align-items: center;
        height: 36px;
      }

      #${HOST_ID} .rc-counter-options-trigger {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        width: 28px;
        height: 34px;
        padding: 0;
        color: #fff;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 3px;
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
      }

      #${HOST_ID} .rc-counter-options-trigger:hover,
      #${HOST_ID} .rc-counter-options-trigger:focus,
      #${HOST_ID} .rc-counter-options.is-open .rc-counter-options-trigger {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.25);
        outline: none;
      }

      #${HOST_ID} .rc-counter-dot {
        width: 3px;
        height: 3px;
        background: currentColor;
        border-radius: 50%;
        box-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
      }

      #${HOST_ID} .rc-counter-options-menu {
        position: absolute;
        top: calc(100% + 5px);
        right: 0;
        display: none;
        min-width: 112px;
        padding: 5px 0;
        background: #fff;
        border: 1px solid rgba(0, 0, 0, 0.15);
        border-radius: 3px;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.18);
        z-index: 10000;
      }

      #${HOST_ID} .rc-counter-options.is-open .rc-counter-options-menu {
        display: block;
      }

      #${HOST_ID} .rc-counter-options-menu::before {
        content: "";
        position: absolute;
        top: -6px;
        right: 10px;
        width: 10px;
        height: 10px;
        background: #fff;
        border-left: 1px solid rgba(0, 0, 0, 0.15);
        border-top: 1px solid rgba(0, 0, 0, 0.15);
        transform: rotate(45deg);
      }

      #${HOST_ID} .rc-counter-menu-action {
        display: block;
        width: 100%;
        padding: 7px 14px;
        color: #333;
        background: transparent;
        border: 0;
        font: inherit;
        font-size: 13px;
        line-height: 1.3;
        text-align: left;
        cursor: pointer;
      }

      #${HOST_ID} .rc-counter-menu-action:hover,
      #${HOST_ID} .rc-counter-menu-action:focus {
        color: #fff;
        background: #4da3df;
        outline: none;
      }

      #${PICKER_HIGHLIGHT_ID} {
        position: fixed;
        display: none;
        pointer-events: none;
        border: 2px solid #4da3df;
        border-radius: 3px;
        background: rgba(77, 163, 223, 0.14);
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.18);
        z-index: 2147483646;
      }

      #${PICKER_BANNER_ID} {
        position: fixed;
        left: 50%;
        top: 62px;
        transform: translateX(-50%);
        display: none;
        max-width: min(520px, calc(100vw - 24px));
        padding: 8px 12px;
        color: #fff;
        background: rgba(44, 64, 84, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 4px;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.24);
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.3;
        text-align: center;
        z-index: 2147483647;
      }

      body.rc-field-picker-active {
        cursor: crosshair !important;
      }

      @media (max-width: 767px) {
        #${HOST_ID}.rc-call-counter-host {
          justify-content: flex-start;
          height: auto;
          padding: 8px 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function findHelpLink() {
    const links = Array.from(document.querySelectorAll('a.dropdown-toggle[data-toggle="dropdown"], a.dropdown-toggle'));
    return links.find((link) => {
      const text = link.textContent.replace(/\s+/g, ' ').trim();
      return text === 'Help' || text.startsWith('Help ');
    });
  }

  function getNavHeight(helpLink) {
    const navbar =
      helpLink.closest('.navbar-collapse') ||
      document.querySelector('.navbar-collapse.collapse') ||
      helpLink.closest('.navbar') ||
      document.querySelector('.navbar');

    const measuredHeight = navbar ? Math.round(navbar.getBoundingClientRect().height) : 0;
    return measuredHeight > 0 ? `${measuredHeight}px` : '44px';
  }

  function createCounterMarkup(counter) {
    return `
      <div class="rc-call-counter" data-counter="${counter.id}" aria-label="${counter.label} counter">
        <div class="rc-call-counter-title">${counter.label}</div>
        <div class="rc-call-counter-controls">
          <button class="rc-call-counter-button" type="button" data-action="decrement" data-counter="${counter.id}" aria-label="Subtract one ${counter.label}">-</button>
          <span class="rc-call-counter-value" data-value="${counter.id}">0</span>
          <button class="rc-call-counter-button" type="button" data-action="increment" data-counter="${counter.id}" aria-label="Add one ${counter.label}">+</button>
        </div>
      </div>
    `;
  }

  function createOptionsMarkup() {
    return `
      <div class="rc-counter-options">
        <button class="rc-counter-options-trigger" type="button" aria-label="Counter options" aria-expanded="false">
          <span class="rc-counter-dot" aria-hidden="true"></span>
          <span class="rc-counter-dot" aria-hidden="true"></span>
          <span class="rc-counter-dot" aria-hidden="true"></span>
        </button>
        <div class="rc-counter-options-menu" role="menu">
          <button class="rc-counter-menu-action rc-counter-submit" type="button" role="menuitem">Submit</button>
          <button class="rc-counter-menu-action rc-counter-pick-field" type="button" role="menuitem">Pick Element</button>
        </div>
      </div>
    `;
  }

  function buildHost(asListItem) {
    const host = document.createElement(asListItem ? 'li' : 'div');
    host.id = HOST_ID;
    host.className = 'rc-call-counter-host';
    host.innerHTML = `${counters.map(createCounterMarkup).join('')}${createOptionsMarkup()}`;

    host.addEventListener('click', (event) => {
      const optionsTrigger = event.target.closest('.rc-counter-options-trigger');
      if (optionsTrigger) {
        event.preventDefault();
        event.stopPropagation();
        toggleOptionsMenu(host);
        return;
      }

      const submitButton = event.target.closest('.rc-counter-submit');
      if (submitButton) {
        event.preventDefault();
        event.stopPropagation();
        sendReportWebhook('manual_submit');
        setOptionsMenuOpen(host, false);
        return;
      }

      const pickFieldButton = event.target.closest('.rc-counter-pick-field');
      if (pickFieldButton) {
        event.preventDefault();
        event.stopPropagation();
        setOptionsMenuOpen(host, false);
        promptForElementPicker();
        return;
      }

      const button = event.target.closest('.rc-call-counter-button');
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      const counterId = button.getAttribute('data-counter');
      const action = button.getAttribute('data-action');
      const counter = counters.find((item) => item.id === counterId);
      const currentValue = readCount(counterId);
      const delta = action === 'increment' ? 1 : -1;
      const nextValue = writeCount(counterId, currentValue + delta);

      sendClickWebhook({
        action,
        button: action === 'increment' ? '+' : '-',
        counterId,
        counterLabel: counter ? counter.label : counterId,
        counterValueAfterClick: nextValue,
      });
    });

    return host;
  }

  function setOptionsMenuOpen(host, isOpen) {
    const options = host.querySelector('.rc-counter-options');
    const trigger = host.querySelector('.rc-counter-options-trigger');
    if (!options || !trigger) return;

    options.classList.toggle('is-open', isOpen);
    trigger.setAttribute('aria-expanded', String(isOpen));
  }

  function toggleOptionsMenu(host) {
    const options = host.querySelector('.rc-counter-options');
    setOptionsMenuOpen(host, !options.classList.contains('is-open'));
  }

  function getSlotName(index) {
    return String(index + 1).padStart(2, '0');
  }

  function createEmptyExtraFields() {
    return Array.from({ length: EXTRA_FIELD_COUNT }, () => ({
      name: '',
      selector: '',
      value: '',
      updatedAtCalifornia: '',
    }));
  }

  function normalizeExtraFields(fields) {
    const normalized = createEmptyExtraFields();
    if (!Array.isArray(fields)) return normalized;

    fields.slice(0, EXTRA_FIELD_COUNT).forEach((field, index) => {
      normalized[index] = {
        name: field && field.name ? String(field.name) : '',
        selector: field && field.selector ? String(field.selector) : '',
        value: field && field.value ? String(field.value) : '',
        updatedAtCalifornia: field && field.updatedAtCalifornia ? String(field.updatedAtCalifornia) : '',
      };
    });

    return normalized;
  }

  function loadExtraFields() {
    try {
      return normalizeExtraFields(JSON.parse(storageGet(extraFieldsKey, '[]')));
    } catch (error) {
      console.warn('[Ricochet Counters] Unable to parse saved picker fields.', error);
      return createEmptyExtraFields();
    }
  }

  function saveExtraFields(fields) {
    storageSet(extraFieldsKey, JSON.stringify(normalizeExtraFields(fields)));
  }

  function parseFieldPromptResponse(value) {
    const trimmed = String(value || '').replace(/\s+/g, ' ').trim();
    if (!trimmed) return null;

    const slotMatch = trimmed.match(/^(?:slot\s*)?([1-9]|10)\s*[:.)-]\s*(.+)$/i);
    if (!slotMatch) {
      return {
        name: trimmed,
        slotIndex: null,
      };
    }

    return {
      name: slotMatch[2].trim(),
      slotIndex: Number(slotMatch[1]) - 1,
    };
  }

  function findExtraFieldSlot(fields, requestedSlotIndex, fieldName) {
    if (Number.isInteger(requestedSlotIndex) && requestedSlotIndex >= 0 && requestedSlotIndex < EXTRA_FIELD_COUNT) {
      return requestedSlotIndex;
    }

    const matchingIndex = fields.findIndex((field) => field.name.toLowerCase() === fieldName.toLowerCase());
    if (matchingIndex >= 0) return matchingIndex;

    const emptyIndex = fields.findIndex((field) => !field.name && !field.selector && !field.value);
    return emptyIndex >= 0 ? emptyIndex : EXTRA_FIELD_COUNT - 1;
  }

  function promptForElementPicker() {
    if (activePicker) cancelElementPicker();

    const response = window.prompt('Field name for the payload. Optional: use "1: Field Name" through "10: Field Name" to replace a specific slot.');
    if (response === null) return;

    const parsed = parseFieldPromptResponse(response);
    if (!parsed || !parsed.name) return;

    startElementPicker(parsed.name, parsed.slotIndex);
  }

  function ensurePickerElements() {
    let highlight = document.getElementById(PICKER_HIGHLIGHT_ID);
    if (!highlight) {
      highlight = document.createElement('div');
      highlight.id = PICKER_HIGHLIGHT_ID;
      document.body.appendChild(highlight);
    }

    let banner = document.getElementById(PICKER_BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = PICKER_BANNER_ID;
      document.body.appendChild(banner);
    }

    return { highlight, banner };
  }

  function startElementPicker(fieldName, slotIndex) {
    const elements = ensurePickerElements();
    const slotLabel = Number.isInteger(slotIndex) ? `extraField${getSlotName(slotIndex)}` : 'next extra field';

    activePicker = {
      fieldName,
      slotIndex,
      highlight: elements.highlight,
      banner: elements.banner,
    };

    elements.banner.textContent = `Pick element for "${fieldName}" (${slotLabel}). Press Esc to cancel.`;
    elements.banner.style.display = 'block';
    elements.highlight.style.display = 'none';
    document.body.classList.add('rc-field-picker-active');
    document.addEventListener('mousemove', handlePickerMove, true);
    document.addEventListener('click', handlePickerClick, true);
    document.addEventListener('keydown', handlePickerKeydown, true);
  }

  function cancelElementPicker() {
    stopElementPicker();
    console.info('[Ricochet Counters] Element picker cancelled.');
  }

  function stopElementPicker() {
    if (!activePicker) return;

    document.removeEventListener('mousemove', handlePickerMove, true);
    document.removeEventListener('click', handlePickerClick, true);
    document.removeEventListener('keydown', handlePickerKeydown, true);
    document.body.classList.remove('rc-field-picker-active');

    if (activePicker.highlight) activePicker.highlight.style.display = 'none';
    if (activePicker.banner) activePicker.banner.style.display = 'none';

    activePicker = null;
  }

  function getPickableTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;

    const element = target;
    if (element.closest(`#${HOST_ID}, #${PICKER_BANNER_ID}`)) return null;
    if (element.id === PICKER_HIGHLIGHT_ID) return null;
    if (element === document.documentElement || element === document.body) return null;

    return element;
  }

  function updatePickerHighlight(element) {
    if (!activePicker || !activePicker.highlight) return;

    if (!element) {
      activePicker.highlight.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      activePicker.highlight.style.display = 'none';
      return;
    }

    activePicker.highlight.style.display = 'block';
    activePicker.highlight.style.left = `${Math.max(0, rect.left)}px`;
    activePicker.highlight.style.top = `${Math.max(0, rect.top)}px`;
    activePicker.highlight.style.width = `${rect.width}px`;
    activePicker.highlight.style.height = `${rect.height}px`;
  }

  function handlePickerMove(event) {
    if (!activePicker) return;
    updatePickerHighlight(getPickableTarget(event.target));
  }

  function handlePickerClick(event) {
    if (!activePicker) return;

    const element = getPickableTarget(event.target);
    if (!element) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    savePickedElement(element);
    stopElementPicker();
  }

  function handlePickerKeydown(event) {
    if (!activePicker || event.key !== 'Escape') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cancelElementPicker();
  }

  function cleanPickedValue(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractElementValue(element) {
    if (!element) return '';

    const tagName = element.tagName ? element.tagName.toLowerCase() : '';
    if (tagName === 'input') {
      const type = String(element.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        return element.checked ? cleanPickedValue(element.value || 'checked') : '';
      }

      return cleanPickedValue(element.value);
    }

    if (tagName === 'select') {
      const option = element.selectedOptions && element.selectedOptions[0];
      return cleanPickedValue((option && option.textContent) || element.value);
    }

    if (tagName === 'textarea') return cleanPickedValue(element.value);
    if (element.isContentEditable) return cleanPickedValue(element.innerText || element.textContent);

    return cleanPickedValue(
      element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.innerText ||
        element.textContent
    );
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function escapeAttributeValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function isUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (error) {
      return false;
    }
  }

  function getElementSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return '';

    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
      if (isUniqueSelector(selector)) return selector;
    }

    const tagName = element.tagName.toLowerCase();
    const attributes = ['name', 'data-field', 'data-name', 'data-ng-model', 'ng-model', 'aria-label', 'title', 'placeholder'];
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute);
      if (!value) continue;

      const selector = `${tagName}[${attribute}="${escapeAttributeValue(value)}"]`;
      if (isUniqueSelector(selector)) return selector;
    }

    const segments = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        segment += `#${cssEscape(current.id)}`;
        segments.unshift(segment);
        break;
      }

      const classes = Array.from(current.classList || [])
        .filter((className) => !className.startsWith('ng-'))
        .slice(0, 3)
        .map((className) => `.${cssEscape(className)}`)
        .join('');

      segment += classes;

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (sameTagSiblings.length > 1) {
          segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
        }
      }

      segments.unshift(segment);
      const selector = segments.join(' > ');
      if (isUniqueSelector(selector)) return selector;

      current = parent;
    }

    return segments.join(' > ');
  }

  function savePickedElement(element) {
    if (!activePicker) return;

    const fields = loadExtraFields();
    const slotIndex = findExtraFieldSlot(fields, activePicker.slotIndex, activePicker.fieldName);
    const slotName = getSlotName(slotIndex);

    fields[slotIndex] = {
      name: activePicker.fieldName,
      selector: getElementSelector(element),
      value: extractElementValue(element),
      updatedAtCalifornia: getCaliforniaTimestamp().timestamp,
    };

    saveExtraFields(fields);

    window.dispatchEvent(
      new CustomEvent('ricochetCounters:fieldPicked', {
        detail: {
          slot: `extraField${slotName}`,
          field: fields[slotIndex],
        },
      })
    );

    console.info(`[Ricochet Counters] Saved extraField${slotName}.`, fields[slotIndex]);
  }

  function getExtraFieldPayload() {
    const fields = loadExtraFields();

    return fields.reduce((payload, field, index) => {
      const slotName = getSlotName(index);
      let element = null;

      try {
        element = field.selector ? document.querySelector(field.selector) : null;
      } catch (error) {
        element = null;
      }

      payload[`extraField${slotName}Name`] = field.name || '';
      payload[`extraField${slotName}Value`] = element ? extractElementValue(element) : field.value || '';

      return payload;
    }, {});
  }

  function getCountsSnapshot() {
    ensureCurrentCounterDate();
    return counters.reduce((snapshot, counter) => {
      snapshot[counter.id] = readCount(counter.id);
      return snapshot;
    }, {});
  }

  function getFlattenedCounts() {
    const counts = getCountsSnapshot();
    return counters.reduce((result, counter) => {
      result[counter.payloadKey] = counts[counter.id];
      return result;
    }, {});
  }

  function cleanUserCandidate(value) {
    if (!value) return '';

    const text = String(value)
      .replace(/\s+/g, ' ')
      .replace(/\b(caret|logout|sign out|profile|account|settings)\b/gi, '')
      .trim();

    const ignoredValues = new Set(['', 'Help', 'Eligibility +', 'Busy', 'Ready', 'Lead Assignment']);
    if (ignoredValues.has(text)) return '';
    if (/^(help|eligibility|busy|ready)$/i.test(text)) return '';
    return text;
  }

  function getFromPath(source, path) {
    try {
      return path.split('.').reduce((current, key) => (current ? current[key] : undefined), source);
    } catch (error) {
      return undefined;
    }
  }

  function detectCurrentUser() {
    const configuredName = cleanUserCandidate(CLICKED_BY_OVERRIDE);
    if (configuredName) return { name: configuredName, source: 'script override' };

    const storedName = cleanUserCandidate(storageGet(clickedByOverrideKey));
    if (storedName) return { name: storedName, source: 'localStorage override' };

    const globalPaths = [
      'currentUser.name',
      'currentUser.full_name',
      'currentUser.email',
      'user.name',
      'user.full_name',
      'user.email',
      'authUser.name',
      'authUser.email',
      'Ricochet.currentUser.name',
      'Ricochet.currentUser.email',
      'App.currentUser.name',
      'App.currentUser.email',
    ];

    for (const path of globalPaths) {
      const name = cleanUserCandidate(getFromPath(window, path));
      if (name) return { name, source: `window.${path}` };
    }

    const userSelectors = [
      '[data-current-user]',
      '[data-user-name]',
      '.navbar [data-user-name]',
      '.navbar .user-name',
      '.navbar .username',
      '.navbar .profile-name',
      '.navbar .dropdown-user .dropdown-toggle',
      '.navbar .user-menu .dropdown-toggle',
      '.navbar-right .dropdown-toggle[title]',
      '.navbar-right a[title]',
      '.navbar-right button[title]',
      '.nav.navbar-nav.navbar-right li:last-child .dropdown-toggle',
    ];

    for (const selector of userSelectors) {
      const element = document.querySelector(selector);
      if (!element) continue;

      const attributes = [
        element.getAttribute('data-current-user'),
        element.getAttribute('data-user-name'),
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.textContent,
      ];

      for (const attribute of attributes) {
        const name = cleanUserCandidate(attribute);
        if (name) return { name, source: selector };
      }
    }

    return { name: 'Unknown Ricochet user', source: 'fallback' };
  }

  function buildBasePayload(eventName, trigger) {
    const now = new Date();
    const californiaTime = getCaliforniaTimestamp(now);
    const actor = detectCurrentUser();
    const counts = getCountsSnapshot();

    return {
      source: 'ricochet_tampermonkey',
      event: eventName,
      trigger,
      scriptVersion: SCRIPT_VERSION,
      clickedBy: actor.name,
      clickedBySource: actor.source,
      californiaDate: californiaTime.date,
      californiaTime: californiaTime.time,
      californiaTimestamp: californiaTime.timestamp,
      californiaTimeZone: californiaTime.timeZone,
      browserTimestampIso: now.toISOString(),
      counterDateCalifornia: storageGet(counterDateKey, californiaTime.date),
      counts,
      ...getFlattenedCounts(),
      ...getExtraFieldPayload(),
      pageUrl: window.location.href,
      pageTitle: document.title,
    };
  }

  function sendClickWebhook(clickDetail) {
    const payload = {
      ...buildBasePayload('counter_click', 'button_click'),
      clickedAtCalifornia: getCaliforniaTimestamp().timestamp,
      ...clickDetail,
    };

    sendWebhook(CLICK_WEBHOOK_URL, payload, 'click update');
  }

  function sendReportWebhook(trigger) {
    const payload = {
      ...buildBasePayload('counter_report', trigger),
      reportAtCalifornia: getCaliforniaTimestamp().timestamp,
    };

    window.dispatchEvent(new CustomEvent('ricochetCounters:submit', { detail: payload }));
    sendWebhook(REPORT_WEBHOOK_URL, payload, 'counter report');
  }

  function sendWebhook(url, payload, label) {
    const body = JSON.stringify(payload);

    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
        },
        data: body,
        timeout: 15000,
        onload(response) {
          if (response.status >= 400) {
            console.warn(`[Ricochet Counters] ${label} webhook returned ${response.status}.`, payload);
          }
        },
        onerror(error) {
          console.warn(`[Ricochet Counters] ${label} webhook failed.`, error, payload);
        },
        ontimeout() {
          console.warn(`[Ricochet Counters] ${label} webhook timed out.`, payload);
        },
      });
      return;
    }

    window.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body,
      mode: 'no-cors',
      keepalive: true,
    }).catch((error) => {
      console.warn(`[Ricochet Counters] ${label} webhook failed.`, error, payload);
    });
  }

  function hasReachedDailyReportTime() {
    const parts = getCaliforniaClockParts();
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);

    return hour > DAILY_REPORT_HOUR || (hour === DAILY_REPORT_HOUR && minute >= DAILY_REPORT_MINUTE);
  }

  function claimDailyReportLock(dateKey) {
    const now = Date.now();
    const lockValue = storageGet(reportLockKey);

    if (lockValue) {
      try {
        const lock = JSON.parse(lockValue);
        if (lock.dateKey === dateKey && lock.expiresAt > now) return false;
      } catch (error) {
        storageSet(reportLockKey, '');
      }
    }

    const token = `${now}-${Math.random().toString(16).slice(2)}`;
    storageSet(reportLockKey, JSON.stringify({ dateKey, token, expiresAt: now + 60000 }));

    try {
      const savedLock = JSON.parse(storageGet(reportLockKey, '{}'));
      return savedLock.token === token;
    } catch (error) {
      return false;
    }
  }

  function maybeSendScheduledDailyReport() {
    ensureCurrentCounterDate();

    const today = getCaliforniaDateKey();
    if (storageGet(reportSentDateKey) === today) return;
    if (!hasReachedDailyReportTime()) return;
    if (!claimDailyReportLock(today)) return;

    storageSet(reportSentDateKey, today);
    sendReportWebhook('scheduled_5_25_pm_ca');
  }

  function startDailyReportTimer() {
    if (dailyReportTimerStarted) return;
    dailyReportTimerStarted = true;

    maybeSendScheduledDailyReport();
    window.setInterval(maybeSendScheduledDailyReport, 15000);
  }

  function attachGlobalListeners() {
    if (globalListenersAttached) return;
    globalListenersAttached = true;

    document.addEventListener('click', (event) => {
      const host = document.getElementById(HOST_ID);
      if (!host || host.contains(event.target)) return;
      setOptionsMenuOpen(host, false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const host = document.getElementById(HOST_ID);
      if (host) setOptionsMenuOpen(host, false);
    });
  }

  function renderCounts() {
    const host = document.getElementById(HOST_ID);
    if (!host) return;

    ensureCurrentCounterDate();

    counters.forEach((counter) => {
      const value = readCount(counter.id);
      const valueNode = host.querySelector(`[data-value="${counter.id}"]`);
      const minusButton = host.querySelector(`[data-action="decrement"][data-counter="${counter.id}"]`);

      if (valueNode) valueNode.textContent = String(value);
      if (minusButton && !ALLOW_NEGATIVE) minusButton.disabled = value <= 0;
    });
  }

  function mountCounters() {
    injectStyles();

    const helpLink = findHelpLink();
    if (!helpLink) return false;

    const helpItem = helpLink.closest('li') || helpLink;
    const parent = helpItem.parentNode;
    if (!parent) return false;

    let host = document.getElementById(HOST_ID);
    if (host && host.parentNode !== parent) {
      host.remove();
      host = null;
    }

    if (!host) {
      host = buildHost(helpItem.tagName.toLowerCase() === 'li');
      parent.insertBefore(host, helpItem);
    } else if (host.nextSibling !== helpItem) {
      parent.insertBefore(host, helpItem);
    }

    host.style.setProperty('--rc-counter-nav-height', getNavHeight(helpLink));
    renderCounts();
    return true;
  }

  function watchForNavigationChanges() {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        mountCounters();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function start() {
    ensureCurrentCounterDate();
    mountCounters();
    attachGlobalListeners();
    watchForNavigationChanges();
    startDailyReportTimer();
    window.setInterval(mountCounters, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
