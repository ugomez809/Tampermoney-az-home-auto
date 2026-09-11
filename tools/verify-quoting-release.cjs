const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = JSON.parse(fs.readFileSync(path.join(__dirname, 'quoting-release-files.json'), 'utf8'));
const identities = new Set();
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const value = key => {
    const matches = [...source.matchAll(new RegExp('^//\\s*@' + key + '\\s+([^\\r\\n]+)', 'gm'))];
    assert.equal(matches.length, 1, file + ': expected one @' + key);
    return matches[0][1].trim();
  };
  const identity = value('name') + '\n' + value('namespace');
  assert.ok(!identities.has(identity), file + ': duplicate script identity');
  identities.add(identity);
  assert.match(value('version'), /^\d+(\.\d+)*$/);
  for (const key of ['updateURL', 'downloadURL']) {
    const url = new URL(value(key));
    assert.equal(url.origin, 'https://raw.githubusercontent.com');
    assert.equal(decodeURIComponent(url.pathname).replace('/refs/heads/main/', '/main/'), '/ugomez809/Tampermoney-az-home-auto/main/' + file);
  }
  new vm.Script(source, { filename: file });
}
console.log('Verified syntax, unique identities, versions and GitHub update targets for ' + files.length + ' quoting scripts.');
