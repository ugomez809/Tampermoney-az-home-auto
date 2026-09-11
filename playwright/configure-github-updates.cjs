const extensionId = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
const base = `chrome-extension://${extensionId}/options.html`;
async function configureGitHubUpdates(context, scripts) {
  const page = await context.newPage();
  try {
    await page.goto(base + '#nav=settings');
    await page.locator('select[name="Check Interval"]').selectOption('86400000');
    await page.locator('input[name="Update disabled scripts"]').check();
    for (const save of await page.locator('input[value="Save"]:visible:enabled').all()) await save.click();
    await page.reload();
    if (await page.locator('select[name="Check Interval"]').inputValue() !== '86400000') throw new Error('Daily update interval did not save');
    for (const script of scripts) {
      await page.goto(base + '#nav=' + script.uuid + '+editor');
      await page.reload();
      await page.locator('.CodeMirror:visible').waitFor({timeout:20000});
      await page.getByText('Settings', {exact:true}).last().click();
      const id = await page.locator('input[type="checkbox"][name="upd"]:visible').evaluateAll(es => es.find(e => {
        try { return atob(e.id.replace(/^input_/, '').replace(/_cb$/, '')).endsWith('check_for_updates'); } catch { return false; }
      })?.id);
      if (!id) throw new Error('Update checkbox missing for ' + script.name);
      await page.locator('[id="' + id + '"]').check();
      await page.locator('input[name="uu"]:visible').fill(script.updateURL);
      await page.locator('input[name="save_update_button"]:visible').click();
      await page.waitForTimeout(350);
    }
    const worker = context.serviceWorkers().find(w => w.url().includes(extensionId));
    const checks = await worker.evaluate(async ids => {
      const stored = await chrome.storage.local.get(ids.map(id => '!extdb.@meta#' + id));
      return ids.map(id => ({uuid:id, enabled: stored['!extdb.@meta#' + id]?.value?.options?.check_for_updates}));
    }, scripts.map(s => s.uuid));
    if (checks.some(s => s.enabled !== true)) throw new Error('Some script update settings did not persist');
    return {intervalHours:24, scripts:checks.length};
  } finally { await page.close().catch(() => {}); }
}
module.exports = {configureGitHubUpdates};
