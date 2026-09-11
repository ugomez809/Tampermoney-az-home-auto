const extensionId = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';

async function registration(context) {
  const worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${extensionId}/`));
  if (!worker) return { available: false, registered: 0 };
  return worker.evaluate(async () => {
    if (!chrome.userScripts) return { available: false, registered: 0 };
    return { available: true, registered: (await chrome.userScripts.getScripts()).length };
  }).catch(() => ({ available: false, registered: 0 }));
}

async function ensureUserScripts(context) {
  let state = await registration(context);
  if (!state.available) {
    const settings = await context.newPage();
    try {
      await settings.goto(`chrome://extensions/?id=${extensionId}`);
      await settings.evaluate(async id => {
        const info = await chrome.developerPrivate.getExtensionInfo(id);
        if (!info.userScriptsAccess?.isEnabled) throw new Error('Chrome does not permit user-script access for Tampermonkey');
        if (!info.userScriptsAccess.isActive) {
          // Restore this browser permission only; never change individual script toggles or storage.
          await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, userScriptsAccess: true });
        }
      }, extensionId);
    } finally { await settings.close(); }
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    state = await registration(context);
    if (state.available && state.registered > 0) return state;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Tampermonkey did not register its user scripts; refusing to open a nonfunctional automation page');
}

module.exports = { ensureUserScripts };
