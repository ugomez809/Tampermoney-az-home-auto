const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

for (const file of ['files/az-ticket-finisher-tagger.user.js']) {
  test(`${file}: preserves fields without usable replacements`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<form id="detailDockform"><div class="form-group">
        <span id="ambiguous">Property</span><label id="beds-label" for="beds">Beds</label><input id="beds" name="beds" value="3"><input id="zillow" name="zillow" value="https://zillow.com/existing">
        <select id="type" name="type"><option value=""> </option><option value="house" selected>House</option><option value="condo">Condo</option></select>
        </div><input id="baths" type="number" name="baths" value="2"><button type="button">Update</button></form>`);
      await page.evaluate(() => {
        window.GM_getValue = key => key === 'tm_az_ticket_finisher_field_targets_v1'
          ? { Bedrooms: { selector: '#beds' }, Bathrooms: { selector: '#baths' }, 'Home Type': { selector: '#type' } } : null;
        window.GM_setValue = () => {};
        window.events = [];
        window.saves = [];
        document.querySelector('form').addEventListener('input', e => events.push([e.target.id, e.target.value]));
        document.querySelector('button').addEventListener('click', () => saves.push(Object.fromEntries(new FormData(document.querySelector('form')))));
      });
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace('  init();',
        '  window.finisher = { fillTicketFields, setFieldValue, resolveEditableTarget }; sleep = async () => {};');
      await page.addScriptTag({ content: source });
      const result = await page.evaluate(async () => {
        const directTarget = finisher.resolveEditableTarget(document.querySelector('#beds'))?.id;
        const labelTarget = finisher.resolveEditableTarget(document.querySelector('#beds-label'))?.id;
        const ambiguousTarget = finisher.resolveEditableTarget(document.querySelector('#ambiguous'));
        await finisher.fillTicketFields({ fields: { Bedrooms: '4', Bathrooms: '', 'Home Type': 'Unrecognized dwelling' } }, {}, false);
        const afterWrite = Object.fromEntries(new FormData(document.querySelector('form')));
        const saveCount = saves.length;
        await finisher.fillTicketFields({ fields: { Bedrooms: ' ', Bathrooms: null } }, {}, false);
        const noOpSaves = saves.length - saveCount;
        await finisher.fillTicketFields({ fields: { Bedrooms: '4', 'Home Type': 'House' } }, {}, false);
        const unchangedSaves = saves.length - saveCount;
        await finisher.setFieldValue({ selector: '#beds' }, '');
        const afterBlank = document.querySelector('#beds').value;
        await finisher.setFieldValue({ selector: '#type' }, 'Condo');
        const matchedType = document.querySelector('#type').value;
        await finisher.setFieldValue({ selector: '#baths' }, 'N/A');
        const invalidNumber = document.querySelector('#baths').value;
        await finisher.fillTicketFields({ fields: { Bathrooms: 0 } }, {}, false);
        return { directTarget, labelTarget, ambiguousTarget, afterWrite, noOpSaves, unchangedSaves, afterBlank, matchedType, invalidNumber, zero: document.querySelector('#baths').value, events, saves };
      });
      assert.equal(result.directTarget, 'beds', 'an exact saved input must not resolve to its neighboring dropdown');
      assert.equal(result.labelTarget, 'beds');
      assert.equal(result.ambiguousTarget, null, 'ambiguous wrappers must not pick a neighboring field');
      assert.deepEqual(result.afterWrite, { beds: '4', zillow: 'https://zillow.com/existing', type: 'house', baths: '2' });
      assert.deepEqual(result.saves[0], result.afterWrite, 'submitted form must retain untouched values');
      assert.equal(result.noOpSaves, 0, 'blank payload must not submit the ticket');
      assert.equal(result.unchangedSaves, 0, 'unchanged values must not submit the ticket');
      assert.equal(result.afterBlank, '4', 'writer must reject empty replacements');
      assert.equal(result.matchedType, 'condo');
      assert.equal(result.invalidNumber, '2', 'invalid numeric data must not clear a number input');
      assert.equal(result.zero, '0', 'zero is information, not an empty value');
      assert.ok(result.events.every(([, value]) => value !== ''), 'never dispatch an intermediate blank write');
    } finally {
      await browser.close();
    }
  });
}
