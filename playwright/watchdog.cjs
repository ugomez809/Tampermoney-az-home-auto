const crypto = require('node:crypto');
class ActivityDeadline {
  constructor(timeoutMs = 180000, now = performance.now()) { this.timeoutMs = timeoutMs; this.changedAt = now; this.fingerprint = null; }
  observe(value, now = performance.now()) {
    if (typeof value !== 'string' || !value || value === this.fingerprint) return;
    this.fingerprint = value; this.changedAt = now;
  }
  expired(now = performance.now()) { return now - this.changedAt >= this.timeoutMs; }
}
// Read-only page/frame sampling. No userscript or website modifications.
function pageSnapshot() {
  const ignore = 'script,style,noscript,svg,canvas,time,[role="timer"],[role="progressbar"],[class*="spinner" i],[class*="loading" i],[id^="tm-"],[id^="tm_"],[id^="homebot"],[id^="az-"],[id^="gwpc-"]';
  const normalize = value => String(value || '').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/gi, '<clock>').replace(/\b\d+\s*(?:seconds?|secs?)\b/gi, '<seconds>').replace(/\s+/g, ' ').trim();
  const visible = el => {
    if (el.closest(ignore)) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
  };
  const text = [];
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (el && visible(el)) { const value = normalize(walker.currentNode.textContent); if (value) text.push(value); }
    }
  }
  const fields = [...document.querySelectorAll('input:not([type="password"]),select,textarea,[role="tab"],details')].filter(visible)
    .map(el => [el.tagName, el.id, el.type, el.value, el.checked, el.getAttribute('aria-selected'), el.open]);
  return { visible: document.visibilityState === 'visible', focused: document.hasFocus(), content: JSON.stringify([location.href, normalize(document.title), text, fields, scrollX, scrollY]) };
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
module.exports = { ActivityDeadline, pageSnapshot, hash };
