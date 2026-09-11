function isTampermonkeyStartupTab(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'chrome-extension:') return parsed.hostname === 'dhdgffkkebhmkfjojejmpbldmpobfkfo' && parsed.pathname === '/options.html';
    return ['http:', 'https:'].includes(parsed.protocol)
      && ['tampermonkey.net', 'www.tampermonkey.net'].includes(parsed.hostname)
      && parsed.pathname === '/index.php'
      && (parsed.searchParams.get('updated') === 'true' || parsed.searchParams.get('installed') === 'true');
  } catch { return false; }
}
module.exports = { isTampermonkeyStartupTab };
